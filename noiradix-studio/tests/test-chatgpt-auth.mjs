import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createChatGPTAuth } from '../tools/chatgpt-auth.mjs';
import { createStudioServer } from '../tools/studio-server.mjs';
import { readCompletedResponse } from '../tools/responses-stream.mjs';
import PIX2 from '../js/pix2-format.js';
import AiDrawing from '../js/ai-drawing.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'noiradix-oauth-test-'));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
const origin = 'https://auth.openai.com';
const metadata = { issuer: origin, authorization_endpoint: origin + '/api/accounts/authorize', token_endpoint: origin + '/api/accounts/oauth/token', jwks_uri: origin + '/.well-known/jwks.json', revocation_endpoint: origin + '/oauth/revoke' };
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function jwt(nonce, clientId, changes = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: origin, sub: 'fixture-subject', aud: clientId, nonce, email: 'artist@example.test', name: 'Artist', iat: now, exp: now + 3600, ...changes })).toString('base64url');
  return head + '.' + body + '.' + sign('sha256', Buffer.from(head + '.' + body), privateKey).toString('base64url');
}
function sse(output, type = 'response.completed') {
  const bytes = Buffer.from('event: response.created\r\ndata: {"type":"response.created"}\r\n\r\nevent: ' + type + '\r\ndata: ' + JSON.stringify({ type, response: { status: 'completed', output } }) + '\r\n\r\n');
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) { if (offset >= bytes.length) return controller.close(); controller.enqueue(bytes.subarray(offset, offset += 7)); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
function fixture() {
  const state = { nonce: '', clientId: 'oaiapp_fixture', authorization: null, scope: scopes, changes: {}, refreshes: 0, codes: 0, revokes: 0, request: null, failToken: false, revokedStatus: 200 };
  state.fetchImpl = async (url, options = {}) => {
    if (url === origin + '/.well-known/openid-configuration') return json(metadata);
    if (url === metadata.jwks_uri) return json({ keys: [jwk] });
    if (url === metadata.revocation_endpoint) { state.revokes++; const body = new URLSearchParams(options.body); assert.equal(body.get('client_id'), state.clientId); assert.equal(body.get('token_type_hint'), 'refresh_token'); return new Response('', { status: state.revokedStatus }); }
    if (url === metadata.token_endpoint) {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('resource'), 'https://api.openai.com/v1'); assert.equal(body.get('client_id'), state.clientId);
      if (body.get('grant_type') === 'refresh_token') {
        state.refreshes++; assert(body.get('refresh_token').startsWith('refresh-fixture')); assert.equal(body.has('scope'), false);
        await new Promise(resolve => setTimeout(resolve, 30));
        return json({ token_type: 'Bearer', access_token: 'access-fixture-renewed', refresh_token: 'refresh-fixture-rotated', expires_in: 3600, scope: state.scope });
      }
      state.codes++;
      if (state.onExchange) state.onExchange();
      if (state.pauseExchange) await state.pauseExchange;
      assert.equal(body.get('code'), 'fixture-code');
      assert.equal(body.get('redirect_uri'), state.authorization.searchParams.get('redirect_uri'));
      assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), state.authorization.searchParams.get('code_challenge'));
      if (state.failToken) return new Response('{}', { status: 400 });
      let signed = jwt(state.nonce, state.clientId, state.changes);
      if (state.corruptSignature) { const parts = signed.split('.'); const bytes = Buffer.from(parts[2], 'base64url'); bytes[0] ^= 1; parts[2] = bytes.toString('base64url'); signed = parts.join('.'); }
      return json({ token_type: 'Bearer', access_token: 'access-fixture-secret', refresh_token: 'refresh-fixture-secret', id_token: signed, scope: state.scope, expires_in: 3600 });
    }
    if (url === 'https://api.openai.com/v1/models') {
      assert.match(options.headers.Authorization, /^Bearer access-fixture/);
      return json({ models: [{ slug: 'fixture-pixel-model', display_name: 'Pixel model', visibility: 'list' }, { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }] });
    }
    if (url === 'https://api.openai.com/v1/responses') {
      state.request = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, 'Bearer access-fixture-secret');
      assert.equal(state.request.stream, true); assert.equal(state.request.store, false);
      assert.equal(options.headers.Accept, 'text/event-stream');
      assert.equal('max_output_tokens' in state.request, false);
      assert.equal(state.request.tools[0].type, 'namespace'); assert.equal(state.request.tools[0].name, 'studio');
      assert.equal(state.request.model, 'fixture-pixel-model');
      return sse([{ type: 'function_call', namespace: 'studio', name: 'draw', call_id: 'draw-fixture', arguments: '{"actions":[{"tool":"pen","color":"#ffffff","points":[{"x":0,"y":0}]}]}' }]);
    }
    throw new Error('Unexpected fixture URL: ' + url);
  };
  return state;
}
async function attempt(auth, fx, clientId = null) {
  const first = await auth.start(18555, clientId);
  assert(!first.openUrl.includes('id_token'));
  const ticket = new URL(first.openUrl).searchParams.get('ticket');
  const redirect = auth.redirect(ticket, 18555);
  fx.authorization = new URL(redirect.location); fx.nonce = fx.authorization.searchParams.get('nonce');
  assert.equal(fx.authorization.origin, origin);
  assert.equal(fx.authorization.searchParams.get('redirect_uri'), 'http://127.0.0.1:18555/auth/callback');
  assert.equal(fx.authorization.searchParams.get('resource'), 'https://api.openai.com/v1');
  assert.notEqual(fx.nonce, fx.authorization.searchParams.get('state'));
  assert.equal(fx.authorization.searchParams.has('agent_name_hint'), !clientId);
  const params = new URLSearchParams({ code: 'fixture-code', state: fx.authorization.searchParams.get('state'), client_id: fx.clientId });
  return { params, cookie: redirect.cookie.split(';')[0], hostId: fx.authorization.searchParams.get('ext_agent_host_id') };
}
try {
  const fx = fixture(), directory = path.join(root, 'auth');
  const auth = createChatGPTAuth({ directory, fetchImpl: fx.fetchImpl });
  assert.equal((await auth.status()).connected, false);
  const first = await attempt(auth, fx);
  assert.equal(fx.authorization.searchParams.get('client_id'), 'dynamic_agent_client');
  const badState = new URLSearchParams(first.params); badState.set('state', 'wrong');
  await assert.rejects(() => auth.callback(badState, first.cookie, 18555), /xác minh/);
  await assert.rejects(() => auth.callback(first.params, 'wrong-cookie', 18555), /xác minh/);
  assert.equal(fx.codes, 0);
  await auth.callback(first.params, first.cookie, 18555);
  await assert.rejects(() => auth.callback(first.params, first.cookie, 18555), /xác minh/);
  let status = await auth.status();
  assert.equal(status.connected, true); assert.equal(status.sharing, true); assert.equal(status.welcomeNeeded, true);
  assert.deepEqual(status.models, [{ id: 'fixture-pixel-model', name: 'Pixel model' }]);
  assert.equal(status.model, 'fixture-pixel-model');
  assert(!JSON.stringify(status).includes('access-fixture') && !JSON.stringify(status).includes('refresh-fixture') && !JSON.stringify(status).includes(jwt(fx.nonce, fx.clientId)));
  const file = path.join(directory, 'chatgpt-auth.json');
  if (process.platform !== 'win32') { assert.equal((await stat(file)).mode & 0o777, 0o600); assert.equal((await stat(directory)).mode & 0o777, 0o700); }
  await auth.action('ack');
  const restored = createChatGPTAuth({ directory, fetchImpl: fx.fetchImpl });
  assert.equal((await restored.status()).welcomeNeeded, false); assert.equal((await restored.connection()).accessToken, 'access-fixture-secret');
  const returning = await attempt(restored, fx, fx.clientId);
  assert.equal(returning.hostId, first.hostId); assert.equal(fx.authorization.searchParams.get('client_id'), fx.clientId);
  fx.changes = { nonce: 'invalid-nonce' };
  await assert.rejects(() => restored.callback(returning.params, returning.cookie, 18555), /xác minh/);
  assert.equal((await restored.connection()).accessToken, 'access-fixture-secret', 'Failed replacement preserves the active connection');
  fx.changes = {};
  fx.corruptSignature = true;
  const forged = await attempt(restored, fx, fx.clientId);
  await assert.rejects(() => restored.callback(forged.params, forged.cookie, 18555), /xác minh/);
  fx.corruptSignature = false;
  const pinnedAccounts = JSON.parse(await readFile(file));
  const other = structuredClone(pinnedAccounts.profiles[0]); other.clientId = 'oaiapp_other_fixture';
  pinnedAccounts.profiles.push(other); pinnedAccounts.active = other.clientId;
  await writeFile(file, JSON.stringify(pinnedAccounts), { mode: 0o600 });
  assert.equal((await restored.connection(fx.clientId, 'fixture-pixel-model')).accountId, fx.clientId, 'Resolve a worker account without selecting it globally');
  assert.equal((await restored.status()).activeClientId, other.clientId, 'Pinned connection does not change the UI account');
  await assert.rejects(() => restored.connection(fx.clientId, 'unavailable-model'), /Model không thuộc/);
  pinnedAccounts.profiles.pop(); pinnedAccounts.active = fx.clientId;
  await writeFile(file, JSON.stringify(pinnedAccounts), { mode: 0o600 });
  const before = JSON.parse(await readFile(file)); before.profiles[0].tokens.expiresAt = Date.now() - 100;
  await writeFile(file, JSON.stringify(before), { mode: 0o600 });
  const renewed = await Promise.all([auth.connection(), restored.connection()]);
  assert.equal(fx.refreshes, 1, 'Serialize rotating refreshes across instances');
  assert(renewed.every(item => item.accessToken === 'access-fixture-renewed'));
  assert.equal(JSON.parse(await readFile(file)).profiles[0].tokens.refreshToken, 'refresh-fixture-rotated');
  fx.revokedStatus = 503;
  const signedOut = await auth.action('logout');
  assert(signedOut.message.includes('Chưa xác nhận')); assert.equal((await auth.status()).connected, false);
  const mapping = JSON.parse(await readFile(file)); assert.equal(mapping.profiles[0].tokens, null); assert.equal(mapping.profiles[0].clientId, fx.clientId); assert.equal(mapping.hostId, first.hostId);

  const identityFx = fixture(); identityFx.scope = 'openid profile email';
  const identityOnly = createChatGPTAuth({ directory: path.join(root, 'identity'), fetchImpl: identityFx.fetchImpl });
  const unshared = await attempt(identityOnly, identityFx);
  await identityOnly.callback(unshared.params, unshared.cookie, 18555);
  assert.equal((await identityOnly.status()).connected, true); assert.equal((await identityOnly.status()).sharing, false);
  await assert.rejects(() => identityOnly.connection(), /cho phép/);
  const partialFx = fixture(); partialFx.failToken = true;
  const partial = createChatGPTAuth({ directory: path.join(root, 'partial'), fetchImpl: partialFx.fetchImpl });
  const incomplete = await attempt(partial, partialFx);
  await assert.rejects(() => partial.callback(incomplete.params, incomplete.cookie, 18555), /hết hạn/);
  assert.equal((await partial.status()).profiles[0].clientId, partialFx.clientId, 'Retain registration if code exchange expires');
  const cancelledFx = fixture();
  let release, entered;
  cancelledFx.pauseExchange = new Promise(resolve => release = resolve);
  const exchanging = new Promise(resolve => entered = resolve); cancelledFx.onExchange = entered;
  const cancelled = createChatGPTAuth({ directory: path.join(root, 'cancelled'), fetchImpl: cancelledFx.fetchImpl });
  const cancelAttempt = await attempt(cancelled, cancelledFx);
  const completion = cancelled.callback(cancelAttempt.params, cancelAttempt.cookie, 18555);
  const rejected = assert.rejects(completion, /bị hủy/);
  await exchanging; await cancelled.action('cancel'); release(); await rejected;
  assert.equal((await cancelled.status()).connected, false, 'Cancel during exchange cannot activate a late callback');

  const unicode = 'Đã vẽ nón đỏ 🖌️';
  const completed = await readCompletedResponse(sse([{ type: 'message', content: [{ type: 'output_text', text: unicode }] }]), true);
  assert.equal(completed.output[0].content[0].text, unicode);
  // Real successful inference can omit Content-Type. Its completion event, not
  // that optional header, determines whether a drawing is safe to apply.
  const headerless = sse([{ type: 'message', content: [{ type: 'output_text', text: unicode }] }]);
  headerless.headers.delete('content-type');
  assert.equal((await readCompletedResponse(headerless, true)).output[0].content[0].text, unicode);
  const noHeaderFailure = sse([], 'response.failed'); noHeaderFailure.headers.delete('content-type');
  await assert.rejects(() => readCompletedResponse(noHeaderFailure, true), /chưa hoàn tất/);
  const noHeaderInterrupted = new Response(new TextEncoder().encode('data: {"type":"response.created"}\n\n'));
  assert.equal(noHeaderInterrupted.headers.get('content-type'), null);
  await assert.rejects(() => readCompletedResponse(noHeaderInterrupted, true), /Mất kết nối/);
  await assert.rejects(() => readCompletedResponse(new Response(new TextEncoder().encode('<html>connection error</html>')), true), /Mất kết nối/);
  await assert.rejects(() => readCompletedResponse(new Response('data: {"type":"response.created"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), true), /Mất kết nối/);
  await assert.rejects(() => readCompletedResponse(sse([], 'response.failed'), true), /chưa hoàn tất/);

  // Real HTTP routes, mocked OpenAI. No sign-in or live inference is performed.
  const httpFx = fixture();
  let denyAccountInference = false, apiInferenceCalls = 0;
  const httpFetch = async (url, options) => {
    if (url === 'https://api.openai.com/v1/responses') {
      if (options.headers.Authorization !== 'Bearer access-fixture-secret') {
        apiInferenceCalls++;
        return json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'API agent selected.' }] }] });
      }
      if (denyAccountInference) return new Response(JSON.stringify({ error: { code: 'usage_limit_reached' } }), { status: 429 });
    }
    const response = await httpFx.fetchImpl(url, options);
    if (url === 'https://api.openai.com/v1/responses') response.headers.delete('content-type');
    return response;
  };
  const server = createStudioServer({ apiKey: '', authDirectory: path.join(root, 'http'), fetchImpl: httpFetch });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, base = 'http://127.0.0.1:' + port;
  const post = (route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/ai/auth/start', {}, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('/api/ai/source', { provider: 'chatgpt' })).status, 401);
    const savedApi = await (await post('/api/ai/agents/save', { name: 'Paid API', provider: 'openai', model: 'api-fixture', apiKey: 'sk-fixture-paid-secret-1234567890' })).json();
    const paidAgentId = savedApi.agents[0].id;
    const start = await (await post('/api/ai/auth/start', {})).json();
    const redirect = await fetch(start.openUrl, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    httpFx.authorization = new URL(redirect.headers.get('location')); httpFx.nonce = httpFx.authorization.searchParams.get('nonce');
    const callback = new URL('/auth/callback', base);
    callback.search = new URLSearchParams({ code: 'fixture-code', state: httpFx.authorization.searchParams.get('state'), client_id: httpFx.clientId });
    assert.equal((await fetch(callback, { redirect: 'manual' })).status, 400, 'Reject callback without the initiating browser cookie');
    const result = await fetch(callback, { redirect: 'manual', headers: { Cookie: redirect.headers.get('set-cookie').split(';')[0] } });
    assert.equal(result.status, 303); assert.equal(result.headers.get('location'), '/auth/result');
    const ready = await (await fetch(base + '/api/ai/status')).json();
    assert.equal(ready.configured, true); assert.equal(ready.provider, 'chatgpt');
    const context = AiDrawing.makeContext(PIX2.createDocument('Test', 1, 1, 16, 16), null, 'new');
    const drawing = await post('/api/ai/agent', { message: 'Vẽ nón đỏ', context });
    const drawingBody = await drawing.json();
    assert.equal(drawing.status, 200); assert.equal(drawingBody.calls[0].name, 'draw');
    assert.equal(apiInferenceCalls, 0, 'Login selects the account even with an enabled API agent');
    assert.equal((await post('/api/ai/source', { provider: 'agents' })).status, 409, 'Do not switch source while editor tools are pending');
    await post('/api/ai/agent', { runId: drawingBody.runId, cancel: true });
    denyAccountInference = true;
    const limited = await post('/api/ai/agent', { message: 'Vẽ nón đỏ', context, agentId: paidAgentId, policy: { allowFallback: true, maxRetries: 0 } });
    assert.equal(limited.status, 429);
    assert.equal(apiInferenceCalls, 0, 'Account quota failure never falls back to saved paid API credentials');
    denyAccountInference = false;
    assert.equal((await post('/api/ai/source', { provider: 'agents' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('/api/ai/source', { provider: 'invalid' })).status, 400);
    assert.equal((await (await post('/api/ai/source', { provider: 'agents' })).json()).provider, 'agents');
    const apiDrawing = await post('/api/ai/agent', { message: 'Vẽ nón đỏ', context });
    assert.equal(apiDrawing.status, 200); assert.equal(apiInferenceCalls, 1);
    assert.equal((await (await post('/api/ai/source', { provider: 'chatgpt' })).json()).provider, 'chatgpt');
    const imported = await post('/api/ai/agents/import-chatgpt', { name: 'ChatGPT worker', model: 'fixture-pixel-model' });
    assert.equal(imported.status, 200);
    const importedState = await imported.json();
    const accountAgent = importedState.agents.find(item => item.authMethod === 'chatgpt_oauth');
    assert(accountAgent);
    assert(!JSON.stringify(importedState).includes('access-fixture') && !JSON.stringify(importedState).includes('refresh-fixture'));
    assert.equal((await post('/api/ai/agents/save', { id: accountAgent.id, model: 'invalid-model' })).status, 400);
    await post('/api/ai/agents/remove', { id: accountAgent.id });
    await post('/api/ai/agents/remove', { id: paidAgentId });
    const logout = await (await post('/api/ai/auth/logout', {})).json();
    assert.equal(logout.configured, false); assert.equal(logout.provider, 'none');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  console.log('ChatGPT sign-in passed: PKCE, state/cookie binding, nonce/signature/identity checks, registration reuse, protected persistence, concurrent refresh rotation, identity-only denial, logout and token secrecy.');
  console.log('HTTP/SSE passed: cross-origin rejection, callback routes, account models, namespaced tools, required preview fields, UTF-8 chunk boundaries and incomplete stream rejection. All OpenAI responses mocked.');
} finally { await rm(root, { recursive: true, force: true }); }
