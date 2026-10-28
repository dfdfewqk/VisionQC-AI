/**
 * Validate the published two-stage PatchCore model's tensor hand-off and
 * returned anomaly map without importing the ONNX Runtime browser bundle.
 * This is an interface contract, NOT a quality/accuracy assessment.
 */
const FEATURES_COUNT = 784 * 1536;
const MAP_SIZE = 224 * 224;

function requireFloatTensor(tensor, name, size) {
  if (!tensor || tensor.type !== 'float32' || tensor.size !== size ||
      !(tensor.data instanceof Float32Array) || tensor.data.length !== size) {
    throw new Error(`${name}: incompatible ONNX tensor type/shape (expected float32, ${size} values)`);
  }
  if (!tensor.data.every(Number.isFinite)) {
    throw new Error(`${name}: non-finite model output`);
  }
}

export function validateFeatureTensor(tensor) {
  requireFloatTensor(tensor, 'PatchCore backbone features', FEATURES_COUNT);
  return tensor;
}

export function parseAnomalyOutputs(anomaly, scoreTensor) {
  requireFloatTensor(anomaly, 'PatchCore anomaly map', MAP_SIZE);
  requireFloatTensor(scoreTensor, 'PatchCore image score', 1);
  return { map: Float32Array.from(anomaly.data), score: scoreTensor.data[0] };
}
