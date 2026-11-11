const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Pixelizer = require('../js/image-pixelizer.js');

// Simple sprites and transparent pixels retain their exact source values.
const sprite = { width: 3, height: 1, data: new Uint8ClampedArray([
  255, 0, 0, 255, 0, 255, 0, 128, 14, 99, 234, 0
]) };
assert.deepStrictEqual(Pixelizer.quantize(sprite, 8).data, sprite.data);
assert.strictEqual(Pixelizer.quantize(sprite, 8).palette.length, 2);
assert.deepStrictEqual(Pixelizer.quantize({ width: 1, height: 1, data: new Uint8ClampedArray(4) }, 16).palette, []);

// A continuous gradient becomes a bounded palette; alpha and input are unchanged.
const gradient = { width: 64, height: 32, data: new Uint8ClampedArray(64 * 32 * 4) };
for (let y = 0; y < gradient.height; y++) {
  for (let x = 0; x < gradient.width; x++) {
    const i = (y * gradient.width + x) * 4;
    gradient.data.set([x * 4, y * 8, (x * 11 + y * 7) % 256, (x + y) % 3 ? 255 : 128], i);
  }
}
const source = new Uint8ClampedArray(gradient.data);
for (const limit of [2, 8, 16, 32, 64]) {
  const result = Pixelizer.quantize(gradient, limit);
  const colors = new Set();
  for (let i = 0; i < result.data.length; i += 4) {
    colors.add(Array.from(result.data.slice(i, i + 3)).join(','));
    assert.strictEqual(result.data[i + 3], source[i + 3]);
  }
  assert(colors.size <= limit, `${colors.size} output colors exceeds ${limit}`);
  assert.deepStrictEqual(Pixelizer.quantize(gradient, limit).data, result.data, 'Conversion is deterministic');
}
assert.deepStrictEqual(gradient.data, source, 'Preview never modifies the source image');
assert.throws(() => Pixelizer.quantize({ width: 2, height: 2, data: new Uint8ClampedArray(4) }), /Invalid RGBA/);

// The exact same module loads as a browser script without CommonJS globals.
const browser = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/image-pixelizer.js'), 'utf8'), browser);
const browserResult = browser.ImagePixelizer.quantize(gradient, 16);
assert.deepStrictEqual(Array.from(browserResult.data), Array.from(Pixelizer.quantize(gradient, 16).data));
console.log('Image pixelizer passed: bounded palette, transparency, deterministic conversion, source preservation, browser loading.');
