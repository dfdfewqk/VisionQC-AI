/**
 * The reference metal_nut PatchCore preprocessor resizes the SHORTER SIDE
 * to 256, then uses a 224px centered crop. When a single rectangle is drawn
 * directly out of the source image, its side is 224/256 * min(width,height).
 * This works for a feasibility test with a centered object. It does NOT
 * perform nut localization and must not be used as the final auto-ROI step.
 */
export function centerCropRect(width, height) {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new RangeError('Image dimensions must be positive finite numbers');
  }
  const side = Math.min(width, height) * (224 / 256);
  return { x: (width - side) / 2, y: (height - side) / 2, width: side, height: side };
}

/** Normalize an anomaly map for visualization only, never for comparison. */
export function normalizeAnomalyMap(raw) {
  if (!raw.length) throw new RangeError('Anomaly map is empty');
  let min = Infinity;
  let max = -Infinity;
  for (const value of raw) {
    if (!Number.isFinite(value)) throw new TypeError('Anomaly map contains a non-finite score');
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min;
  return { min, max, values: Float32Array.from(raw, v => range > 0 ? (v - min) / range : 0) };
}

/** Thresholds file schema can vary; parsing is deliberately strict. */
export function metalNutThreshold(document) {
  const obj = document && typeof document === 'object' ? document : null;
  const metal = obj?.metal_nut;
  const candidate = typeof metal === 'number' ? metal : metal?.threshold;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    throw new Error('metal_nut threshold missing from model metadata');
  }
  return candidate;
}
