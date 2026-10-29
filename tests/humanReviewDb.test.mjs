import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {openInspectionDatabase, createInspectionRepository, DB_VERSION} from '../src/storage/inspectionDb.mjs';
import {createHumanReviewRepository} from '../src/storage/humanReviewDb.mjs';
import {createInspectionSnapshot} from '../src/storage/inspectionModel.mjs';
let serial=0;
const photo=(x='x')=>new Blob([x],{type:'image/png'});
async function setup(){
 const name=`visionqc-review-${++serial}`;
 const db=await openInspectionDatabase({indexedDB,name});
 let eventNo=0;
 const repo=createInspectionRepository({db,cryptoImpl:webcrypto});
 const review=createHumanReviewRepository({db,uuid:()=>`test-${++eventNo}`,clock:()=>`2026-10-28T08:40:${String(eventNo).padStart(2,'0')}Z`});
 async function scan(id,status='inferred',sourceType='user',bytes=id){
  const file=photo(bytes),sourceId=await repo.fingerprint(file);
  const snapshot=createInspectionSnapshot({id,sourceId,createdAt:'2026-10-28T08:30:00Z',sourceType,status,
   width:1000,height:900,roi:status==='inferred'?{x:10,y:20,width:260,height:260}:null,
   score:status==='inferred'?1.5:null,candidate:status==='inferred'?{code:'review_required',isFinalVerdict:false,reasonCodes:['calibration_missing']}:null,
   modelIds:status==='inferred'?['model-v1']:[],failureReasons:status==='held'?['underexposed']:[],elapsedMs:status==='inferred'?12:null});
  await repo.save({file,snapshot});return snapshot;
 }
 const record=(inspectionId,expectedRevision=0,verdict='defective',reason='실물 확인')=>review.record({inspectionId,expectedRevision,verdict,reason,operatorName:'작업자 A'});
 return {db,repo,review,scan,record};
}

test('v2 -> v3 upgrade retains existing queue and inspection records',async()=>{
 const name=`visionqc-reviews-upgrade-${++serial}`;
 const older=await new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,2);
  req.onupgradeneeded=()=>{
   const db=req.result;
   db.createObjectStore('sourceImages',{keyPath:'id'});
   const r=db.createObjectStore('inspections',{keyPath:'id'});r.createIndex('bySource','sourceId');r.createIndex('byCreatedAt','createdAt');
   db.createObjectStore('heatmaps',{keyPath:'inspectionId'});db.createObjectStore('inspectionQueue',{keyPath:'id'});
  };req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
 await new Promise((resolve,reject)=>{
  const tx=older.transaction(['inspections','inspectionQueue'],'readwrite');
  tx.objectStore('inspections').add({id:'previous',status:'held',sourceType:'user'});
  tx.objectStore('inspectionQueue').add({id:'existing-queue',status:'interrupted'});
  tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
 });older.close();
 const db=await openInspectionDatabase({indexedDB,name});
 assert.equal(db.version,4);assert.equal(DB_VERSION,4);assert.ok(db.objectStoreNames.contains('humanReviewEvents'));
 const tx=db.transaction(['inspections','inspectionQueue'],'readonly');
 const results=await Promise.all(['inspections','inspectionQueue'].map(store=>new Promise((resolve,reject)=>{
  const q=tx.objectStore(store).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
 })));
 assert.equal(results[0][0].id,'previous');assert.equal(results[1][0].id,'existing-queue');db.close();
});
test('worker decision is appended to independent audit store, AI snapshot never overwritten',async()=>{
 const {db,repo,review,scan,record}=await setup();await scan('a');
 const initial=await record('a');assert.equal(initial.revision,1);assert.equal(initial.verdict,'defective');
 const changed=await record('a',1,'normal','재검사 후 정상 판단');
 assert.equal(changed.previousEventId,initial.id);assert.equal(changed.revision,2);
 assert.deepEqual((await review.history('a')).map(e=>e.verdict),['defective','normal']);
 assert.equal((await review.latest('a')).id,changed.id);
 const original=(await repo.get('a')).inspection;
 assert.equal(original.humanVerdict,null);assert.equal(original.candidate.code,'review_required');db.close();
});
test('stale revision cannot replace newer worker decision or append an event',async()=>{
 const {db,review,scan,record}=await setup();await scan('a');await record('a');
 await assert.rejects(()=>record('a',0,'normal'),e=>e.code==='human_review_revision_conflict');
 assert.equal((await review.history('a')).length,1);db.close();
});
test('parallel concurrent edits with the same revision have only one winner',async()=>{
 const {db,review,scan}=await setup();await scan('a');
 const args=(verdict)=>({inspectionId:'a',expectedRevision:0,verdict,operatorName:'worker',reason:'확인 사항'});
 const res=await Promise.allSettled([review.record(args('normal')),review.record(args('defective'))]);
 assert.deepEqual(res.map(x=>x.status).sort(),['fulfilled','rejected']);
 assert.equal((await review.history('a')).length,1);db.close();
});
test('missing inspection and rejected held photo are atomic and leave no audit',async()=>{
 const {db,review,scan,record}=await setup();
 await assert.rejects(()=>record('missing'),/존재하지/);
 await scan('held','held');
 await assert.rejects(()=>record('held'),/보류/);
 assert.deepEqual(await review.history('held'),[]);
 const next=await record('held',0,'reinspection');assert.equal(next.isFinalHumanVerdict,false);db.close();
});
test('explicit inspection deletion also deletes associated human event chain atomically',async()=>{
 const {db,repo,review,scan,record}=await setup();await scan('a');await record('a');await record('a',1,'normal','변경 사유');
 assert.equal((await review.history('a')).length,2);
 assert.equal(await repo.remove('a'),true);
 assert.deepEqual(await review.history('a'),[]);assert.equal(await repo.get('a'),null);db.close();
});
test('source-provenance review summaries count inspection attempts, not unique products',async()=>{
 const {db,review,scan,record}=await setup();await scan('a','inferred','user');await scan('b','inferred','user');
 await scan('demo','inferred','demo');await record('a');await record('demo');
 const a=await review.summary();assert.equal(a.inspectionAttempts,2);assert.equal(a.defective,1);assert.equal(a.unreviewed,1);
 assert.equal(a.uniqueProducts,null);assert.equal(a.confirmedProductDefectRate,null);
 const d=await review.summary({sourceType:'demo'});assert.equal(d.defective,1);db.close();
});
test('duplicate audit event IDs cannot overwrite historical events',async()=>{
 const {db,review,scan,record}=await setup();await scan('a');await record('a');
 const attempt=await createHumanReviewRepository({db,uuid:()=> 'test-1'}).record({inspectionId:'a',expectedRevision:1,verdict:'normal',operatorName:'another',reason:'reason'}).then(()=>null,e=>e);
 assert.ok(attempt instanceof Error);
 assert.equal((await review.history('a')).length,1);db.close();
});
