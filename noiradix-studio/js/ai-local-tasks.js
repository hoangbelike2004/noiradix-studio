/** Exact, deliberately narrow commands that need no language model. Ambiguous
 * requests continue through the AI; never partially consume a compound request. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.AiLocalTasks = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function route(message) {
    if (typeof message !== 'string') return null;
    const text = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().replace(/[.!]$/, '').trim();
    if (/^(?:nhan doi frame(?: nay| dang chon)?|duplicate (?:this |current )?frame)$/.test(text)) return { label: 'Đã nhân đôi frame đang chọn.', actions: [{ op: 'duplicate_frame', frameId: '', name: '' }] };
    const size = text.match(/^(?:doi kich thuoc tat ca frame|resize all frames)(?: to)? (\d{1,3})\s*[x×]\s*(\d{1,3})$/);
    if (size && +size[1] >= 1 && +size[1] <= 512 && +size[2] >= 1 && +size[2] <= 512) return { label: 'Đã đổi kích thước bằng nearest-neighbor.', actions: [{ op: 'resize_frames', width: +size[1], height: +size[2], mode: 'scale' }] };
    const move = text.match(/^(?:dich frame|move frame) (-?\d{1,3})\s*,\s*(-?\d{1,3})$/);
    if (move && Math.abs(+move[1]) <= 512 && Math.abs(+move[2]) <= 512) return { label: 'Đã dịch pixel trong frame đang chọn.', actions: [{ op: 'transform', frameId: '', nodeId: '', scope: 'frame', operation: 'move', dx: +move[1], dy: +move[2] }] };
    if (/^(?:xuat spritesheet|export spritesheet)$/.test(text)) return { label: 'Đã chuẩn bị spritesheet PNG.', actions: [{ op: 'export_file', format: 'animation_png', filename: '' }] };
    return null;
  }
  return { route };
});
