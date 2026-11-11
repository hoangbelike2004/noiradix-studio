import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureGoogleRuntime, extractGoogleZip } from '../tools/google-acp-runtime.mjs';
import { createGoogleAcp, isStudioPermission } from '../tools/google-acp.mjs';
import { GoogleAcpClient } from '../tools/google-acp-client.mjs';
import PIX2 from '../js/pix2-format.js';
import AiDrawing from '../js/ai-drawing.js';
import { createStudioServer } from '../tools/studio-server.mjs';

export const fixtureRuntime = async () => ({ executable: process.execPath, args: [fileURLToPath(new URL('./fixtures/google-acp-agent.mjs', import.meta.url))], cached: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), 'noiradix-google-'));
const zip = (name, data, mode = 0o100755) => {
  const filename = Buffer.from(name), payload = Buffer.from(data), packed = deflateRawSync(payload);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(payload.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(payload.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((mode * 65536) >>> 0, 38);
  const head = Buffer.concat([local, filename, packed]), index = Buffer.concat([central, filename]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(head.length, 16);
  return Buffer.concat([head, index, end]);
};
const document = PIX2.createDocument('Google', 1, 1, 16, 16), context = AiDrawing.makeContext(document, document.cells.cell_0_0, 'edit');
const signal = new AbortController().signal;
const trace = stage => { if (process.env.GOOGLE_ACP_TEST_TRACE) console.log('Google test: ' + stage); };
const until = async condition => { const end = Date.now() + 10000; while (!condition()) { if (Date.now() > end) throw new Error('Google test timed out'); await new Promise(resolve => setTimeout(resolve, 25)); } };
try {
  trace('runtime download/cache');
  const archive = zip(process.platform === 'win32' ? 'agy_acp_server.exe' : 'agy_acp_server.par', 'fixture runtime, never executed');
  const checksum = createHash('sha256').update(archive).digest('hex'); let fetched = 0;
  const options = { directory: path.join(temporary, 'cache'), distribution: ['fixture', 'fixture', checksum], fetchImpl: async url => {
    assert(url.startsWith('https://dl.google.com/')); fetched++; return new Response(archive);
  } };
  const first = await ensureGoogleRuntime(options); assert.equal(first.cached, false); assert.equal(fetched, 1);
  assert.equal((await ensureGoogleRuntime(options)).cached, true); assert.equal(fetched, 1, 'verified runtime reused without downloading');
  await writeFile(first.executable, 'tampered'); await ensureGoogleRuntime(options); assert.equal(fetched, 2, 'tampered cache is replaced before execution');
  await assert.rejects(() => ensureGoogleRuntime({ ...options, directory: path.join(temporary, 'wrong-hash'), distribution: ['fixture', 'fixture', '0'.repeat(64)] }), /Checksum/);
  for (const filename of ['../escape', '/absolute', 'C:/escape', 'nested/../../escape', 'back\\slash']) {
    await assert.rejects(() => extractGoogleZip(zip(filename, 'bad'), temporary), /Đường dẫn/);
  }
  await assert.rejects(() => extractGoogleZip(zip('link', 'target', 0o120777), temporary), /an toàn/);

  // Account login must not inherit a paid API key, and the client never exposes
  // host files merely because an agent asks for the optional filesystem API.
  const previousApiKey = process.env.GEMINI_API_KEY;
  trace('client environment/filesystem');
  let peer;
  try {
    process.env.GEMINI_API_KEY = 'fixture-private-do-not-inherit';
    peer = new GoogleAcpClient({ ...await fixtureRuntime(), cwd: temporary });
    const init = await peer.call('initialize', { protocolVersion: 1, clientCapabilities: {}, testClientFs: true });
    assert.equal(init.testHasApiKey, false); assert.equal(init.testFsDenied, true);
  } finally { await peer?.close(); if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousApiKey; }

  const dir = path.join(temporary, 'connection'); let starts = 0;
  trace('start connection');
  const connection = createGoogleAcp({ directory: dir, pollMs: 30, autoApproveEditor: false, runtimeLoader: async () => { starts++; return fixtureRuntime(); } });
  await connection.restore(); assert.equal(starts, 0, 'first visit does not download or authenticate');
  await connection.action('start'); await until(() => connection.status().connected || connection.status().phase === 'error');
  assert.equal(connection.status().connected, true, JSON.stringify(connection.status()));
  assert.equal(connection.status().selected, true); assert.equal(connection.status().models.length, 2);
  assert(!JSON.stringify(connection.status()).includes('Bearer'), 'MCP capability token is private');
  await connection.action('model', { model: 'gemini-fixture-2' }); assert.equal(connection.status().model, 'gemini-fixture-2');
  await assert.rejects(() => connection.action('model', { model: 'not-entitled' }), /được tài khoản/);
  let answer = await connection.step({ message: 'Paint a pixel', context }, signal);
  trace('permission');
  assert(answer.permission); assert.equal(answer.permission.options.length, 2);
  await assert.rejects(() => connection.action('disconnect'), /dừng lượt/);
  answer = await connection.step({ runId: answer.runId, permission: { id: answer.permission.id, optionId: 'once' } }, signal);
  while (answer.waiting) answer = await connection.step({ runId: answer.runId, poll: true }, signal);
  assert.equal(answer.calls[0].name, 'draw');
  const runId = answer.runId, callId = answer.calls[0].callId;
  trace('editor feedback');
  await assert.rejects(() => connection.step({ runId, results: [{ callId: 'wrong', output: {} }] }, signal), /không khớp/);
  answer = await connection.step({ runId, results: [{ callId, output: { ok: true, canvas: { pix2: '#00dd88' } } }] }, signal);
  while (answer.waiting) answer = await connection.step({ runId, poll: true }, signal);
  assert.equal(answer.done, true); assert.match(answer.reply, /verified editor pixel/);
  assert(!answer.reply.includes('PRIVATE_THOUGHT'));
  assert.deepEqual(connection.status().contextUsage, { used: 320, size: 100000 });
  await connection.action('select', { selected: false }); assert.equal(connection.status().connected, true);
  await connection.action('select', { selected: true });
  await connection.close();
  trace('restore connection');
  const restored = createGoogleAcp({ directory: dir, pollMs: 30, runtimeLoader: fixtureRuntime });
  await restored.restore(); await until(() => restored.status().connected || restored.status().phase === 'error');
  assert.equal(restored.status().connected, true, 'connection restored from app preference; Google retains its own auth');
  answer = await restored.step({ message: 'CANCEL_FIXTURE', context }, signal);
  const cancelled = await restored.step({ runId: answer.runId, cancel: true }, signal);
  assert.equal(cancelled.done, true); assert.equal(restored.status().connected, false); await restored.close();

  // Automatic consent is scoped to the closed Studio tool schemas. Labels and
  // titles never grant permission for a terminal, file or another MCP server.
  const drawInput = { actions: [{ tool: 'line', color: '#dde8ef', x1: 4, x2: 6, y1: 15, y2: 15 }] };
  assert(isStudioPermission({ rawInput: drawInput }), 'Actual native permission input need not include a tool name');
  assert(isStudioPermission({ name: 'mcp__noiradix_studio__draw', rawInput: drawInput }));
  assert(isStudioPermission({ name: 'inspect_canvas', rawInput: {} }));
  for (const call of [
    { title: 'Studio draw', rawInput: { command: 'some-command' } },
    { name: 'execute', rawInput: drawInput },
    { name: 'mcp__other__draw', rawInput: drawInput },
    { name: 'draw', rawInput: { ...drawInput, path: '/private/file' } },
    { name: 'draw', rawInput: drawInput, locations: [{ path: '/private/file' }] },
    { name: 'draw', rawInput: { actions: [{ tool: 'pen', color: 'invalid', points: [{ x: 0, y: 0 }] }] } },
    { name: 'draw', rawInput: { actions: [{ tool: 'line', color: '#ffffff', x1: -1, x2: 6, y1: 0, y2: 0 }] } },
    { rawInput: {} }, { rawInput: 'draw()' }
  ]) assert.equal(isStudioPermission(call), false, JSON.stringify(call));
  const automatic = createGoogleAcp({ directory: path.join(temporary, 'automatic'), pollMs: 30, runtimeLoader: fixtureRuntime });
  await automatic.action('start'); await until(() => automatic.status().connected);
  answer = await automatic.step({ message: 'AUTO_PERMISSION_FIXTURE paint', context }, signal);
  while (answer.waiting) answer = await automatic.step({ runId: answer.runId, poll: true }, signal);
  assert.equal(answer.permission, undefined); assert.equal(answer.calls[0].name, 'draw');
  answer = await automatic.step({ runId: answer.runId, results: [{ callId: answer.calls[0].callId, output: { ok: true, canvas: { pix2: '#00dd88' } } }] }, signal);
  while (answer.waiting) answer = await automatic.step({ runId: answer.runId, poll: true }, signal);
  assert.equal(answer.done, true); assert.equal(answer.permission, undefined);
  assert.match(answer.reply, /verified editor pixel/); await automatic.close();

  // Real HTTP gates: local origin only; no credential/custom-runtime URL input.
  const server = createStudioServer({ apiKey: '', authDirectory: path.join(temporary, 'auth'), googleOptions: { runtimeLoader: fixtureRuntime, pollMs: 30 } });
  trace('HTTP server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const post = (route, body, origin) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
    assert.equal((await post('/api/ai/google/start', {}, 'https://evil.example')).status, 403);
    assert.equal((await post('/api/ai/google/start', {})).status, 200);
    for (let i = 0; i < 100; i++) { if ((await (await fetch(base + '/api/ai/google/status')).json()).connected) break; await new Promise(resolve => setTimeout(resolve, 30)); }
    assert.equal((await (await fetch(base + '/api/ai/status')).json()).provider, 'google');
    assert.equal((await post('/api/ai/google/model', { model: 'not-entitled' })).status, 400);
    await post('/api/ai/google/disconnect', {});
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  console.log('PASS Google ACP: verified runtime, real stdio RPC/MCP drawing, automatic Studio-only permissions, external tool denial, manual mode, cancellation, restore and origin gates. Fixture provider only; no paid calls.');
} finally { await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
