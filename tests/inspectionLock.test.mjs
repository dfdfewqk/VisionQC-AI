import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireInspectionTabLock,InspectionAlreadyActiveError} from '../src/storage/inspectionLock.mjs';

function mockLocks(){
 let busy=false;
 return {request:async(name,opts,cb)=>{
  assert.equal(name,'visionqc-active-inspection-v1');assert.deepEqual(opts,{mode:'exclusive',ifAvailable:true});
  if(busy)return cb(null);
  busy=true;
  try{return await cb({name})}finally{busy=false}
 }};
}
test('one inspection tab obtains lease, second is blocked, release allows new tab',async()=>{
 const locks=mockLocks();const a=await acquireInspectionTabLock({locks});
 await assert.rejects(()=>acquireInspectionTabLock({locks}),InspectionAlreadyActiveError);
 await a.release();
 const b=await acquireInspectionTabLock({locks});
 await b.release();await b.release();
});
test('missing browser Web Locks is explicit error rather than silently allowing concurrent inspections',async()=>{
 await assert.rejects(()=>acquireInspectionTabLock({locks:null}),/지원하지 않는/);
});
test('locking failures reject without hanging',async()=>{
 await assert.rejects(()=>acquireInspectionTabLock({locks:{request:()=>Promise.reject(new Error('denied'))}}),/denied/);
});
