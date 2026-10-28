import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {openInspectionDatabase,createInspectionRepository} from '../src/storage/inspectionDb.mjs';
import {createInspectionQueueRepository,InspectionQueueFullError} from '../src/storage/inspectionQueueDb.mjs';
import {createInspectionQueueRunner} from '../src/ai/inspectionQueue.mjs';
import {createInspectionService} from '../src/ai/inspectionService.mjs';
import {webcrypto} from 'node:crypto';
let n=0;
const file=(name='sample')=>new Blob([name],{type:'image/png'});
async function setup(){
  const name=`visionqc-queue-test-${++n}`;
  const db=await openInspectionDatabase({indexedDB,name});
  let sequence=0;
  const queue=createInspectionQueueRepository({db,uuid:()=>`test-${++sequence}`,
    clock:()=>`2026-10-28T00:00:${String(sequence).padStart(2,'0')}Z`});
  return {db,queue,repo:createInspectionRepository({db,cryptoImpl:webcrypto})};
}

test('DB v2 adds queue store and leaves v1 source, inspections, and heatmaps untouched',async()=>{
 const name=`visionqc-queue-migration-${++n}`;
 const first=await new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,1);req.onupgradeneeded=()=>{
   for(const store of ['sourceImages','inspections','heatmaps'])req.result.createObjectStore(store,{keyPath:'id'});
  };req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
 await new Promise((resolve,reject)=>{
  const tx=first.transaction('sourceImages','readwrite');tx.objectStore('sourceImages').add({id:'old',value:17});
  tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
 });first.close();
 const current=await openInspectionDatabase({indexedDB,name});
 assert.equal(current.version,2);assert.equal(current.objectStoreNames.contains('inspectionQueue'),true);
 const saved=await new Promise((resolve,reject)=>{
  const req=current.transaction('sourceImages').objectStore('sourceImages').get('old');
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });assert.deepEqual(saved,{id:'old',value:17});current.close();
});
test('queue allows one running and one waiting but rejects second waiting image',async()=>{
 const {db,queue}=await setup();
 const first=await queue.enqueue({file:file('A')});
 await assert.rejects(()=>queue.enqueue({file:file('B')}),InspectionQueueFullError);
 const claimed=await queue.claimNext();assert.equal(claimed.id,first.id);
 const second=await queue.enqueue({file:file('B')});
 await assert.rejects(()=>queue.enqueue({file:file('C')}),/대기 사진/);
 assert.equal((await queue.list()).length,2);
 assert.equal((await queue.list())[0].hasSource,true);
 assert.equal('file' in (await queue.list())[0],false);
 assert.equal(second.status,'queued');db.close();
});
test('after reopen running becomes interrupted and is never silently executed',async()=>{
 const {db,queue}=await setup();
 const job=await queue.enqueue({file:file()});await queue.claimNext();const name=db.name;db.close();
 const reopened=await openInspectionDatabase({indexedDB,name});
 const recovered=createInspectionQueueRepository({db:reopened});
 assert.equal(await recovered.recoverInterrupted(),1);
 assert.equal((await recovered.list())[0].status,'interrupted');
 assert.equal((await recovered.list())[0].hasSource,true);
 assert.equal(await recovered.recoverInterrupted(),0);
 const reclaimed=await recovered.claimNext();assert.equal(reclaimed.id,job.id);
 reopened.close();
});
test('runner completes two jobs sequentially, with immutable inspection IDs matching queue IDs',async()=>{
 const {db,queue,repo}=await setup();let simultaneous=0,maxSimultaneous=0;
 let firstStarted;const started=new Promise(resolve=>firstStarted=resolve);
 let releaseFirst;const gate=new Promise(resolve=>releaseFirst=resolve);
 const service=createInspectionService({repository:repo,infer:async()=>{
  simultaneous++;maxSimultaneous=Math.max(maxSimultaneous,simultaneous);
  if(simultaneous===1){firstStarted();await gate;}
  simultaneous--;
  return {width:700,height:700,crop:{x:80,y:80,width:300,height:300},score:1,
   candidate:{code:'review_required',isFinalVerdict:false,reasonCodes:['calibration_missing']},
   quality:{status:'preflight_ok'},modelIds:['v1'],elapsedMs:12,threshold:null};
 }});
 const first=await queue.enqueue({file:file('A')});
 const runner=createInspectionQueueRunner({queue,inspectAndSave:service.inspectAndSave,findExisting:repo.get});
 // A pending queue job can be registered while processing the first image.
 const start=runner.runQueue();
 await started;
 const second=await queue.enqueue({file:file('B')});
 releaseFirst();
 const report=await start;
 assert.equal(report.completed,2);assert.equal(maxSimultaneous,1);
 assert.equal((await repo.get(first.id)).inspection.id,first.id);
 assert.equal((await repo.get(second.id)).inspection.id,second.id);
 assert.equal((await queue.list()).every(j=>j.status==='completed'&&!j.hasSource),true);
 db.close();
});
test('if an inspection committed before a crash, retry recovers without rerunning it',async()=>{
 const {db,queue,repo}=await setup();const job=await queue.enqueue({file:file()});
 const claimed=await queue.claimNext();assert.equal(claimed.id,job.id);
 const service=createInspectionService({repository:repo,infer:async()=>({width:1000,height:1000,
   crop:{x:300,y:300,width:240,height:240},score:0.5,threshold:null,modelIds:['v1'],elapsedMs:1,
   candidate:{code:'review_required',isFinalVerdict:false,reasonCodes:['calibration_missing']}})});
 await service.inspectAndSave({file:claimed.file,inspectionId:job.id});
 await queue.recoverInterrupted();let calls=0;
 const runner=createInspectionQueueRunner({queue,inspectAndSave:async()=>{calls++;throw Error('unexpected')},findExisting:repo.get});
 const report=await runner.runQueue();assert.equal(report.completed,1);assert.equal(calls,0);
 assert.equal((await queue.list())[0].status,'completed');db.close();
});
test('image-specific error marks only that job failed and continues pending image',async()=>{
 const {db,queue}=await setup();await queue.enqueue({file:file('broken')});
 const first=await queue.claimNext();const second=await queue.enqueue({file:file('good')});
 await queue.recoverInterrupted();let count=0;
 const runner=createInspectionQueueRunner({queue,findExisting:async()=>null,inspectAndSave:async ({inspectionId})=>{
  count++;if(inspectionId===first.id){const e=new Error('bad image');e.code='image_decode_failed';throw e;}
  return {id:second.id};
 }});
 const report=await runner.runQueue();
 assert.equal(report.failedImage,1);assert.equal(report.completed,1);assert.equal(count,2);
 assert.deepEqual((await queue.list()).map(j=>j.status),['failed_image','completed']);db.close();
});
test('model or storage error pauses processing and retains pending files',async()=>{
 const {db,queue}=await setup();const first=await queue.enqueue({file:file('A')});
 await queue.claimNext();const second=await queue.enqueue({file:file('B')});await queue.recoverInterrupted();
 const runner=createInspectionQueueRunner({queue,findExisting:async()=>null,
  inspectAndSave:async()=>{throw new Error('ONNX HTTP 503');}});
 const result=await runner.runQueue();
 assert.equal(result.state,'paused_system');assert.equal(result.haltedOn,first.id);
 assert.deepEqual((await queue.list()).map(j=>j.status),['paused_system','queued']);
 assert.ok((await queue.get(second.id)).file instanceof Blob);db.close();
});
test('cancellation is explicit, running jobs cannot be canceled and retained records remain visible',async()=>{
 const {db,queue}=await setup();const job=await queue.enqueue({file:file()});
 await queue.claimNext();await assert.rejects(()=>queue.cancel(job.id),/상태/);
 await queue.recoverInterrupted();const result=await queue.cancel(job.id);
 assert.equal(result.status,'canceled');assert.equal(result.hasSource,false);
 assert.equal((await queue.list())[0].status,'canceled');db.close();
});
test('invalid file and unsupported ROI are rejected without changing queue',async()=>{
 const {db,queue}=await setup();
 await assert.rejects(()=>queue.enqueue({file:new Blob(['x'],{type:'text/plain'})}),/유효하지/);
 await assert.rejects(()=>queue.enqueue({file:file(),roi:{x:0,y:0,width:0,height:5}}),/ROI/);
 assert.deepEqual(await queue.list(),[]);db.close();
});
