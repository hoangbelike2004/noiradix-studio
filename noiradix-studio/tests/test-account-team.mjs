import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createStudioServer } from '../tools/studio-server.mjs';
import PIX2 from '../js/pix2-format.js';
import AiDrawing from '../js/ai-drawing.js';
import AiTools from '../js/ai-tools.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'noiradix-account-team-'));
const authDirectory = path.join(directory, 'auth'); await mkdir(authDirectory);
await writeFile(path.join(authDirectory, 'chatgpt-auth.json'), JSON.stringify({ version: 1, active: 'account-fixture', profiles: [{
  clientId: 'account-fixture', identity: { email: 'account@example.test' }, welcomed: true,
  tokens: { accessToken: 'account-fixture-secret', expiresAt: Date.now() + 3600000, scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'] },
  model: 'account-model', models: [{ id: 'account-model', name: 'Account model' }], modelsAt: Date.now()
}] }));
let accountCalls = 0, paidCalls = 0, needsCorrection = false, deny = false, holdPlan = false, lastAbort;
const fetchImpl = async (url, options) => {
  assert.equal(url, 'https://api.openai.com/v1/responses');
  if (options.headers.Authorization !== 'Bearer account-fixture-secret') { paidCalls++; throw new Error('Paid API must never be reached'); }
  accountCalls++;
  const body = JSON.parse(options.body);
  assert.equal(body.model, 'account-model'); assert.equal(body.store, false); assert.equal(body.stream, true);
  assert.deepEqual(body.tools, []); assert.equal('max_output_tokens' in body, false);
  if (holdPlan) {
    lastAbort = options.signal;
    await new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); });
  }
  if (deny) return new Response(JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }), { status: 429 });
  const phase = body.instructions.includes('Create a practical') ? 'plan' : body.instructions.includes('First line must') ? 'review' : 'finish';
  if (phase !== 'plan') {
    assert(body.input.at(-1).content[0].text.includes('#00dd88'), 'Reviewer receives actual editor pixels');
    assert(body.input.at(-1).content[0].text.includes('overview-fixture'), 'Reviewer receives a fresh Studio inspection');
  }
  const reply = phase === 'plan' ? 'Giữ nguyên frame, vẽ một pixel xanh tại 2,0.' : phase === 'review' ? needsCorrection ? 'REVISE\nKiểm tra lại pixel và giữ nguyên phần còn lại.' : 'APPROVED\nPixel thật đã đúng yêu cầu.' : 'Đã kiểm tra lại kết quả sau lượt sửa.';
  return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: reply }] }], usage: { input_tokens: 30, output_tokens: 10 } } }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
};
const makeServer = () => createStudioServer({ apiKey: 'sk-optional-paid-key-12345678', geminiApiKey: 'optional-google-key-12345678', geminiModel: 'paid-model', authDirectory, fetchImpl,
  teamOptions: { pollMs: 5 }, googleOptions: { pollMs: 5, autoApproveEditor: false, runtimeLoader: async () => ({ executable: process.execPath, args: [fileURLToPath(new URL('./fixtures/google-acp-agent.mjs', import.meta.url))] }) } });
let server = makeServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let base = 'http://127.0.0.1:' + server.address().port;
const post = (route, body, origin) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
const state = async () => (await fetch(base + '/api/ai/status')).json();
const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => setTimeout(resolve, 100)); };
const until = async predicate => { const deadline = Date.now() + 10000; while (!await predicate()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 20)); } };
try {
  assert.equal((await post('/api/ai/source', { provider: 'accounts' }, 'https://evil.example')).status, 403);
  await post('/api/ai/google/start', {});
  await until(async () => (await state()).google.connected);
  const selected = await (await post('/api/ai/source', { provider: 'accounts' })).json();
  assert.equal(selected.provider, 'accounts'); assert.equal(selected.configured, true);
  assert.equal(selected.google.selected, false); assert.equal(selected.team.selected, true);
  async function runTeam({ correction = false, cancel = false, reject = false } = {}) {
    needsCorrection = correction;
    const doc = PIX2.createDocument('Team', 1, 1, 8, 8), cell = doc.cells[Object.keys(doc.cells)[0]];
    const canvas = () => AiDrawing.makeContext(doc, cell, 'edit');
    let body = { message: 'Vẽ pixel xanh tại 2,0, giữ nguyên mọi phần khác.', context: canvas() }, answer, inspections = 0, permissions = 0, runId;
    for (let i = 0; i < 150; i++) {
      const response = await post('/api/ai/team/turn', body);
      answer = await response.json(); assert.equal(response.status, 200, JSON.stringify(answer)); runId = answer.runId;
      if (i === 0) {
        assert.equal((await post('/api/ai/source', { provider: 'chatgpt' })).status, 409);
        assert.equal((await post('/api/ai/agent', { message: 'Draw', context: canvas() })).status, 409);
        assert.equal((await post('/api/ai/google/disconnect', {})).status, 409);
      }
      if (answer.done) break;
      if (answer.permission) {
        permissions++;
        if (reject) {
          const refused = await post('/api/ai/team/turn', { runId, permission: { id: answer.permission.id, optionId: 'deny' } });
          assert.equal(refused.status, 409); assert((await refused.json()).error.includes('không tự yêu cầu lại'));
          assert.equal((await state()).team.workflow.status, 'Cancelled');
          return;
        }
        if (cancel) {
          assert.equal((await post('/api/ai/team/turn', { runId, cancel: true })).status, 200);
          assert.equal((await state()).team.workflow.status, 'Cancelled');
          return;
        }
        body = { runId, permission: { id: answer.permission.id, optionId: 'once' } };
      } else if (answer.calls) {
        const results = answer.calls.map(call => {
          if (call.name === 'draw') { for (const action of call.arguments.actions) AiTools.execute(cell, action, 8, 8); return { callId: call.callId, output: { ok: true, canvas: canvas() } }; }
          inspections++;
          return { callId: call.callId, output: call.name === 'inspect_canvas' ? { ok: true, canvas: canvas() } : { ok: true, studio: { projectName: 'overview-fixture' } } };
        });
        body = { runId, results };
      } else body = { runId, poll: true };
    }
    assert.equal(answer.done, true); assert.equal(answer.team.status, 'Completed');
    assert.equal(inspections, correction ? 4 : 2); assert.equal(permissions, correction ? 2 : 1);
    assert.equal(answer.team.stages.find(item => item.id === 'refine').status, correction ? 'Completed' : 'Skipped');
    assert(canvas().pix2.includes('#00dd88'));
  }
  await runTeam(); assert.equal(accountCalls, 2);
  await runTeam({ correction: true }); assert.equal(accountCalls, 5);
  assert.equal((await state()).team.usage.inputTokens, 150); assert.equal(paidCalls, 0);
  deny = true;
  const context = AiDrawing.makeContext(PIX2.createDocument('Quota', 1, 1, 8, 8), null, 'new');
  let limited = await post('/api/ai/team/turn', { message: 'Vẽ pixel', context });
  let error = await limited.json();
  while (limited.status === 200 && !error.done) { limited = await post('/api/ai/team/turn', { runId: error.runId, poll: true }); error = await limited.json(); }
  assert.equal(limited.status, 429); assert.equal((await state()).team.workflow.status, 'Failed'); assert.equal(paidCalls, 0);
  assert.equal((await state()).team.usage.requests, 6); assert.equal((await state()).team.usage.unreportedRequests, 1);
  deny = false;
  await runTeam({ reject: true }); assert.equal(paidCalls, 0);
  await post('/api/ai/source', { provider: 'accounts' }); await until(async () => (await state()).google.connected);
  await runTeam({ cancel: true }); assert.equal((await state()).google.connected, false);
  // Resume the account-owned native runtime without reusing an API key.
  await post('/api/ai/source', { provider: 'accounts' }); await until(async () => (await state()).google.connected);
  holdPlan = true;
  const pending = await (await post('/api/ai/team/turn', { message: 'Vẽ pixel', context })).json();
  await until(() => Boolean(lastAbort));
  await post('/api/ai/team/turn', { runId: pending.runId, cancel: true }); assert.equal(lastAbort.aborted, true); holdPlan = false;
  await close(); server = makeServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
  await until(async () => (await state()).configured);
  assert.equal((await state()).provider, 'accounts', 'Account-team selection and native Google login restore');
  assert.equal((await state()).team.usage.requests, 0, 'RAM usage is not a provider balance');
  assert.equal(paidCalls, 0);
  console.log('PASS account team: account-only planning, real ACP permissions/MCP drawing, fresh editor review, bounded refinement, usage, quota errors, cancellation, mutual exclusion, restore and no paid API fallback. No live inference.');
} finally { await close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
