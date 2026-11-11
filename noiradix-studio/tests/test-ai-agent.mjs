import assert from 'node:assert/strict';
import { createAgentGateway } from '../tools/studio-agent.mjs';
import AiTools from '../js/ai-tools.js';
import AiDrawing from '../js/ai-drawing.js';
import PIX2 from '../js/pix2-format.js';

const actions = [
  { tool: 'rectangle', color: '#aa3300', x: 1, y: 1, width: 6, height: 5, filled: false },
  { tool: 'fill', color: '#ffcc44', x: 2, y: 2 },
  { tool: 'pen', color: '#112233', points: [{ x: 2, y: 2 }, { x: 4, y: 2 }] },
  { tool: 'line', color: '#8899aa', x1: 2, y1: 3, x2: 4, y2: 3 },
  { tool: 'eraser', points: [{ x: 3, y: 2 }] }
];
const cell = { pixels: { '0,0': '#123456' } };
AiTools.validate(actions, 8, 6);
for (const action of actions) AiTools.execute(cell, action, 8, 6);
assert.equal(cell.pixels['0,0'], '#123456');
assert.equal(cell.pixels['1,1'], '#aa3300');
assert.equal(cell.pixels['2,4'], '#ffcc44');
assert.equal(cell.pixels['2,2'], '#112233');
assert.equal(cell.pixels['3,2'], undefined);
assert.equal(cell.pixels['4,3'], '#8899aa');
assert.equal(cell.pixels['7,5'], undefined);
for (const bad of [
  { tool: 'pen', color: '#ffffff', points: [{ x: 8, y: 0 }] },
  { tool: 'pen', color: 'alert(1)', points: [{ x: 0, y: 0 }] },
  { tool: 'rectangle', color: '#ffffff', x: 7, y: 0, width: 2, height: 1, filled: true },
  { tool: 'fill', color: '#ffffff', x: 1.5, y: 1 },
  { tool: 'eval', code: 'bad' }, { tool: 'eraser', points: [] }
]) assert.throws(() => AiTools.validate([bad], 8, 6));
// Validate every action before executing any part of a batch.
assert.throws(() => AiTools.validate([...actions, { tool: 'fill', color: '#ffffff', x: -1, y: 0 }], 8, 6));

const doc = PIX2.createDocument('Test', 1, 1, 8, 6);
const dense = PIX2.createDocument('Dense', 1, 1, 256, 256);
AiTools.execute(dense.cells.cell_0_0, { tool: 'fill', color: '#123456', x: 0, y: 0 }, 256, 256);
const denseContext = AiDrawing.makeContext(dense, dense.cells.cell_0_0, 'edit');
assert(denseContext.pix2.length < 20000, 'Dense tool feedback is compact');
const denseParsed = AiDrawing.parseFrame(denseContext.pix2, 256, 256);
assert.equal(Object.keys(denseParsed.pixels).length, 256 * 256);
assert.equal(denseParsed.pixels['255,255'], '#123456');
const context = AiDrawing.makeContext(doc, doc.cells.cell_0_0, 'edit');
const response = output => new Response(JSON.stringify({ status: 'completed', output }));
let calls = 0;
const gateway = createAgentGateway({ getApiKey: () => 'fixture', getModel: () => 'gpt-5.4-mini', fetchImpl: async (url, options) => {
  assert.equal(url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(options.body);
  assert.equal(body.store, false); assert.equal(body.parallel_tool_calls, false);
  assert.deepEqual(body.tools.map(item => item.name), ['draw', 'inspect_canvas', 'create_frame', 'inspect_studio', 'studio_actions']);
  assert.deepEqual(body.include, ['reasoning.encrypted_content']);
  if (++calls === 1) {
    assert.equal(body.input[0].role, 'user', 'Ignore client-supplied system history');
    return response([{ type: 'reasoning', id: 'rs_fixture', encrypted_content: 'fixture', summary: [] },
      { type: 'function_call', call_id: 'call_draw', name: 'draw', arguments: JSON.stringify({ actions }) }]);
  }
  if (calls === 2) {
    assert(body.input.some(item => item.type === 'reasoning'), 'Replay reasoning items with tool outputs');
    assert.equal(body.input.at(-1).type, 'function_call_output');
    assert.equal(body.input.at(-1).call_id, 'call_draw');
    const actual = JSON.parse(body.input.at(-1).output);
    assert.equal(AiDrawing.parseFrame(actual.canvas.pix2, 8, 6).pixels['2,4'], '#ffcc44');
    return response([{ type: 'function_call', call_id: 'call_inspect', name: 'inspect_canvas', arguments: '{}' }]);
  }
  assert.equal(body.input.at(-1).call_id, 'call_inspect');
  return response([{ type: 'message', content: [{ type: 'output_text', text: 'Đã vẽ bằng bút và tô màu.' }] }]);
} });
const signal = new AbortController().signal;
const first = await gateway.step({ message: 'Vẽ hình', context, history: [{ role: 'system', content: 'untrusted' }] }, signal);
assert.equal(first.done, false); assert.equal(first.calls[0].name, 'draw');
const actual = PIX2.createDocument('Actual', 1, 1, 8, 6);
actual.cells.cell_0_0.pixels = cell.pixels;
const output = { ok: true, canvas: AiDrawing.makeContext(actual, actual.cells.cell_0_0, 'edit') };
await assert.rejects(() => gateway.step({ runId: first.runId, results: [{ callId: 'incorrect', output }] }, signal), /khớp/);
const second = await gateway.step({ runId: first.runId, results: [{ callId: 'call_draw', output }] }, signal);
assert.equal(second.calls[0].name, 'inspect_canvas');
const final = await gateway.step({ runId: second.runId, results: [{ callId: 'call_inspect', output }] }, signal);
assert.equal(final.done, true); assert.match(final.reply, /Đã vẽ/);
await assert.rejects(() => gateway.step({ runId: first.runId, results: [] }, signal), /hết hạn/);
await assert.rejects(() => gateway.step({ message: 'bad', context: { ...context, width: 513 } }, signal), /không hợp lệ/);
const pendingGateway = createAgentGateway({ getApiKey: () => 'fixture', getModel: () => 'fixture', fetchImpl: async () => response([{ type: 'function_call', call_id: 'pending', name: 'draw', arguments: '{"actions":[]}' }]) });
const pending = await pendingGateway.step({ message: 'draw', context }, signal);
assert.equal((await pendingGateway.step({ runId: pending.runId, cancel: true }, signal)).done, true);
await assert.rejects(() => pendingGateway.step({ runId: pending.runId, results: [] }, signal), /hết hạn/);
const failing = createAgentGateway({ getApiKey: () => 'fixture', getModel: () => 'fixture', fetchImpl: async () => new Response('{}', { status: 401 }) });
await assert.rejects(() => failing.step({ message: 'draw', context }, signal), /API key/);
console.log('AI agent passed: five real editor tools, bounded coordinates/batches, multi-round function calls, actual canvas feedback, reasoning replay, history roles, cancellation, validation and API errors.');
