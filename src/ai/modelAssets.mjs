/**
 * Verified, revision-pinned PatchCore model downloads.
 * ONNX byte counts / SHA-256 values are the LFS pointers in the upstream
 * verified Hugging Face commit, not estimates or test-set performance claims.
 * https://huggingface.co/yandyassine/patchcore-mvtec-ad/commit/f1705b3e17bb7eecd0d192fd15b59fabbde5b0a9
 */
export const MODEL_REPOSITORY = 'https://huggingface.co/yandyassine/patchcore-mvtec-ad';
export const MODEL_REVISION = 'f1705b3e17bb7eecd0d192fd15b59fabbde5b0a9';
export const MODEL_BASE = `${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}`;
export const MODEL_CACHE_NAME = `visionqc-patchcore-${MODEL_REVISION}`;

export const MODEL_ASSETS = Object.freeze({
  'backbone.onnx': Object.freeze({
    size: 49734896,
    sha256: '220153c1693b2fc5a00b9f3261c35ab4ec3d66ac2e554d596407a8e83c867e5e',
  }),
  'knn_metal_nut.onnx': Object.freeze({
    size: 53026215,
    sha256: '32b3aa7b53bc043d9b70ccf90d7d5806c4c65646c0c15c7a3afaf1b5eebc1d1d',
  }),
});

function validateThresholdJSON(bytes) {
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('thresholds.json: 유효하지 않은 JSON 데이터'); }
  const threshold = value?.metal_nut?.threshold;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    throw new Error('thresholds.json: metal_nut 임계값이 없거나 유효하지 않음');
  }
}

/** Digest is computed on the fetched bytes before a file enters CacheStorage. */
export async function verifyModelAsset(relativePath, bytes, digest) {
  if (!(bytes instanceof ArrayBuffer)) throw new Error(`${relativePath}: 모델 파일 형식 오류`);
  const spec = MODEL_ASSETS[relativePath];
  if (!spec) {
    if (relativePath !== 'thresholds.json') throw new Error(`허용되지 않은 모델 파일: ${relativePath}`);
    validateThresholdJSON(bytes);
    return;
  }
  if (bytes.byteLength !== spec.size) {
    throw new Error(`${relativePath}: 모델 파일 크기 불일치 (${bytes.byteLength}/${spec.size} bytes)`);
  }
  const sha256 = await digest(bytes);
  if (sha256 !== spec.sha256) throw new Error(`${relativePath}: SHA-256 검증 실패`);
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('HTTPS 보안 환경에서만 모델 무결성 검사가 가능합니다');
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Injectable browser dependencies keep corrupted-cache and network behavior
 * testable without downloading two 50MB models during unit tests.
 */
export function createModelAssetLoader({
  fetchImpl = globalThis.fetch,
  cachesApi = globalThis.caches,
  digest = sha256Hex,
  baseUrl = MODEL_BASE,
  cacheName = MODEL_CACHE_NAME,
} = {}) {
  return async function fetchVerifiedModelAsset(relativePath) {
    if (!(relativePath in MODEL_ASSETS) && relativePath !== 'thresholds.json') {
      throw new Error(`허용되지 않은 모델 파일: ${relativePath}`);
    }
    const url = `${baseUrl}/${relativePath}`;
    let cache = null;
    try { if (cachesApi?.open) cache = await cachesApi.open(cacheName); }
    catch { /* CacheStorage unavailable, network inference still possible. */ }

    if (cache) {
      try {
        const response = await cache.match(url);
        if (response) {
          const bytes = await response.arrayBuffer();
          await verifyModelAsset(relativePath, bytes, digest);
          return bytes;
        }
      } catch (error) {
        // A stale/corrupt cache must never be given to the inference runtime.
        console.warn(`Discarding invalid cached model ${relativePath}`, error);
        try { await cache.delete(url); } catch { /* best effort */ }
      }
    }

    let response;
    try { response = await fetchImpl(url, { mode: 'cors' }); }
    catch (error) { throw new Error(`${relativePath}: 모델 다운로드 연결 실패`, { cause: error }); }
    if (!response?.ok || response.type === 'opaque') {
      throw new Error(`${relativePath}: 모델 다운로드 실패 (HTTP ${response?.status ?? 'unknown'})`);
    }
    const bytes = await response.arrayBuffer();
    await verifyModelAsset(relativePath, bytes, digest);
    if (cache) {
      try {
        await cache.put(url, new Response(bytes.slice(0), {
          headers: { 'Content-Type': relativePath.endsWith('.onnx') ? 'application/octet-stream' : 'application/json' },
        }));
      } catch { /* CacheStorage capacity or browser restrictions: nonfatal. */ }
    }
    return bytes;
  };
}

export const fetchVerifiedModelAsset = createModelAssetLoader();
