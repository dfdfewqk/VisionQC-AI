/** VisionQC v1 browser-local IndexedDB storage: shared originals, separate ROI inspections and overlays. */
import {createInspectionSnapshot} from './inspectionModel.mjs';

export const DEFAULT_DB_NAME = 'visionqc-inspections-v1';
export const DB_VERSION = 1;
const SOURCE_STORE = 'sourceImages';
const RECORD_STORE = 'inspections';
const OVERLAY_STORE = 'heatmaps';
const VALID_MIME = new Set(['image/png','image/jpeg','image/webp']);

function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}
function txResult(tx, body) {
  return new Promise((resolve, reject) => {
    let outcome;
    let failure = null;
    tx.oncomplete = () => resolve(outcome);
    tx.onerror = () => { failure ??= tx.error; };
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('IndexedDB transaction aborted'));
    try { body(value => { outcome = value; }, error => { failure = error; tx.abort(); }); }
    catch (error) { failure = error; try { tx.abort(); } catch { reject(error); } }
  });
}

/** Open only in a browser/IndexedDB-capable context; database lifecycle is local to this origin. */
export function openInspectionDatabase({indexedDB = globalThis.indexedDB, name = DEFAULT_DB_NAME} = {}) {
  if (!indexedDB?.open) return Promise.reject(new Error('IndexedDB를 사용할 수 없는 브라우저입니다.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SOURCE_STORE)) db.createObjectStore(SOURCE_STORE, {keyPath:'id'});
      if (!db.objectStoreNames.contains(RECORD_STORE)) {
        const records = db.createObjectStore(RECORD_STORE, {keyPath:'id'});
        records.createIndex('bySource', 'sourceId', {unique:false});
        records.createIndex('byCreatedAt', 'createdAt', {unique:false});
      }
      if (!db.objectStoreNames.contains(OVERLAY_STORE)) db.createObjectStore(OVERLAY_STORE, {keyPath:'inspectionId'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 열기 실패'));
    request.onblocked = () => reject(new Error('다른 탭이 저장소 업데이트를 막고 있습니다. 해당 탭을 닫아 주세요.'));
  });
}

/**
 * Inject dependencies to test actual transaction behavior without browser hardware.
 * Save is atomic: original + immutable ROI inspection + optional overlay commit together.
 */
/** @param {{db: IDBDatabase, cryptoImpl?: Crypto}} options */
export function createInspectionRepository({db, cryptoImpl = globalThis.crypto} = {}) {
  if (!db?.transaction) throw new TypeError('Open IndexedDB connection required');
  if (!cryptoImpl?.subtle?.digest) throw new TypeError('SHA-256 crypto support required');
  const sha256 = async blob => {
    const array = await blob.arrayBuffer();
    const hash = await cryptoImpl.subtle.digest('SHA-256', array);
    return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2,'0')).join('');
  };
  async function prepareSource(file) {
    if (!(file instanceof Blob) || !VALID_MIME.has(file.type) || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new TypeError('원본은 비어 있지 않은 JPEG/PNG/WebP Blob이어야 합니다.');
    }
    const hash = await sha256(file);
    return {id:`sha256:${hash}`, hash, blob:file, type:file.type, bytes:file.size};
  }
  return {
    /** Stable identity is exact file bytes, not a claim that two photos show the same physical nut. */
    async fingerprint(file) { return (await prepareSource(file)).id; },
    async save({file, snapshot, overlay = null}) {
      const source = await prepareSource(file);
      if (!(overlay === null || (overlay instanceof Blob && overlay.type === 'image/png' && overlay.size > 0))) {
        throw new TypeError('Heatmap overlay must be a PNG Blob or null');
      }
      if (!snapshot || snapshot.sourceId !== source.id) throw new TypeError('Source hash does not match record');
      // Revalidate and deep copy, refusing speculative final human decisions or arbitrary payloads.
      const record = createInspectionSnapshot(snapshot);
      const tx = db.transaction([SOURCE_STORE,RECORD_STORE,OVERLAY_STORE], 'readwrite');
      return txResult(tx, done => {
        const original = tx.objectStore(SOURCE_STORE);
        const inspections = tx.objectStore(RECORD_STORE);
        const existing = original.get(source.id);
        existing.onsuccess = () => {
          if (!existing.result) original.add(source);
          // add() rather than put(): never overwrite an immutable inspection with the same ID.
          inspections.add(record);
          if (overlay) tx.objectStore(OVERLAY_STORE).add({inspectionId:record.id,blob:overlay});
          done({id:record.id,sourceId:source.id});
        };
      });
    },
    async get(id) {
      const tx = db.transaction([RECORD_STORE,SOURCE_STORE,OVERLAY_STORE], 'readonly');
      const inspectionRequest = tx.objectStore(RECORD_STORE).get(id);
      const inspection = await requestValue(inspectionRequest);
      if (!inspection) return null;
      const sourceRequest = tx.objectStore(SOURCE_STORE).get(inspection.sourceId);
      const overlayRequest = tx.objectStore(OVERLAY_STORE).get(id);
      const [source,heatmap] = await Promise.all([requestValue(sourceRequest),requestValue(overlayRequest)]);
      return {inspection,source:source ?? null,overlay:heatmap?.blob ?? null};
    },
    async list({sourceType = null,status = null,limit = 100,offset = 0} = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(offset) || offset < 0) {
        throw new RangeError('Invalid pagination');
      }
      const tx = db.transaction(RECORD_STORE,'readonly');
      // Lightweight metadata only; source Blobs and overlays are never loaded by listing.
      const all = await requestValue(tx.objectStore(RECORD_STORE).getAll());
      return all.filter(record => (!sourceType || record.sourceType === sourceType) && (!status || record.status === status))
        .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(offset,offset+limit);
    },
    async remove(id) {
      if (typeof id !== 'string' || !id) throw new TypeError('Inspection ID required');
      const tx = db.transaction([RECORD_STORE,SOURCE_STORE,OVERLAY_STORE], 'readwrite');
      return txResult(tx, done => {
        const records = tx.objectStore(RECORD_STORE);
        const get = records.get(id);
        get.onsuccess = () => {
          const record = get.result;
          if (!record) {done(false); return;}
          const others = records.index('bySource').getAllKeys(record.sourceId);
          others.onsuccess = () => {
            records.delete(id);
            tx.objectStore(OVERLAY_STORE).delete(id);
            if (others.result.length === 1 && others.result[0] === id) tx.objectStore(SOURCE_STORE).delete(record.sourceId);
            done(true);
          };
        };
      });
    },
    close() { db.close(); },
    get databaseName() { return db.name; },
  };
}

export function explainStorageError(error) {
  const name = error?.name;
  if (name === 'QuotaExceededError') return '브라우저 저장 공간이 부족합니다. 기존 기록을 자동 삭제하지 않았습니다. 백업 후 저장 공간을 확보해 주세요.';
  if (name === 'ConstraintError') return '동일한 검사 ID가 이미 저장되어 원본 기록을 덮어쓰지 않았습니다.';
  if (name === 'InvalidStateError' || name === 'TransactionInactiveError') return '저장소 연결 상태가 바뀌었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.';
  return `로컬 검사 기록 처리 실패: ${errorMessage(error)}`;
}
