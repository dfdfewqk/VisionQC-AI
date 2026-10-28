import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeatureTensor, parseAnomalyOutputs, parseModelOutputs } from '../src/ai/modelContract.mjs';
const tensor = (data, dims) => ({ type: 'float32', size: data.length, data, dims });
const map = () => tensor(new Float32Array(224 * 224).fill(2.5), [224, 224]);
const score = () => tensor(new Float32Array([4.2]), []);

test('accepts feature tensor of published PatchCore shape', () => {
  const t = tensor(new Float32Array(784 * 1536), [784, 1536]);
  assert.equal(validateFeatureTensor(t), t);
});
test('rejects wrong feature size before second model', () => {
  assert.throws(() => validateFeatureTensor(tensor(new Float32Array(100), [100])), /incompatible/);
});
test('rejects flattened features despite matching element count', () => {
  assert.throws(() => validateFeatureTensor(tensor(new Float32Array(784 * 1536), [784 * 1536])), /incompatible/);
});
test('extracts anomaly map and raw scalar score without normalization', () => {
  const heat = map();
  const out = parseAnomalyOutputs(heat, score());
  assert.equal(out.map.length, 224 * 224);
  assert.equal(out.map[0], 2.5);
  assert.ok(Math.abs(out.score - 4.2) < 1e-5);
  assert.notEqual(out.map, heat.data);
});
test('rejects non-finite anomaly or image score', () => {
  const heat = map();
  heat.data[72] = NaN;
  assert.throws(() => parseAnomalyOutputs(heat, score()), /non-finite/);
  heat.data[72] = 0;
  assert.throws(() => parseAnomalyOutputs(heat, tensor(new Float32Array([Infinity]), [])), /non-finite/);
});
test('rejects wrong anomaly-map dimensions or dtype', () => {
  assert.throws(() => parseAnomalyOutputs(tensor(new Float32Array(224 * 223), [224, 223]), score()), /incompatible/);
  const wrongDtype = { type: 'float16', data: new Uint16Array(224 * 224), size: 224 * 224, dims: [224, 224] };
  assert.throws(() => parseAnomalyOutputs(wrongDtype, score()), /incompatible/);
  assert.throws(() => parseAnomalyOutputs(tensor(new Float32Array(224 * 224), [224 * 224]), score()), /incompatible/);
});
test('accepts ONNX map batch dimensions and scalar singleton dimensions', () => {
  const heat = tensor(new Float32Array(224 * 224), [1, 1, 224, 224]);
  assert.equal(parseAnomalyOutputs(heat, tensor(new Float32Array([3]), [1, 1])).score, 3);
});
test('parses named outputs regardless of graph output order or names', () => {
  const a = parseModelOutputs({ image_score: score(), heatmap: map() });
  const b = parseModelOutputs({ any_map_name: map(), any_score_name: score() });
  assert.equal(a.map.length, 224 * 224);
  assert.equal(a.score, b.score);
});
test('rejects ambiguous or incomplete KNN output objects', () => {
  assert.throws(() => parseModelOutputs({}), /expected 2/);
  assert.throws(() => parseModelOutputs({ only: map() }), /expected 2/);
  assert.throws(() => parseModelOutputs({ first: map(), second: map() }), /expected a 224x224/);
  assert.throws(() => parseModelOutputs({ first: map(), second: score(), third: score() }), /expected 2/);
});
