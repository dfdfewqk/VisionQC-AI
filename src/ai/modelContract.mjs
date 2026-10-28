/**
 * Validate the published two-stage PatchCore ONNX model tensor contract.
 * This does not establish model accuracy or device/browser compatibility.
 * Source model card: https://huggingface.co/yandyassine/patchcore-mvtec-ad
 */
const FEATURE_DIMS = [784, 1536];
const FEATURE_COUNT = 784 * 1536;
const MAP_SIZE = 224 * 224;
const MAP_DIMS = [[224, 224], [1, 224, 224], [1, 1, 224, 224]];
const SCORE_DIMS = [[], [1], [1, 1]];

function matchesDimensions(actual, allowed) {
  return Array.isArray(actual) && allowed.some(shape =>
    shape.length === actual.length && shape.every((value, i) => value === actual[i]));
}

function assertFloatTensor(tensor, name, size, allowedDims) {
  if (!tensor || tensor.type !== 'float32' || tensor.size !== size ||
      !(tensor.data instanceof Float32Array) || tensor.data.length !== size ||
      !matchesDimensions(tensor.dims, allowedDims)) {
    throw new Error(`${name}: incompatible ONNX tensor type/shape ` +
      `(expected float32, ${size} values, dimensions ${JSON.stringify(allowedDims)})`);
  }
  // Do not pass NaN or Infinity to an anomaly score or the next ONNX model.
  for (const value of tensor.data) {
    if (!Number.isFinite(value)) throw new Error(`${name}: non-finite model output`);
  }
}

export function validateFeatureTensor(tensor) {
  assertFloatTensor(tensor, 'PatchCore backbone features', FEATURE_COUNT, [FEATURE_DIMS]);
  return tensor;
}

export function parseAnomalyOutputs(anomaly, scoreTensor) {
  assertFloatTensor(anomaly, 'PatchCore anomaly map', MAP_SIZE, MAP_DIMS);
  assertFloatTensor(scoreTensor, 'PatchCore image score', 1, SCORE_DIMS);
  return { map: Float32Array.from(anomaly.data), score: scoreTensor.data[0] };
}

/**
 * ORT returns a name-to-tensor map. Discover roles by validated tensor shape,
 * NOT by outputNames[0]/outputNames[1]. The ONNX graph may rename or reorder
 * outputs while preserving the published map + scalar interface.
 */
export function parseModelOutputs(outputs) {
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
    throw new Error('PatchCore KNN output map is missing');
  }
  const values = Object.values(outputs);
  if (values.length !== 2 || values.some(value => !value || !Number.isInteger(value.size))) {
    throw new Error(`PatchCore KNN expected 2 tensor outputs, received ${values.length}`);
  }
  const anomaly = values.find(value => value.size === MAP_SIZE);
  const score = values.find(value => value.size === 1);
  if (!anomaly || !score) {
    throw new Error('PatchCore KNN expected a 224x224 anomaly map and a scalar image score');
  }
  return parseAnomalyOutputs(anomaly, score);
}
