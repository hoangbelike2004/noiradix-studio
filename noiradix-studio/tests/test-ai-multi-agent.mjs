import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import PIX2 from '../js/pix2-format.js';
import AiDrawing from '../js/ai-drawing.js';
import AiTools from '../js/ai-tools.js';
import AiStudio from '../js/ai-studio.js';
import AiLocalTasks from '../js/ai-local-tasks.js';
import { createAgentGateway } from '../tools/studio-agent.mjs';
import { createAgentManager } from '../tools/ai-agent-manager.mjs';
import { createStudioServer } from '../tools/studio-server.mjs';
import { AssetManager, compactToolHistory } from '../tools/ai-context.mjs';
import { costFor } from '../tools/ai-usage.mjs';
import { createProviderAdapters } from '../tools/ai-providers.mjs';

const doc = PIX2.createDocument('Hero', 1, 1, 32, 32);
doc.palette = { 1: '#123456', 2: '#fedcba' };
doc.cells.cell_0_0.pixels = { '1,2': '#123456' };
const context = AiDrawing.makeContext(doc, doc.cells.cell_0_0, 'edit');
context.studio = { frames: [{ id: 'cell_0_0', locked: false }], animations: [{ id: 'run', fps: 8, frames: ['cell_0_0'] }] };
const signal = new AbortController().signal;
const usage = { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 } };
const message = value => ({ type: 'message', content: [{ type: 'output_text', text: value }] });
const call = (name, args, id = 'call_' + name) => ({ type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) });
const openai = output => new Response(JSON.stringify({ status: 'completed', output, usage }));
const gemini = parts => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts } }],
  usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 15, thoughtsTokenCount: 5, cachedContentTokenCount: 20 } }));
const credentials = { openai: 'sk-fixture-private-openai-12345', gemini: 'AQ.fixture-private-gemini.12345' };
function group() {
  const manager = createAgentManager();
  const ids = {};
  for (const provider of ['openai', 'gemini']) ids[provider] = manager.save({ name: provider, provider, model: provider + '-fixture', apiKey: credentials[provider],
    role: provider === 'openai' ? 'orchestrator' : 'generator', pricing: { input: 1, cached: 0.5, output: 2 } });
  return { manager, ids };
}
const delegateTasks = tasks => call('delegate_tasks', { tasks });
const spec = (role, agentId = '', goal = 'Generate the next pose') => ({ role, agentId, goal, expectedOutput: 'Preserve palette, 32x32, 8 FPS and the original frame.' });

// Modern auth keys are opaque: dots and longer values survive unchanged in
// headers, surrounding pasted whitespace is trimmed, unsafe header input fails.
{
  const manager = createAgentManager();
  const key = 'AQ.' + 'fixture_private-key.'.repeat(40);
  const id = manager.save({ name: 'Gemini auth key', provider: 'gemini', model: 'gemini-4-argon', apiKey: '  ' + key + '\r\n' });
  assert.equal(manager.connection(id).accessToken, key);
  assert(!JSON.stringify(manager.snapshot()).includes(key));
  for (const bad of ['short', 'fixture-key-with\nheader-injection', 'fixture key with spaces', 'A'.repeat(4097)]) {
    assert.throws(() => manager.save({ id, apiKey: bad }), /API key/);
    assert.equal(manager.connection(id).accessToken, key, 'invalid replacement preserves the existing credential');
  }
}

// Provider authentication and permissions have different actionable messages;
// arbitrary upstream messages containing secrets are never returned to the UI.
{
  const options = { connection: { provider: 'gemini', model: 'fixture', accessToken: credentials.gemini }, input: [{ role: 'user', content: 'Hello' }], instructions: '', tools: [], maxOutputTokens: 256, signal };
  for (const [http, reason, expectedStatus, expectedMessage] of [[400, 'API_KEY_INVALID', 401, /từ chối API key/], [403, 'PERMISSION_DENIED', 403, /quyền truy cập/], [404, 'NOT_FOUND', 502, /Không tìm thấy model/]]) {
    const adapters = createProviderAdapters(async () => new Response(JSON.stringify({ error: { message: credentials.gemini, details: [{ reason }] } }), { status: http }));
    await assert.rejects(() => adapters.respond(options), error => {
      assert.equal(error.status, expectedStatus); assert.match(error.message, expectedMessage);
      assert(!error.message.includes(credentials.gemini)); return true;
    });
  }
}

// HTTP 429 is not a single diagnosis. Preserve only recognized machine codes,
// distinguish recoverable rate limits from billing/daily quotas, never echo
// arbitrary upstream bodies, and keep retry behavior aligned with the message.
{
  const cases = [
    ['openai', { code: 'credit_balance_exhausted', type: 'insufficient_quota' }, /hết credit API/, false],
    ['openai', { code: 'project_spend_limit_exceeded', type: 'insufficient_quota' }, /chi tiêu của project/, false],
    ['openai', { code: 'organization_spend_limit_exceeded' }, /chi tiêu của tổ chức/, false],
    ['openai', { code: 'organization_usage_limit_exceeded' }, /hạn mức API của tổ chức/, false],
    ['openai', { type: 'insufficient_quota' }, /hạn mức API không đủ/, false],
    ['openai', { code: 'subscription_sharing_usage_limit_exceeded' }, /gói ChatGPT/, false],
    ['openai', { code: 'rate_limit_exceeded' }, /vượt tốc độ.*3 giây/, true],
    ['openai', { code: 'slow_down' }, /giảm tốc độ.*3 giây/, true],
    ['gemini', { type: 'quota_exceeded' }, /quota theo ngày/, false],
    ['gemini', { type: 'too_many_requests' }, /quá nhiều yêu cầu.*3 giây/, true],
    ['gemini', { status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProject' }] }] }, /quota theo ngày/, false],
    ['gemini', { status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProject' }] }] }, /vượt tốc độ.*3 giây/, true],
    ['gemini', { status: 'RESOURCE_EXHAUSTED' }, /chưa đủ dữ liệu để phân biệt/, false],
    ['openai', { code: credentials.openai }, /chưa đủ dữ liệu để phân biệt/, false]
  ];
  for (const [provider, detail, expected, retryable] of cases) {
    const adapters = createProviderAdapters(async () => new Response(JSON.stringify({ error: { ...detail, message: credentials.openai } }), { status: 429, headers: { 'retry-after': '2.5' } }));
    await assert.rejects(() => adapters.respond({ connection: { provider, model: 'fixture', accessToken: credentials[provider] }, input: [], instructions: '', tools: [], maxOutputTokens: 256, signal }), error => {
      assert.equal(error.status, 429); assert.equal(error.retryable, retryable); assert.equal(error.retryAfterMs, 2500);
      assert.match(error.message, expected); assert(!error.message.includes(credentials.openai)); return true;
    });
  }
}

// Do not retry exhausted balances; honor bounded rate-limit retries and allow
// an explicitly enabled fallback to another independently configured agent.
{
  for (const [code, retryAfter, expectedCalls] of [['credit_balance_exhausted', '0', 1], ['rate_limit_exceeded', '0', 2], ['rate_limit_exceeded', '120', 1]]) {
    const { manager } = group(); let sent = 0;
    const gateway = createAgentGateway({ manager, fetchImpl: async () => {
      if (++sent === 1) return new Response(JSON.stringify({ error: { code } }), { status: 429, headers: { 'retry-after': retryAfter } });
      return openai([message('Recovered')]);
    } });
    const task = gateway.step({ message: 'Describe sprite', context, policy: { allowFallback: false, maxRetries: 1 } }, signal);
    if (expectedCalls === 1) await assert.rejects(() => task, error => error.status === 429);
    else assert.equal((await task).reply, 'Recovered');
    assert.equal(sent, expectedCalls);
  }
  const { manager } = group(); let first = 0, second = 0;
  const gateway = createAgentGateway({ manager, fetchImpl: async url => {
    if (url.includes('openai.com')) { first++; return new Response(JSON.stringify({ error: { code: 'credit_balance_exhausted' } }), { status: 429 }); }
    second++; return gemini([{ text: 'Fallback succeeded' }]);
  } });
  const result = await gateway.step({ message: 'Describe sprite', context, policy: { allowFallback: true, maxRetries: 2 } }, signal);
  assert.equal(result.reply, 'Fallback succeeded'); assert.equal(first, 1); assert.equal(second, 1);
}

// One agent incurs no planning/coordination requests. Old history is bounded.
{
  let requests = 0;
  const gateway = createAgentGateway({ getApiKey: () => 'fixture', getModel: () => 'fixture', fetchImpl: async (_url, options) => {
    requests++; const body = JSON.parse(options.body);
    assert.equal(body.tools.some(tool => tool.name === 'delegate_tasks'), false);
    assert.equal(body.input.length, 5);
    return openai([message('Done')]);
  } });
  const answer = await gateway.step({ message: 'Describe the sprite', context, history: Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) })) }, signal);
  assert.equal(requests, 1); assert.equal(answer.workflow.mode, 'single');
  assert.equal(answer.workflow.usage.inputTokens, 100); assert.equal(answer.workflow.usage.cachedTokens, 40);
  assert.equal(answer.workflow.usage.unpricedRequests, 1);
}

// OpenAI delegates real pixel drawing to Gemini, which consumes actual editor
// feedback. Original signed Gemini parts survive the tool round unchanged.
{
  const { manager, ids } = group(); let rootCalls = 0, workerCalls = 0;
  const originalPart = { functionCall: { name: 'draw', args: { actions: [{ tool: 'pen', color: '#fedcba', points: [{ x: 3, y: 4 }] }] } }, thoughtSignature: 'signed-fixture' };
  const gateway = createAgentGateway({ manager, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    assert(!JSON.stringify(body).includes('private-'), 'credentials are headers only');
    if (url.includes('openai.com')) {
      assert.equal(options.headers.Authorization, 'Bearer ' + credentials.openai);
      if (++rootCalls === 1) return openai([delegateTasks([spec('generator', ids.gemini)])]);
      const result = JSON.parse(body.input.at(-1).output);
      assert.equal(result.tasks[0].status, 'Completed');
      assert.equal(result.sharedContext.constraints.width, 32);
      assert.equal(result.sharedContext.constraints.studio.animations[0].fps, 8);
      assert.equal(AiDrawing.parseFrame(result.sharedContext.constraints.pix2, 32, 32).pixels['3,4'], '#fedcba');
      return openai([message('Created one pose using verified editor results.')]);
    }
    assert.equal(options.headers['x-goog-api-key'], credentials.gemini);
    assert(url.endsWith('/gemini-fixture:generateContent'));
    assert(!body.tools[0].functionDeclarations.some(tool => tool.name === 'delegate_tasks'));
    if (++workerCalls === 1) return gemini([originalPart]);
    assert.deepEqual(body.contents.at(-2).parts, [originalPart], 'no synthetic IDs or changed thought signatures in native model content');
    const actual = body.contents.at(-1).parts[0].functionResponse;
    assert.equal(actual.name, 'draw'); assert(!('id' in actual));
    assert.equal(AiDrawing.parseFrame(actual.response.canvas.pix2, 32, 32).pixels['3,4'], '#fedcba');
    return gemini([{ text: 'Added the specified pixel. Original source preserved.' }]);
  } });
  const first = await gateway.step({ message: 'Create the next pose', context, mode: 'multi' }, signal);
  assert.equal(first.calls[0].name, 'draw');
  assert.equal(first.workflow.tasks[1].agentId, ids.gemini);
  const actualDoc = PIX2.parse(PIX2.serialize(doc));
  const actions = first.calls[0].arguments.actions;
  AiTools.validate(actions, 32, 32);
  for (const action of actions) AiTools.execute(actualDoc.cells.cell_0_0, action, 32, 32);
  assert.equal(actualDoc.cells.cell_0_0.pixels['1,2'], '#123456');
  const actualContext = AiDrawing.makeContext(actualDoc, actualDoc.cells.cell_0_0, 'edit');
  const answer = await gateway.step({ runId: first.runId, results: [{ callId: first.calls[0].callId, output: { ok: true, canvas: actualContext } }] }, signal);
  assert.equal(answer.done, true); assert.equal(rootCalls, 2); assert.equal(workerCalls, 2);
  assert.equal(answer.workflow.usage.requests, 4);
  assert.equal(answer.workflow.usage.inputTokens, 360); assert.equal(answer.workflow.usage.outputTokens, 80);
  assert(answer.workflow.usage.costUSD > 0);
  assert(!JSON.stringify(gateway.snapshot()).includes('private-'));
  assert(!JSON.stringify(gateway.snapshot()).includes('signed-fixture'));
}

// Consultations really overlap; a repeated unchanged task is reused, not billed
// again. No editor-writing tool is exposed to a read-only worker.
{
  const { manager, ids } = group();
  const extra = manager.save({ name: 'Planner', provider: 'openai', model: 'planner-fixture', apiKey: credentials.openai, role: 'planner' });
  let rootCalls = 0, active = 0, maxActive = 0, specialistCalls = 0;
  const gateway = createAgentGateway({ manager, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.model === 'openai-fixture') {
      if (++rootCalls % 2) return openai([delegateTasks([spec('planner', extra, 'Plan timing'), spec('reviewer', ids.gemini, 'Review design')])]);
      return openai([message('Consultations incorporated.')]);
    }
    specialistCalls++; active++; maxActive = Math.max(maxActive, active);
    assert(!body.tools?.length);
    await new Promise(resolve => setTimeout(resolve, 20)); active--;
    return url.includes('openai.com') ? openai([message('Plan: keep 8 FPS.')]) : gemini([{ text: 'Palette and proportions consistent.' }]);
  } });
  const first = await gateway.step({ message: 'Plan and review', context, mode: 'multi', policy: { maxRequests: 4 } }, signal);
  assert.equal(first.done, true); assert.equal(maxActive, 2); assert.equal(first.workflow.usage.requests, 4);
  const second = await gateway.step({ message: 'Plan and review', context, mode: 'multi' }, signal);
  assert.equal(specialistCalls, 2); assert.equal(second.workflow.usage.requests, 2); assert.equal(second.workflow.usage.cacheHits, 2);
}

// Coordinator transfer never replays tools and retains the verified canvas.
{
  const { manager, ids } = group(); let rootCalls = 0, replacementCalls = 0;
  const gateway = createAgentGateway({ manager, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.includes('openai.com')) {
      if (++rootCalls === 1) return openai([call('inspect_canvas', {})]);
      return new Response('{}', { status: 503 });
    }
    replacementCalls++;
    assert.equal(body.contents.length, 1); assert.equal(body.contents[0].role, 'user');
    assert(body.contents[0].parts[0].text.includes('recentToolResults'));
    return gemini([{ text: 'Finished from the verified canvas.' }]);
  } });
  const first = await gateway.step({ message: 'Review current result', context, policy: { maxRetries: 0 } }, signal);
  const answer = await gateway.step({ runId: first.runId, results: [{ callId: first.calls[0].callId, output: { ok: true, canvas: context } }] }, signal);
  assert.equal(answer.done, true); assert.equal(replacementCalls, 1);
  assert.equal(answer.workflow.orchestratorId, ids.gemini);
  assert.equal(answer.workflow.tasks[0].previousAgentId, ids.openai);
}

// Bounded retries and no silent use of other connections when disallowed.
{
  const { manager } = group(); let attempts = 0;
  const gateway = createAgentGateway({ manager, fetchImpl: async () => { attempts++; return new Response('{}', { status: 503 }); } });
  await assert.rejects(() => gateway.step({ message: 'Create artwork', context, mode: 'single', policy: { maxRetries: 1, allowFallback: false } }, signal), /HTTP 503/);
  assert.equal(attempts, 2);
  assert.equal(gateway.snapshot().workflows.at(-1).status, 'Failed');
}

// Cancellation interrupts in-flight requests and releases the editor lease.
{
  let entered;
  const started = new Promise(resolve => entered = resolve), controller = new AbortController();
  const gateway = createAgentGateway({ getApiKey: () => 'fixture', getModel: () => 'fixture', fetchImpl: async (_url, options) => {
    entered(); return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  } });
  const running = gateway.step({ message: 'Draw character', context }, controller.signal); await started; controller.abort();
  await assert.rejects(() => running);
  assert.equal(gateway.snapshot().workflows.at(-1).status, 'Cancelled');
  const next = await gateway.step({ message: 'Nhân đôi frame này', context }, signal);
  assert.equal(next.workflow.mode, 'local');
  await gateway.step({ runId: next.runId, cancel: true }, signal);
}

// Enforce budgets before sending any billable request. Unpriced is not $0.
{
  const { manager, ids } = group(); let sent = 0;
  manager.save({ id: ids.openai, pricing: { input: null, output: null, cached: null } });
  const gateway = createAgentGateway({ manager, fetchImpl: async () => { sent++; return openai([message('Done')]); } });
  await assert.rejects(() => gateway.step({ message: 'Draw character', context, policy: { maxCostUSD: 1 } }, signal), /Cần nhập giá/);
  await assert.rejects(() => gateway.step({ message: 'Draw character', context, policy: { maxTokens: 1 } }, signal), /giới hạn token/);
  assert.equal(sent, 0);
  assert.equal(costFor({ inputTokens: 100, cachedTokens: 20, outputTokens: 10, reported: true }, { input: 1, cached: 0.5, output: 2 }), 0.00011);
  assert.equal(costFor({ inputTokens: 0, cachedTokens: 0, outputTokens: 0, reported: false }, { input: 1, output: 2 }), null);
}

// No AI calls for exact local tasks; compound/ambiguous requests never get
// partially matched. The actual commands pass the editor's operation validator.
{
  const gateway = createAgentGateway({ fetchImpl: async () => { throw new Error('Local task called AI'); } });
  for (const command of ['Nhân đôi frame này', 'Đổi kích thước tất cả frame 24x32', 'Dịch frame 2,-1', 'Xuất spritesheet']) {
    const local = AiLocalTasks.route(command); assert(local); AiStudio.validate(local.actions);
    const first = await gateway.step({ message: command, context }, signal);
    assert.equal(first.calls[0].name, 'studio_actions');
    const answer = await gateway.step({ runId: first.runId, results: [{ callId: first.calls[0].callId, output: { ok: true, canvas: context } }] }, signal);
    assert.equal(answer.workflow.usage.requests, 0);
  }
  assert.equal(AiLocalTasks.route('Nhân đôi frame này rồi đổi màu'), null);
  assert.equal(AiLocalTasks.route('resize all frames 999x32'), null);
}

// Compaction removes only superseded snapshots. All authoritative pixels,
// palette and technical constraints in the newest result remain exact.
{
  const input = ['old', 'new'].map(id => ({ type: 'function_call_output', call_id: id, output: JSON.stringify({ ok: true, canvas: context, studio: context.studio }) }));
  const assets = new AssetManager(); compactToolHistory(input, assets);
  const old = JSON.parse(input[0].output), latest = JSON.parse(input[1].output);
  assert.deepEqual(assets.get(old.canvas.assetRef), context); assert.deepEqual(latest.canvas, context);
  const dense = PIX2.createDocument('Dense', 1, 1, 32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) dense.cells.cell_0_0.pixels[`${x},${y}`] = '#123456';
  const compressed = AiDrawing.makeContext(dense, dense.cells.cell_0_0, 'edit');
  assert(compressed.pix2.length < PIX2.serialize(dense).length / 4);
  assert.deepEqual(AiDrawing.parseFrame(compressed.pix2, 32, 32).pixels, dense.cells.cell_0_0.pixels);
}

// Agreed project memory survives later turns without carrying chat or model
// reasoning across projects. Exact technical state still comes from the editor.
{
  const remembered = { characterDesign: 'Blue coat; eyes at 12,9 and 18,9.', style: 'Limited palette, no antialiasing.', decisions: ['8 FPS run cycle; preserve confirmed source.'] };
  let calls = 0;
  const gateway = createAgentGateway({ getApiKey: () => 'fixture', getModel: () => 'fixture', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); calls++;
    if (calls === 1) return openai([call('remember_project', remembered)]);
    if (calls === 3) {
      assert(body.instructions.includes(remembered.characterDesign));
      assert(body.input[0].content.includes('32'));
    }
    if (calls === 4) assert(!body.instructions.includes(remembered.characterDesign), 'another project has a separate brief');
    return openai([message('Done')]);
  } });
  await gateway.step({ message: 'Keep this design', context: { ...context, projectId: 'hero-project' } }, signal);
  await gateway.step({ message: 'Next pose', context: { ...context, projectId: 'hero-project' } }, signal);
  await gateway.step({ message: 'New asset', context: { ...context, projectId: 'another-project' } }, signal);
  assert.equal(calls, 4);
}

// Only one initializer may acquire the editor, including an asynchronous OAuth
// connection lookup. A failed initialization releases that lease.
{
  let release, entered;
  const started = new Promise(resolve => entered = resolve);
  const gateway = createAgentGateway({ getConnection: async () => { entered(); await new Promise(resolve => release = resolve); return { accessToken: 'fixture', model: 'fixture' }; }, fetchImpl: async () => openai([message('Done')]) });
  const first = gateway.step({ message: 'Draw character', context }, signal); await started;
  await assert.rejects(() => gateway.step({ message: 'Another task', context }, signal), /workflow đang sử dụng/);
  release(); assert.equal((await first).done, true);
}

// A worker failure is surfaced to the coordinator with its task identity. It
// does not masquerade as a successful design or erase previous task results.
{
  const { manager, ids } = group(); let rootCalls = 0;
  const gateway = createAgentGateway({ manager, fetchImpl: async url => {
    if (!url.includes('openai.com')) return new Response('{}', { status: 401 });
    if (++rootCalls === 1) return openai([delegateTasks([spec('generator', ids.gemini)])]);
    return openai([message('The requested generation failed; no success claimed.')]);
  } });
  const answer = await gateway.step({ message: 'Generate a pose', context, policy: { allowFallback: false } }, signal);
  assert.equal(answer.workflow.tasks[1].status, 'Failed');
  assert.match(answer.workflow.tasks[1].error, /API key/);
}

// Manager HTTP routes use existing origin defenses and never return keys.
{
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'noiradix-multi-agent-'));
  const server = createStudioServer({ apiKey: '', geminiApiKey: '', authDirectory: temporary, fetchImpl: async () => openai([message('Connected')]) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const post = (action, body, headers = {}) => fetch(url + '/api/ai/agents/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('save', {}, { Origin: 'https://evil.test' })).status, 403);
    const response = await post('save', { name: 'Gemini 1', provider: 'gemini', model: 'fixture', apiKey: credentials.gemini });
    assert.equal(response.status, 200); const result = await response.json();
    assert(!JSON.stringify(result).includes(credentials.gemini));
    assert.equal(result.agents[0].status, 'unverified');
    assert.equal((await (await fetch(url + '/api/ai/status')).json()).provider, 'agents');
    const id = result.agents[0].id;
    assert.equal((await post('save', { id, model: 'new-fixture', enabled: false })).status, 200);
    assert.equal((await post('orchestrator', { id })).status, 400);
    assert.equal((await post('remove', { id })).status, 200);
    assert.equal((await (await fetch(url + '/api/ai/agents')).json()).agents.length, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); }
}
console.log('PASS multi-agent: real OpenAI/Gemini tool pipeline, exact pixels and signed parts, bounded single agent, concurrent consultations, result reuse, failover, retries, cancellation, budgets, local tasks, lossless compaction and protected HTTP management. All provider responses mocked; no paid requests.');
