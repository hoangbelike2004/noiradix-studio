/** Read Responses SSE through response.completed; incomplete streams never commit artwork. */
export async function readCompletedResponse(upstream, streaming = false) {
  if (!streaming) return upstream.json();
  if (!upstream.body) throw new Error('OpenAI chưa trả về dữ liệu phản hồi. Hãy thử lại.');
  // Some successful streaming responses arrive without Content-Type. Validate
  // the SSE events and terminal response below instead of rejecting their header.
  const reader = upstream.body.getReader(), decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  function event(block) {
    const text = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!text || text === '[DONE]') return null;
    const item = JSON.parse(text);
    if (item.type === 'response.completed') return item.response;
    if (['error', 'response.failed', 'response.incomplete'].includes(item.type)) throw Object.assign(new Error('OpenAI chưa hoàn tất yêu cầu. Hãy kiểm tra hạn mức trong ChatGPT hoặc thử lại.'), { responseUsage: item.response?.usage });
    return null;
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); break; }
      bytes += value.length;
      if (bytes > 16000000) throw new Error('Phản hồi AI quá lớn. Hãy chia nhỏ yêu cầu.');
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const completed = event(block);
        if (completed) return completed;
      }
      if (buffer.length > 2000000) throw new Error('Phản hồi AI quá lớn.');
    }
    if (buffer.trim()) { const completed = event(buffer); if (completed) return completed; }
    throw Object.assign(new Error('Mất kết nối trước khi AI hoàn tất. Hãy thử lại.'), { status: 502, retryable: true });
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
