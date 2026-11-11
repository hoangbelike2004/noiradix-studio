import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const defaultDirectory = () => process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'NOIRADIX Studio') : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/NOIRADIX Studio') : path.join(os.homedir(), '.config/noiradix-studio');

class AuthStore {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'chatgpt-auth.json'); }
  async read() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.profiles)) throw new Error('Invalid auth store');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, hostId: null, active: null, profiles: [] };
      fail('Không đọc được cấu hình đăng nhập trên máy. Kiểm tra quyền thư mục cấu hình Studio.', 500);
    }
  }
  async update(change) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await chmod(this.directory, 0o700);
    const lock = path.join(this.directory, 'chatgpt-auth.lock');
    const deadline = Date.now() + 25000;
    for (;;) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try { if (Date.now() - (await stat(lock)).mtimeMs > 90000) { await rm(lock, { recursive: true, force: true }); continue; } } catch { continue; }
        if (Date.now() > deadline) fail('Một phiên Studio khác đang cập nhật đăng nhập. Hãy thử lại sau.', 409);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      const data = await this.read();
      const result = await change(data);
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.file);
      if (process.platform !== 'win32') await chmod(this.file, 0o600);
      return result;
    } finally { await rm(temporary, { force: true }); await rm(lock, { recursive: true, force: true }); }
  }
}

/** Official local/open-source OAuth flow. No external registration until the user signs in. */
export function createChatGPTAuth({ directory = defaultDirectory(), fetchImpl = fetch, preferredModel = 'gpt-5.4-mini', onChange = () => {} } = {}) {
  const store = new AuthStore(directory);
  let pending = null, lastError = '', discovery = null, keys = null, keysAt = 0;
  async function metadata() {
    if (discovery) return discovery;
    const response = await fetchImpl(issuer + '/.well-known/openid-configuration', { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) fail('Chưa kết nối được trang đăng nhập OpenAI. Hãy thử lại.', 502);
    const data = await response.json();
    if (data.issuer !== issuer) fail('Thông tin máy chủ đăng nhập OpenAI không hợp lệ.', 502);
    for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'revocation_endpoint']) {
      if (typeof data[field] !== 'string' || new URL(data[field]).origin !== issuer) fail('Địa chỉ máy chủ đăng nhập không hợp lệ.', 502);
    }
    discovery = data; return data;
  }
  async function identity(token, clientId, nonce = null) {
    if (typeof token !== 'string' || token.length > 40000) fail('OpenAI chưa trả về thông tin tài khoản hợp lệ.', 502);
    const segments = token.split('.');
    if (segments.length !== 3) fail('Chữ ký đăng nhập không hợp lệ.', 502);
    let header, claims;
    try { header = JSON.parse(Buffer.from(segments[0], 'base64url')); claims = JSON.parse(Buffer.from(segments[1], 'base64url')); } catch { fail('Thông tin đăng nhập không hợp lệ.', 502); }
    if (!['RS256', 'ES256'].includes(header.alg) || typeof header.kid !== 'string' || header.crit) fail('Chữ ký đăng nhập không được hỗ trợ.', 502);
    async function loadKeys() {
      const response = await fetchImpl((await metadata()).jwks_uri, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) fail('Không kiểm tra được chữ ký đăng nhập OpenAI.', 502);
      keys = (await response.json()).keys; keysAt = Date.now();
      if (!Array.isArray(keys)) fail('Khóa xác minh đăng nhập không hợp lệ.', 502);
    }
    if (!keys || Date.now() - keysAt > 300000) await loadKeys();
    let key = keys.find(item => item.kid === header.kid);
    if (!key) { await loadKeys(); key = keys.find(item => item.kid === header.kid); }
    if (!key || (key.use && key.use !== 'sig') || (key.alg && key.alg !== header.alg) || key.kty !== (header.alg === 'RS256' ? 'RSA' : 'EC')) fail('Không xác minh được chữ ký đăng nhập.', 502);
    const publicKey = createPublicKey({ key, format: 'jwk' });
    const valid = verify('sha256', Buffer.from(segments[0] + '.' + segments[1]), header.alg === 'ES256' ? { key: publicKey, dsaEncoding: 'ieee-p1363' } : publicKey, Buffer.from(segments[2], 'base64url'));
    const now = Date.now() / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!valid || claims.iss !== issuer || !audiences.includes(clientId) || (audiences.length > 1 && claims.azp !== clientId) ||
        !Number.isFinite(claims.exp) || claims.exp < now - 5 || !Number.isFinite(claims.iat) || claims.iat > now + 5 ||
        (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 5)) || typeof claims.sub !== 'string' || !claims.sub || (nonce !== null && !equal(claims.nonce, nonce))) fail('Không xác minh được tài khoản hoặc phiên đăng nhập đã hết hạn.', 502);
    return { issuer, subject: claims.sub, email: typeof claims.email === 'string' ? claims.email.slice(0, 300) : '', name: typeof claims.name === 'string' ? claims.name.slice(0, 200) : '' };
  }
  async function tokenRequest(fields) {
    const response = await fetchImpl((await metadata()).token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...fields, resource }).toString(), signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) fail(response.status === 400 || response.status === 401 ? 'Phiên đăng nhập chưa hợp lệ hoặc đã hết hạn. Hãy bấm Continue with ChatGPT để đăng nhập lại.' : 'OpenAI chưa hoàn tất đăng nhập. Hãy thử lại.', 502);
    return response.json();
  }
  function credentials(data, previous = null) {
    if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 40000 || data.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86400) fail('OpenAI chưa trả về phiên truy cập hợp lệ.', 502);
    const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : previous?.scopes || [];
    if (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || data.refresh_token.length > 40000)) fail('Phiên gia hạn đăng nhập không hợp lệ.', 502);
    const earliest = typeof data.earliest_refresh_at === 'number' ? (data.earliest_refresh_at < 1e12 ? data.earliest_refresh_at * 1000 : data.earliest_refresh_at) : Date.parse(data.earliest_refresh_at || '');
    return { accessToken: data.access_token, refreshToken: data.refresh_token || previous?.refreshToken || null, idToken: data.id_token || previous?.idToken || null,
      expiresAt: Date.now() + data.expires_in * 1000, earliestRefreshAt: Number.isFinite(earliest) ? earliest : 0, scopes };
  }
  const sharing = profile => Boolean(profile?.tokens?.scopes?.includes('chatgpt.tokens.use.direct') && profile.tokens.scopes.includes('resource.invoke'));
  const connected = profile => Boolean(profile?.identity && profile?.tokens && (profile.tokens.expiresAt > Date.now() || profile.tokens.refreshToken));
  async function status() {
    if (pending && Date.now() > pending.expiresAt) { pending = null; lastError = 'Đăng nhập đã hết thời gian chờ. Hãy thử lại.'; }
    const data = await store.read(), active = data.profiles.find(item => item.clientId === data.active);
    return { pending: Boolean(pending), error: lastError, activeClientId: data.active, connected: connected(active), sharing: sharing(active),
      models: connected(active) ? active.models || [] : [], model: active?.model || '', welcomeNeeded: Boolean(connected(active) && sharing(active) && !active.welcomed),
      profiles: data.profiles.map((item, index) => ({ clientId: item.clientId, label: `${item.identity?.email || item.identity?.name || 'Tài khoản ChatGPT'} · ${index + 1}`, connected: connected(item) })) };
  }
  async function start(port, clientId = null) {
    if (pending && Date.now() < pending.expiresAt) fail('Một lượt đăng nhập đang mở. Hoàn tất hoặc bấm Hủy đăng nhập trước.', 409);
    const info = await metadata();
    const prepared = await store.update(data => {
      if (!data.hostId) data.hostId = 'urn:uuid:' + randomUUID();
      const selected = clientId ? data.profiles.find(item => item.clientId === clientId) : null;
      if (clientId && !selected) fail('Tài khoản đã chọn không còn trong cấu hình.');
      return { hostId: data.hostId, selected };
    });
    const verifier = randomBytes(48).toString('base64url');
    const state = random(), nonce = random(), ticket = random(), cookie = random();
    const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
    const params = new URLSearchParams({ client_id: clientId || 'dynamic_agent_client', ext_agent_host_id: prepared.hostId, response_type: 'code', redirect_uri: redirectUri,
      scope, resource, state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    if (!clientId) params.set('agent_name_hint', 'NOIRADIX Studio');
    if (prepared.selected?.identity?.email) params.set('login_hint', prepared.selected.identity.email);
    if (prepared.selected?.tokens?.idToken) params.set('id_token_hint', prepared.selected.tokens.idToken);
    pending = { state, nonce, ticket, cookie, verifier, redirectUri, clientId, identity: prepared.selected?.identity || null, expiresAt: Date.now() + 300000,
      authorizationUrl: info.authorization_endpoint + '?' + params };
    lastError = '';
    return { openUrl: `http://127.0.0.1:${port}/auth/chatgpt?ticket=${ticket}` };
  }
  function redirect(ticket, port) {
    if (!pending || pending.opened || Date.now() > pending.expiresAt || !equal(ticket, pending.ticket)) fail('Liên kết đăng nhập đã hết hạn. Hãy mở lại từ Studio.');
    pending.opened = true;
    return { location: pending.authorizationUrl, cookie: `noiradix_auth_${port}=${pending.cookie}; HttpOnly; SameSite=Lax; Path=/auth/callback; Max-Age=300` };
  }
  async function callback(params, cookieHeader, port) {
    const attempt = pending;
    const cookie = (cookieHeader || '').split(';').map(item => item.trim()).find(item => item.startsWith(`noiradix_auth_${port}=`))?.split('=')[1];
    if (!attempt || attempt.processing || !attempt.opened || Date.now() > attempt.expiresAt || !equal(params.get('state'), attempt.state) || !equal(cookie, attempt.cookie)) fail('Không xác minh được lượt đăng nhập. Hãy quay lại Studio và thử lại.', 403);
    attempt.processing = true;
    try {
      if (params.has('error')) fail(params.get('error') === 'access_denied' ? 'Bạn chưa cho phép đăng nhập hoặc dùng gói ChatGPT. Có thể thử lại từ Studio.' : 'OpenAI chưa chấp nhận lượt đăng nhập này. Hãy thử lại.');
      const issued = params.get('client_id') || attempt.clientId;
      if (!issued || issued === 'dynamic_agent_client' || !/^[\w-]{3,200}$/.test(issued) || (attempt.clientId && issued !== attempt.clientId) || !params.get('code') || params.get('code').length > 12000) fail('Đăng ký ứng dụng chưa hoàn tất. Hãy thử đăng nhập lại.');
      // Save registration before exchange: a code may expire after registration succeeds.
      await store.update(data => { if (!data.profiles.some(item => item.clientId === issued)) data.profiles.push({ clientId: issued, identity: null, tokens: null, welcomed: false }); });
      const token = await tokenRequest({ grant_type: 'authorization_code', client_id: issued, code: params.get('code'), code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri });
      const account = await identity(token.id_token, issued, attempt.nonce);
      if (attempt.identity && (account.issuer !== attempt.identity.issuer || account.subject !== attempt.identity.subject)) fail('Tài khoản trả về khác với tài khoản đã chọn. Hãy thêm tài khoản mới.');
      const tokens = credentials(token);
      if (pending !== attempt) fail('Lượt đăng nhập đã bị hủy.');
      await store.update(data => {
        if (pending !== attempt) fail('Lượt đăng nhập đã bị hủy.');
        const profile = data.profiles.find(item => item.clientId === issued);
        if (profile.identity && (profile.identity.subject !== account.subject || profile.identity.issuer !== account.issuer)) fail('Đăng nhập không khớp với tài khoản đã lưu.');
        Object.assign(profile, { identity: account, tokens, models: [], model: '' }); data.active = issued;
      });
      attempt.committed = true;
      onChange();
      if (sharing({ tokens })) { try { await models(); } catch { lastError = 'Đã đăng nhập nhưng chưa tải được danh sách model. Bấm Kiểm tra lại.'; } }
      else lastError = 'Đã đăng nhập, nhưng chưa có quyền dùng gói ChatGPT để vẽ. Hãy đăng nhập lại và cho phép sử dụng gói nếu tài khoản hỗ trợ.';
    } catch (error) { if (pending === attempt) lastError = error.status ? error.message : 'Chưa hoàn tất đăng nhập. Hãy quay lại Studio và thử lại.'; throw error; }
    finally { if (pending === attempt) pending = null; }
  }
  async function access(clientId = null) {
    const initial = await store.read(), current = initial.profiles.find(item => item.clientId === (clientId || initial.active));
    if (!connected(current) || !sharing(current)) fail('Hãy đăng nhập và cho phép Studio dùng gói ChatGPT trước khi vẽ.', 401);
    if (current.tokens.expiresAt - Date.now() > 45000) return current;
    const renewed = await store.update(async data => {
      const profile = data.profiles.find(item => item.clientId === (clientId || data.active));
      if (!profile || profile.clientId !== current.clientId || !connected(profile)) fail('Tài khoản đã thay đổi. Hãy gửi lại yêu cầu.', 409);
      if (profile.tokens.expiresAt - Date.now() > 45000) return profile;
      if (!profile.tokens.refreshToken) fail('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.', 401);
      if (Date.now() < profile.tokens.earliestRefreshAt) {
        if (profile.tokens.expiresAt > Date.now()) return profile;
        fail('OpenAI chưa cho phép gia hạn phiên này. Hãy đăng nhập lại.', 401);
      }
      const response = await tokenRequest({ grant_type: 'refresh_token', client_id: profile.clientId, refresh_token: profile.tokens.refreshToken });
      if (response.id_token) {
        const account = await identity(response.id_token, profile.clientId);
        if (account.subject !== profile.identity.subject || account.issuer !== profile.identity.issuer) fail('Tài khoản gia hạn không khớp. Hãy đăng nhập lại.', 401);
      }
      profile.tokens = credentials(response, profile.tokens);
      return profile;
    });
    if (!sharing(renewed)) fail('Quyền dùng gói ChatGPT đã thay đổi. Hãy đăng nhập lại.', 401);
    return renewed;
  }
  async function models(clientId = null) {
    const profile = await access(clientId);
    const response = await fetchImpl(resource + '/models', { headers: { Authorization: 'Bearer ' + profile.tokens.accessToken }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) fail('Không tải được model cho tài khoản ChatGPT này. Kiểm tra quyền sử dụng gói hoặc đăng nhập lại.', 502);
    const available = (await response.json()).models;
    if (!Array.isArray(available)) fail('Danh sách model ChatGPT chưa hợp lệ.', 502);
    const choices = available.filter(item => item.visibility === 'list' && typeof item.slug === 'string' && /^[\w.:-]{1,150}$/.test(item.slug)).slice(0, 100).map(item => ({ id: item.slug, name: typeof item.display_name === 'string' ? item.display_name.slice(0, 150) : item.slug }));
    if (!choices.length) fail('Tài khoản này chưa có model khả dụng cho Studio.', 403);
    await store.update(data => {
      const saved = data.profiles.find(item => item.clientId === profile.clientId);
      saved.models = choices; saved.modelsAt = Date.now();
      if (!choices.some(item => item.id === saved.model)) saved.model = choices.find(item => item.id === preferredModel)?.id || choices[0].id;
    });
    return choices;
  }
  async function connection(clientId = null, requestedModel = null) {
    let profile = await access(clientId);
    if (!profile.models?.length || Date.now() - (profile.modelsAt || 0) > 3600000) {
      await models(clientId); const data = await store.read();
      if (!clientId && data.active !== profile.clientId) fail('Tài khoản đã thay đổi. Hãy gửi lại yêu cầu.', 409);
      profile = data.profiles.find(item => item.clientId === (clientId || data.active));
    }
    if (requestedModel && !profile.models.some(item => item.id === requestedModel)) fail('Model không thuộc tài khoản ChatGPT này.');
    return { accessToken: profile.tokens.accessToken, model: requestedModel || profile.model, chatgpt: true, accountId: profile.clientId };
  }
  async function action(name, body = {}) {
    if (name === 'cancel') {
      if (pending?.committed) return { message: 'Đăng nhập đã hoàn tất. Bạn có thể đăng xuất sau khi Studio tải xong model.' };
      pending = null; lastError = ''; return {};
    }
    if (name === 'models') { await models(); lastError = ''; return {}; }
    if (name === 'select') {
      await store.update(data => { if (!data.profiles.some(item => item.clientId === body.clientId)) fail('Tài khoản không tồn tại.'); data.active = body.clientId; });
      lastError = ''; onChange(); return {};
    }
    if (name === 'model' || name === 'ack') {
      await store.update(data => {
        const profile = data.profiles.find(item => item.clientId === data.active);
        if (!profile || !connected(profile)) fail('Hãy đăng nhập trước.');
        if (name === 'ack') profile.welcomed = true;
        else { if (!profile.models?.some(item => item.id === body.model)) fail('Model không thuộc tài khoản này.'); profile.model = body.model; }
      });
      if (name === 'model') onChange(); return {};
    }
    if (name === 'logout') {
      pending = null;
      let revoked = true;
      await store.update(async data => {
        const profile = data.profiles.find(item => item.clientId === data.active);
        revoked = !profile?.tokens?.refreshToken;
        if (!revoked) {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const response = await fetchImpl((await metadata()).revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token: profile.tokens.refreshToken, token_type_hint: 'refresh_token', client_id: profile.clientId }).toString(), signal: AbortSignal.timeout(15000), redirect: 'error' });
              revoked = response.ok;
              if (revoked || response.status < 500) break;
            } catch { /* Retry once, then report unconfirmed remote revocation. */ }
            if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 400));
          }
        }
        if (profile) profile.tokens = null;
        data.active = null;
      });
      lastError = ''; onChange();
      return { message: revoked ? 'Đã đăng xuất trên máy này.' : 'Đã đăng xuất trên máy này. Chưa xác nhận thu hồi phiên từ OpenAI; bạn có thể ngắt kết nối Studio trong ChatGPT Settings.' };
    }
    fail('Thao tác đăng nhập không hợp lệ.');
  }
  return { status, start, redirect, callback, action, connection };
}
