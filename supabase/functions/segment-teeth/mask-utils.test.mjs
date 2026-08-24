import assert from "node:assert/strict";
import { calculateOutputSize, extractMaskComponents } from "./mask-utils.ts";

function bitmap(width, height, rectangles, noise = []) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  for (const [x, y, w, h] of rectangles) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const offset = (yy * width + xx) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
      }
    }
  }
  for (const [x, y] of noise) {
    const offset = (y * width + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
  }
  return pixels;
}

const width = 120;
const height = 80;
const components = extractMaskComponents(
  width,
  height,
  bitmap(width, height, [[12, 20, 18, 24], [72, 18, 20, 26]], [[2, 2]]),
  240,
  160,
);
assert.equal(components.length, 2, "el ruido aislado debe descartarse");
assert.deepEqual(components.map((item) => item.bbox), [
  [144, 36, 40, 52],
  [24, 40, 36, 48],
]);
assert.ok(components.every((item) => item.contentType === "image/svg+xml"));
assert.ok(new TextDecoder().decode(components[0].fileData).includes("<path fill=\"#fff\""));

const output = calculateOutputSize(720, 540);
assert.equal(output.width % 16, 0);
assert.equal(output.height % 16, 0);
assert.ok(output.width * output.height >= 655_360);
assert.equal(output.value, `${output.width}x${output.height}`);

assert.throws(
  () => extractMaskComponents(20, 20, bitmap(20, 20, [[0, 0, 20, 20]])),
  /cobertura inválida/,
);
assert.throws(() => calculateOutputSize(1600, 400), /relación 3:1/);

console.log("mask-utils: 6 verificaciones superadas");
