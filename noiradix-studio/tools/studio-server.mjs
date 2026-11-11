import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import AiDrawing from '../js/ai-drawing.js';
import { createAgentGateway } from './studio-agent.mjs';
import { createChatGPTAuth } from './chatgpt-auth.mjs';
import { createAgentManager } from './ai-agent-manager.mjs';
import { recentHistory } from './ai-context.mjs';
import { createGoogleAcp } from './google-acp.mjs';
import { createAccountTeam } from './account-team.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const studioInstanceId = rootDir => createHash('sha256').update(path.resolve(rootDir)).digest('hex').slice(0, 24);
// Capture the source fingerprint once, when this process loads its modules.
// Re-reading it per request would incorrectly label an old process as updated.
export const studioBuildId = (() => {
  const hash = createHash('sha256');
  for (const file of ['studio-server.mjs', 'launch-studio.mjs', 'studio-agent.mjs', 'ai-agent-manager.mjs', 'ai-providers.mjs',
    'ai-context.mjs', 'ai-usage.mjs', 'chatgpt-auth.mjs', 'responses-stream.mjs', 'account-team.mjs', 'google-acp.mjs', 'google-acp-client.mjs', 'google-acp-runtime.mjs', '../js/ai-drawing.js', '../js/ai-images.js',
    '../js/ai-tools.js', '../js/ai-studio.js', '../js/ai-local-tasks.js', '../js/tools.js', '../js/pix2-format.js',
    '../js/animation-frames.js', '../js/image-pixelizer.js']) hash.update(file).update(readFileSync(new URL(file, import.meta.url)));
  return hash.digest('hex').slice(0, 24);
})();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.pix2': 'text/plain', '.md': 'text/plain' };
const schema = { type: 'object', additionalProperties: false, required: ['reply', 'pix2'],
  properties: { reply: { type: 'string' }, pix2: { type: ['string', 'null'] } } };

export function createStudioServer({ apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.OPENAI_MODEL || 'gpt-5.4-mini', geminiApiKey = process.env.GEMINI_API_KEY || '',
  geminiModel = process.env.GEMINI_MODEL || '', fetchImpl = fetch, rootDir = projectRoot, authDirectory, googleOptions = {}, teamOptions = {} } = {}) {
  let busy = false;
  let provider = apiKey ? 'api' : null;
  const manager = createAgentManager();
  const google = createGoogleAcp({ ...(authDirectory ? { directory: path.join(authDirectory, 'google-acp') } : {}), ...googleOptions });
  if (geminiApiKey && geminiModel) manager.save({ name: 'Gemini', provider: 'gemini', model: geminiModel, apiKey: geminiApiKey });
  const auth = createChatGPTAuth({ directory: authDirectory, fetchImpl, preferredModel: model, onChange: () => { provider = 'chatgpt'; agent.clear(); } });
  const team = createAccountTeam({ auth, google, fetchImpl, ...(authDirectory ? { directory: path.join(authDirectory, 'account-team') } : {}), ...teamOptions });
  async function connectionStatus() {
    const login = await auth.status();
    const managed = manager.snapshot();
    const googleState = google.status();
    const teamState = team.status();
    if (teamState.selected) return { configured: login.connected && login.sharing && login.models.length > 0 && googleState.connected,
      provider: 'accounts', model: null, login, google: googleState, team: teamState, apiKeyAvailable: Boolean(apiKey), agentsAvailable: managed.agents.some(item => item.enabled) };
    if (provider === 'chatgpt') return { configured: login.connected && login.sharing && login.models.length > 0,
      provider, model: login.model, login, google: googleState, team: teamState, apiKeyAvailable: Boolean(apiKey), agentsAvailable: managed.agents.some(item => item.enabled) };
    if (googleState.selected) return { configured: googleState.connected, provider: 'google', model: googleState.model, login, google: googleState,
      team: teamState, apiKeyAvailable: Boolean(apiKey), agentsAvailable: managed.agents.some(item => item.enabled) };
    if (managed.agents.some(item => item.enabled && item.capabilities.tools)) return { configured: true, provider: 'agents', model: null, login,
      google: googleState, team: teamState, apiKeyAvailable: Boolean(apiKey), agentsAvailable: true };
    const selected = provider || (login.activeClientId ? 'chatgpt' : 'none');
    return { configured: selected === 'api' ? Boolean(apiKey) : selected === 'chatgpt' && login.connected && login.sharing && login.models.length > 0,
      provider: selected, model: selected === 'chatgpt' ? login.model : model, login, google: googleState, team: teamState, apiKeyAvailable: Boolean(apiKey) };
  }
  const agent = createAgentGateway({ fetchImpl, manager, useManagedAgents: async () => (await connectionStatus()).provider === 'agents',
    resolveConnection: connection => auth.connection(connection.accountId, connection.model), getConnection: async () => {
    const status = await connectionStatus();
    if (status.provider === 'chatgpt') return auth.connection();
    if (status.provider === 'api' && apiKey) return { accessToken: apiKey, model, chatgpt: false };
    throw Object.assign(new Error('Hãy bấm Continue with ChatGPT để đăng nhập trước khi vẽ.'), { status: 401 });
  } });
  const server = http.createServer(async (req, res) => {
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    const port = server.address()?.port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    if (!hosts.includes(req.headers.host)) return json(403, { error: 'Localhost access only.' });
    const url = new URL(req.url, 'http://' + req.headers.host);
    if (req.method === 'GET' && ['/auth/chatgpt', '/auth/callback', '/auth/result'].includes(url.pathname)) {
      const authPage = (code, message) => {
        res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
        res.end('<!doctype html><html lang="vi"><meta charset="utf-8"><title>NOIRADIX Studio</title><h1>NOIRADIX Studio</h1><p>' + message + '</p><p>Quay lại tab Studio để xem trạng thái. Bạn có thể đóng tab đăng nhập này.</p></html>');
      };
      try {
        if (url.pathname === '/auth/chatgpt') {
          const redirect = auth.redirect(url.searchParams.get('ticket'), port);
          res.writeHead(302, { Location: redirect.location, 'Set-Cookie': redirect.cookie, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
          return res.end();
        }
        if (url.pathname === '/auth/callback') {
          await auth.callback(url.searchParams, req.headers.cookie, port);
          if (google.status().selected) await google.action('select', { selected: false });
          res.writeHead(303, { Location: '/auth/result', 'Set-Cookie': `noiradix_auth_${port}=; HttpOnly; SameSite=Lax; Path=/auth/callback; Max-Age=0`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
          return res.end();
        }
        return authPage(200, 'Đã hoàn tất lượt đăng nhập.');
      } catch { return authPage(400, 'Chưa hoàn tất đăng nhập. Hãy thử lại từ Studio.'); }
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin && !hosts.some(host => req.headers.origin === 'http://' + host)) return json(403, { error: 'Origin not allowed.' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Origin not allowed.' });
      if (req.method === 'GET' && url.pathname === '/api/studio/info') return json(200, { application: 'noiradix-studio', instance: studioInstanceId(rootDir), build: studioBuildId });
      if (req.method === 'GET' && url.pathname === '/api/ai/status') {
        try { return json(200, await connectionStatus()); } catch { return json(500, { error: 'Không đọc được cấu hình đăng nhập Studio trên máy này.' }); }
      }
      if (req.method === 'GET' && url.pathname === '/api/ai/agents') return json(200, agent.snapshot());
      if (req.method === 'GET' && url.pathname === '/api/ai/google/status') return json(200, google.status());
      if (req.method === 'GET' && url.pathname === '/api/ai/team/status') return json(200, await connectionStatus());
      const authAction = url.pathname.match(/^\/api\/ai\/auth\/(start|cancel|select|model|models|ack|logout)$/)?.[1];
      const googleAction = url.pathname.match(/^\/api\/ai\/google\/(start|cancel|disconnect|select|model)$/)?.[1];
      const managerAction = url.pathname.match(/^\/api\/ai\/agents\/(save|remove|orchestrator|import-chatgpt|import-api)$/)?.[1];
      if (req.method !== 'POST' || (!authAction && !googleAction && !managerAction && !['/api/ai/chat', '/api/ai/agent', '/api/ai/connect', '/api/ai/source', '/api/ai/google/turn', '/api/ai/team/turn'].includes(url.pathname))) return json(404, { error: 'Not found.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'JSON required.' });
      if (!apiKey && url.pathname === '/api/ai/chat') return json(503, { error: 'Chưa kết nối OpenAI. Mở phần Kết nối AI để cấu hình API key một lần.' });
      if (busy) return json(429, { error: 'An AI request is already running. Please wait.' });
      busy = true;
      const abort = new AbortController();
      const onClose = () => abort.abort();
      res.once('close', onClose);
      let legacyStarted = 0, legacyUsage = null;
      try {
        const chunks = []; let bytes = 0;
        for await (const chunk of req) {
          chunks.push(chunk); bytes += chunk.length;
          if (bytes > 8000000) { json(413, { error: 'Ảnh hoặc cuộc trò chuyện quá lớn. Hãy bớt ảnh đính kèm.' }); return; }
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(400, { error: 'Invalid JSON.' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Invalid request.' });
        if (url.pathname === '/api/ai/team/turn') {
          if (!team.busy && (google.busy || agent.snapshot().workflows.some(item => ['Running', 'Waiting'].includes(item.status)))) return json(409, { error: 'Một AI khác đang dùng editor. Hãy hoàn tất hoặc dừng lượt đó.' });
          return json(200, await team.step(body, abort.signal));
        }
        if (team.busy) return json(409, { error: 'Nhóm tài khoản đang dùng editor. Hãy hoàn tất hoặc dừng lượt đó trước.' });
        if (googleAction) {
          if (agent.snapshot().workflows.some(item => ['Running', 'Waiting'].includes(item.status))) return json(409, { error: 'Hãy hoàn tất hoặc dừng lượt AI trước khi đổi kết nối Google.' });
          if ((await auth.status()).pending) return json(409, { error: 'Hãy hoàn tất hoặc hủy đăng nhập ChatGPT trước khi đổi kết nối.' });
          const result = await google.action(googleAction, body);
          if (result.selected) { await team.select(false); provider = 'google'; }
          else if (provider === 'google') provider = null;
          return json(200, result);
        }
        if (url.pathname === '/api/ai/google/turn') {
          if (agent.snapshot().workflows.some(item => ['Running', 'Waiting'].includes(item.status))) return json(409, { error: 'Một nhóm AI đang dùng editor.' });
          if (!google.status().selected && !body.runId) return json(409, { error: 'Hãy chọn Dùng Google trong Cài đặt AI trước.' });
          return json(200, await google.step(body, abort.signal));
        }
        if (google.busy) return json(409, { error: 'Google đang thao tác trong editor. Hãy hoàn tất hoặc dừng lượt đó.' });
        if (url.pathname === '/api/ai/source') {
          if (agent.snapshot().workflows.some(item => ['Running', 'Waiting'].includes(item.status))) return json(409, { error: 'Hãy hoàn tất hoặc dừng lượt AI trước khi đổi kết nối.' });
          if ((await auth.status()).pending) return json(409, { error: 'Hãy hoàn tất hoặc hủy đăng nhập ChatGPT trước khi đổi kết nối.' });
          if (!['chatgpt', 'agents', 'accounts'].includes(body.provider)) return json(400, { error: 'Kết nối AI không hợp lệ.' });
          if (body.provider === 'accounts') {
            await team.select(true);
            await google.action('select', { selected: false });
            provider = 'accounts'; agent.clear();
            return json(200, await connectionStatus());
          }
          if (body.provider === 'chatgpt') await auth.connection();
          await team.select(false);
          await google.action('select', { selected: false });
          provider = body.provider === 'chatgpt' ? 'chatgpt' : apiKey && !manager.snapshot().agents.some(item => item.enabled) ? 'api' : 'agents';
          agent.clear();
          return json(200, await connectionStatus());
        }
        if (managerAction) {
          if (agent.snapshot().workflows.some(item => ['Running', 'Waiting'].includes(item.status))) return json(409, { error: 'Hãy hoàn tất hoặc hủy workflow trước khi thay đổi kết nối.' });
          if (managerAction === 'save') {
            const old = manager.snapshot().agents.find(item => item.id === body.id);
            if (old?.authMethod === 'chatgpt_oauth') {
              if (body.provider && body.provider !== 'openai' || body.apiKey) return json(400, { error: 'Hãy tạo kết nối API riêng khi đổi phương thức xác thực.' });
              const connection = await auth.connection(old.clientId, body.model || old.model);
              manager.save({ ...body, provider: 'openai', model: connection.model }, old.clientId);
            } else manager.save(body);
          }
          if (managerAction === 'import-chatgpt') {
            const connection = await auth.connection(body.clientId || null, body.model || null);
            manager.save({ ...body, provider: 'openai', model: connection.model, apiKey: undefined }, connection.accountId);
          }
          if (managerAction === 'import-api') {
            if (!apiKey) return json(400, { error: 'Chưa có kết nối OpenAI API hiện tại.' });
            manager.save({ ...body, provider: 'openai', model: body.model || model, apiKey });
          }
          if (managerAction === 'remove') manager.remove(body.id);
          if (managerAction === 'orchestrator') manager.setOrchestrator(body.id);
          return json(200, agent.snapshot());
        }
        if (authAction) {
          if (agent.snapshot().workflows.some(item => ['Running', 'Waiting'].includes(item.status))) return json(409, { error: 'Hãy hoàn tất hoặc dừng lượt AI trước khi đổi tài khoản.' });
          if (authAction === 'start') return json(200, await auth.start(port, body.clientId || null));
          const result = await auth.action(authAction, body);
          if (['select', 'model'].includes(authAction) && google.status().selected) await google.action('select', { selected: false });
          if (authAction === 'logout') provider = 'none';
          return json(200, { ...await connectionStatus(), ...result });
        }
        if (url.pathname === '/api/ai/connect') {
          if (typeof body.apiKey !== 'string' || !/^sk-[\w-]{16,300}$/.test(body.apiKey.trim())) return json(400, { error: 'API key chưa đúng định dạng. Hãy kiểm tra lại key từ tài khoản OpenAI API.' });
          apiKey = body.apiKey.trim(); provider = 'api'; agent.clear();
          await team.select(false);
          return json(200, await connectionStatus());
        }
        if (url.pathname === '/api/ai/agent') return json(200, await agent.step(body, abort.signal));
        if ((await connectionStatus()).provider !== 'api') return json(400, { error: 'Tài khoản ChatGPT dùng luồng vẽ trực tiếp trong Studio.' });
        const { message, context, history = [] } = body;
        if (typeof message !== 'string' || !message.trim() || message.length > 6000 ||
            !context || !['new', 'edit'].includes(context.mode) || !Number.isInteger(context.width) || !Number.isInteger(context.height) ||
            context.width < 1 || context.height < 1 || context.width > 512 || context.height > 512 ||
            typeof context.pix2 !== 'string' || context.pix2.length > 500000 || !Array.isArray(history)) {
          return json(400, { error: 'Invalid drawing request.' });
        }
        const prior = recentHistory(history)
          .map(item => ({ role: item.role, content: item.content.slice(0, 8000) }));
        legacyStarted = Date.now();
        const upstream = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]),
          body: JSON.stringify({ model, store: false, instructions: AiDrawing.instructions, max_output_tokens: 14000, prompt_cache_key: 'noiradix-pix2-v1',
            input: [...prior, { role: 'user', content: 'Target context:\n' + JSON.stringify(context) + '\nRequest:\n' + message }],
            text: { format: { type: 'json_schema', name: 'pixel_drawing_reply', strict: true, schema } } })
        });
        if (!upstream.ok) {
          const code = upstream.status;
          return json(code === 429 ? 429 : 502, { error: code === 401 ? 'OpenAI API key không hợp lệ.' :
            code === 429 ? 'OpenAI đã hết hạn mức hoặc đang giới hạn tốc độ. Kiểm tra tài khoản API.' : 'OpenAI request failed (HTTP ' + code + ').' });
        }
        const response = await upstream.json();
        legacyUsage = response.usage;
        if (response.status !== 'completed') return json(502, { error: 'AI trả lời chưa hoàn tất. Thử yêu cầu đơn giản hơn hoặc frame nhỏ hơn.' });
        const parts = (response.output || []).flatMap(item => item.type === 'message' ? item.content || [] : []);
        const refusal = parts.find(item => item.type === 'refusal');
        if (refusal) return json(200, { reply: refusal.refusal, pix2: null });
        const answer = JSON.parse(parts.filter(item => item.type === 'output_text').map(item => item.text).join(''));
        if (typeof answer.reply !== 'string' || (answer.pix2 !== null && typeof answer.pix2 !== 'string')) throw new Error('Invalid AI output');
        if (answer.pix2 !== null) {
          try { AiDrawing.parseFrame(answer.pix2, context.width, context.height); }
          catch (error) { return json(502, { error: 'AI tạo mã PIX2 chưa hợp lệ: ' + error.message }); }
        }
        return json(200, { reply: answer.reply, pix2: answer.pix2 });
      } catch (error) {
        if (res.destroyed) return;
        if ((url.pathname === '/api/ai/agent' || url.pathname === '/api/ai/source' || url.pathname === '/api/ai/team/turn' || url.pathname === '/api/ai/google/turn' || googleAction || authAction || managerAction) && error.status) return json(error.status, { error: error.message });
        if (googleAction || url.pathname === '/api/ai/google/turn') return json(502, { error: 'Chưa hoàn tất kết nối Google. Kiểm tra mạng rồi thử lại.' });
        return json(502, { error: error.name === 'TimeoutError' ? 'AI mất quá lâu để trả lời. Hãy thử lại.' : 'Không thể nhận phản hồi hợp lệ từ OpenAI. Vui lòng thử lại.' });
      } finally {
        if (legacyStarted) agent.observeLegacy({ model, usage: legacyUsage, elapsedMs: Date.now() - legacyStarted, success: !res.destroyed && res.statusCode === 200 });
        res.off('close', onClose); busy = false;
      }
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'Method not allowed.' });
    try {
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.split(/[\\/]/).some(part => part.startsWith('.')) || decoded.includes('\0')) throw new Error('Forbidden');
      let filename = path.resolve(rootDir, '.' + decoded);
      if (!(filename === rootDir || filename.startsWith(rootDir + path.sep))) throw new Error('Forbidden');
      if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
      filename = await realpath(filename);
      const root = await realpath(rootDir);
      if (!filename.startsWith(root + path.sep) || !types[path.extname(filename)]) throw new Error('Forbidden');
      const data = await readFile(filename);
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] + (['.html', '.js', '.css', '.json', '.md', '.pix2'].includes(path.extname(filename)) ? '; charset=utf-8' : ''),
        'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { json(404, { error: 'Not found.' }); }
  });
  server.once('listening', () => { team.restore().then(() => google.restore({ connect: team.status().selected })).catch(() => {}); });
  server.once('close', () => { team.close(); google.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const envFile = path.join(projectRoot, '.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const portIndex = process.argv.indexOf('--port');
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  createStudioServer().listen(port, '127.0.0.1', () => console.log(`NOIRADIX Studio: http://127.0.0.1:${port} · AI ${process.env.OPENAI_API_KEY ? 'configured' : 'not configured'}`));
}
