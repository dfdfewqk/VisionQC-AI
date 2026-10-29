/** Durable, revisioned LOT/product registry, separate from immutable AI snapshots. */
import {LOT_STORE,PRODUCT_STORE,LINK_STORE,AUDIT_STORE,code,source,quantity,revision,actor,checkRevision,changed} from './lotProductModel.mjs';
const yes=v=>typeof v==='string'&&v.trim().length>0;
function req(r){return new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error??new Error('조회 실패'));});}
function write(db,names,fn){
  const tx=db.transaction(names,'readwrite');
  return new Promise((ok,no)=>{
    let output,failure;
    tx.oncomplete=()=>ok(output);
    tx.onerror=()=>{failure??=tx.error;};
    tx.onabort=()=>no(failure??tx.error??new Error('LOT/제품 변경 트랜잭션 취소'));
    const done=v=>{output=v;};
    const fail=e=>{failure=e;try{tx.abort();}catch{no(e);}};
    try{fn(tx,done,fail);}catch(e){fail(e);}
  });
}
/** @param {{db:IDBDatabase,uuid?:()=>string,clock?:()=>string}} options */
export function createLotProductRepository({db,uuid=()=>globalThis.crypto.randomUUID(),clock=()=>new Date().toISOString()}={}){
  if(!db?.transaction||![LOT_STORE,PRODUCT_STORE,LINK_STORE,AUDIT_STORE].every(x=>db.objectStoreNames.contains(x)))throw new TypeError('IndexedDB v4 LOT/제품 관리가 필요합니다.');
  function key(prefix){const k=uuid();if(!yes(k)||k.length>160)throw new TypeError('Invalid identity ID');return prefix+'-'+k;}
  function when(){const t=clock();if(!yes(t)||!Number.isFinite(Date.parse(t)))throw new TypeError('Invalid timestamp');return t;}
  function audit(tx,type,k,next,previous,before,after,person,why,t,eventId){
    tx.objectStore(AUDIT_STORE).add({id:eventId,entityType:type,entityKey:k,revision:next,
      previousEventId:previous??null,operatorName:person,reason:why,recordedAt:t,before,after});
  }
  const api={
    registerLot({lotId,plannedQuantity=null,sourceType='user',operatorName,reason}={}){
      const c=code(lotId),q=quantity(plannedQuantity),s=source(sourceType),a=actor(operatorName,reason),k=key('lot'),e=key('audit'),t=when();
      return write(db,[LOT_STORE,AUDIT_STORE],(tx,done)=>{
        const result={key:k,code:c,plannedQuantity:q,sourceType:s,revision:1,createdAt:t,updatedAt:t,lastEventId:e};
        tx.objectStore(LOT_STORE).add(result);
        audit(tx,'lot',k,1,null,null,{code:c,plannedQuantity:q,sourceType:s},a.operatorName,a.reason,t,e);done(result);
      });
    },
    changeLot({lotKey,expectedRevision,lotId,plannedQuantity,operatorName,reason}={}){
      if(!yes(lotKey))throw new TypeError('LOT key required');revision(expectedRevision);const a=actor(operatorName,reason);
      const c=lotId===undefined?undefined:code(lotId),q=plannedQuantity===undefined?undefined:quantity(plannedQuantity),e=key('audit'),t=when();
      return write(db,[LOT_STORE,AUDIT_STORE],(tx,done,fail)=>{
        const s=tx.objectStore(LOT_STORE),r=s.get(lotKey);
        r.onsuccess=()=>{try{
          const old=r.result;if(!old)throw new Error('LOT가 존재하지 않습니다.');checkRevision(old,expectedRevision);
          const before={code:old.code,plannedQuantity:old.plannedQuantity,sourceType:old.sourceType};
          const after={code:c??old.code,plannedQuantity:q===undefined?old.plannedQuantity:q,sourceType:old.sourceType};changed(before,after);
          const next={...old,code:after.code,plannedQuantity:after.plannedQuantity,revision:old.revision+1,updatedAt:t,lastEventId:e};
          s.put(next);audit(tx,'lot',lotKey,next.revision,old.lastEventId,before,after,a.operatorName,a.reason,t,e);done(next);
        }catch(err){fail(err);}};
      });
    },
    registerProduct({lotKey,productId,operatorName,reason}={}){
      if(!yes(lotKey))throw new TypeError('LOT key required');const c=code(productId),a=actor(operatorName,reason),k=key('product'),e=key('audit'),t=when();
      return write(db,[LOT_STORE,PRODUCT_STORE,AUDIT_STORE],(tx,done,fail)=>{
        const r=tx.objectStore(LOT_STORE).get(lotKey);
        r.onsuccess=()=>{try{
          if(!r.result)throw new Error('LOT를 먼저 등록해 주세요.');
          const p={key:k,lotKey,code:c,sourceType:r.result.sourceType,revision:1,createdAt:t,updatedAt:t,lastEventId:e};
          tx.objectStore(PRODUCT_STORE).add(p);
          audit(tx,'product',k,1,null,null,{lotKey,code:c,sourceType:p.sourceType},a.operatorName,a.reason,t,e);done(p);
        }catch(err){fail(err);}};
      });
    },
    changeProduct({productKey,productId,expectedRevision,operatorName,reason}={}){
      if(!yes(productKey))throw new TypeError('Product key required');revision(expectedRevision);
      const c=code(productId),a=actor(operatorName,reason),e=key('audit'),t=when();
      return write(db,[PRODUCT_STORE,AUDIT_STORE],(tx,done,fail)=>{
        const s=tx.objectStore(PRODUCT_STORE),r=s.get(productKey);
        r.onsuccess=()=>{try{
          const old=r.result;if(!old)throw new Error('제품 기록이 존재하지 않습니다.');checkRevision(old,expectedRevision);
          const before={lotKey:old.lotKey,code:old.code,sourceType:old.sourceType},after={...before,code:c};
          changed(before,after);
          const next={...old,code:c,revision:old.revision+1,updatedAt:t,lastEventId:e};
          s.put(next);audit(tx,'product',productKey,next.revision,old.lastEventId,before,after,a.operatorName,a.reason,t,e);done(next);
        }catch(err){fail(err);}};
      });
    },
    assignInspection({inspectionId,productKey,expectedRevision,operatorName,reason}={}){
      if(!yes(inspectionId)||!(productKey===null||yes(productKey)))throw new TypeError('Inspection ID and product key required');
      revision(expectedRevision);const a=actor(operatorName,reason),e=key('audit'),t=when();
      return write(db,['inspections',LOT_STORE,PRODUCT_STORE,LINK_STORE,AUDIT_STORE],(tx,done,fail)=>{
        const scan=tx.objectStore('inspections').get(inspectionId);
        scan.onsuccess=()=>{try{
          const inspection=scan.result;if(!inspection)throw new Error('검사 기록이 존재하지 않습니다.');
          const link=tx.objectStore(LINK_STORE).get(inspectionId);
          link.onsuccess=()=>{try{
            const current=link.result??null;checkRevision(current,expectedRevision);
            const before=current?{lotKey:current.lotKey,productKey:current.productKey}:null;
            const finish=(product,lot)=>{try{
              if(product&&(product.sourceType!==inspection.sourceType||lot?.sourceType!==inspection.sourceType||product.lotKey!==lot.key))throw new Error('검사 데이터 출처와 LOT/제품 출처가 일치하지 않습니다.');
              const after=product?{lotKey:lot.key,productKey:product.key}:null;changed(before,after);
              const rev=(current?.revision??0)+1;
              const result={inspectionId,lotKey:lot?.key??null,productKey:product?.key??null,
                sourceType:inspection.sourceType,revision:rev,updatedAt:t,lastEventId:e};
              tx.objectStore(LINK_STORE).put(result);
              audit(tx,'inspection',inspectionId,rev,current?.lastEventId,before,after,a.operatorName,a.reason,t,e);done(result);
            }catch(err){fail(err);}};
            if(productKey===null){finish(null,null);return;}
            const r=tx.objectStore(PRODUCT_STORE).get(productKey);
            r.onsuccess=()=>{try{if(!r.result)throw new Error('제품이 등록되지 않았습니다.');
              const lr=tx.objectStore(LOT_STORE).get(r.result.lotKey);
              lr.onsuccess=()=>{try{if(!lr.result)throw new Error('제품 LOT가 없습니다.');finish(r.result,lr.result);}catch(err){fail(err);}};
            }catch(err){fail(err);}};
          }catch(err){fail(err);}};
        }catch(err){fail(err);}};
      });
    },
    getLot(k){if(!yes(k))throw new TypeError('LOT key required');return req(db.transaction(LOT_STORE,'readonly').objectStore(LOT_STORE).get(k)).then(x=>x??null);},
    getProduct(k){if(!yes(k))throw new TypeError('Product key required');return req(db.transaction(PRODUCT_STORE,'readonly').objectStore(PRODUCT_STORE).get(k)).then(x=>x??null);},
    getInspectionIdentity(k){if(!yes(k))throw new TypeError('Inspection key required');return req(db.transaction(LINK_STORE,'readonly').objectStore(LINK_STORE).get(k)).then(x=>x??null);},
    listLots({sourceType='user'}={}){const s=source(sourceType);return req(db.transaction(LOT_STORE,'readonly').objectStore(LOT_STORE).getAll()).then(rows=>rows.filter(x=>x.sourceType===s).sort((a,b)=>a.code.localeCompare(b.code)));},
    listProducts({lotKey}={}){if(!yes(lotKey))throw new TypeError('LOT key required');return req(db.transaction(PRODUCT_STORE,'readonly').objectStore(PRODUCT_STORE).index('byLot').getAll(lotKey)).then(rows=>rows.sort((a,b)=>a.code.localeCompare(b.code)));},
    history({entityType,entityKey}={}){if(!['lot','product','inspection'].includes(entityType)||!yes(entityKey))throw new TypeError('Invalid audit history query');
      return req(db.transaction(AUDIT_STORE,'readonly').objectStore(AUDIT_STORE).index('byEntity').getAll([entityType,entityKey])).then(rows=>rows.sort((a,b)=>a.revision-b.revision));},
    async lotOverview({lotKey}={}){const lot=await api.getLot(lotKey);if(!lot)return null;
      return {lot,declaredProductRecords:(await api.listProducts({lotKey})).length,plannedQuantity:lot.plannedQuantity,
        confirmedPhysicalProductCount:null,confirmedPhysicalDefectRate:null};}
  };
  return Object.freeze(api);
}
