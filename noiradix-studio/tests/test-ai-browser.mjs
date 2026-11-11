// Optional end-to-end smoke test using an isolated headless Chrome/Edge profile.
// No browser library, personal browser profile, network credentials or paid API.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createStudioServer } from '../tools/studio-server.mjs';

const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(item => item && existsSync(item));
if (!chrome) { console.log('SKIP browser smoke: set CHROME_PATH to Chrome/Edge.'); process.exit(0); }
const temporary = await mkdtemp(path.join(os.tmpdir(), 'noiradix-browser-'));
let rootCalls = 0, workerCalls = 0, chatgptCalls = 0, teamCalls = 0, workerId, failSynthesis = false, verifyPreserved = false;
let accountTeamMode = false, reviewNeedsCorrection = false;
const server = createStudioServer({ apiKey: '', geminiApiKey: '', authDirectory: path.join(temporary, 'auth'),
  googleOptions: { pollMs: 30, runtimeLoader: async () => ({ executable: process.execPath, args: [fileURLToPath(new URL('./fixtures/google-acp-agent.mjs', import.meta.url))] }) }, fetchImpl: async (url, options) => {
  if (options.headers.Authorization === 'Bearer browser-chatgpt-fixture') {
    const request = JSON.parse(options.body);
    if (accountTeamMode) {
      teamCalls++;
      assert.equal(request.tools.length, 0);
      const planning = request.instructions.includes('Create a practical');
      if (!planning) assert(options.body.includes('#00dd88'), 'Account reviewer sees Google editor output');
      const reply = planning ? 'Plan fixture: let Gemini paint 2,0.' : request.instructions.includes('First line must') ?
        reviewNeedsCorrection ? 'REVISE\nRecheck the pixel.' : 'APPROVED\nTeam fixture verified actual pixel.' : 'Team correction verified actual pixel.';
      return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: reply }] }], usage: { input_tokens: 40, output_tokens: 10 } } }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    }
    chatgptCalls++;
    assert.equal(request.model, 'chatgpt-browser-model');
    assert.equal(request.stream, true); assert.equal('max_output_tokens' in request, false);
    const output = chatgptCalls === 1 ? [{ type: 'function_call', namespace: 'studio', name: 'draw', call_id: 'account-draw',
      arguments: JSON.stringify({ actions: [{ tool: 'pen', color: '#aabbcc', points: [{ x: 0, y: 0 }] }] }) }] :
      [{ type: 'message', content: [{ type: 'output_text', text: 'ChatGPT account verified pixel.' }] }];
    if (chatgptCalls > 1) assert(options.body.includes('#aabbcc'), 'ChatGPT receives actual editor pixel feedback');
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output, usage: { input_tokens: 40, output_tokens: 10 } } }) + '\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (url.includes('openai.com')) {
    if (verifyPreserved) {
      assert(options.body.includes('#00ffff'), 'a subsequent capture retains completed worker pixels after coordinator failure');
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Preserved pixel verified.' }] }], usage: { input_tokens: 100, output_tokens: 10 } }));
    }
    rootCalls++;
    if (failSynthesis && rootCalls > 1) return new Response('{}', { status: 503 });
    const output = rootCalls === 1 ? [{ type: 'function_call', call_id: 'delegate_ui', name: 'delegate_tasks', arguments: JSON.stringify({ tasks: [
      { role: 'generator', agentId: workerId, goal: 'Paint one pixel at 0,0 in the selected frame.', expectedOutput: 'One verified pixel, preserve other frames.' }
    ] }) }] : [{ type: 'message', content: [{ type: 'output_text', text: 'Verified worker pixel.' }] }];
    return new Response(JSON.stringify({ status: 'completed', output, usage: { input_tokens: 100, output_tokens: 20 } }));
  }
  workerCalls++;
  const body = JSON.parse(options.body);
  if (workerCalls > 1) {
    const response = body.contents.at(-1).parts[0].functionResponse.response;
    assert.equal(response.ok, true, 'actual browser editor accepted the drawing');
    assert(response.canvas.pix2.includes(failSynthesis ? '#00ffff' : '#ff00ff'), 'browser serialized the actual new pixel');
  }
  const parts = workerCalls === 1 ? [{ functionCall: { name: 'draw', args: { actions: [{ tool: 'pen', color: failSynthesis ? '#00ffff' : '#ff00ff', points: [{ x: failSynthesis ? 1 : 0, y: 0 }] }] } }, thoughtSignature: 'ui-fixture-signature' }] : [{ text: 'Painted one pixel.' }];
  return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts } }], usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 } }));
} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--remote-debugging-port=0', '--user-data-dir=' + path.join(temporary, 'profile'), 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chrome DevTools startup timed out')), 15000);
    browser.once('error', error => { clearTimeout(timeout); reject(error); });
    browser.once('exit', code => { clearTimeout(timeout); reject(new Error('Chrome exited: ' + code)); });
    browser.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let next = 0; const pending = new Map(), errors = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const handler = pending.get(message.id); if (handler) { pending.delete(message.id); clearTimeout(handler.timeout); message.error ? handler.reject(new Error(JSON.stringify(message.error))) : handler.resolve(message.result); } }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next, timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const targetId = targetInfos.find(item => item.type === 'page')?.targetId || (await send('Target.createTarget', { url: 'about:blank' })).targetId;
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId); await send('Page.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId); await send('Network.setBlockedURLs', { urls: ['https://*'] }, sessionId);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async expression => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 80)); }
    throw new Error('Browser condition timed out: ' + expression + '\n' + await evaluate("document.getElementById('ai-chat-messages')?.textContent + '\n' + document.querySelector('[data-error]')?.textContent"));
  };
  await send('Page.navigate', { url }, sessionId);
  await until('Boolean(window.aiChatPanel)');
  await evaluate("document.getElementById('btn-toggle-ai-chat').click(); const localInput=document.getElementById('ai-chat-input'); localInput.value='Nhân đôi frame này'; localInput.dispatchEvent(new Event('input'));");
  await until("!document.getElementById('btn-ai-chat-send').disabled");
  await evaluate("document.getElementById('ai-chat-form').requestSubmit()");
  await until("document.getElementById('ai-chat-messages').textContent.includes('Đã nhân đôi frame đang chọn.') && !document.body.classList.contains('ai-drawing-busy')");
  assert.equal(rootCalls + workerCalls, 0, 'keyless local command did not call a provider');
  assert.equal(await evaluate("document.getElementById('ai-chat-preferences').open"), false, 'unconfigured chat leaves settings closed');
  const chatHeight = await evaluate("document.getElementById('ai-chat-messages').getBoundingClientRect().height");
  await evaluate("document.getElementById('btn-ai-chat-settings').click()");
  assert.equal(await evaluate("document.getElementById('ai-chat-preferences').matches(':modal') && !document.getElementById('ai-chat-panel').contains(document.getElementById('ai-chat-preferences'))"), true, 'settings opens as a separate modal');
  assert.equal(await evaluate("document.getElementById('ai-chat-messages').getBoundingClientRect().height"), chatHeight, 'settings does not shrink chat');
  assert.equal(await evaluate("document.getElementById('ai-api-advanced').open"), false, 'Account setup replaces the default API form');
  assert.equal(await evaluate("document.getElementById('ai-account-team-settings').checkVisibility()"), true);
  await evaluate("document.getElementById('ai-api-advanced').open=true");
  await evaluate("document.querySelector('[data-agent-form]').elements.name.value='Draft AI'; document.getElementById('ai-settings-tab-account').click()");
  assert.equal(await evaluate("document.getElementById('ai-settings-account').checkVisibility() && !document.getElementById('ai-settings-agents').checkVisibility()"), true);
  await evaluate("document.getElementById('ai-settings-tab-api').click()");
  assert.equal(await evaluate("document.getElementById('ai-chat-connect-form').checkVisibility()"), true);
  await evaluate("document.getElementById('ai-settings-tab-agents').click()");
  assert.equal(await evaluate("document.querySelector('[data-agent-form]').elements.name.value"), 'Draft AI', 'switching tabs preserves form');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
  await until("!document.getElementById('ai-chat-preferences').open");
  assert.equal(await evaluate("document.activeElement.id"), 'btn-ai-chat-settings', 'Escape returns focus to settings button');
  await evaluate("document.getElementById('btn-ai-chat-settings').click()");
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, sessionId);
  assert.equal(await evaluate("(() => { const d=document.getElementById('ai-chat-preferences'), r=d.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && d.scrollWidth<=d.clientWidth && document.querySelector('.ai-settings-body').scrollWidth<=document.querySelector('.ai-settings-body').clientWidth; })()"), true, 'settings fits narrow screens without horizontal scrolling');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false }, sessionId);
  assert.equal(await evaluate("document.querySelector('[data-agent-form]').elements.model.tagName"), 'SELECT');
  await evaluate("(() => { const f=document.querySelector('[data-agent-form]'); f.elements.provider.value='gemini'; f.elements.provider.dispatchEvent(new Event('change')); })()");
  assert.deepEqual(await evaluate("Array.from(document.querySelector('[data-agent-form]').elements.model.options).map(option=>option.value)"), ['', 'gemini-4-argon', 'gemini-3.8-flash', '__custom__']);
  assert.equal(await evaluate("document.querySelector('[data-import]').classList.contains('hidden') && document.querySelector('[data-import-api]').classList.contains('hidden')"), true);
  async function addAgent(provider, name, model) {
    await evaluate(`(() => { const f=document.querySelector('[data-agent-form]'); f.elements.name.value=${JSON.stringify(name)}; f.elements.provider.value=${JSON.stringify(provider)}; f.elements.provider.dispatchEvent(new Event('change')); f.elements.model.value=${JSON.stringify(model)}; f.elements.model.dispatchEvent(new Event('change')); f.elements.tokens.value=${JSON.stringify(provider === 'openai' ? '1000000' : '')}; f.elements.apiKey.value=${JSON.stringify(provider === 'gemini' ? 'AQ.fixture-browser-private-key.12345' : 'fixture-browser-private-key-12345')}; f.requestSubmit(); })()`);
  }
  await addAgent('openai', 'UI Orchestrator', 'gpt-6.1-sol');
  await until("document.querySelectorAll('.ai-agent-card').length === 1 && !document.querySelector('[data-agent-form] button').disabled");
  await addAgent('gemini', 'UI Worker', 'gemini-4-argon');
  await until("document.querySelectorAll('.ai-agent-card').length === 2 && !document.querySelector('[data-agent-form] button').disabled");
  assert.equal(await evaluate("document.getElementById('ai-chat-preferences').open"), true, 'saving an AI keeps settings open for another connection');
  assert.equal(await evaluate("document.querySelectorAll('[data-tokens-remaining]')[0].textContent"), (1000000).toLocaleString('vi-VN'));
  assert.equal(await evaluate("document.querySelectorAll('[data-tokens-remaining]')[1].textContent"), 'Chưa đặt giới hạn', 'no provider token balance invented for an unset cap');
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.ai-agent-billing-links a')).map(a=>a.href)"), [
    'https://platform.openai.com/usage', 'https://platform.openai.com/settings/organization/billing/overview',
    'https://aistudio.google.com/usage', 'https://aistudio.google.com/billing']);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, sessionId);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.ai-agent-card, .ai-agent-token-usage, .ai-agent-form-section')).every(el=>el.scrollWidth<=el.clientWidth)"), true, 'token balances and form fit narrow screens');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false }, sessionId);
  if (process.env.STUDIO_TEST_SCREENSHOT) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(process.env.STUDIO_TEST_SCREENSHOT, Buffer.from(data, 'base64'));
  }
  const state = await (await fetch(url + '/api/ai/agents')).json(); workerId = state.agents.find(item => item.provider === 'gemini').id;
  assert.equal(await evaluate("document.querySelector('[data-agent-form]').elements.apiKey.value"), '');
  assert.equal(await evaluate("localStorage.getItem('apiKey')"), null);
  await evaluate("document.getElementById('btn-close-ai-chat-settings').click(); document.getElementById('ai-agent-mode').value='multi'; const input=document.getElementById('ai-chat-input'); input.value='Paint one pixel and preserve the rest'; input.dispatchEvent(new Event('input')); document.getElementById('ai-chat-form').requestSubmit();");
  await until("document.getElementById('ai-chat-messages').textContent.includes('Verified worker pixel.') && !document.body.classList.contains('ai-drawing-busy')");
  assert.equal(rootCalls, 2); assert.equal(workerCalls, 2);
  assert.equal((await (await fetch(url + '/api/ai/agents')).json()).workflows.at(-1).status, 'Completed');
  assert.equal(await evaluate("document.getElementById('ai-chat-messages').textContent.includes('Hình trước lượt')"), false);
  await until("document.querySelectorAll('[data-tokens-used]')[0].textContent === '240' && document.querySelectorAll('[data-tokens-used]')[1].textContent === '200'");
  assert.equal(await evaluate("document.querySelector('[data-tokens-remaining]').textContent"), (1000000 - 240).toLocaleString('vi-VN'), 'remaining budget refreshes after actual provider usage');
  // The visible local token cap is editable without replacing the saved key.
  await evaluate("document.getElementById('btn-ai-chat-settings').click(); document.querySelectorAll('.ai-agent-token-usage button')[1].click()");
  assert.equal(await evaluate("document.activeElement.name"), 'tokens');
  await evaluate("document.querySelector('[data-agent-form]').elements.tokens.value='0'; document.querySelector('[data-agent-form]').requestSubmit()");
  await until("document.querySelectorAll('[data-tokens-remaining]')[1].textContent === '0' && !document.querySelector('[data-agent-form] button').disabled");
  assert.equal(await evaluate("document.querySelectorAll('.ai-agent-token-usage')[1].classList.contains('ai-agent-token-warning')"), true);
  await evaluate("document.querySelectorAll('.ai-agent-token-usage button')[1].click(); document.querySelector('[data-agent-form]').elements.tokens.value=''; document.querySelector('[data-agent-form]').requestSubmit()");
  await until("document.querySelectorAll('[data-tokens-remaining]')[1].textContent === 'Chưa đặt giới hạn' && !document.querySelector('[data-agent-form] button').disabled");
  // Editing and disabling a real connection through its card/form preserves keys.
  await evaluate("document.querySelector('.ai-agent-card button').click(); const form=document.querySelector('[data-agent-form]'); form.elements.model.value='__custom__'; form.elements.model.dispatchEvent(new Event('change')); form.elements.customModel.value='ui-root-edited'; form.elements.customModel.dispatchEvent(new Event('input')); form.elements.tokens.value=''; form.requestSubmit();");
  await until("document.querySelector('.ai-agent-card').textContent.includes('ui-root-edited')");
  await until("!document.querySelector('[data-agent-form] button').disabled");
  await evaluate("document.querySelector('.ai-agent-card button').click()");
  assert.equal(await evaluate("document.querySelector('[data-agent-form]').elements.model.value"), 'ui-root-edited', 'reopening a saved custom model preserves its exact ID');
  failSynthesis = true; rootCalls = 0; workerCalls = 0;
  await evaluate("document.querySelector('[data-policy=maxRetries]').value='0'; document.querySelector('[data-policy=allowFallback]').checked=false; document.getElementById('btn-close-ai-chat-settings').click(); document.getElementById('ai-chat-input').value='Paint another pixel'; document.getElementById('ai-chat-form').requestSubmit();");
  await until("document.getElementById('ai-chat-messages').textContent.includes('Lượt chưa hoàn tất; các thay đổi đã thực hiện được giữ lại.') && !document.body.classList.contains('ai-drawing-busy')");
  const failed = (await (await fetch(url + '/api/ai/agents')).json()).workflows.at(-1);
  assert.equal(failed.status, 'Failed'); assert.equal(failed.tasks[1].status, 'Completed');
  await evaluate("document.getElementById('btn-ai-chat-settings').click(); document.querySelector('.ai-agent-token-usage button').click(); document.querySelector('[data-agent-form]').elements.tokens.value='1000000'; document.querySelector('[data-agent-form]').requestSubmit()");
  await until("document.querySelector('.ai-agent-token-usage').dataset.tokenStatus === 'unreported' && !document.querySelector('[data-agent-form] button').disabled");
  assert.equal(await evaluate("document.querySelector('[data-tokens-remaining]').textContent"), 'Chưa xác định', 'failed provider responses without usage never create a fake remaining balance');
  assert.equal(await evaluate("document.querySelector('.ai-agent-token-usage progress')"), null);
  await evaluate("document.querySelector('.ai-agent-token-usage button').click(); document.querySelector('[data-agent-form]').elements.tokens.value=''; document.querySelector('[data-agent-form]').requestSubmit()");
  await until("!document.querySelector('[data-agent-form] button').disabled");
  await evaluate("document.getElementById('btn-close-ai-chat-settings').click()");
  verifyPreserved = true;
  await evaluate("document.getElementById('ai-chat-input').value='Describe preserved pixel'; document.getElementById('ai-chat-form').requestSubmit();");
  await until("document.getElementById('ai-chat-messages').textContent.includes('Preserved pixel verified.') && !document.body.classList.contains('ai-drawing-busy')");
  // Google uses a real ACP subprocess/MCP bridge and an interactive permission
  // card, with account-specific models and no API-key-provider fallback.
  const apiCallsBeforeGoogle = rootCalls + workerCalls;
  await evaluate("document.getElementById('btn-ai-chat-settings').click(); document.getElementById('ai-settings-tab-google').click(); document.getElementById('btn-ai-google-login').click()");
  await until("document.getElementById('ai-google-status').textContent.includes('Google đang được dùng') && !document.getElementById('ai-google-model').disabled");
  assert.equal((await (await fetch(url + '/api/ai/status')).json()).provider, 'google');
  assert.equal(await evaluate("document.getElementById('ai-google-model').options.length"), 2);
  await evaluate("document.getElementById('ai-google-model').value='gemini-fixture-2'; document.getElementById('ai-google-model').dispatchEvent(new Event('change'))");
  await until("!document.getElementById('ai-google-model').disabled");
  assert.equal((await (await fetch(url + '/api/ai/google/status')).json()).model, 'gemini-fixture-2');
  if (process.env.STUDIO_GOOGLE_SCREENSHOT) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(process.env.STUDIO_GOOGLE_SCREENSHOT, Buffer.from(data, 'base64'));
  }
  await evaluate("document.getElementById('btn-close-ai-chat-settings').click(); document.getElementById('ai-chat-input').value='Google paint one verified pixel'; document.getElementById('ai-chat-form').requestSubmit()");
  await until("Boolean(document.querySelector('.ai-google-permission button:not(:disabled)'))");
  await evaluate("document.querySelector('.ai-google-permission button:not(:disabled)').click()");
  await until("document.getElementById('ai-chat-messages').textContent.includes('Google fixture verified editor pixel.') && !document.body.classList.contains('ai-drawing-busy')");
  assert.equal(rootCalls + workerCalls, apiCallsBeforeGoogle, 'Google subscription connection never falls back to paid API keys');
  assert.equal(await evaluate("document.getElementById('ai-chat-messages').textContent.includes('PRIVATE_THOUGHT')"), false);
  await evaluate("document.getElementById('btn-ai-chat-settings').click()");
  await until("document.getElementById('ai-google-usage').textContent.includes('320')");
  await evaluate("document.getElementById('btn-ai-google-api').click()");
  await until("document.getElementById('ai-chat-connection').textContent.includes('Nhóm AI')");
  await evaluate("document.getElementById('btn-ai-google-select').click()");
  await until("document.getElementById('ai-chat-connection').textContent.includes('Google')");
  await evaluate("document.getElementById('btn-ai-google-disconnect').click()");
  await until("!document.getElementById('btn-ai-google-login').classList.contains('hidden')");
  await send('Page.navigate', { url: url + '/?ai-settings=google' }, sessionId);
  await until("Boolean(window.aiChatPanel) && document.getElementById('ai-chat-preferences').open");
  assert.equal(await evaluate("document.getElementById('ai-settings-tab-google').getAttribute('aria-selected')"), 'true', 'Google setup link opens its settings tab without authenticating');
  // A private fixture session exercises account selection in the real browser;
  // OAuth validation itself is covered in test-chatgpt-auth with signed tokens.
  await writeFile(path.join(temporary, 'auth', 'chatgpt-auth.json'), JSON.stringify({ version: 1, active: 'browser-account', profiles: [{
    clientId: 'browser-account', identity: { email: 'artist@example.test' }, welcomed: true,
    tokens: { accessToken: 'browser-chatgpt-fixture', expiresAt: Date.now() + 3600000, scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'] },
    models: [{ id: 'chatgpt-browser-model', name: 'Account pixel model' }], model: 'chatgpt-browser-model', modelsAt: Date.now()
  }] }));
  await send('Page.navigate', { url: url + '/?ai-settings=chatgpt' }, sessionId);
  await until("Boolean(window.aiChatPanel) && !document.getElementById('btn-ai-chat-use-account').classList.contains('hidden')");
  assert.equal(await evaluate("document.getElementById('ai-settings-tab-account').getAttribute('aria-selected')"), 'true');
  await evaluate("document.getElementById('btn-ai-chat-use-account').click()");
  await until("document.getElementById('ai-chat-source-status').textContent.includes('Đang dùng ChatGPT') && !document.getElementById('btn-ai-chat-use-agents').disabled");
  assert.equal((await (await fetch(url + '/api/ai/status')).json()).provider, 'chatgpt');
  const apiCallsBeforeAccount = rootCalls + workerCalls;
  await evaluate("document.querySelector('[data-policy=maxTokens]').value='0'; document.getElementById('btn-close-ai-chat-settings').click(); document.getElementById('ai-chat-input').value='ChatGPT paint one verified pixel'; document.getElementById('ai-chat-form').requestSubmit()");
  await until("document.getElementById('ai-chat-messages').textContent.includes('ChatGPT account verified pixel.') && !document.body.classList.contains('ai-drawing-busy')");
  assert.equal(chatgptCalls, 2); assert.equal(rootCalls + workerCalls, apiCallsBeforeAccount);
  await evaluate("document.getElementById('btn-ai-chat-settings').click(); document.getElementById('btn-ai-chat-use-agents').click()");
  await until("document.getElementById('ai-chat-connection').textContent.includes('Nhóm AI') && !document.getElementById('btn-ai-chat-use-account').disabled");
  assert.equal(await evaluate("document.getElementById('ai-chat-model').value"), 'chatgpt-browser-model');
  // Account-based teamwork replaces API setup and hands real editor results
  // between ChatGPT consultations and the interactive Gemini ACP session.
  accountTeamMode = true;
  await send('Page.navigate', { url: url + '/?ai-settings=accounts' }, sessionId);
  await until("Boolean(window.aiChatPanel) && !document.getElementById('btn-ai-team-use').disabled");
  assert.equal(await evaluate("document.getElementById('ai-api-advanced').open"), false);
  assert.equal(await evaluate("document.getElementById('ai-team-chatgpt-model').value"), 'chatgpt-browser-model');
  await evaluate("document.getElementById('btn-ai-team-use').click()");
  await until("document.getElementById('ai-chat-connection').textContent.includes('ChatGPT + Gemini')");
  assert.equal((await (await fetch(url + '/api/ai/status')).json()).provider, 'accounts');
  assert.equal(await evaluate("document.getElementById('ai-team-google-model').options.length"), 2);
  const paidBeforeTeam = rootCalls + workerCalls;
  if (process.env.STUDIO_TEAM_SCREENSHOT) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(process.env.STUDIO_TEAM_SCREENSHOT, Buffer.from(data, 'base64'));
  }
  await evaluate("document.getElementById('btn-close-ai-chat-settings').click(); document.getElementById('ai-chat-input').value='Team paint one verified pixel'; document.getElementById('ai-chat-form').requestSubmit()");
  await until("Boolean(document.querySelector('.ai-google-permission button:not(:disabled)'))");
  await evaluate("document.querySelector('.ai-google-permission button:not(:disabled)').click()");
  await until("document.getElementById('ai-chat-messages').textContent.includes('Team fixture verified actual pixel.') && !document.body.classList.contains('ai-drawing-busy')");
  assert.equal(teamCalls, 2); assert.equal(rootCalls + workerCalls, paidBeforeTeam);
  assert.equal((await (await fetch(url + '/api/ai/status')).json()).team.workflow.status, 'Completed');
  assert.equal(await evaluate("document.querySelector('#ai-account-team-monitor [data-stage=refine]').dataset.status"), 'Skipped');
  // A second request exercises the one-pass correction and the same Undo-able
  // editor transaction, without copying account tokens into browser state.
  reviewNeedsCorrection = true;
  await evaluate("document.getElementById('ai-chat-input').value='Team recheck and refine'; document.getElementById('ai-chat-form').requestSubmit()");
  for (let permission = 0; permission < 2; permission++) {
    await until("Boolean(document.querySelector('.ai-google-permission button:not(:disabled)'))");
    await evaluate("document.querySelector('.ai-google-permission button:not(:disabled)').click()");
  }
  await until("document.getElementById('ai-chat-messages').textContent.includes('Team correction verified actual pixel.') && !document.body.classList.contains('ai-drawing-busy')");
  assert.equal(teamCalls, 5); assert.equal(rootCalls + workerCalls, paidBeforeTeam);
  assert.equal(await evaluate("document.querySelector('#ai-account-team-monitor [data-stage=refine]').dataset.status"), 'Completed');
  assert.deepEqual(errors, [], 'no uncaught browser exceptions');
  console.log('PASS headless browser: account-first settings, API compatibility, ChatGPT/Gemini account team, live MCP pixel feedback, review/refinement, permissions, workflow progress, budgets and source switching. No paid API calls.');
  await send('Browser.close');
} finally {
  ws?.close(); browser.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => setTimeout(resolve, 300));
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
