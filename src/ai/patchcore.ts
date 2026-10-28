import * as ort from 'onnxruntime-web/wasm';
import { centerCropRect, metalNutThreshold, normalizeAnomalyMap } from './geometry.mjs';
import { validateFeatureTensor, parseAnomalyOutputs } from './modelContract.mjs';

export const MODEL_REPOSITORY = 'https://huggingface.co/yandyassine/patchcore-mvtec-ad';
const MODEL_BASE = `${MODEL_REPOSITORY}/resolve/main`;
const CACHE_NAME = 'visionqc-model-preflight-v1';
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

async function fetchCached(relativePath: string): Promise<ArrayBuffer> {
  const url = `${MODEL_BASE}/${relativePath}`;
  // Readable CORS response is mandatory; do not accept opaque responses.
  // CacheStorage is used only for static model files, never uploaded photos.
  let cache: Cache | null = null;
  try { if ('caches' in globalThis) cache = await caches.open(CACHE_NAME); } catch { /* nonfatal */ }
  const existing = await cache?.match(url);
  if (existing) return await existing.arrayBuffer();
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok || response.type === 'opaque') throw new Error(`모델 다운로드 실패 (${response.status}): ${relativePath}`);
  const bytes = await response.arrayBuffer();
  if (relativePath.endsWith('.onnx') && bytes.byteLength < 1_000_000) {
    throw new Error(`모델 파일이 예상보다 작습니다: ${relativePath}`);
  }
  try { await cache?.put(url, new Response(bytes.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })); }
  catch { /* storage is best effort, do not block inference */ }
  return bytes;
}

async function threshold(): Promise<number | null> {
  try {
    const bytes = await fetchCached('thresholds.json');
    return metalNutThreshold(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    console.warn('Threshold unavailable; no classification will be asserted', error);
    return null;
  }
}

async function initialize() {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = '/ort/';
  const bbBytes = await fetchCached('backbone.onnx');
  const backbone = await ort.InferenceSession.create(bbBytes, { executionProviders: ['wasm'] });
  try {
    const knnBytes = await fetchCached('knn_metal_nut.onnx');
    const knn = await ort.InferenceSession.create(knnBytes, { executionProviders: ['wasm'] });
    if (!backbone.inputNames.includes('image') || !knn.inputNames.includes('features')) {
      throw new Error('공개 모델의 입력 이름이 문서와 다릅니다');
    }
    return { backbone, knn };
  } catch (error) {
    await backbone.release();
    throw error;
  }
}

async function getSessions() {
  if (sessions) return sessions;
  if (!loadPromise) loadPromise = initialize();
  try {
    const loaded = await loadPromise;
    sessions = loaded;
    return loaded;
  } catch (error) {
    loadPromise = null;
    throw error;
  }
}

export async function releaseModel() {
  const old = sessions;
  sessions = null;
  loadPromise = null;
  if (old) { await old.knn.release(); await old.backbone.release(); }
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

export async function runMetalNutPreflight(image: File): Promise<InferenceResult> {
  const started = performance.now();
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  try {
    const { tensor, crop } = await preprocess(bitmap);
    const { backbone, knn } = await getSessions();
    const features = await backbone.run({ image: tensor });
    const featureTensor = validateFeatureTensor(features[backbone.outputNames[0]]);
    const outputs = await knn.run({ features: featureTensor });
    const { map: raw, score } = parseAnomalyOutputs(outputs[knn.outputNames[0]], outputs[knn.outputNames[1]]);
    const map = normalizeAnomalyMap(raw);
    return {
      score, threshold: await threshold(), map, crop,
      width: bitmap.width, height: bitmap.height,
      elapsedMs: Math.round(performance.now() - started),
      modelIds: ['backbone.onnx', 'knn_metal_nut.onnx'],
    };
  } finally { bitmap.close(); }
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
