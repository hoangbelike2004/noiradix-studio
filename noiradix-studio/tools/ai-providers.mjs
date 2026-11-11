import { randomUUID } from 'node:crypto';
import { readCompletedResponse } from './responses-stream.mjs';

export const providerError = (message, status = 400, retryable = false) => Object.assign(new Error(message), { status, retryable });
const count = value => Number.isFinite(value) && value >= 0 ? value : 0;

function rateLimitError(provider, payload, retryAfter) {
  const detail = payload?.error || {}, label = provider === 'gemini' ? 'Gemini' : 'OpenAI';
  const seconds = Number(retryAfter);
  const retryAfterMs = retryAfter !== null && retryAfter !== '' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400 ? Math.ceil(seconds * 1000) : null;
  const wait = retryAfterMs === null ? 'Chờ hạn mức tốc độ phục hồi rồi thử lại.' : `Chờ ít nhất ${Math.ceil(retryAfterMs / 1000)} giây rồi thử lại.`;
  const messages = {
    credit_balance_exhausted: 'OpenAI báo đã hết credit API. Mở Billing của đúng tổ chức để kiểm tra credit và quyền lợi Pro đã kích hoạt. Thử lại liên tục không khôi phục credit.',
    organization_spend_limit_exceeded: 'OpenAI báo đã đạt giới hạn chi tiêu của tổ chức. Kiểm tra Limits và Billing của tổ chức.',
    project_spend_limit_exceeded: 'OpenAI báo đã đạt giới hạn chi tiêu của project. Kiểm tra Limits của đúng project chứa API key.',
    organization_usage_limit_exceeded: 'OpenAI báo đã đạt hạn mức API của tổ chức. Kiểm tra Limits; có thể cần yêu cầu tăng hạn mức.',
    subscription_sharing_usage_limit_exceeded: 'Đã đạt hạn mức dùng gói ChatGPT cho ứng dụng. Kiểm tra Usage trong cài đặt ChatGPT.',
    usage_limit_exceeded: 'OpenAI báo đã đạt giới hạn sử dụng hoặc thanh toán API. Kiểm tra Limits và Billing.',
    insufficient_quota: 'OpenAI báo hạn mức API không đủ. Kiểm tra credit và Limits của đúng tổ chức/project; đăng ký Pro chưa tự xác nhận API key có ngân sách.',
    rate_limit_exceeded: `${label} báo vượt tốc độ request/token. ${wait}`,
    slow_down: `OpenAI yêu cầu giảm tốc độ gửi yêu cầu. ${wait}`,
    too_many_requests: `${label} báo có quá nhiều yêu cầu trong thời gian ngắn. ${wait}`,
    quota_exceeded: 'Gemini báo đã hết quota theo ngày. Chờ quota phục hồi hoặc kiểm tra hạn mức của project trong AI Studio.'
  };
  // Only known machine codes and static guidance reach the browser. Provider
  // messages can contain account identifiers, prompt content, or credentials.
  const code = typeof detail.code === 'string' ? detail.code : typeof detail.type === 'string' ? detail.type : '';
  const providerCodes = provider === 'gemini' ? ['rate_limit_exceeded', 'too_many_requests', 'quota_exceeded'] :
    Object.keys(messages).filter(item => !['too_many_requests', 'quota_exceeded'].includes(item));
  let safeCode = providerCodes.includes(code) ? code : provider !== 'gemini' && detail.type === 'insufficient_quota' ? 'insufficient_quota' : null;
  let message = safeCode ? messages[safeCode] : null;
  if (!message && provider === 'gemini') {
    const violations = (Array.isArray(detail.details) ? detail.details : []).flatMap(item => Array.isArray(item?.violations) ? item.violations : []);
    const quotaNames = violations.map(item => [item?.quotaId, item?.quotaMetric].filter(value => typeof value === 'string').join(' '));
    if (quotaNames.some(value => /perday|per_day|daily/i.test(value))) { safeCode = 'quota_exceeded'; message = messages.quota_exceeded; }
    else if (quotaNames.some(value => /perminute|per_minute|persecond|per_second/i.test(value))) { safeCode = 'rate_limit_exceeded'; message = messages.rate_limit_exceeded; }
  }
  if (!message) message = `${label} từ chối yêu cầu (HTTP 429), chưa đủ dữ liệu để phân biệt giới hạn tốc độ với hết quota/credit. Kiểm tra Usage, Limits và Billing của đúng project.`;
  const retryable = ['rate_limit_exceeded', 'slow_down', 'too_many_requests'].includes(safeCode);
  return Object.assign(providerError(message + (safeCode ? ` [${safeCode}]` : ''), 429, retryable), { retryAfterMs });
}

// Canonical input uses Responses items. Gemini's original model parts, including
// thought signatures, are retained separately and never exposed to the browser.
function geminiContents(input) {
  const names = new Map();
  const contents = [];
  for (const item of input) {
    if (item.type === 'gemini_content') {
      contents.push(item.content);
      for (const call of item.calls || []) names.set(call.call_id, call.name);
    } else if (item.type === 'function_call_output') {
      const response = { name: names.get(item.call_id), response: JSON.parse(item.output) };
      if (item.call_id && !item.call_id.startsWith('local_')) response.id = item.call_id;
      if (!response.name) throw providerError('Không tìm thấy công cụ Gemini tương ứng.');
      const previous = contents.at(-1);
      if (previous?.role === 'user' && previous.parts.every(part => part.functionResponse)) previous.parts.push({ functionResponse: response });
      else contents.push({ role: 'user', parts: [{ functionResponse: response }] });
    } else if (item.role) {
      const parts = typeof item.content === 'string' ? [{ text: item.content }] : item.content.map(part => {
        if (part.type === 'input_text') return { text: part.text };
        const match = part.image_url?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
        if (!match) throw providerError('Ảnh Gemini không hợp lệ.');
        return { inlineData: { mimeType: match[1], data: match[2] } };
      });
      contents.push({ role: item.role === 'assistant' ? 'model' : 'user', parts });
    }
  }
  return contents;
}

export function createProviderAdapters(fetchImpl = fetch) {
  async function checked(url, headers, body, signal, provider) {
    let upstream;
    try {
      upstream = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw providerError('Mất kết nối với AI provider.', 502, true);
    }
    if (!upstream.ok) {
      let payload;
      try { payload = await upstream.json(); } catch { /* Never echo provider response bodies or credentials. */ }
      const reasons = Array.isArray(payload?.error?.details) ? payload.error.details.map(item => item?.reason) : [];
      const invalidKey = ['API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_NOT_FOUND'].some(reason => reasons.includes(reason));
      const deniedKey = reasons.some(reason => ['API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED'].includes(reason));
      const status = upstream.status;
      if (status === 429) throw rateLimitError(provider, payload, upstream.headers.get('retry-after'));
      const message = status === 401 || invalidKey ? 'AI provider từ chối API key. Hãy sao chép lại toàn bộ key và kiểm tra đúng Provider.' :
        status === 403 || deniedKey ? 'AI provider từ chối quyền truy cập (HTTP 403). Kiểm tra quyền dùng model và giới hạn API của project.' :
        status === 404 ? 'Không tìm thấy model hoặc tài khoản chưa có quyền dùng model này (HTTP 404).' :
        `AI provider trả về HTTP ${status}.`;
      throw providerError(message, status === 401 || invalidKey ? 401 : status === 403 || deniedKey ? 403 : 502, status >= 500);
    }
    return upstream;
  }
  const adapters = {
    openai: async ({ connection, input, instructions, tools, maxOutputTokens, signal }) => {
      const body = { model: connection.model, store: false, include: ['reasoning.encrypted_content'], instructions,
        tools, parallel_tool_calls: false, input };
      if (connection.chatgpt) {
        body.stream = true;
        body.tools = tools.length ? [{ type: 'namespace', name: 'studio', description: 'Operate the Studio editor and delegate bounded tasks.', tools }] : [];
      } else { body.max_output_tokens = maxOutputTokens; body.prompt_cache_key = 'noiradix-tools-v2'; }
      const upstream = await checked('https://api.openai.com/v1/responses', { Authorization: 'Bearer ' + connection.accessToken,
        Accept: connection.chatgpt ? 'text/event-stream' : 'application/json' }, body, signal, 'openai');
      let answer;
      try { answer = await readCompletedResponse(upstream, connection.chatgpt); }
      catch (error) {
        if (error.responseUsage) error.usage = { inputTokens: count(error.responseUsage.input_tokens), outputTokens: count(error.responseUsage.output_tokens),
          cachedTokens: Math.min(count(error.responseUsage.input_tokens), count(error.responseUsage.input_tokens_details?.cached_tokens)),
          reported: Number.isFinite(error.responseUsage.input_tokens) && Number.isFinite(error.responseUsage.output_tokens) };
        throw error;
      }
      const usage = { inputTokens: count(answer.usage?.input_tokens), outputTokens: count(answer.usage?.output_tokens),
        cachedTokens: Math.min(count(answer.usage?.input_tokens), count(answer.usage?.input_tokens_details?.cached_tokens)), reported: Number.isFinite(answer.usage?.input_tokens) && Number.isFinite(answer.usage?.output_tokens) };
      if (answer.status !== 'completed' || !Array.isArray(answer.output)) throw Object.assign(providerError('AI trả lời chưa hoàn tất.', 502), { usage });
      return { output: answer.output, calls: answer.output.filter(item => item.type === 'function_call'), usage,
        reply: answer.output.filter(item => item.type === 'message').flatMap(item => item.content || []).map(part => part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : '').join('\n') };
    },
    gemini: async ({ connection, input, instructions, tools, maxOutputTokens, signal }) => {
      const body = { systemInstruction: { parts: [{ text: instructions }] }, contents: geminiContents(input),
        generationConfig: { maxOutputTokens } };
      if (tools.length) body.tools = [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }];
      const upstream = await checked('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(connection.model) + ':generateContent',
        { 'x-goog-api-key': connection.accessToken }, body, signal, 'gemini');
      const answer = await upstream.json();
      const meta = answer.usageMetadata;
      const usage = { inputTokens: count(meta?.promptTokenCount), outputTokens: count(meta?.candidatesTokenCount) + count(meta?.thoughtsTokenCount),
        cachedTokens: Math.min(count(meta?.promptTokenCount), count(meta?.cachedContentTokenCount)), reported: Number.isFinite(meta?.promptTokenCount) && Number.isFinite(meta?.candidatesTokenCount) };
      const candidate = answer.candidates?.[0];
      if (candidate?.finishReason !== 'STOP' || !candidate.content?.parts?.length) throw Object.assign(providerError('Gemini trả lời chưa hoàn tất hoặc đã chặn yêu cầu.', 502), { usage });
      const content = structuredClone(candidate.content);
      const calls = content.parts.filter(part => part.functionCall).map(part => {
        // A locally generated ID is only used for routing, never sent to Google.
        return { type: 'function_call', name: part.functionCall.name, call_id: part.functionCall.id || 'local_' + randomUUID(), arguments: JSON.stringify(part.functionCall.args || {}) };
      });
      return { output: [{ type: 'gemini_content', content, calls }], calls, usage,
        reply: content.parts.filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('\n') };
    }
  };
  return { async respond(options) {
    const adapter = adapters[options.connection.provider || 'openai'];
    if (!adapter) throw providerError('Provider chưa được hỗ trợ.');
    return adapter(options);
  } };
}
