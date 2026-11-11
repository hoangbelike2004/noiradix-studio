import { providerError } from './ai-providers.mjs';

export function costFor(usage, pricing = {}) {
  if (!usage.reported || !['input', 'output'].every(key => Number.isFinite(pricing[key])) || (usage.cachedTokens && !Number.isFinite(pricing.cached))) return null;
  return ((usage.inputTokens - usage.cachedTokens) * pricing.input + usage.cachedTokens * (pricing.cached ?? pricing.input) + usage.outputTokens * pricing.output) / 1e6;
}

export class TokenCostMonitor {
  constructor(manager) { this.manager = manager; this.records = []; this.reservations = new Map(); }
  reserve(run, connection, request) {
    if (connection.chatgpt && [run.policy.maxTokens, run.policy.maxCostUSD, connection.limits?.tokens, connection.limits?.costUSD].some(value => value !== null && value !== undefined)) throw providerError('Phiên gói ChatGPT không hỗ trợ chặn output bằng API này. Dùng kết nối API key cho giới hạn token/USD.', 409);
    // Byte count is a conservative text-token estimate, not measured usage. A
    // separate image allowance is required; unknown pricing refuses a USD cap.
    const text = JSON.stringify(request);
    const images = (text.match(/"type":"input_image"/g) || []).length;
    const input = Buffer.byteLength(text) + images * 8192;
    const estimate = { inputTokens: input, outputTokens: run.policy.maxOutputTokens, cachedTokens: 0, reported: true };
    const estimatedCost = costFor(estimate, connection.pricing);
    const pending = [...this.reservations.values()];
    const sameRun = pending.filter(item => item.runId === run.id), sameAgent = pending.filter(item => item.agentId === connection.id);
    const agentUsage = this.manager.snapshot().agents.find(item => item.id === connection.id)?.usage || {};
    const used = run.usage;
    if ((used.unreportedRequests && [run.policy.maxTokens, run.policy.maxCostUSD].some(value => value !== null)) ||
      (agentUsage.unreportedRequests && [connection.limits?.tokens, connection.limits?.costUSD].some(value => value !== null && value !== undefined))) throw providerError('Usage trước đó chưa được provider xác nhận. Đã dừng để bảo vệ ngân sách.', 409);
    const tokens = estimate.inputTokens + estimate.outputTokens;
    const check = (limit, actual, reserved, next, label) => {
      if (limit !== null && limit !== undefined && actual + reserved + next > limit) throw providerError('Đã đạt giới hạn ' + label + '.', 409);
    };
    check(run.policy.maxRequests, used.requests, 0, 1, 'request của nhiệm vụ');
    check(run.policy.maxTokens, used.inputTokens + used.outputTokens, sameRun.reduce((sum, item) => sum + item.tokens, 0), tokens, 'token của nhiệm vụ');
    check(connection.limits?.requests, agentUsage.requests || 0, sameAgent.length, 1, 'request của AI');
    check(connection.limits?.tokens, (agentUsage.inputTokens || 0) + (agentUsage.outputTokens || 0), sameAgent.reduce((sum, item) => sum + item.tokens, 0), tokens, 'token của AI');
    for (const [limit, actual, entries] of [[run.policy.maxCostUSD, used.costUSD, sameRun], [connection.limits?.costUSD, agentUsage.costUSD || 0, sameAgent]]) {
      if (limit !== null && limit !== undefined) {
        if (estimatedCost === null) throw providerError('Cần nhập giá model trước khi đặt giới hạn USD.', 409);
        check(limit, actual, entries.reduce((sum, item) => sum + (item.cost || 0), 0), estimatedCost, 'chi phí ước tính');
      }
    }
    const id = Symbol(); this.reservations.set(id, { runId: run.id, agentId: connection.id, tokens, cost: estimatedCost });
    used.requests++;
    return id;
  }
  finish(id, run, connection, usage, elapsedMs, error = false) {
    this.reservations.delete(id);
    const measured = usage || { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reported: false };
    const costUSD = connection.chatgpt ? null : costFor(measured, connection.pricing);
    for (const field of ['inputTokens', 'outputTokens', 'cachedTokens']) run.usage[field] += measured[field];
    run.usage.elapsedMs += elapsedMs;
    if (costUSD === null) run.usage.unpricedRequests++; else run.usage.costUSD += costUSD;
    if (!measured.reported) run.usage.unreportedRequests++;
    this.manager.record(connection.id, measured, costUSD);
    const row = { runId: run.id, mode: run.mode, agentId: connection.id, provider: connection.provider || 'openai', model: connection.model,
      ...measured, costUSD, elapsedMs, error, at: Date.now() };
    this.records.push(row); if (this.records.length > 1000) this.records.shift();
  }
}

export const emptyUsage = () => ({ requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUSD: 0,
  unpricedRequests: 0, unreportedRequests: 0, elapsedMs: 0, cacheHits: 0, cacheLookups: 0 });

export function workflowPolicy(value = {}) {
  const defaults = { maxRequests: 32, maxRounds: 32, maxOutputTokens: 10000, maxRetries: 1, maxRepairRounds: 2, maxTasks: 8, maxTokens: null, maxCostUSD: null, allowFallback: true, assignment: 'auto', optimized: true };
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) if (key in value) result[key] = value[key];
  const limits = { maxRequests: [1, 64], maxRounds: [1, 32], maxOutputTokens: [256, 16000], maxRetries: [0, 2], maxRepairRounds: [0, 8], maxTasks: [0, 16], maxTokens: [0, 10000000], maxCostUSD: [0, 10000] };
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (result[key] === null && ['maxTokens', 'maxCostUSD'].includes(key)) continue;
    if (!Number.isFinite(result[key]) || result[key] < min || result[key] > max || (key !== 'maxCostUSD' && !Number.isInteger(result[key]))) throw providerError('Giới hạn workflow không hợp lệ: ' + key);
  }
  if (typeof result.allowFallback !== 'boolean' || typeof result.optimized !== 'boolean' || !['auto', 'manual'].includes(result.assignment)) throw providerError('Chế độ workflow không hợp lệ.');
  return result;
}
