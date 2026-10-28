/** Append-only human final reviews with revision conflict checks in one IDB transaction. */
import {validateHumanReviewInput, makeHumanReviewEvent, summarizeHumanReviewEvents} from './humanReviewModel.mjs';

export const REVIEW_STORE = 'humanReviewEvents';

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('판정 이력 조회 실패'));
  });
}

function transaction(db, stores, callback) {
  const tx = db.transaction(stores, 'readwrite');
  return new Promise((resolve, reject) => {
    let output, failure;
    tx.oncomplete = () => resolve(output);
    tx.onerror = () => { failure ??= tx.error; };
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('판정 저장 트랜잭션 중단'));
    const done = value => { output = value; };
    const fail = error => { failure = error; try { tx.abort(); } catch { reject(error); } };
    try { callback(tx, done, fail); } catch (error) { fail(error); }
  });
}

/** @param {{db: IDBDatabase, uuid?:()=>string, clock?:()=>string}} options */
export function createHumanReviewRepository({db, uuid = () => globalThis.crypto.randomUUID(),
  clock = () => new Date().toISOString()} = {}) {
  if (!db?.transaction || !db.objectStoreNames.contains(REVIEW_STORE)) {
    throw new TypeError('IndexedDB v3 작업자 판정 저장소가 필요합니다.');
  }
  async function history(inspectionId) {
    if (typeof inspectionId !== 'string' || !inspectionId.trim()) throw new TypeError('검사 ID가 필요합니다.');
    const tx = db.transaction(REVIEW_STORE, 'readonly');
    const all = await requestValue(tx.objectStore(REVIEW_STORE).index('byInspection').getAll(inspectionId));
    return all.sort((a,b) => a.revision - b.revision);
  }
  return Object.freeze({
    async record({inspectionId, verdict, operatorName, reason, expectedRevision} = {}) {
      const input = validateHumanReviewInput({inspectionId, verdict, operatorName, reason, expectedRevision});
      const eventId = `hr-${uuid()}`;
      const recordedAt = clock();
      if (typeof eventId !== 'string' || eventId.length > 180) throw new TypeError('판정 이벤트 ID 오류');
      // All reads and writes are in a single readwrite transaction; no TOCTOU.
      return transaction(db, ['inspections', REVIEW_STORE], (tx, done, fail) => {
        const eventStore = tx.objectStore(REVIEW_STORE);
        const req = tx.objectStore('inspections').get(input.inspectionId);
        req.onsuccess = () => {
          const inspection = req.result;
          if (!inspection) { fail(new Error('삭제되었거나 존재하지 않는 검사 기록입니다.')); return; }
          const history = eventStore.index('byInspection').getAll(input.inspectionId);
          history.onsuccess = () => {
            try {
              const last = history.result.reduce((a, b) => !a || b.revision > a.revision ? b : a, null);
              const revision = last?.revision ?? 0;
              if (revision !== input.expectedRevision) {
                const error = new Error('다른 판정이 먼저 저장되었습니다. 최신 이력을 확인한 뒤 다시 진행해 주세요.');
                error.code = 'human_review_revision_conflict';
                throw error;
              }
              const event = makeHumanReviewEvent({id: eventId, inspection, input, revision: revision + 1,
                recordedAt, previousEventId: last?.id ?? null});
              eventStore.add(event); // add, not put: prior audit events cannot be rewritten
              done(event);
            } catch (error) { fail(error); }
          };
        };
      });
    },
    history,
    async latest(inspectionId) {
      const rows = await history(inspectionId);
      return rows.at(-1) ?? null;
    },
    async summary({sourceType = 'user'} = {}) {
      if (!['user','demo'].includes(sourceType)) throw new TypeError('잘못된 검사 데이터 출처입니다.');
      const tx = db.transaction(['inspections', REVIEW_STORE], 'readonly');
      const [inspections, events] = await Promise.all([
        requestValue(tx.objectStore('inspections').getAll()),
        requestValue(tx.objectStore(REVIEW_STORE).getAll()),
      ]);
      return summarizeHumanReviewEvents(inspections, events, {sourceType});
    },
  });
}
