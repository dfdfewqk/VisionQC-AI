import test from 'node:test';
import assert from 'node:assert/strict';
import { centerCropRect, normalizeAnomalyMap, metalNutThreshold } from '../src/ai/geometry.mjs';

test('reference center crop matches 256 short side -> 224', () => {
  assert.deepEqual(centerCropRect(256, 256), {x:16, y:16, width:224, height:224});
});
test('center crop maps a landscape image without stretching', () => {
  assert.deepEqual(centerCropRect(512, 256), {x:144, y:16, width:224, height:224});
});
test('reject invalid dimensions', () => {
  assert.throws(() => centerCropRect(0, 12), RangeError);
  assert.throws(() => centerCropRect(NaN, 12), RangeError);
});
test('heatmap visualization normalizes, not score', () => {
  const result = normalizeAnomalyMap([4, 6, 8]);
  assert.deepEqual(Array.from(result.values), [0, 0.5, 1]);
  assert.equal(result.min, 4);
  assert.equal(result.max, 8);
});
test('constant map does not cause divide-by-zero', () => {
  assert.deepEqual(Array.from(normalizeAnomalyMap([5, 5]).values), [0, 0]);
});
test('reject invalid anomaly map values', () => {
  assert.throws(() => normalizeAnomalyMap([Infinity]), TypeError);
});
test('reads explicit metal nut threshold and rejects missing values', () => {
  assert.equal(metalNutThreshold({metal_nut:{threshold:2.35}}), 2.35);
  assert.equal(metalNutThreshold({metal_nut:1.23}), 1.23);
  assert.throws(() => metalNutThreshold({bottle:{threshold:2}}));
});
