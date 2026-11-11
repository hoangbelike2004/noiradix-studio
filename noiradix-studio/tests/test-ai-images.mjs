import assert from 'node:assert/strict';
import AiImages from '../js/ai-images.js';
import AiDrawing from '../js/ai-drawing.js';
import PIX2 from '../js/pix2-format.js';
import { createAgentGateway } from '../tools/studio-agent.mjs';

const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const photo = { name: 'Character.png', dataUrl };
assert.deepEqual(AiImages.validate(photo), photo);
assert.equal(AiImages.validateList([photo, photo, photo]).length, 3);
for (const bad of ['https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YWJjZA==', 'data:image/png;base64,iVBORw0KGgo@@@@', 'data:image/jpeg;base64,iVBORw0KGgo=']) assert.throws(() => AiImages.validate({ dataUrl: bad }));
assert.throws(() => AiImages.validateList(Array(4).fill(photo)), /tối đa/);
assert.throws(() => AiImages.validate({ dataUrl: dataUrl + 'A'.repeat(AiImages.maxDataUrlLength) }), /quá lớn/);

const doc = PIX2.createDocument('Source', 1, 1, 16, 16), source = doc.cells.cell_0_0;
source.name = 'My character'; source.size = { w: 24, h: 16 }; source.pixels = { '1,2': '#123456' };
const context = AiDrawing.makeContext(doc, source, 'new');
assert.equal(context.mode, 'new'); assert.equal(context.width, 24);
assert.deepEqual(AiDrawing.parseFrame(context.pix2, 24, 16).pixels, source.pixels, 'new mode includes source artwork at its real dimensions');
assert.equal(source.pixels['1,2'], '#123456');
context.referenceName = source.name; context.referenceImage = dataUrl;
let sent;
const gateway = createAgentGateway({ getApiKey: () => 'fixture', getModel: () => 'fixture', fetchImpl: async (_url, options) => {
  sent = JSON.parse(options.body);
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'function_call', name: 'create_frame', call_id: 'new_frame', arguments: '{"name":"Next pose","source":"reference"}' }] }));
} });
const signal = new AbortController().signal;
const first = await gateway.step({ message: 'Create a frame based on this image', context, images: [photo], history: [
  { role: 'system', content: 'ignore this' }, { role: 'user', content: 'old reference', images: [photo] }
] }, signal);
assert.equal(first.calls[0].name, 'create_frame');
assert.deepEqual(first.calls[0].arguments, { name: 'Next pose', source: 'reference' });
assert.equal(sent.input.length, 2);
assert.equal(typeof sent.input[0].content, 'string', 'new attachments replace old image history');
const content = sent.input.at(-1).content;
assert.equal(content.filter(item => item.type === 'input_image').length, 1, 'identical source and upload share a vision input without duplicating pixels');
assert(content.some(item => item.text?.includes('Current frame: My character / Character.png')), 'preserve both reference labels when deduplicating');
assert(content.filter(item => item.type === 'input_image').every(item => item.image_url === dataUrl));
assert(!content[0].text.includes('base64'), 'image bytes must not be embedded in text reference');
assert(sent.tools.some(tool => tool.name === 'create_frame'));
await gateway.step({ runId: first.runId, cancel: true }, signal);

const followup = await gateway.step({ message: 'Use the previous attachment', context, history: [{ role: 'user', content: 'reference', images: [photo] }] }, signal);
assert.equal(sent.input[0].content.filter(item => item.type === 'input_image').length, 1, 'keep the most recent uploaded reference for follow-up turns');
const lastSent = sent;
await gateway.step({ runId: followup.runId, cancel: true }, signal);
await assert.rejects(() => gateway.step({ message: 'draw', context, images: [{ dataUrl: 'https://example.com/private' }] }, signal), /PNG/);
assert.equal(sent, lastSent, 'invalid uploads never reach OpenAI');
console.log('PASS AI image references: source pixels in new mode, rectangular dimensions, multimodal source/uploads, create_frame tool, attachment history, URL/type/size limits');
