import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {openInspectionDatabase,createInspectionRepository,explainStorageError} from '../src/storage/inspectionDb.mjs';
import {createInspectionSnapshot} from '../src/storage/inspectionModel.mjs';
import {createInspectionService} from '../src/ai/inspectionService.mjs';

let counter=0;
async function createRepo() {
 const db=await openInspectionDatabase({indexedDB,name:`visionqc-unit-${++counter}`});
 return createInspectionRepository({db,cryptoImpl:webcrypto});
}
const photo = (bytes='real photo')=>new Blob([bytes],{type:'image/png'});
const valid=(id,sourceId,status='inferred', sourceType='user')=>createInspectionSnapshot({id,sourceId,createdAt:'2026-10-28T08:20:00Z',
 sourceType,status,width:1000,height:900,roi:status==='inferred'?{x:10,y:20,width:240,height:240}:null,
 score:status==='inferred'?2:null,threshold:null,
 candidate:status==='inferred'?{code:'review_required',isFinalVerdict:false,reasonCodes:['calibration_missing']}:null,
 modelIds:status==='inferred'?['v1']:[],failureReasons:status==='held'?['blur']:[],elapsedMs:status==='inferred'?22:null});

test('IndexedDB writes original, distinct ROI record, and PNG overlay atomically',async()=>{
 const repo=await createRepo();const file=photo();const sourceId=await repo.fingerprint(file);
 const overlay=new Blob(['png'],{type:'image/png'});
 await repo.save({file,snapshot:valid('record-1',sourceId),overlay});
 const row=await repo.get('record-1');
 assert.equal(row.inspection.id,'record-1');assert.equal(row.source.id,sourceId);
 assert.equal(await row.source.blob.text(),'real photo');assert.equal(await row.overlay.text(),'png');
 repo.close();
});
test('same exact photo supports two separate ROI inspections without duplicating original blob',async()=>{
 const repo=await createRepo();const file=photo();const sourceId=await repo.fingerprint(file);
 await repo.save({file,snapshot:valid('r1',sourceId)});await repo.save({file,snapshot:valid('r2',sourceId)});
 assert.equal((await repo.list()).length,2);
 await repo.remove('r1');assert.equal((await repo.get('r1')),null);
 assert.ok((await repo.get('r2')).source.blob);
 await repo.remove('r2');assert.equal((await repo.get('r2')),null);
 const db=await openInspectionDatabase({indexedDB,name:repo.databaseName});
 const tx=db.transaction('sourceImages','readonly');const source=await new Promise((resolve,reject)=>{const request=tx.objectStore('sourceImages').get(sourceId);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 assert.equal(source,undefined);repo.close();db.close();
});
test('same ID cannot overwrite historical record, failed transaction preserves original',async()=>{
 const repo=await createRepo();const file=photo();const sourceId=await repo.fingerprint(file);
 await repo.save({file,snapshot:valid('id',sourceId)});
 await assert.rejects(()=>repo.save({file,snapshot:valid('id',sourceId)}));
 assert.equal((await repo.list()).length,1);assert.equal((await repo.get('id')).inspection.score,2);repo.close();
});
test('incorrect source hash fails before writing any data',async()=>{
 const repo=await createRepo();const file=photo();
 await assert.rejects(()=>repo.save({file,snapshot:valid('id','sha256:wrong')}),/hash/);
 assert.deepEqual(await repo.list(),[]);repo.close();
});
test('different photo same claimed ROI is not deduplicated',async()=>{
 const repo=await createRepo();const a=photo('A'),b=photo('B');const aa=await repo.fingerprint(a),bb=await repo.fingerprint(b);
 assert.notEqual(aa,bb);await repo.save({file:a,snapshot:valid('a',aa)});await repo.save({file:b,snapshot:valid('b',bb)});
 assert.notEqual((await repo.get('a')).source.id,(await repo.get('b')).source.id);repo.close();
});
test('demo records stay filterable separately from live user inspections',async()=>{
 const repo=await createRepo();const file=photo();const s=await repo.fingerprint(file);
 await repo.save({file,snapshot:valid('demo',s,'inferred','demo')});await repo.save({file,snapshot:valid('live',s,'inferred','user')});
 assert.deepEqual((await repo.list({sourceType:'demo'})).map(r=>r.id),['demo']);
 assert.deepEqual((await repo.list({sourceType:'user'})).map(r=>r.id),['live']);repo.close();
});
test('pagination guards resource limits, and list excludes source blobs',async()=>{
 const repo=await createRepo();const file=photo();const s=await repo.fingerprint(file);
 await repo.save({file,snapshot:valid('i',s)});
 const rows=await repo.list({limit:1,offset:0});assert.equal(rows.length,1);assert.equal('blob' in rows[0],false);
 await assert.rejects(()=>repo.list({limit:Infinity}),/pagination/);repo.close();
});
test('held records do not invent inference scores and can be fetched',async()=>{
 const repo=await createRepo();const file=photo('held');const s=await repo.fingerprint(file);
 await repo.save({file,snapshot:valid('hold',s,'held')});
 const row=await repo.get('hold');assert.equal(row.inspection.score,null);assert.equal(row.overlay,null);assert.equal(row.inspection.status,'held');repo.close();
});
test('deleting a nonexistent record is safe and does not change existing records',async()=>{
 const repo=await createRepo();const file=photo();const s=await repo.fingerprint(file);
 await repo.save({file,snapshot:valid('r',s)});assert.equal(await repo.remove('missing'),false);
 assert.ok(await repo.get('r'));repo.close();
});
test('storage quota error is actionable and never promises silent data cleanup',()=>{
 assert.match(explainStorageError({name:'QuotaExceededError'}),/자동 삭제하지/);
 assert.match(explainStorageError({name:'ConstraintError'}),/덮어쓰지/);
});

test('inference-to-IDB integration persists selected rotated ROI, shares source across multiple crops, and reloads',async()=>{
 const repo=await createRepo();const file=photo('camera image');let n=0;
 const service=createInspectionService({repository:repo,
   uuid:()=>`scan-${++n}`,clock:()=> '2026-10-28T08:20:00Z',
   infer:async(f,options)=>{
    const r=options.roi;
    return {width:1024,height:768,crop:{x:r.x,y:r.y,width:r.width,height:r.height},
      roiTransform:{...r,source:'user_selected_unverified',modelSize:224},
      score:1.8,threshold:null,modelIds:['pinned-model'],elapsedMs:42,
      quality:{status:'preflight_ok',qualityVerifiedForClassification:false},
      candidate:{code:'review_required',isFinalVerdict:false,reasonCodes:['roi_unverified']}};
   }});
 const a={x:100,y:100,width:300,height:280,rotationDegrees:15};
 const b={x:550,y:160,width:224,height:224,rotationDegrees:0};
 const first=await service.inspectAndSave({file,roi:a});
 const second=await service.inspectAndSave({file,roi:b});
 assert.notEqual(first.id,second.id);
 assert.equal(first.sourceId,second.sourceId);
 assert.deepEqual((await repo.get(first.id)).inspection.roiTransform,{...a,source:'user_selected_unverified',modelSize:224});
 assert.equal((await repo.get(second.id)).inspection.candidate.code,'review_required');
 await repo.remove(first.id);assert.ok((await repo.get(second.id)).source.blob);
 repo.close();
});
