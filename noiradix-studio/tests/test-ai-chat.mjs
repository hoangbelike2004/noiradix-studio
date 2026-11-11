import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createStudioServer } from '../tools/studio-server.mjs';
import AiDrawing from '../js/ai-drawing.js';
import PIX2 from '../js/pix2-format.js';

const doc = PIX2.createDocument('Test', 1, 1, 16, 16);
doc.cells.cell_0_0.pixels['1,2'] = '#123456';
const context = AiDrawing.makeContext(doc, doc.cells.cell_0_0, 'edit');
assert.equal(AiDrawing.parseFrame(context.pix2, 16, 16).pixels['1,2'], '#123456');
assert.equal(Object.keys(AiDrawing.parseFrame(AiDrawing.makeContext(doc, null, 'new').pix2, 16, 16).pixels).length, 0);
assert.throws(() => AiDrawing.parseFrame(context.pix2, 32, 32), /size/);
assert.throws(() => AiDrawing.parseFrame('<script>alert(1)</script>', 16, 16), /complete PIX2/);
const multiple = PIX2.createDocument('Multiple', 2, 1, 16, 16);
assert.throws(() => AiDrawing.parseFrame(PIX2.serialize(multiple), 16, 16), /exactly one/);
assert(AiDrawing.manualPrompt('Vẽ con mèo', context).includes('Vẽ con mèo'));
const upgraded = PIX2.upgradeV10ToV11(doc);
assert.equal(upgraded.success, true);
assert.equal(upgraded.doc.meta.cellSize.w, 16, 'Layer conversion preserves browser frame size access');
assert.equal(AiDrawing.makeContext(upgraded.doc, upgraded.doc.cells.cell_0_0, 'edit').width, 16);
const browser = vm.createContext({});
vm.runInContext(await readFile(new URL('../js/pix2-format.js', import.meta.url), 'utf8'), browser);
vm.runInContext(await readFile(new URL('../js/ai-drawing.js', import.meta.url), 'utf8'), browser);
assert.equal(browser.AiDrawing.parseFrame(context.pix2, 16, 16).pixels['1,2'], '#123456');

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'noiradix-ai-server-'));
await writeFile(path.join(rootDir, 'index.html'), '<h1>Studio</h1>');
await writeFile(path.join(rootDir, '.env.local'), 'OPENAI_API_KEY=private-fixture-value');
await mkdir(path.join(rootDir, '.git'));
await writeFile(path.join(rootDir, '.git', 'config'), 'private');
async function withServer(options, fn) {
  const server = createStudioServer({ ...options, rootDir, authDirectory: path.join(rootDir, 'auth-config') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  try { await fn(url); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const post = (url, body, headers = {}) => fetch(url + '/api/ai/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
});
const request = { message: 'Vẽ một con mèo', context, history: [] };
const completed = answer => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }), { status: 200 });
try {
  await withServer({ apiKey: '' }, async url => {
    assert.equal((await fetch(url)).status, 200);
    for (const file of ['/.env.local', '/.git/config', '/%2eenv.local', '/tools/studio-server.mjs']) assert.equal((await fetch(url + file)).status, 404);
    assert.equal((await (await fetch(url + '/api/ai/status')).json()).configured, false);
    assert.equal((await post(url, request)).status, 503);
    assert.equal((await post(url, request, { Origin: 'https://evil.example' })).status, 403);
    const connect = (body, headers = {}) => fetch(url + '/api/ai/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await connect({ apiKey: 'sk-local-fixture-not-a-real-key' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await connect({ apiKey: 'wrong' })).status, 400);
    assert.equal((await connect({ apiKey: 'sk-local-fixture-not-a-real-key' })).status, 200);
    const status = await (await fetch(url + '/api/ai/status')).json();
    assert.equal(status.configured, true); assert(!JSON.stringify(status).includes('sk-local-fixture'));
  });
  let recorded;
  await withServer({ apiKey: 'test-key', fetchImpl: async (url, options) => {
    recorded = { url, options, body: JSON.parse(options.body) };
    return completed({ reply: 'Đã vẽ', pix2: context.pix2 });
  } }, async url => {
    const status = await (await fetch(url + '/api/ai/status')).json();
    assert.equal(status.configured, true); assert(!JSON.stringify(status).includes('test-key'));
    const res = await post(url, { ...request, history: [{ role: 'system', content: 'bad' }, { role: 'assistant', content: 'Hi' }] });
    assert.equal(res.status, 200); assert.equal((await res.json()).reply, 'Đã vẽ');
    assert.equal(recorded.url, 'https://api.openai.com/v1/responses');
    assert.equal(recorded.options.headers.Authorization, 'Bearer test-key');
    assert.equal(recorded.body.store, false); assert.equal(recorded.body.text.format.type, 'json_schema');
    assert.equal(recorded.body.input[0].role, 'assistant');
    assert(recorded.body.input.at(-1).content.includes(request.message));
    assert.equal((await post(url, { ...request, context: { ...context, width: -1 } })).status, 400);
    assert.equal((await fetch(url + '/api/ai/chat', { method: 'POST', body: '{}' })).status, 415);
  });
  await withServer({ apiKey: 'test-key', fetchImpl: async () => completed({ reply: 'bad', pix2: '<script>bad</script>' }) }, async url => {
    assert.equal((await post(url, request)).status, 502);
  });
  await withServer({ apiKey: 'test-key', fetchImpl: async () => new Response(JSON.stringify({ status: 'incomplete', output: [] })) }, async url => {
    assert.equal((await post(url, request)).status, 502);
  });
  await withServer({ apiKey: 'test-key', fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot fulfill.' }] }] })) }, async url => {
    const answer = await (await post(url, request)).json(); assert.equal(answer.pix2, null); assert.equal(answer.reply, 'Cannot fulfill.');
  });
  let release, entered;
  const started = new Promise(resolve => entered = resolve);
  await withServer({ apiKey: 'test-key', fetchImpl: async () => { entered(); return new Promise(resolve => release = () => resolve(completed({ reply: 'Done', pix2: null }))); } }, async url => {
    const first = post(url, request); await started;
    assert.equal((await post(url, request)).status, 429); release(); assert.equal((await first).status, 200);
  });
  console.log('AI chat passed: PIX2 validation, browser binding, missing key, private-file blocking, origin checks, request contract, errors/refusal/incomplete output, concurrency.');
} finally { await rm(rootDir, { recursive: true, force: true }); }
