/** Plan grid placement without changing animation membership or artwork. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.AnimationFrames = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function position(cell) {
    const match = (cell.id || '').match(/^cell_(\d+)_(\d+)$/);
    return { row: cell.row ?? (match ? Number(match[1]) : -1), col: cell.col ?? (match ? Number(match[2]) : -1) };
  }

  function planRow(doc, clipId, extraIds = []) {
    const clip = doc.animations[clipId];
    if (!clip) throw new Error('Animation không còn tồn tại.');
    const sequence = [...(clip.frames || []), ...extraIds];
    const ids = [...new Set(sequence)].filter(id => doc.cells[id] || extraIds.includes(id));
    const firstCell = ids.map(id => doc.cells[id]).find(cell => cell && position(cell).row >= 0);
    const row = firstCell ? position(firstCell).row : doc.meta.grid.rows;
    if (row >= 256) throw new Error('Dự án đã đạt giới hạn số hàng.');
    const members = new Set(ids);
    const reserved = new Set(Object.values(doc.cells).filter(cell => !members.has(cell.id) && position(cell).row === row).map(cell => position(cell).col));
    let col = 0;
    const placements = ids.map(id => {
      while (reserved.has(col)) col++;
      if (col >= 128) throw new Error('Hàng này không đủ chỗ. Tối đa 128 ô trên một hàng.');
      return { id, row, col: col++, frame: sequence.indexOf(id) };
    });
    return { placements, rows: Math.max(doc.meta.grid.rows, row + 1), cols: Math.max(doc.meta.grid.cols, col) };
  }

  function applyRow(doc, plan) {
    for (const { id, ...placement } of plan.placements) {
      if (!doc.cells[id]) throw new Error('Frame không còn tồn tại.');
      doc.cells[id] = { ...doc.cells[id], ...placement };
    }
    doc.meta.grid.rows = plan.rows;
    doc.meta.grid.cols = plan.cols;
  }

  return { planRow, applyRow };
});
