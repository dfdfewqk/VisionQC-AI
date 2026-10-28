import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {openInspectionDatabase,createInspectionRepository,DB_VERSION} from '../src/storage/inspectionDb.mjs';
import {createHumanReviewRepository} from '../src/storage/humanReviewDb.mjs';
import {createInspectionHistoryRepository} from '../src/storage/inspectionHistoryDb.mjs';
import {createInspectionSnapshot} from '../src/storage/inspectionModel.mjs';
let n=0;
const photo=x=>new Blob([x],{type:'image/png'});
async function setup(){
  const db=await openInspectionDatabase({indexedDB,name:`visionqc-history-test-${++n}`});
  const repo=createInspectionRepository({db,cryptoImpl:webcrypto});
  const human=createHumanReviewRepository({db,uuid:()=>`audit-${++n}`});
  const history=createInspectionHistoryRepository({db});
  async function record(id,{sourceType='user',createdAt='2026-10-28T08:00:00Z',source='picture',code='review_required',status='inferred'}={}){
    const file=photo(source),sourceId=await repo.fingerprint(file);
    const snapshot=createInspectionSnapshot({id,sourceId,sourceType,createdAt,status,width:1100,height:900,
      roi:status==='inferred'?{x:10,y:10,width:250,height:250}:null,
      score:status==='inferred'?2:null,modelIds:status==='inferred'?['v1']:[],elapsedMs:status==='inferred'?30:null,
      candidate:status==='inferred'?{code,isFinalVerdict:false,reasonCodes:['unverified']}:null,
      failureReasons:status==='held'?['underexposed']:[],lotId:'LOT-A',productId:'P-A'});
    await repo.save({file,snapshot});
    return snapshot;
  }
  async function verdict(id,name='Kim',verdict='defective',expectedRevision=0){
    return human.record({inspectionId:id,operatorName:name,verdict,expectedRevision,reason:'실물 육안 검사'});
  }
  return {db,repo,human,history,record,verdict};
}
test('read-only history query includes latest worker decision, without image/overlay Blobs',async()=>{
  const {db,history,record,verdict}=await setup();await record('a');await record('b',{source:'other'});
  await verdict('a');await verdict('a','Park','normal',1);
  const results=await history.search({operatorName:'park',humanVerdict:'normal'});
  assert.equal(results.total,1);assert.equal(results.items[0].id,'a');
  assert.equal(results.items[0].latestHumanReview.revision,2);
  assert.equal('blob' in results.items[0],false);db.close();
});
test('integrated stats distinguish photo views, worker confirmed attempts and demo data',async()=>{
  const {db,history,record,verdict}=await setup();await record('a');await record('b');
  await record('demo',{sourceType:'demo'});await verdict('a');await verdict('b','Park','normal');await verdict('demo');
  const stats=await history.qualityStatistics();
  assert.equal(stats.totalAttempts,2);assert.equal(stats.distinctPhotographicViews,1);
  assert.equal(stats.humanConfirmedDefectiveAttemptRate,0.5);assert.equal(stats.uniqueProducts,null);
  assert.equal((await history.qualityStatistics({sourceType:'demo'})).humanConfirmedDefectiveAttemptRate,1);
  db.close();
});
test('deletion updates stats and search without leaving stale reviewed count',async()=>{
  const {db,history,repo,record,verdict}=await setup();await record('a');await verdict('a');
  assert.equal((await history.qualityStatistics()).humanConfirmedAttemptCount,1);
  await repo.remove('a');
  assert.equal((await history.qualityStatistics()).humanConfirmedAttemptCount,0);
  assert.equal((await history.search()).total,0);db.close();
});
test('existing v3 database supports history without changing DB schema/version',async()=>{
  const {db,history,record}=await setup();await record('a');
  assert.equal(DB_VERSION,3);assert.equal(db.version,3);
  assert.equal((await history.search({inspectionId:'a'})).total,1);
  assert.equal(db.objectStoreNames.contains('inspectionHistory'),false);
  db.close();
});
