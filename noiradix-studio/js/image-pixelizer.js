/** Deterministic palette reduction for imported RGBA images. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ImagePixelizer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function quantize(image, requestedColors = 16) {
    const { width, height, data } = image;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        !data || data.length !== width * height * 4) throw new Error('Invalid RGBA image');
    const limit = Math.min(64, Math.max(2, Math.round(Number(requestedColors)) || 16));
    const output = new Uint8ClampedArray(data);
    const bins = new Map();
    let exactColors = new Map();
    const keyFor = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (!alpha) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (exactColors) {
        exactColors.set((r << 16) | (g << 8) | b, [r, g, b]);
        if (exactColors.size > limit) exactColors = null;
      }
      const key = keyFor(r, g, b);
      let bin = bins.get(key);
      if (!bin) { bin = { key, weight: 0, r: 0, g: 0, b: 0 }; bins.set(key, bin); }
      // Weight partial transparency so nearly invisible pixels cannot dominate.
      bin.weight += alpha;
      bin.r += r * alpha; bin.g += g * alpha; bin.b += b * alpha;
    }
    if (exactColors) return { width, height, data: output, palette: [...exactColors.values()] };

    const points = [...bins.values()].map(p => ({
      key: p.key, weight: p.weight, r: p.r / p.weight, g: p.g / p.weight, b: p.b / p.weight
    }));
    function boxFor(colors) {
      const min = { r: 255, g: 255, b: 255 }, max = { r: 0, g: 0, b: 0 };
      let weight = 0;
      for (const color of colors) {
        weight += color.weight;
        for (const channel of ['r', 'g', 'b']) {
          min[channel] = Math.min(min[channel], color[channel]);
          max[channel] = Math.max(max[channel], color[channel]);
        }
      }
      const channel = ['r', 'g', 'b'].sort((a, b) => (max[b] - min[b]) - (max[a] - min[a]))[0];
      return { colors, weight, channel, score: colors.length > 1 ? (max[channel] - min[channel]) * weight : 0 };
    }
    const boxes = [boxFor(points)];
    while (boxes.length < limit) {
      let index = -1;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].score > 0 && (index < 0 || boxes[i].score > boxes[index].score)) index = i;
      }
      if (index < 0) break;
      const box = boxes[index];
      const sorted = box.colors.slice().sort((a, b) => a[box.channel] - b[box.channel] || a.key - b.key);
      let split = 0, weight = 0;
      while (split < sorted.length - 1 && weight < box.weight / 2) weight += sorted[split++].weight;
      split = Math.max(1, split);
      boxes.splice(index, 1, boxFor(sorted.slice(0, split)), boxFor(sorted.slice(split)));
    }
    const palette = boxes.map(box => {
      const sums = [0, 0, 0];
      for (const p of box.colors) {
        sums[0] += p.r * p.weight; sums[1] += p.g * p.weight; sums[2] += p.b * p.weight;
      }
      return sums.map(sum => Math.round(sum / box.weight));
    });
    const mapped = new Map();
    for (const p of points) {
      let best = palette[0], distance = Infinity;
      for (const color of palette) {
        const d = 0.299 * (p.r - color[0]) ** 2 + 0.587 * (p.g - color[1]) ** 2 + 0.114 * (p.b - color[2]) ** 2;
        if (d < distance) { distance = d; best = color; }
      }
      mapped.set(p.key, best);
    }
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      const color = mapped.get(keyFor(data[i], data[i + 1], data[i + 2]));
      output[i] = color[0]; output[i + 1] = color[1]; output[i + 2] = color[2];
    }
    return { width, height, data: output, palette };
  }

  return { quantize };
});
