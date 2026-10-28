import test from 'node:test';
import assert from 'node:assert/strict';
import {createInspectionSnapshot,createInferredSnapshot,createHeldSnapshot} from '../src/storage/inspectionModel.mjs';
import {createInspectionService} from '../src/ai/inspectionService.mjs';
import {ImageQualityHoldError} from '../src/ai/imageQuality.mjs';

const base = () => ({id:'ins-1',sourceId:'sha256:abc',createdAt:'2026-10-28T07:00:00Z',sourceType:'user',status:'inferred',
 width:1000,height:900,roi:{x:200,y:100,width:400,height:600},score:2.75,threshold:null,
 candidate:{code:'review_required',reasonCodes:['calibration_missing'],isFinalVerdict:false},
 quality:{status:'preflight_ok',reasonCodes:[]},modelIds:['model@v1'],elapsedMs:140});

test('save only normalized AI candidate and never human final verdict',()=>{
 const record=createInspectionSnapshot({...base(),candidate:{...base().candidate,label:'fake normal',isFinalVerdict:false}});
 assert.equal(record.candidate.label,'확인 필요');
 assert.equal(record.humanVerdict,null);
 assert.equal(record.candidate.isFinalVerdict,false);
 assert.equal(record.quality.qualityVerifiedForClassification,false);
 assert.equal(record.threshold,null);
});
test('rejects invalid ROI, NaN, invalid status, unsupported provenance and forged human verdict',()=>{
 const x=base();
 for(const bad of [{...x,roi:{x:-1,y:0,width:100,height:100}}, {...x,roi:{x:999,y:0,width:20,height:10}},
 {...x,score:NaN},{...x,status:'completed'},{...x,sourceType:'unverified'},{...x,candidate:{...x.candidate,isFinalVerdict:true}}]) {
  assert.throws(()=>createInspectionSnapshot(bad));
 }
});
test('allow unknown dimensions for undecoded held photo, without inventing size or score',()=>{
 const r=createHeldSnapshot({id:'held',sourceId:'sha256:abc',createdAt:'2026-10-28T07:00:00Z',
  width:null,height:null,report:{status:'hold',reasonCodes:['image_decode_failed']}});
 assert.equal(r.status,'held'); assert.equal(r.width,null); assert.equal(r.score,null); assert.equal(r.candidate,null);
});
test('rejected held snapshot cannot silently include a score or pretend inference',()=>{
 assert.throws(()=>createInspectionSnapshot({...base(),status:'held',failureReasons:['underexposed']}));
 assert.throws(()=>createHeldSnapshot({id:'held',sourceId:'sha256:abc',createdAt:'2026-10-28T07:00:00Z',report:{reasonCodes:[]}}));
});
test('inference snapshot copies relevant metadata without serializing model tensors',()=>{
 const {id,sourceId,createdAt,...rest}=base();
 const r=createInferredSnapshot({id,sourceId,createdAt,inference:{width:rest.width,height:rest.height,crop:rest.roi,
  score:rest.score,threshold:rest.threshold,candidate:rest.candidate,quality:rest.quality,modelIds:rest.modelIds,elapsedMs:rest.elapsedMs,
  map:{values:new Float32Array(224*224)}}});
 assert.equal(r.roi.width,400);assert.equal('map' in r,false);
});
test('AI pipeline persists genuine inference once and returns only after commit',async()=>{
 const saved=[];const repository={fingerprint:async()=> 'sha256:test',save:async entry=>{saved.push(entry);}};
 const infer=async()=>({width:1024,height:768,crop:{x:100,y:100,width:300,height:300},score:1.2,threshold:null,
 candidate:{code:'review_required',isFinalVerdict:false,reasonCodes:['calibration_missing']},quality:{status:'preflight_ok'},modelIds:['v1'],elapsedMs:30});
 const service=createInspectionService({repository,infer,uuid:()=> 'id-1',clock:()=> '2026-10-28T07:00:00Z'});
 const data=await service.inspectAndSave({file:new Blob(['ok'],{type:'image/png'})});
 assert.equal(data.id,'id-1');assert.equal(data.humanVerdict,null);assert.equal(saved.length,1);assert.equal(saved[0].snapshot.status,'inferred');
});
test('quality hold persists as held without false AI score, but model failure never persists',async()=>{
 const saved=[];const repository={fingerprint:async()=> 'sha256:test',save:async entry=>saved.push(entry)};
 let infer=async()=>{throw new ImageQualityHoldError({status:'hold',reasonCodes:['underexposed']});};
 const service=createInspectionService({repository,infer,uuid:()=> 'held-1',clock:()=> '2026-10-28T07:00:00Z'});
 const result=await service.inspectAndSave({file:new Blob(['dark'],{type:'image/png'})});
 assert.equal(result.status,'held');assert.equal(result.score,null);assert.equal(result.width,null);assert.deepEqual(result.failureReasons,['underexposed']);
 infer=async()=>{throw new Error('ONNX crashed');};
 const fail=createInspectionService({repository,infer,uuid:()=> 'id-2',clock:()=> '2026-10-28T07:00:00Z'});
 await assert.rejects(()=>fail.inspectAndSave({file:new Blob(['something'],{type:'image/png'})}),/ONNX crashed/);
 assert.equal(saved.length,1);
});
test('ROI inference snapshot preserves reviewed geometry transform without automatic approval',()=>{
 const roi={x:100,y:200,width:280,height:230,rotationDegrees:15,source:'user_selected_unverified',modelSize:224};
 const inference={width:1400,height:950,crop:{x:100,y:200,width:280,height:230},roiTransform:roi,
  score:2,threshold:null,candidate:{code:'review_required',isFinalVerdict:false,reasonCodes:['roi_unverified']},
  quality:{status:'preflight_ok'},modelIds:['model'],elapsedMs:18};
 const saved=createInferredSnapshot({id:'rotated',sourceId:'sha256:abc',createdAt:'2026-10-28T07:00:00Z',inference});
 assert.deepEqual(saved.roiTransform,roi);assert.equal(saved.schemaVersion,2);assert.equal(saved.humanVerdict,null);
 assert.throws(()=>createInspectionSnapshot({...saved,roiTransform:{...roi,rotationDegrees:181}}),/rotation|valid/);
 assert.throws(()=>createInspectionSnapshot({...saved,roiTransform:{...roi,x:99}}),/differs/);
});
test('inspection adapter forwards optional ROI without treating it as verified',async()=>{
 const saved=[];let seen;
 const repository={fingerprint:async()=> 'sha256:test',save:async entry=>{saved.push(entry);}};
 const service=createInspectionService({repository,infer:async(file,options)=>{
  seen=options;return {width:1000,height:700,crop:{x:100,y:80,width:240,height:240},score:2.1,
  threshold:null,candidate:{code:'review_required',isFinalVerdict:false,reasonCodes:['roi_unverified']},modelIds:['v1'],elapsedMs:15};
 },uuid:()=> 'roi-pass',clock:()=> '2026-10-28T07:00:00Z'});
 const roi={x:100,y:80,width:240,height:240};
 await service.inspectAndSave({file:new Blob(['content'],{type:'image/png'}),roi});
 assert.deepEqual(seen,{roi});assert.equal(saved.length,1);
});
