import { randomUUID } from 'node:crypto';
import { providerError } from './ai-providers.mjs';

export const roles = ['auto', 'orchestrator', 'designer', 'planner', 'generator', 'reviewer', 'refiner'];
const nonnegative = (value, name) => {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isFinite(value) || value < 0) throw providerError(name + ' phải là số không âm.');
  return value;
};
export function createAgentManager() {
  const agents = new Map(), secrets = new Map();
  let orchestratorId = null;
  function save(body, verifiedClientId = null) {
    if (!body || typeof body !== 'object') throw providerError('Kết nối không hợp lệ.');
    const old = body.id ? agents.get(body.id) : null;
    if (body.id && !old) throw providerError('Không tìm thấy AI.');
    const provider = body.provider ?? old?.provider;
    if (!['openai', 'gemini'].includes(provider)) throw providerError('Provider chưa được hỗ trợ.');
    const model = body.model ?? old?.model;
    const name = body.name ?? old?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw providerError('Hãy nhập tên AI từ 1 đến 100 ký tự.');
    if (typeof model !== 'string' || !/^[\w.:-]{1,120}$/.test(model)) throw providerError('Hãy chọn model trong danh sách hoặc nhập ID hợp lệ ở mục Model khác.');
    // Credentials are opaque header values, not a fixed provider-specific regex.
    // In particular, Gemini authorization keys can contain dots (AQ.…).
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : body.apiKey;
    if (apiKey !== undefined && (typeof apiKey !== 'string' || !/^[\x21-\x7e]{16,4096}$/.test(apiKey))) throw providerError('API key bị thiếu, quá dài hoặc chứa khoảng trắng/ký tự không hợp lệ. Hãy dùng nút Copy để sao chép toàn bộ key.');
    if (!old && !apiKey && !verifiedClientId) throw providerError('Cần API key cho kết nối mới.');
    if (old && provider !== old.provider && !apiKey) throw providerError('Đổi provider cần API key mới.');
    const role = body.role ?? old?.role ?? 'auto';
    if (!roles.includes(role)) throw providerError('Vai trò không hợp lệ.');
    const caps = body.capabilities ?? old?.capabilities ?? { tools: true, vision: true };
    if (typeof caps?.tools !== 'boolean' || typeof caps?.vision !== 'boolean') throw providerError('Khả năng AI không hợp lệ.');
    const limits = { ...old?.limits };
    for (const key of ['requests', 'tokens', 'costUSD']) if (body.limits && key in body.limits) {
      limits[key] = nonnegative(body.limits[key], key);
      if (key !== 'costUSD' && limits[key] !== null && !Number.isSafeInteger(limits[key])) throw providerError('Giới hạn request/token phải là số nguyên.');
    }
    const pricing = { ...old?.pricing };
    for (const key of ['input', 'cached', 'output']) if (body.pricing && key in body.pricing) pricing[key] = nonnegative(body.pricing[key], key);
    const id = old?.id || randomUUID();
    const agent = { id, name: name.trim(), provider, model, authMethod: verifiedClientId ? 'chatgpt_oauth' : old?.authMethod || 'api_key_memory',
      clientId: verifiedClientId || old?.clientId || null, enabled: body.enabled ?? old?.enabled ?? true,
      role, capabilities: { tools: caps.tools, vision: caps.vision }, limits, pricing, status: old?.status || 'unverified',
      usage: old?.usage || { requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUSD: 0, unpricedRequests: 0, unreportedRequests: 0 } };
    if (typeof agent.enabled !== 'boolean') throw providerError('Trạng thái AI không hợp lệ.');
    if (body.orchestrator === true && (!agent.enabled || !agent.capabilities.tools)) throw providerError('Orchestrator phải bật và hỗ trợ công cụ.');
    agents.set(id, agent);
    if (apiKey) secrets.set(id, apiKey);
    if (!agent.enabled && orchestratorId === id) orchestratorId = null;
    if (agent.enabled && agent.capabilities.tools && (body.orchestrator === true || !orchestratorId)) orchestratorId = id;
    return id;
  }
  function remove(id) { if (!agents.delete(id)) throw providerError('Không tìm thấy AI.'); secrets.delete(id); if (id === orchestratorId) orchestratorId = null; }
  function connection(id) {
    const agent = agents.get(id);
    if (!agent?.enabled) throw providerError('AI đã tắt hoặc bị xóa.', 409);
    return { ...structuredClone(agent), accessToken: secrets.get(id), chatgpt: agent.authMethod === 'chatgpt_oauth', accountId: agent.clientId };
  }
  function choose({ role = 'auto', id, vision = false, tools = true, exclude = [] } = {}) {
    const compatible = agent => agent.enabled && !exclude.includes(agent.id) && (!vision || agent.capabilities.vision) && (!tools || agent.capabilities.tools);
    if (id) {
      const agent = agents.get(id);
      if (!agent || !compatible(agent)) throw providerError('AI được chỉ định không có khả năng phù hợp hoặc đã tắt.', 409);
      return connection(id);
    }
    const hasBudget = agent => (agent.limits.requests == null || agent.usage.requests < agent.limits.requests) &&
      (agent.limits.tokens == null || agent.usage.inputTokens + agent.usage.outputTokens < agent.limits.tokens) &&
      (agent.limits.costUSD == null || agent.usage.costUSD < agent.limits.costUSD);
    const candidates = [...agents.values()].filter(compatible).filter(hasBudget).sort((a, b) => {
      const rank = agent => (agent.role === role ? -10 : agent.role === 'auto' ? 0 : 5) +
        (agent.status === 'offline' ? 100 : 0) + (agent.pricing.input ?? 1) + (agent.pricing.output ?? 1);
      return rank(a) - rank(b);
    });
    if (!candidates.length) throw providerError('Không có AI tương thích cho nhiệm vụ này.', 409);
    return connection(candidates[0].id);
  }
  function status(id, value) { const agent = agents.get(id); if (agent) agent.status = value; }
  function record(id, usage, costUSD) {
    const agent = agents.get(id); if (!agent) return;
    agent.usage.requests++;
    for (const field of ['inputTokens', 'outputTokens', 'cachedTokens']) agent.usage[field] += usage[field];
    if (costUSD === null) agent.usage.unpricedRequests++; else agent.usage.costUSD += costUSD;
    if (!usage.reported) agent.usage.unreportedRequests++;
  }
  return { save, remove, choose, connection, status, record,
    snapshot: () => ({ agents: structuredClone([...agents.values()]), orchestratorId }),
    get orchestratorId() { return orchestratorId; },
    setOrchestrator(id) { if (!agents.get(id)?.enabled || !agents.get(id)?.capabilities.tools) throw providerError('Orchestrator phải bật và hỗ trợ công cụ.'); orchestratorId = id; } };
}
