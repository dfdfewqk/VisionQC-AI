import * as ort from 'onnxruntime-web/wasm';
import { centerCropRect, metalNutThreshold, normalizeAnomalyMap } from './geometry.mjs';
import { validateFeatureTensor, parseModelOutputs } from './modelContract.mjs';
import { fetchVerifiedModelAsset, MODEL_REVISION } from './modelAssets.mjs';

export { MODEL_REPOSITORY, MODEL_REVISION } from './modelAssets.mjs';

const MODEL_SIZE = 224;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

type Normalization = { min: number; max: number; values: Float32Array };
export type Crop = { x: number; y: number; width: number; height: number };
export type InferenceResult = {
  score: number;
  threshold: number | null;
  map: Normalization;
  crop: Crop;
  width: number;
  height: number;
  elapsedMs: number;
  modelIds: string[];
};

type Sessions = { backbone: ort.InferenceSession; knn: ort.InferenceSession };
let sessions: Sessions | null = null;
let loadPromise: Promise<Sessions> | null = null;

async function threshold(): Promise<number | null> {
  try {
    const bytes = await fetchVerifiedModelAsset('thresholds.json');
    return metalNutThreshold(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    console.warn('Threshold unavailable; no classification will be asserted', error);
    return null;
  }
}

async function initialize(): Promise<Sessions> {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = '/ort/';
  let backbone: ort.InferenceSession | null = null;
  let knn: ort.InferenceSession | null = null;
  try {
    const bbBytes = await fetchVerifiedModelAsset('backbone.onnx');
    backbone = await ort.InferenceSession.create(bbBytes, { executionProviders: ['wasm'] });
    const knnBytes = await fetchVerifiedModelAsset('knn_metal_nut.onnx');
    knn = await ort.InferenceSession.create(knnBytes, { executionProviders: ['wasm'] });
    if (!backbone.inputNames.includes('image') || !knn.inputNames.includes('features')) {
      throw new Error('공개 모델의 입력 이름이 문서와 다릅니다');
    }
    return { backbone, knn };
  } catch (error) {
    // Release both models even when the second session was already created.
    if (knn) await knn.release().catch(releaseError => console.warn('KNN release failed', releaseError));
    if (backbone) await backbone.release().catch(releaseError => console.warn('Backbone release failed', releaseError));
    throw error;
  }
}

async function getSessions(): Promise<Sessions> {
  if (sessions) return sessions;
  if (!loadPromise) loadPromise = initialize();
  try {
    const loaded = await loadPromise;
    sessions = loaded;
    return loaded;
  } catch (error) {
    loadPromise = null; // A later attempt can retry a failed model download/load.
    throw error;
  }
}

// All inference and session release operations share one FIFO promise gate.
// This prevents a user-triggered release from destroying an active ORT session.
let operationTail: Promise<void> = Promise.resolve();
function enqueueModelOperation<T>(operation: () => Promise<T>): Promise<T> {
  const current = operationTail.then(operation);
  operationTail = current.then(() => undefined, () => undefined);
  return current;
}

export function releaseModel(): Promise<void> {
  return enqueueModelOperation(async () => {
    const old = sessions;
    sessions = null;
    loadPromise = null;
    if (!old) return;
    try { await old.knn.release(); }
    finally { await old.backbone.release(); }
  });
}

/** This is ONLY a reference crop for ONNX feasibility. Object detection is not yet wired. */
async function preprocess(bitmap: ImageBitmap): Promise<{ tensor: ort.Tensor; crop: Crop }> {
  const crop = centerCropRect(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = MODEL_SIZE;
  canvas.height = MODEL_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const pixels = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
  const numPixels = MODEL_SIZE * MODEL_SIZE;
  const data = new Float32Array(3 * numPixels);
  for (let p = 0; p < numPixels; p++) {
    for (let c = 0; c < 3; c++) {
      data[c * numPixels + p] = ((pixels[p * 4 + c] / 255) - MEAN[c]) / STD[c];
    }
  }
  return { tensor: new ort.Tensor('float32', data, [1, 3, MODEL_SIZE, MODEL_SIZE]), crop };
}

export function runMetalNutPreflight(image: File): Promise<InferenceResult> {
  return enqueueModelOperation(async () => {
    const started = performance.now();
    const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
    try {
      const { tensor, crop } = await preprocess(bitmap);
      const { backbone, knn } = await getSessions();
      const features = await backbone.run({ image: tensor });
      const featureTensor = validateFeatureTensor(features[backbone.outputNames[0]]);
      const outputs = await knn.run({ features: featureTensor });
      const { map: raw, score } = parseModelOutputs(outputs);
      const map = normalizeAnomalyMap(raw);
      return {
        score, threshold: await threshold(), map, crop,
        width: bitmap.width, height: bitmap.height,
        elapsedMs: Math.round(performance.now() - started),
        modelIds: [`backbone.onnx@${MODEL_REVISION}`, `knn_metal_nut.onnx@${MODEL_REVISION}`],
      };
    } finally { bitmap.close(); }
  });
}

/** Draw local-contrast heatmap in the original photo coordinate system. */
export async function makeOverlay(image: File, result: InferenceResult): Promise<string> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const heat = document.createElement('canvas');
    heat.width = MODEL_SIZE; heat.height = MODEL_SIZE;
    const hctx = heat.getContext('2d');
    if (!hctx) throw new Error('Heatmap canvas unavailable');
    const pixels = hctx.createImageData(MODEL_SIZE, MODEL_SIZE);
    for (let i = 0; i < MODEL_SIZE * MODEL_SIZE; i++) {
      const v = result.map.values[i];
      pixels.data[i * 4 + 0] = Math.round(255 * v);
      pixels.data[i * 4 + 1] = Math.round(130 * (1 - v));
      pixels.data[i * 4 + 2] = Math.round(255 * (1 - v));
      pixels.data[i * 4 + 3] = Math.round(180 * v);
    }
    hctx.putImageData(pixels, 0, 0);
    ctx.drawImage(heat, result.crop.x, result.crop.y, result.crop.width, result.crop.height);
    return canvas.toDataURL('image/png');
  } finally { bitmap.close(); }
}
