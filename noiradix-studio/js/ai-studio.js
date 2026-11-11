/** Validated Studio operations shared by the assistant and the editor. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./pix2-format.js'), require('./tools.js'), require('./animation-frames.js'), require('./image-pixelizer.js'));
  else root.AiStudio = factory(typeof PIX2 !== 'undefined' ? PIX2 : root.PIX2, root.Tools, root.AnimationFrames, root.ImagePixelizer);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PIX2, Tools, AnimationFrames, ImagePixelizer) {
  'use strict';
  const string = { type: 'string', maxLength: 160 }, name = { type: 'string', maxLength: 120 };
  const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
  const choice = values => ({ type: 'string', enum: values });
  const bool = { type: 'boolean' }, color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' };
  const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  const direction = choice(['none', 'down', 'up', 'left', 'right', 'down_left', 'down_right', 'up_left', 'up_right']);
  const scope = choice(['frame', 'node']);
  const schema = (op, fields) => object({ op: choice([op]), ...fields });
  const variants = [
    schema('select_frame', { frameId: string, nodeId: string }),
    schema('rename_frame', { frameId: string, name }),
    schema('duplicate_frame', { frameId: string, name }),
    schema('delete_frame', { frameId: string }),
    schema('clear_artwork', { frameId: string, nodeId: string, scope }),
    schema('create_animation', { animationId: string, name, fps: integer(1, 120), direction, mode: choice(['loop', 'pingpong', 'once']) }),
    schema('select_animation', { animationId: string }),
    schema('update_animation', { animationId: string, name, fps: integer(1, 120), direction, mode: choice(['loop', 'pingpong', 'once']) }),
    schema('delete_animation', { animationId: string }),
    schema('set_animation_frames', { animationId: string, frameIds: { type: 'array', items: string, maxItems: 512 } }),
    schema('move_animation_frame', { animationId: string, index: integer(0, 511), toIndex: integer(0, 511) }),
    schema('remove_animation_frame', { animationId: string, index: integer(0, 511) }),
    schema('arrange_frames', { animationId: string }),
    schema('playback', { animationId: string, playing: bool }),
    schema('create_layer', { frameId: string, name }),
    schema('create_group', { frameId: string, parentId: string, name }),
    schema('create_region', { frameId: string, parentId: string, name }),
    schema('rename_node', { frameId: string, nodeId: string, name }),
    schema('delete_node', { frameId: string, nodeId: string }),
    schema('move_node', { frameId: string, nodeId: string, parentId: string, index: integer(0, 16383) }),
    schema('set_visibility', { frameId: string, nodeId: string, visible: bool }),
    schema('set_locked', { frameId: string, nodeId: string, locked: bool }),
    schema('set_opacity', { frameId: string, nodeId: string, opacity: { type: 'number', minimum: 0, maximum: 1 } }),
    schema('transform', { frameId: string, nodeId: string, scope, operation: choice(['flip_horizontal', 'flip_vertical', 'rotate_cw', 'center', 'move']), dx: integer(-512, 512), dy: integer(-512, 512) }),
    schema('resize_frames', { width: integer(1, 512), height: integer(1, 512), mode: choice(['scale', 'crop']) }),
    schema('replace_color', { frameId: string, nodeId: string, scope: choice(['frame', 'node', 'project']), from: color, to: color }),
    schema('pixelate', { frameId: string, nodeId: string, scope, colors: integer(2, 64) }),
    schema('set_palette', { colors: { type: 'array', minItems: 1, maxItems: 256, items: color } }),
    schema('rename_project', { name }),
    schema('import_image', { imageIndex: integer(0, 2), mode: choice(['new_frame', 'replace_frame', 'new_layer']), name, colors: integer(0, 64) }),
    schema('export_file', { format: choice(['frame_png', 'animation_png', 'atlas_png', 'frames_zip', 'project_pix2', 'texturepacker_zip']), filename: name })
  ];
  const inspectSchema = object({ section: choice(['overview', 'frames', 'animations', 'layers']), offset: integer(0, 16383) });
  const descriptions = {
    duplicate_frame: 'Copy the complete frame and its layers, append the copy to the selected animation, and select it. Keep the original unchanged.',
    set_animation_frames: 'Replace the complete playback sequence with these existing frame IDs, in this exact order. Repeated IDs are allowed. Omitted frames are detached from this animation.',
    delete_frame: 'Delete a frame from the project and remove all its animation references. Keep at least one project frame.',
    remove_animation_frame: 'Remove this occurrence from the animation sequence, keeping the underlying artwork in the project.',
    resize_frames: 'Resize every project frame using nearest-neighbor scaling or top-left crop/expand. width and height become the new draw bounds.',
    import_image: 'Read an image listed in context.attachments by zero-based imageIndex, including the most recent uploaded images from earlier messages. This index excludes the automatic current-frame reference image. Fit it proportionally into a new frame, replace the selected full frame, or add a layer. colors=0 preserves colors; 2..64 reduces the palette.',
    export_file: 'Prepare an actual downloadable file from current state. frame_png exports the selected frame; animation_png/frames_zip use selected animation; atlas_png/texturepacker_zip/project_pix2 use the project. The link appears in chat after successful turn completion.'
  };
  for (const variant of variants) { const description = descriptions[variant.properties.op.enum[0]]; if (description) variant.description = description; }
  const labels = { select_frame: 'Chọn frame', rename_frame: 'Đổi tên frame', duplicate_frame: 'Nhân đôi frame', delete_frame: 'Xóa frame', clear_artwork: 'Xóa hình', create_animation: 'Tạo animation', select_animation: 'Chọn animation', update_animation: 'Chỉnh animation', delete_animation: 'Xóa animation', set_animation_frames: 'Sắp xếp animation', move_animation_frame: 'Đổi thứ tự frame', remove_animation_frame: 'Bỏ frame khỏi animation', arrange_frames: 'Xếp frame cùng hàng', playback: 'Chỉnh phát animation', create_layer: 'Tạo layer', create_group: 'Tạo nhóm', create_region: 'Tạo vùng', rename_node: 'Đổi tên lớp/vùng', delete_node: 'Xóa lớp/vùng', move_node: 'Sắp xếp lớp/vùng', set_visibility: 'Ẩn/hiện lớp', set_locked: 'Khóa/mở khóa lớp', set_opacity: 'Chỉnh độ trong suốt', transform: 'Biến đổi hình', resize_frames: 'Đổi kích thước', replace_color: 'Thay màu', pixelate: 'Chuyển màu pixel art', set_palette: 'Đổi bảng màu', rename_project: 'Đổi tên dự án', import_image: 'Nhập ảnh', export_file: 'Xuất file' };
  const batchSchema = object({ actions: { type: 'array', minItems: 1, maxItems: 40, items: { anyOf: variants } } });
  const fail = message => { throw new Error(message); };
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const clone = value => JSON.parse(JSON.stringify(value));

  function matches(value, rule) {
    if (rule.enum && !rule.enum.includes(value)) return false;
    if (rule.type === 'object') return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => own(rule.properties, key)) && rule.required.every(key => own(value, key) && matches(value[key], rule.properties[key]));
    if (rule.type === 'array') return Array.isArray(value) && value.length >= (rule.minItems || 0) && value.length <= rule.maxItems && value.every(item => rule.items.anyOf ? rule.items.anyOf.some(variant => matches(item, variant)) : matches(item, rule.items));
    if (rule.type === 'string') return typeof value === 'string' && value.length <= (rule.maxLength || 1000) && (!rule.pattern || new RegExp(rule.pattern).test(value));
    if (rule.type === 'boolean') return typeof value === 'boolean';
    return typeof value === 'number' && Number.isFinite(value) && (rule.type !== 'integer' || Number.isInteger(value)) && value >= rule.minimum && value <= rule.maximum;
  }
  function validate(actions) { if (!matches({ actions }, batchSchema)) fail('Thao tác Studio không hợp lệ hoặc vượt giới hạn.'); return actions; }
  function frame(state, runtime, id = '') {
    const key = id || runtime.frameId;
    if (!key || !own(state.doc.cells, key)) fail('Không tìm thấy frame. Hãy xem lại danh sách frame.');
    return state.doc.cells[key];
  }
  function animation(state, runtime, id = '') {
    const key = id || runtime.clipId;
    if (!key || !own(state.doc.animations, key)) fail('Không tìm thấy animation.');
    return { id: key, clip: state.doc.animations[key] };
  }
  function walk(nodes, visit, parents = []) { for (const node of nodes || []) { visit(node, parents); walk(node.children, visit, [...parents, node]); } }
  function ensureCapacity(doc, addedNodes = 0) {
    let count = 0; Object.values(doc.cells).forEach(cell => walk(cell.layers, () => count++));
    if (count + addedNodes > 16384) fail('Dự án đã đạt giới hạn layer/group/region.');
  }
  function locked(cell, nodeId = null) {
    let result = Boolean(cell.locked);
    walk(cell.layers, (node, parents) => { if (!nodeId ? node.locked : node.id === nodeId && [node, ...parents].some(item => item.locked)) result = true; });
    return result;
  }
  function unlocked(cell, nodeId = null) { if (locked(cell, nodeId)) fail('Frame hoặc lớp đang bị khóa. Chỉ mở khóa khi người dùng yêu cầu.'); }
  function sync(state, cell) {
    if (Array.isArray(cell.layers)) cell.pixels = cell.layers.length ? PIX2.compositeCellLayers(cell, cell.size || state.doc.meta.cellSize) : {};
  }
  function nodesFor(state, runtime, cell, nodeId, targetScope) {
    if (targetScope === 'node' && cell.layers?.length) {
      const match = state.findNode(cell.id, nodeId || (runtime.frameId === cell.id ? runtime.nodeId : null));
      if (!match) fail('Hãy chọn layer/region cần sửa.');
      unlocked(cell, match.node.id);
      const result = []; walk([match.node], node => { if (node.type === 'region') result.push(node); });
      if (result.some(node => locked(cell, node.id))) fail('Một vùng con đang bị khóa.');
      return result;
    }
    unlocked(cell);
    if (!cell.layers?.length) return [cell];
    const result = []; walk(cell.layers, node => { if (node.type === 'region') result.push(node); }); return result;
  }
  function upgrade(state, cellId) {
    if (state.doc.meta.version !== '1.1') {
      const converted = state.upgradeDocumentToV11(cellId);
      if (!converted.success) fail(converted.error || 'Không chuyển được dự án sang layer.');
    }
    const cell = state.doc.cells[cellId];
    let count = 0; walk(cell.layers, () => count++);
    if (count >= 16000) fail('Frame đã đạt giới hạn số node.');
    return cell;
  }
  function select(state, runtime, cell, nodeId = '') {
    runtime.frameId = cell.id;
    let match = nodeId ? state.findNode(cell.id, nodeId) : null;
    if (nodeId && !match) fail('Layer/region không nằm trong frame này.');
    if (!match && cell.layers?.length) {
      let first; walk(cell.layers, node => { if (!first && node.type === 'region') first = node; });
      match = first ? state.findNode(cell.id, first.id) : null;
    }
    if (match?.node.type !== 'region') {
      let first; walk(match ? [match.node] : [], node => { if (!first && node.type === 'region') first = node; });
      if (first) match = state.findNode(cell.id, first.id);
    }
    runtime.nodeId = match?.node.type === 'region' ? match.node.id : null;
    state.activeLayerId = match?.layer?.id || null; state.activeRegionId = runtime.nodeId;
    state.activeGroupId = null; state.isolatedNodeId = null;
    return { frameId: cell.id, nodeId: runtime.nodeId };
  }
  function inspect(state, runtime, options = { section: 'overview', offset: 0 }) {
    if (!matches(options, inspectSchema)) fail('Yêu cầu xem Studio không hợp lệ.');
    const doc = state.doc, cell = doc.cells[runtime.frameId], frames = Object.values(doc.cells), clips = Object.entries(doc.animations);
    const flat = []; walk(cell?.layers, (node, parents) => flat.push({ id: node.id, type: node.type, name: node.name, parentId: parents.at(-1)?.id || '', locked: Boolean(node.locked), visible: node.visible !== false, opacity: node.opacity ?? 1, pixels: Object.keys(node.pixels || {}).length }));
    const frameInfo = item => ({ id: item.id, name: item.name, row: item.row, col: item.col, size: item.size || doc.meta.cellSize, pixels: Object.keys(item.pixels || {}).length });
    const animationInfo = ([id, clip]) => ({ id, name: clip.name, fps: clip.fps, mode: clip.mode || (clip.loop === false ? 'once' : 'loop'), direction: clip.direction || 'none', count: clip.frames?.length || 0, frames: clip.frames || [] });
    const result = { title: doc.meta.title, size: doc.meta.cellSize, grid: doc.meta.grid, selectedFrameId: runtime.frameId || null, selectedNodeId: runtime.nodeId || null, selectedAnimationId: runtime.clipId || null, totalFrames: frames.length, totalAnimations: clips.length, palette: doc.palette };
    if (options.section === 'overview' || options.section === 'frames') result.frames = frames.slice(options.offset, options.offset + 64).map(frameInfo);
    if (options.section === 'overview' || options.section === 'animations') result.animations = clips.slice(options.offset, options.offset + 32).map(animationInfo);
    if (options.section === 'overview' || options.section === 'layers') result.nodes = flat.slice(options.offset, options.offset + 128);
    result.offset = options.offset;
    return result;
  }

  async function execute(state, runtime, action) {
    validate([action]);
    let doc = state.doc;
    const op = action.op;
    if (op === 'rename_project') { doc.meta.title = action.name; return { title: action.name }; }
    if (op === 'set_palette') { doc.palette = Object.fromEntries(action.colors.map((value, index) => [index + 1, value])); return { colors: action.colors.length }; }
    if (op === 'export_file') return runtime.exportFile(action);
    if (op === 'import_image') return runtime.importImage(action);
    if (op === 'resize_frames') {
      Object.values(doc.cells).forEach(cell => unlocked(cell));
      if (Object.keys(doc.cells).length * action.width * action.height > 8000000) fail('Dự án quá lớn để đổi kích thước trong một thao tác AI.');
      PIX2.resizeCells(doc, action.width, action.height, action.mode);
      return { width: action.width, height: action.height };
    }
    if (op === 'create_animation') {
      const id = PIX2.sanitizeKey(action.animationId || action.name, 'animation');
      if (['__proto__', 'constructor', 'prototype'].includes(id) || !PIX2.isSafeIdentifier(id)) fail('ID animation không hợp lệ.');
      if (own(doc.animations, id)) fail('Animation đã tồn tại. Dùng update_animation để chỉnh.');
      if (Object.keys(doc.animations).length >= 256) fail('Dự án đã đạt giới hạn animation.');
      doc.animations[id] = { name: action.name || id, frames: [], fps: action.fps, direction: action.direction, mode: action.mode, loop: action.mode !== 'once' };
      runtime.clipId = id; return { animationId: id };
    }
    if (['select_animation', 'update_animation', 'delete_animation', 'set_animation_frames', 'move_animation_frame', 'remove_animation_frame', 'arrange_frames', 'playback'].includes(op)) {
      const { id, clip } = animation(state, runtime, action.animationId);
      if (op === 'update_animation') Object.assign(clip, { name: action.name, fps: action.fps, direction: action.direction, mode: action.mode, loop: action.mode !== 'once' });
      if (op === 'set_animation_frames') { action.frameIds.forEach(key => frame(state, runtime, key)); clip.frames = [...action.frameIds]; }
      if (op === 'move_animation_frame' || op === 'remove_animation_frame') {
        if (action.index >= clip.frames.length || (op === 'move_animation_frame' && action.toIndex >= clip.frames.length)) fail('Chỉ số frame vượt số frame của animation.');
        const [item] = clip.frames.splice(action.index, 1);
        if (op === 'move_animation_frame') clip.frames.splice(action.toIndex, 0, item);
      }
      if (op === 'delete_animation') { delete doc.animations[id]; if (runtime.clipId === id) runtime.clipId = Object.keys(doc.animations)[0] || null; return { deletedAnimationId: id, framesPreserved: true }; }
      if (op === 'arrange_frames' && clip.frames.length) AnimationFrames.applyRow(doc, AnimationFrames.planRow(doc, id));
      if (op === 'playback') { runtime.clipId = id; runtime.playing = action.playing; }
      if (op === 'select_animation') { runtime.clipId = id; if (clip.frames[0]) select(state, runtime, frame(state, runtime, clip.frames[0])); }
      return { animationId: id, frameIds: clip.frames, fps: clip.fps, playing: runtime.playing };
    }
    const cell = frame(state, runtime, action.frameId);
    if (op === 'select_frame') return select(state, runtime, cell, action.nodeId);
    if (op === 'rename_frame') { cell.name = action.name; return { frameId: cell.id, name: cell.name }; }
    if (op === 'duplicate_frame') {
      if (runtime.createdCount() >= 16 || Object.keys(doc.cells).length >= 4096) fail('Đã đạt giới hạn tạo frame.');
      const clip = doc.animations[runtime.clipId];
      if ((clip?.frames?.length || 0) >= 512) fail('Animation đã đạt giới hạn số frame.');
      const id = 'copy_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      const plan = clip ? AnimationFrames.planRow(doc, runtime.clipId, [id]) : null;
      if (!clip && doc.meta.grid.rows >= 256) fail('Dự án đã đạt giới hạn số hàng.');
      const duplicate = clone(cell); duplicate.id = id; duplicate.name = action.name || cell.name + ' Copy';
      const remap = new Map(); walk(duplicate.layers, node => remap.set(node.id, id + '_' + remap.size));
      ensureCapacity(doc, remap.size);
      walk(duplicate.layers, node => { node.id = remap.get(node.id); node.cell = id; if (node.parent) node.parent = remap.get(node.parent); });
      doc.cells[id] = duplicate;
      if (plan) { AnimationFrames.applyRow(doc, plan); clip.frames.push(id); }
      else { duplicate.row = doc.meta.grid.rows++; duplicate.col = 0; duplicate.frame = 0; }
      runtime.onFrameCreated(id); select(state, runtime, doc.cells[id]);
      return { frameId: id, sourceFrameId: cell.id };
    }
    if (op === 'delete_frame') {
      unlocked(cell); if (Object.keys(doc.cells).length <= 1) fail('Dự án cần giữ ít nhất một frame.');
      delete doc.cells[cell.id];
      Object.values(doc.animations).forEach(clip => { clip.frames = (clip.frames || []).filter(id => id !== cell.id); });
      if (runtime.frameId === cell.id) select(state, runtime, Object.values(doc.cells)[0]);
      return { deletedFrameId: cell.id };
    }
    if (['create_layer', 'create_group', 'create_region'].includes(op)) {
      if (cell.locked) fail('Frame đang bị khóa.');
      const upgraded = upgrade(state, cell.id); doc = state.doc;
      ensureCapacity(doc, op === 'create_layer' ? 2 : 1);
      let node;
      if (op === 'create_layer') {
        if (upgraded.layers.length >= 64) fail('Frame đã đạt giới hạn 64 layer.');
        node = state.addLayer(cell.id, action.name);
        select(state, runtime, upgraded, node.children[0].id);
      } else {
        const parentId = action.parentId || (runtime.frameId === cell.id ? state.activeGroupId || state.activeLayerId : null) || upgraded.layers[0]?.id;
        const parent = state.findNode(cell.id, parentId);
        if (!parent || !['group', 'layer'].includes(parent.node.type)) fail('Không tìm thấy layer/group cha.');
        unlocked(upgraded, parentId);
        node = op === 'create_group' ? state.addGroup(cell.id, parentId, action.name) : state.addRegion(cell.id, parentId, action.name);
        if (!node) fail('Không tạo được node.');
        if (op === 'create_region') select(state, runtime, upgraded, node.id);
      }
      return { frameId: cell.id, nodeId: node.id, selectedNodeId: runtime.nodeId };
    }
    if (['rename_node', 'delete_node', 'move_node', 'set_visibility', 'set_locked', 'set_opacity'].includes(op)) {
      const id = action.nodeId || (runtime.frameId === cell.id ? (op === 'set_opacity' ? state.activeLayerId : runtime.nodeId) : null), match = state.findNode(cell.id, id);
      if (!match) fail('Không tìm thấy layer/group/region.');
      if (['delete_node', 'move_node'].includes(op)) { unlocked(cell, id); let descendantLocked = false; walk([match.node], node => { if (node.locked) descendantLocked = true; }); if (descendantLocked) fail('Một node con đang bị khóa.'); }
      let ok = true;
      if (op === 'rename_node') ok = state.setNodeName(cell.id, id, action.name);
      if (op === 'delete_node') ok = state.removeNode(cell.id, id);
      if (op === 'move_node') ok = state.moveNode(cell.id, id, action.parentId || null, action.index);
      if (op === 'set_visibility') ok = state.setNodeVisibility(cell.id, id, action.visible);
      if (op === 'set_locked') ok = state.setNodeLocked(cell.id, id, action.locked);
      if (op === 'set_opacity') ok = state.setLayerOpacity(cell.id, id, action.opacity);
      if (!ok) fail('Không thực hiện được thao tác với node này.');
      sync(state, cell); if (op === 'delete_node') select(state, runtime, cell);
      return { frameId: cell.id, nodeId: id };
    }
    const cells = action.scope === 'project' ? Object.values(doc.cells) : [cell];
    const targets = cells.map(item => ({ cell: item, nodes: nodesFor(state, runtime, item, action.nodeId, action.scope) }));
    if (targets.reduce((sum, target) => sum + target.nodes.reduce((n, node) => n + Object.keys(node.pixels || {}).length, 0), 0) > 4000000) fail('Quá nhiều pixel cho một thao tác. Hãy xử lý từng frame.');
    for (const target of targets) {
      const { w, h } = target.cell.size || doc.meta.cellSize;
      let reduced = null, reducedIndex = 0;
      if (op === 'pixelate') {
        const count = target.nodes.reduce((sum, node) => sum + Object.keys(node.pixels || {}).length, 0);
        if (count) {
          const data = new Uint8ClampedArray(count * 4); let offset = 0;
          for (const node of target.nodes) for (const hex of Object.values(node.pixels || {})) { const rgba = PIX2.hexToRgba(hex); data.set([rgba.r, rgba.g, rgba.b, rgba.a], offset); offset += 4; }
          reduced = ImagePixelizer.quantize({ width: count, height: 1, data }, action.colors).data;
        }
      }
      let dx = action.dx, dy = action.dy;
      if (op === 'transform' && action.operation === 'center') {
        const coords = target.nodes.flatMap(node => Object.keys(node.pixels || {})).map(key => key.split(',').map(Number));
        if (coords.length) { let minX = w, minY = h, maxX = -1, maxY = -1; coords.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }); dx = Math.floor((w - maxX + minX - 1) / 2) - minX; dy = Math.floor((h - maxY + minY - 1) / 2) - minY; }
        else { dx = 0; dy = 0; }
      }
      for (const node of target.nodes) {
        if (op === 'clear_artwork') node.pixels = {};
        if (op === 'replace_color') for (const key in node.pixels) if (node.pixels[key].toLowerCase() === action.from.toLowerCase()) node.pixels[key] = action.to;
        if (op === 'transform') {
          const proxy = { pixels: node.pixels };
          if (action.operation === 'flip_horizontal') Tools.flipHorizontal(proxy, w);
          if (action.operation === 'flip_vertical') Tools.flipVertical(proxy, h);
          if (action.operation === 'rotate_cw') Tools.rotate90Clockwise(proxy, w, h);
          if (['move', 'center'].includes(action.operation)) Tools.nudge(proxy, dx, dy, w, h);
          node.pixels = proxy.pixels;
        }
        if (op === 'pixelate') {
          const pixels = {};
          for (const key of Object.keys(node.pixels || {})) { if (reduced?.[reducedIndex + 3]) pixels[key] = PIX2.rgbaToHex(...reduced.subarray(reducedIndex, reducedIndex + 4)); reducedIndex += 4; }
          node.pixels = pixels;
        }
        if (node.primitives) node.primitives = [];
      }
      sync(state, target.cell);
    }
    return { frameIds: cells.map(item => item.id), operation: op };
  }
  return { variants, inspectSchema, batchSchema, validate, inspect, execute, select, nodesFor, labels, ensureCapacity };
});
