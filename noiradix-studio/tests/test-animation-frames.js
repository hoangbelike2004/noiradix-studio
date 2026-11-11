const assert = require('node:assert/strict');
const { planRow, applyRow } = require('../js/animation-frames.js');
const PIX2 = require('../js/pix2-format.js');

function fixture() {
  const doc = PIX2.parse('@pix2 1.0\n@meta\n  cell_size: 16x16\n  grid: 4x4\n@end');
  doc.cells = {};
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const id = `cell_${row}_${col}`;
    doc.cells[id] = { id, row, col, frame: col, name: id, pixels: { '0,0': '#ff0000' } };
  }
  doc.animations = { walk_down: { name: 'Walk Down', frames: ['cell_0_0', 'cell_0_1', 'cell_0_2', 'cell_0_3'], fps: 6, direction: 'down' } };
  return doc;
}

// Two imports grow only this clip's row, retaining other rows and artwork.
{
  const doc = fixture(), up = JSON.stringify(doc.cells.cell_1_0);
  for (const id of ['image_a', 'image_b']) {
    const before = JSON.stringify(doc);
    const plan = planRow(doc, 'walk_down', [id]);
    assert.equal(JSON.stringify(doc), before, 'planning must not mutate the project');
    doc.cells[id] = { id, name: id, pixels: { '1,1': '#0000ff' } };
    applyRow(doc, plan);
    doc.animations.walk_down.frames.push(id);
  }
  assert.deepEqual(doc.meta.grid, { cols: 6, rows: 4 });
  assert.deepEqual(doc.animations.walk_down.frames.map(id => [doc.cells[id].row, doc.cells[id].col]), [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5]]);
  assert.equal(JSON.stringify(doc.cells.cell_1_0), up);
  const restored = PIX2.parse(PIX2.serialize(doc));
  assert.equal(restored.animations.walk_down.frames.length, 6, 'save/reopen retains every frame');
  assert.deepEqual(restored.cells.image_b.pixels, { '1,1': '#0000ff' });
}

// Older projects have imports on separate rows. Arrange them without changing
// IDs, layers, animation order, or overwriting another frame on the target row.
{
  const doc = fixture();
  const layers = [{ id: 'art', children: [{ id: 'pixels', pixels: { '0,0': '#00ff00' } }] }];
  doc.cells.image_old = { id: 'image_old', row: 4, col: 0, layers, pixels: { '0,0': '#00ff00' } };
  doc.cells.reserved = { id: 'reserved', row: 0, col: 4, pixels: { '0,0': '#ffffff' } };
  doc.meta.grid = { cols: 5, rows: 5 };
  doc.animations.walk_down.frames.push('image_old', 'cell_0_0');
  const frames = [...doc.animations.walk_down.frames];
  applyRow(doc, planRow(doc, 'walk_down'));
  assert.deepEqual(doc.animations.walk_down.frames, frames, 'repeated playback entries stay intact');
  assert.equal(doc.cells.image_old.col, 5, 'skip the unrelated frame');
  assert.equal(doc.cells.image_old.row, 0);
  assert.equal(doc.cells.image_old.layers, layers);
  assert.equal(doc.cells.reserved.col, 4);
}

// Reject over-capacity placement before any mutation, while a full row count
// still allows importing into an existing animation row.
{
  const doc = fixture();
  doc.meta.grid.rows = 256;
  assert.equal(planRow(doc, 'walk_down', ['image']).rows, 256);
  const before = JSON.stringify(doc);
  assert.throws(() => planRow(doc, 'walk_down', Array.from({ length: 125 }, (_, i) => 'extra_' + i)), /128/);
  assert.equal(JSON.stringify(doc), before);
  doc.animations.empty = { frames: [] };
  assert.throws(() => planRow(doc, 'empty', ['image']), /hàng/);
}

console.log('PASS animation frame placement: six-frame imports, persistence, legacy layout, collisions, repeated frames and limits');
