/** Read-only, no schema migration: transactional snapshot of inspections and human audit events. */
import {searchInspectionHistory,summarizeQualityStatistics} from './inspectionHistory.mjs';

const requestValue = request => new Promise((resolve,reject)=>{
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error??new Error('검사 이력 조회 실패'));
});

/** @param {{db: IDBDatabase}} options */
export function createInspectionHistoryRepository({db}={}) {
  if (!db?.transaction || !db.objectStoreNames.contains('inspections') ||
      !db.objectStoreNames.contains('humanReviewEvents')) throw new TypeError('IndexedDB v3 조회 저장소가 필요합니다.');
  async function snapshot(){
    const tx=db.transaction(['inspections','humanReviewEvents'],'readonly');
    const [records,events]=await Promise.all([
      requestValue(tx.objectStore('inspections').getAll()),
      requestValue(tx.objectStore('humanReviewEvents').getAll()),
    ]);
    return {records,events};
  }
  return Object.freeze({
    async search(options={}) {const {records,events}=await snapshot();return searchInspectionHistory(records,events,options);},
    async qualityStatistics(options={}) {const {records,events}=await snapshot();return summarizeQualityStatistics(records,events,options);},
  });
}
