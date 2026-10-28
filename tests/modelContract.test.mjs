import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeatureTensor, parseAnomalyOutputs } from '../src/ai/modelContract.mjs';
const tensor = (data) => ({ type:'float32', size:data.length, data });

test('accepts feature tensor of published PatchCore shape', () => {
  const t = tensor(new Float32Array(784 * 1536));
  assert.equal(validateFeatureTensor(t), t);
});
test('rejects wrong feature size before second model', () => {
  assert.throws(() => validateFeatureTensor(tensor(new Float32Array(100))), /incompatible/);
});
test('extracts anomaly map and raw scalar score without normalization', () => {
  const heat = tensor(new Float32Array(224 * 224).fill(2.5));
  const out = parseAnomalyOutputs(heat, tensor(new Float32Array([4.2])));
  assert.equal(out.map.length, 224 * 224);
  assert.equal(out.map[0], 2.5);
  assert.ok(Math.abs(out.score - 4.2) < 1e-5);
  assert.notEqual(out.map, heat.data);
});
test('rejects non-finite anomaly or image score', () => {
  const heat = tensor(new Float32Array(224 * 224));
  heat.data[72] = NaN;
  assert.throws(() => parseAnomalyOutputs(heat, tensor(new Float32Array([1]))), /non-finite/);
  heat.data[72] = 0;
  assert.throws(() => parseAnomalyOutputs(heat, tensor(new Float32Array([Infinity]))), /non-finite/);
});
test('rejects wrong anomaly-map dimensions or dtype', () => {
  const heat = tensor(new Float32Array(224 * 223));
  assert.throws(() => parseAnomalyOutputs(heat, tensor(new Float32Array([1]))), /incompatible/);
  const wrongDtype = { type: 'float16', data: new Uint16Array(224 * 224), size: 224 * 224 };
  assert.throws(() => parseAnomalyOutputs(wrongDtype, tensor(new Float32Array([1]))), /incompatible/);
});
