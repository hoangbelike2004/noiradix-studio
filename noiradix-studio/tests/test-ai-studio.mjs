import assert from 'node:assert/strict';
import AiStudio from '../js/ai-studio.js';
import PIX2 from '../js/pix2-format.js';
import EditorState from '../js/editor-state.js';
import AnimationPlayer from '../js/animation-player.js';
import { createAgentGateway } from '../tools/studio-agent.mjs';
import AiDrawing from '../js/ai-drawing.js';

function fixture() {
  const state = new EditorState(), doc = PIX2.createDocument('Project', 2, 1, 8, 6);
  doc.cells.cell_0_0.pixels = { '0,0': '#ff0000', '1,0': '#0000ff' };
  doc.animations = { walk_down: { name: 'Walk Down', direction: 'down', fps: 6, mode: 'loop', frames: ['cell_0_0', 'cell_0_1'] } };
  state.setDocument(doc); state.openCellTab('cell_0_0');
  const created = [], exports = [];
  const runtime = { frameId: 'cell_0_0', nodeId: null, clipId: 'walk_down', createdCount: () => created.length, onFrameCreated: id => created.push(id), exportFile: async action => { exports.push(action); return { filename: action.filename, readyWhenTurnFinishes: true }; }, importImage: async () => ({ imported: true }) };
  const action = op => AiStudio.execute(state, runtime, op);
  return { state, runtime, action, created, exports };
}
{
  const { state, runtime, action, created, exports } = fixture();
  const before = PIX2.serialize(state.doc), info = AiStudio.inspect(state, runtime);
  assert.equal(info.totalFrames, 2); assert.equal(info.animations[0].fps, 6);
  assert.equal(PIX2.serialize(state.doc), before, 'inspection must not edit the project');
  await action({ op: 'rename_project', name: 'Animation workflow' });
  await action({ op: 'update_animation', animationId: '', name: 'Walk slower', direction: 'down', mode: 'pingpong', fps: 8 });
  const duplicate = await action({ op: 'duplicate_frame', frameId: '', name: 'Mirrored pose' });
  assert.equal(created.length, 1); assert.equal(state.doc.animations.walk_down.frames.length, 3);
  await action({ op: 'transform', frameId: '', nodeId: '', scope: 'frame', operation: 'flip_horizontal', dx: 0, dy: 0 });
  assert.equal(state.doc.cells[duplicate.frameId].pixels['7,0'], '#ff0000');
  assert.equal(state.doc.cells.cell_0_0.pixels['0,0'], '#ff0000');
  await action({ op: 'replace_color', frameId: '', nodeId: '', scope: 'frame', from: '#ff0000', to: '#00ff00' });
  assert.equal(state.doc.cells[duplicate.frameId].pixels['7,0'], '#00ff00');
  await action({ op: 'move_animation_frame', animationId: '', index: 2, toIndex: 0 });
  assert.equal(state.doc.animations.walk_down.frames[0], duplicate.frameId);
  await action({ op: 'set_animation_frames', animationId: '', frameIds: ['cell_0_0', duplicate.frameId, 'cell_0_0'] });
  await action({ op: 'remove_animation_frame', animationId: '', index: 2 });
  assert.deepEqual(state.doc.animations.walk_down.frames, ['cell_0_0', duplicate.frameId]);
  await action({ op: 'export_file', format: 'animation_png', filename: 'walk.png' }); assert.equal(exports.length, 1);
  await action({ op: 'create_animation', animationId: 'idle', name: 'Idle', direction: 'none', fps: 4, mode: 'once' });
  assert.equal(runtime.clipId, 'idle');
  await action({ op: 'set_animation_frames', animationId: '', frameIds: [duplicate.frameId] });
  await action({ op: 'playback', animationId: '', playing: true }); assert.equal(runtime.playing, true);
  await action({ op: 'delete_animation', animationId: 'idle' }); assert(state.doc.cells[duplicate.frameId]);
  await action({ op: 'delete_frame', frameId: duplicate.frameId }); assert(!state.doc.cells[duplicate.frameId]);
  assert(state.doc.animations.walk_down.frames.every(id => state.doc.cells[id]));
  console.log('PASS project/frame/animation management, copies, FPS, order, recolor, playback and export delegation');
}
{
  const { state, runtime, action } = fixture();
  const layer = await action({ op: 'create_layer', frameId: '', name: 'Hat' });
  assert.equal(state.doc.meta.version, '1.1');
  assert.equal(state.doc.cells.cell_0_0.pixels['0,0'], '#ff0000', 'automatic layer conversion retains artwork');
  await action({ op: 'set_opacity', frameId: '', nodeId: '', opacity: 0.5 });
  assert.equal(state.findNode('cell_0_0', layer.nodeId).node.opacity, 0.5);
  await action({ op: 'set_locked', frameId: '', nodeId: layer.nodeId, locked: true });
  await assert.rejects(() => action({ op: 'transform', frameId: '', nodeId: runtime.nodeId, scope: 'node', operation: 'move', dx: 1, dy: 0 }), /khóa/);
  await action({ op: 'update_animation', animationId: '', name: 'Still editable', fps: 12, mode: 'loop', direction: 'down' });
  assert.equal(state.doc.animations.walk_down.fps, 12, 'locked pixels do not block animation settings');
  await action({ op: 'set_locked', frameId: '', nodeId: layer.nodeId, locked: false });
  const group = await action({ op: 'create_group', frameId: '', parentId: layer.nodeId, name: 'Details' });
  const region = await action({ op: 'create_region', frameId: '', parentId: group.nodeId, name: 'Rim' });
  await action({ op: 'rename_node', frameId: '', nodeId: '', name: 'Hat rim' });
  assert.equal(state.findNode('cell_0_0', region.nodeId).node.name, 'Hat rim');
  const before = PIX2.serialize(state.doc);
  await assert.rejects(() => action({ op: 'move_node', frameId: '', nodeId: group.nodeId, parentId: group.nodeId, index: 0 }), /thao tác/);
  assert.equal(PIX2.serialize(state.doc), before, 'invalid hierarchy move leaves structure unchanged');
  const copy = await action({ op: 'duplicate_frame', frameId: '', name: 'Layered copy' });
  const ids = new Set();
  const visit = nodes => { for (const item of nodes) { assert.equal(item.cell, copy.frameId); assert(!ids.has(item.id)); ids.add(item.id); visit(item.children || []); } };
  visit(state.doc.cells[copy.frameId].layers);
  assert(PIX2.validate(state.doc, { strict: true }).valid);
  await action({ op: 'resize_frames', width: 16, height: 12, mode: 'scale' });
  assert.equal(state.doc.meta.cellSize.w, 16); assert.equal(state.doc.cells.cell_0_0.layers[0].children[0].pixels['1,1'], '#ff0000');
  console.log('PASS layer/group/region management, ancestor locks, opacity, hierarchy, duplicate ownership and structured resizing');
}
{
  const { state, runtime, action } = fixture();
  const layer = await action({ op: 'create_layer', frameId: '', name: 'More colors' });
  state.findNode(runtime.frameId, runtime.nodeId).node.pixels = { '2,0': '#00ff00', '3,0': '#ffff00' };
  await action({ op: 'pixelate', frameId: '', nodeId: '', scope: 'frame', colors: 2 });
  const colors = new Set(); for (const item of state.doc.cells.cell_0_0.layers) for (const child of item.children) for (const color of Object.values(child.pixels)) colors.add(color);
  assert(colors.size <= 2, 'one palette applies across the entire frame, preserving layers');
  await action({ op: 'delete_node', frameId: '', nodeId: layer.nodeId });
  const lastLayer = state.doc.cells.cell_0_0.layers[0].id;
  await action({ op: 'delete_node', frameId: '', nodeId: lastLayer });
  assert.deepEqual(state.doc.cells.cell_0_0.pixels, {}, 'deleting final layer clears composite artwork');
  for (const bad of [{ op: 'eval', code: 'bad' }, { op: 'resize_frames', width: 10000, height: 16, mode: 'scale' }, { op: 'rename_project', name: 'x', extra: true }]) assert.throws(() => AiStudio.validate([bad]));
  await assert.rejects(() => action({ op: 'select_frame', frameId: 'constructor', nodeId: '' }), /frame/);
  console.log('PASS shared palette reduction, deleting last layer, unsupported operations, bounds and prototype names');
}
{
  const { state, runtime } = fixture();
  const player = new AnimationPlayer(null); player.getState = () => state;
  player.requireExplicitAnimation = true; player.activeAnimationName = 'missing';
  assert.deepEqual(player.getActiveFrames(), []);
  player.activeAnimationName = runtime.clipId; assert.equal(player.getActiveFrames().length, 2);
  const gateway = createAgentGateway({ getApiKey: () => 'fixture', getModel: () => 'fixture', fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'function_call', name: 'studio_actions', call_id: 'settings', arguments: JSON.stringify({ actions: [{ op: 'update_animation', animationId: '', name: 'Walk', fps: 8, direction: 'down', mode: 'loop' }] }) }] })) });
  const result = await gateway.step({ message: 'Set animation to 8 FPS', context: AiDrawing.makeContext(state.doc, state.doc.cells.cell_0_0, 'edit') }, new AbortController().signal);
  assert.equal(result.calls[0].name, 'studio_actions');
  assert.equal(result.calls[0].arguments.actions[0].fps, 8);
  console.log('PASS real tool gateway accepts non-drawing Studio actions and explicit animation playback handles missing clips');
}
