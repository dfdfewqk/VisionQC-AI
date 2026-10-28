/** Durable, browser-local inspection queue. The queue stores source Blobs until
 *  their result commits. Only the user can restart interrupted/system-paused jobs.
 *  No queue record or stored inspection is silently deleted on startup. */

export const QUEUE_STORE_NAME = 'inspectionQueue';
export const ACTIVE_QUEUE_STATUSES = Object.freeze(['queued','running','interrupted','paused_system']);
const isText = s => typeof s === 'string' && s.trim().length > 0;
const validFile = file => file instanceof Blob && file.size > 0 &&
  ['image/jpeg','image/png','image/webp'].includes(file.type) && file.size <= 40 * 1024 * 1024;

export class InspectionQueueFullError extends Error {
  constructor() {
    super('진행 중인 검사 외에 대기 사진은 한 장만 등록할 수 있습니다.');
    this.name='InspectionQueueFullError'; this.code='inspection_queue_full';
  }
}

function requestValue(request) {
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error ?? new Error('Inspection queue request failed'));
  });
}
function transaction(db, action) {
  const tx=db.transaction(QUEUE_STORE_NAME,'readwrite');
  return new Promise((resolve,reject)=>{
    let result, error;
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>{error ??= tx.error;};
    tx.onabort=()=>reject(error ?? tx.error ?? new Error('검사 대기열 트랜잭션이 취소되었습니다.'));
    const done=v=>{result=v;};
    const fail=e=>{error=e;try{tx.abort();}catch{reject(e);}};
    try{action(tx.objectStore(QUEUE_STORE_NAME),done,fail);}catch(e){fail(e);}
  });
}
function sorted(jobs) {return jobs.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));}
function cleaned(job) {
  // Inspecting the queue never loads an original image into a UI list.
  const {file, ...meta}=job;
  return {...meta,hasSource:file instanceof Blob};
}

/** @param {{db: IDBDatabase, clock?: ()=>string, uuid?: ()=>string}} options */
export function createInspectionQueueRepository({db,clock=()=>new Date().toISOString(),uuid=()=>globalThis.crypto.randomUUID()}={}) {
  if(!db?.transaction || !db.objectStoreNames?.contains(QUEUE_STORE_NAME))
    throw new TypeError('IndexedDB v2 inspection queue is required');
  const now=()=>clock();
  const update=(id,expected,change)=>transaction(db,(store,done,fail)=>{
    const request=store.get(id);
    request.onsuccess=()=>{
      const record=request.result;
      if(!record || !expected.includes(record.status)) {fail(new Error('검사 대기열 상태가 변경되었습니다.'));return;}
      const next={...record,...change,updatedAt:now()};
      store.put(next);done(cleaned(next));
    };
  });
  return {
    async enqueue({file,sourceType='user',roi=null,lotId=null,productId=null,reinspectionOf=null}={}) {
      if(!validFile(file) || !['user','demo'].includes(sourceType) ||
        [lotId,productId,reinspectionOf].some(v=>v!==null&&!isText(v)))
        throw new TypeError('검사 사진 형식·크기 또는 등록 정보가 유효하지 않습니다.');
      if(roi!==null && (!['x','y','width','height'].every(k=>Number.isFinite(roi[k])) ||
        roi.width<=0 || roi.height<=0 ||
        (roi.rotationDegrees!==undefined&&!Number.isFinite(roi.rotationDegrees))))
        throw new TypeError('ROI가 유효하지 않습니다.');
      const id=`qi-${uuid()}`;const createdAt=now();
      if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id))throw new TypeError('유효하지 않은 검사 ID');
      return transaction(db,(store,done,fail)=>{
        const request=store.getAll();
        request.onsuccess=()=>{
          const active=request.result.filter(j=>ACTIVE_QUEUE_STATUSES.includes(j.status));
          if(active.length>=2||active.some(j=>j.status==='queued')){fail(new InspectionQueueFullError());return;}
          const job={id,file,sourceType,roi,lotId,productId,reinspectionOf,status:'queued',
            createdAt,updatedAt:createdAt,recordId:null,errorMessage:null,errorCode:null};
          store.add(job);done(cleaned(job));
        };
      });
    },
    async list({includeCompleted=true}={}) {
      const tx=db.transaction(QUEUE_STORE_NAME,'readonly');
      const rows=await requestValue(tx.objectStore(QUEUE_STORE_NAME).getAll());
      return sorted(rows).filter(j=>includeCompleted || ACTIVE_QUEUE_STATUSES.includes(j.status)).map(cleaned);
    },
    /** Called only after acquiring the one-active-tab Web Lock. */
    recoverInterrupted() {
      return transaction(db,(store,done)=>{
        const request=store.getAll();
        request.onsuccess=()=>{
          let recovered=0;
          for(const job of request.result){
            if(job.status==='running'){
              store.put({...job,status:'interrupted',updatedAt:now()});recovered++;
            }
          }
          done(recovered);
        };
      });
    },
    claimNext() {
      return transaction(db,(store,done,fail)=>{
        const request=store.getAll();
        request.onsuccess=()=>{
          const rows=request.result;
          if(rows.some(j=>j.status==='running')){fail(new Error('이미 진행 중인 검사가 있습니다.'));return;}
          const next=sorted(rows.filter(j=>ACTIVE_QUEUE_STATUSES.includes(j.status)))[0];
          if(!next){done(null);return;}
          const claimed={...next,status:'running',updatedAt:now(),errorMessage:null,errorCode:null};
          store.put(claimed);done(claimed); // Blob accessible only inside the runner
        };
      });
    },
    complete(id,recordId) {
      if(!isText(recordId) || recordId!==id)throw new TypeError('검사 ID가 일치하지 않습니다.');
      return update(id,['running'],{status:'completed',recordId,file:null,errorMessage:null,errorCode:null});
    },
    markImageFailure(id,error) {
      return update(id,['running'],{status:'failed_image',errorMessage:String(error?.message ?? error),
        errorCode:String(error?.code ?? error?.name ?? 'invalid_image')});
    },
    pauseSystem(id,error) {
      return update(id,['running'],{status:'paused_system',errorMessage:String(error?.message ?? error),
        errorCode:String(error?.code ?? error?.name ?? 'system_error')});
    },
    cancel(id) {return update(id,['queued','interrupted','paused_system','failed_image'],{status:'canceled',file:null});},
    retryFailedImage(id) {return update(id,['failed_image'],{status:'interrupted',errorMessage:null,errorCode:null});},
    async get(id) {
      const tx=db.transaction(QUEUE_STORE_NAME,'readonly');
      return requestValue(tx.objectStore(QUEUE_STORE_NAME).get(id));
    },
  };
}
