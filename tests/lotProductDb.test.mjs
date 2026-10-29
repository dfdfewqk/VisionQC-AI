import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {webcrypto} from 'node:crypto';
import {openInspectionDatabase,createInspectionRepository,DB_VERSION} from '../src/storage/inspectionDb.mjs';
import {createInspectionSnapshot} from '../src/storage/inspectionModel.mjs';
import {createLotProductRepository} from '../src/storage/lotProductDb.mjs';
let num=0;
async function setup(){
 const db=await openInspectionDatabase({indexedDB,name:'visionqc-identity-test-'+(++num)});
 let i=0;
 const x=createLotProductRepository({db,uuid:()=>String(++i),clock:()=>new Date('2026-10-29T09:00:00Z').toISOString()});
 const scans=createInspectionRepository({db,cryptoImpl:webcrypto});
 const lot=(lotId='L1',sourceType='user')=>x.registerLot({lotId,sourceType,operatorName:'operator',reason:'등록'});
 const product=(lotKey,productId='P1')=>x.registerProduct({lotKey,productId,operatorName:'operator',reason:'제품 등록'});
 const edit=(lotKey,expectedRevision=1,lotId='L2')=>x.changeLot({lotKey,lotId,expectedRevision,operatorName:'operator',reason:'정정'});
 const scan=async(id,sourceType='user')=>{
   const file=new Blob(['photo-'+id],{type:'image/png'}),sourceId=await scans.fingerprint(file);
   await scans.save({file,snapshot:createInspectionSnapshot({id,sourceId,sourceType,status:'inferred',
     createdAt:'2026-10-29T09:00:00Z',width:800,height:900,roi:{x:0,y:0,width:256,height:256},
     score:1.2,modelIds:['test'],elapsedMs:1,candidate:{code:'review_required',reasonCodes:['uncalibrated'],isFinalVerdict:false}})});
 };
 const assign=(inspectionId,productKey,expectedRevision=0)=>x.assignInspection({inspectionId,productKey,expectedRevision,operatorName:'operator',reason:'식별 정정'});
 return {db,x,scans,lot,product,edit,scan,assign};
}
test('v3 to v4 retains previous inspection queue and human review',async()=>{
 const name='visionqc-identity-migrate-'+(++num);
 const old=await new Promise((ok,no)=>{
  const r=indexedDB.open(name,3);
  r.onupgradeneeded=()=>{
   const db=r.result;db.createObjectStore('sourceImages',{keyPath:'id'});
   const scans=db.createObjectStore('inspections',{keyPath:'id'});scans.createIndex('bySource','sourceId');scans.createIndex('byCreatedAt','createdAt');
   db.createObjectStore('heatmaps',{keyPath:'inspectionId'});db.createObjectStore('inspectionQueue',{keyPath:'id'});
   const reviews=db.createObjectStore('humanReviewEvents',{keyPath:'id'});reviews.createIndex('byInspection','inspectionId');
  };r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);
 });
 await new Promise((ok,no)=>{
  const tx=old.transaction(['inspections','inspectionQueue','humanReviewEvents'],'readwrite');
  tx.objectStore('inspections').add({id:'scan-old',sourceType:'user'});
  tx.objectStore('inspectionQueue').add({id:'queue-old'});
  tx.objectStore('humanReviewEvents').add({id:'review-old',inspectionId:'scan-old'});
  tx.oncomplete=ok;tx.onabort=()=>no(tx.error);
 });old.close();
 const db=await openInspectionDatabase({indexedDB,name});
 assert.equal(db.version,4);assert.equal(DB_VERSION,4);
 for(const name of ['lotRegistry','productRegistry','inspectionIdentity','identityAudit'])assert.ok(db.objectStoreNames.contains(name));
 const tx=db.transaction(['inspections','inspectionQueue','humanReviewEvents'],'readonly');
 const values=await Promise.all(['inspections','inspectionQueue','humanReviewEvents'].map(name=>new Promise((ok,no)=>{
  const q=tx.objectStore(name).getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);
 })));
 assert.deepEqual(values.map(x=>x.length),[1,1,1]);db.close();
});
test('LOT registration and rename record both revisions without mutating past event',async()=>{
 const {db,x,lot,edit}=await setup();const a=await lot(),b=await edit(a.key,1,'L2');
 assert.equal(b.revision,2);assert.equal((await x.getLot(a.key)).code,'L2');
 const history=await x.history({entityType:'lot',entityKey:a.key});
 assert.deepEqual(history.map(x=>x.after.code),['L1','L2']);db.close();
});
test('LOT names are unique per source but demo and user may share labels',async()=>{
 const {db,x,lot}=await setup();await lot('A');await assert.rejects(()=>lot('A'));await lot('A','demo');
 assert.equal((await x.listLots({sourceType:'user'})).length,1);
 assert.equal((await x.listLots({sourceType:'demo'})).length,1);db.close();
});
test('product codes are unique per LOT, and renames retain a stable key',async()=>{
 const {db,x,lot,product}=await setup();const l=await lot(),m=await lot('L2');
 const a=await product(l.key,'P1');await assert.rejects(()=>product(l.key,'P1'));await product(m.key,'P1');
 const edited=await x.changeProduct({productKey:a.key,productId:'P2',expectedRevision:1,operatorName:'operator',reason:'잘못된 번호'});
 assert.equal(edited.key,a.key);assert.equal(edited.code,'P2');
 assert.equal((await x.history({entityType:'product',entityKey:a.key})).length,2);db.close();
});
test('stale LOT update and rename uniqueness collision are atomic',async()=>{
 const {db,x,lot,edit}=await setup();const a=await lot(),b=await lot('L2');
 await assert.rejects(()=>edit(a.key,0,'L3'),e=>e.code==='identity_revision_conflict');
 await assert.rejects(()=>edit(a.key,1,'L2'));
 assert.equal((await x.getLot(a.key)).code,'L1');
 assert.equal((await x.history({entityType:'lot',entityKey:a.key})).length,1);db.close();
});
test('explicit assignment and correction only update identity link, not AI scan',async()=>{
 const {db,x,scans,lot,product,scan,assign}=await setup();
 await scan('s1');const l=await lot(),a=await product(l.key,'A'),b=await product(l.key,'B');
 const first=await assign('s1',a.key),second=await assign('s1',b.key,1);
 assert.equal(first.revision,1);assert.equal(second.revision,2);
 const h=await x.history({entityType:'inspection',entityKey:'s1'});
 assert.equal(h[0].after.productKey,a.key);assert.equal(h[1].before.productKey,a.key);
 assert.equal((await scans.get('s1')).inspection.productId,null);db.close();
});
test('unassign is audited, and cross-source/missing-scan assignments fail closed',async()=>{
 const {db,x,lot,product,scan,assign}=await setup();
 await scan('demo','demo');await scan('user','user');const l=await lot(),p=await product(l.key);
 await assert.rejects(()=>assign('demo',p.key),/출처/);
 await assert.rejects(()=>assign('unknown',p.key),/검사/);
 await assign('user',p.key);
 const unassigned=await assign('user',null,1);assert.equal(unassigned.productKey,null);
 assert.equal((await x.history({entityType:'inspection',entityKey:'user'})).length,2);db.close();
});
test('two competing inspection assignments cannot both overwrite the current version',async()=>{
 const {db,x,lot,product,scan,assign}=await setup();
 await scan('s');const l=await lot(),p=await product(l.key);await assign('s',p.key);
 const results=await Promise.allSettled([assign('s',null,1),assign('s',null,1)]);
 assert.deepEqual(results.map(v=>v.status).sort(),['fulfilled','rejected']);
 assert.equal((await x.history({entityType:'inspection',entityKey:'s'})).length,2);db.close();
});
test('explicit inspection deletion also removes attached identity link and only its own audit trail',async()=>{
 const {db,x,scans,lot,product,scan,assign}=await setup();
 await scan('s');const l=await lot(),p=await product(l.key);await assign('s',p.key);
 assert.equal(await scans.remove('s'),true);
 assert.equal(await x.getInspectionIdentity('s'),null);
 assert.equal((await x.history({entityType:'inspection',entityKey:'s'})).length,0);
 assert.ok(await x.getLot(l.key));assert.ok(await x.getProduct(p.key));db.close();
});
test('declared LOT product registrations are not proof of manufactured items or real defect rate',async()=>{
 const {db,x,lot,product}=await setup();const l=await lot();await product(l.key);
 const r=await x.lotOverview({lotKey:l.key});
 assert.equal(r.declaredProductRecords,1);assert.equal(r.plannedQuantity,null);
 assert.equal(r.confirmedPhysicalProductCount,null);assert.equal(r.confirmedPhysicalDefectRate,null);db.close();
});
