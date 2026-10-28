/** Serial queue runner; no browser or hardware dependency.
 * Requires an explicit user runQueue() after reopening the app. */
export function isImageInputError(error) {
  const code=error?.code??error?.name;
  return ['image_quality_hold','image_decode_failed','invalid_image','invalid_image_type',
    'invalid_image_size','EncodingError','NotReadableError','InvalidImageError'].includes(code);
}

/** @param {{queue: any, inspectAndSave: Function, findExisting: Function}} options */
export function createInspectionQueueRunner({queue,inspectAndSave,findExisting}={}) {
  if(!queue?.claimNext || !queue?.complete || typeof inspectAndSave!=='function' ||
    typeof findExisting!=='function')throw new TypeError('Queue storage and inspection service required');
  let active=null;
  async function runQueue() {
    if(active)return active; // duplicate clicks share same worker
    active=(async()=>{
      let completed=0, failedImage=0, haltedOn=null, message=null;
      while(true){
        const job=await queue.claimNext();
        if(!job)break;
        try {
          // A crash may have happened AFTER the inspection commit but BEFORE
          // queue.complete(). Recover the stable record ID without a 2nd inference.
          const committed=await findExisting(job.id);
          if(committed?.inspection?.id===job.id){
            await queue.complete(job.id,job.id);completed++;continue;
          }
          const record=await inspectAndSave({file:job.file,sourceType:job.sourceType,
            roi:job.roi,lotId:job.lotId,productId:job.productId,
            reinspectionOf:job.reinspectionOf,inspectionId:job.id});
          if(record?.id!==job.id)throw new Error('검사 ID가 일치하지 않습니다.');
          await queue.complete(job.id,record.id);completed++;
        }catch(error){
          // If persistence succeeded but completion marking failed, keep the
          // durable job for explicit recovery; do NOT run pending work.
          if(isImageInputError(error)) {
            await queue.markImageFailure(job.id,error);
            failedImage++;continue;
          }
          await queue.pauseSystem(job.id,error);
          haltedOn=job.id;message=error instanceof Error?error.message:String(error);
          break;
        }
      }
      return Object.freeze({completed,failedImage,haltedOn,message,
        state:haltedOn?'paused_system':'idle'});
    })();
    try{return await active;}finally{active=null;}
  }
  return {runQueue};
}
