import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createModelAssetLoader, verifyModelAsset, MODEL_ASSETS, MODEL_BASE, MODEL_REVISION,
} from '../src/ai/modelAssets.mjs';

const bytes = (text) => new TextEncoder().encode(text).buffer;
const threshold = bytes('{"metal_nut":{"threshold":2.1994}}');
const validResponse = (content) => new Response(content.slice(0), { status: 200 });
const dig = async (buffer) => createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
function cacheStore(initial = undefined) {
  const data = new Map(initial);
  let deletes = 0;
  return {
    data, get deletes() { return deletes; },
    async open() {
      return {
        async match(key) { return data.get(key)?.clone(); },
        async delete(key) { deletes++; return data.delete(key); },
        async put(key, response) { data.set(key, response.clone()); },
      };
    },
  };
}

test('the model URL is pinned to a 40-character source revision', () => {
  assert.match(MODEL_REVISION, /^[a-f0-9]{40}$/);
  assert.equal(MODEL_BASE.endsWith(`/resolve/${MODEL_REVISION}`), true);
  assert.equal(Object.keys(MODEL_ASSETS).length, 2);
  for (const spec of Object.values(MODEL_ASSETS)) {
    assert.ok(spec.size > 40_000_000);
    assert.match(spec.sha256, /^[a-f0-9]{64}$/);
  }
});

test('accepts valid thresholds and rejects malformed or missing metal_nut threshold', async () => {
  await verifyModelAsset('thresholds.json', threshold, dig);
  await assert.rejects(verifyModelAsset('thresholds.json', bytes('{bad'), dig), /JSON/);
  await assert.rejects(verifyModelAsset('thresholds.json', bytes('{}'), dig), /metal_nut/);
  await assert.rejects(verifyModelAsset('unknown.onnx', bytes('bad'), dig), /허용되지 않은/);
});

test('cached verified threshold is reused without hitting the network', async () => {
  const url = `${MODEL_BASE}/thresholds.json`;
  const cache = cacheStore([[url, validResponse(threshold)]]);
  const fetchImpl = () => { throw new Error('must not download'); };
  const load = createModelAssetLoader({ cachesApi: cache, fetchImpl, digest: dig });
  assert.equal(new TextDecoder().decode(await load('thresholds.json')), new TextDecoder().decode(threshold));
});

test('corrupt cache is evicted and a valid replacement is saved', async () => {
  const url = `${MODEL_BASE}/thresholds.json`;
  const cache = cacheStore([[url, validResponse(bytes('oops'))]]);
  let calls = 0;
  const load = createModelAssetLoader({ cachesApi: cache, fetchImpl: async () => { calls++; return validResponse(threshold); }, digest: dig });
  const original = console.warn;
  console.warn = () => {};
  try { await load('thresholds.json'); } finally { console.warn = original; }
  assert.equal(calls, 1);
  assert.equal(cache.deletes, 1);
  assert.equal(JSON.parse(await cache.data.get(url).text()).metal_nut.threshold, 2.1994);
});

test('download failure is propagated and nothing invalid is cached', async () => {
  const cache = cacheStore();
  const load = createModelAssetLoader({ cachesApi: cache, fetchImpl: async () => new Response('missing', { status: 503 }), digest: dig });
  await assert.rejects(load('thresholds.json'), /HTTP 503/);
  assert.equal(cache.data.size, 0);
});

test('rejects a truncated ONNX file before hashing and does not cache it', async () => {
  const cache = cacheStore();
  const load = createModelAssetLoader({ cachesApi: cache, fetchImpl: async () => validResponse(bytes('not a valid ONNX')), digest: dig });
  await assert.rejects(load('backbone.onnx'), /크기 불일치/);
  assert.equal(cache.data.size, 0);
});

test('rejects mismatched SHA-256 even if exact expected byte count is provided', async () => {
  // Inject a fake digest to exercise the SHA check without allocating 50MB test assets.
  const realSize = MODEL_ASSETS['backbone.onnx'].size;
  const fakeSize = new ArrayBuffer(realSize);
  await assert.rejects(verifyModelAsset('backbone.onnx', fakeSize, async () => '0'.repeat(64)), /SHA-256/);
});

test('CacheStorage unavailability still allows direct verified threshold download', async () => {
  const load = createModelAssetLoader({ cachesApi: { async open() { throw new Error('quota'); } }, fetchImpl: async () => validResponse(threshold), digest: dig });
  assert.equal(JSON.parse(new TextDecoder().decode(await load('thresholds.json'))).metal_nut.threshold, 2.1994);
});
