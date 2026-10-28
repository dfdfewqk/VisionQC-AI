import test from 'node:test';
import assert from 'node:assert/strict';
import {createInspectionQueueRunner,isImageInputError} from '../src/ai/inspectionQueue.mjs';

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
const job=id=>({id,file:new Blob([id],{type:'image/png'}),sourceType:'user',roi:null,lotId:null,productId:null,reinspectionOf:null});
test('duplicate Run Queue clicks share the same in-flight operation',async()=>{
 const pending=deferred();let claimed=0,invoked=0;
 const queue={claimNext:async()=>claimed++===0?job('qi-a'):null,complete:async()=>{}};
 const runner=createInspectionQueueRunner({queue,findExisting:async()=>null,
  inspectAndSave:async()=>{invoked++;await pending.promise;return {id:'qi-a'};}});
 const one=runner.runQueue(),two=runner.runQueue();
 pending.resolve();const [a,b]=await Promise.all([one,two]);
 assert.equal(a.completed,1);assert.equal(b.completed,1);assert.equal(invoked,1);
});
test('network error pauses without reclassifying it as invalid photo',async()=>{
 assert.equal(isImageInputError(Object.assign(new Error('ONNX'),{code:'network_error'})),false);
 assert.equal(isImageInputError(Object.assign(new Error('Invalid image'),{code:'image_decode_failed'})),true);
});
test('queue runner cannot be constructed with missing dependencies',()=>{
 assert.throws(()=>createInspectionQueueRunner(),/required/);
});
test('completion mismatch halts processing as system corruption',async()=>{
 let calls=0;
 const queue={claimNext:async()=>calls++===0?job('qi-one'):null,
  pauseSystem:async(id,error)=>({id,error}),complete:async()=>{}};
 const runner=createInspectionQueueRunner({queue,findExisting:async()=>null,inspectAndSave:async()=>({id:'other'})});
 const result=await runner.runQueue();assert.equal(result.state,'paused_system');assert.equal(result.haltedOn,'qi-one');
});
