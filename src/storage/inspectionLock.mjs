/**
 * One active VisionQC inspection tab per origin / browser profile.
 * Chromium Web Locks serialize ownership across tabs; lease persists until close.
 * No ownership is claimed when browser locks are unavailable or already held.
 */
export const INSPECTION_LOCK_NAME = 'visionqc-active-inspection-v1';
export class InspectionAlreadyActiveError extends Error {
  constructor(message='같은 브라우저에서 다른 검사 탭이 이미 실행 중입니다. 다른 탭의 검사를 종료해 주세요.') {
    super(message);this.name='InspectionAlreadyActiveError';this.code='inspection_tab_busy';
  }
}
export async function acquireInspectionTabLock({locks=globalThis.navigator?.locks}={}) {
  if (!locks?.request) throw new Error('활성 검사 탭 중복 방지를 지원하지 않는 브라우저입니다. Chrome 최신 버전에서 실행해 주세요.');
  let releaseLease=()=>{};
  const lease=new Promise(resolve=>{releaseLease=resolve});
  let finishAcquisition;
  const acquired=new Promise(resolve=>{finishAcquisition=resolve});
  let settled=false;
  const task=locks.request(INSPECTION_LOCK_NAME,{mode:'exclusive',ifAvailable:true},async lock=>{
    settled=true;
    if (!lock){finishAcquisition(false);return;}
    finishAcquisition(true);
    await lease;
  });
  // Handle provider rejection before it enters the callback; never hang here.
  task.catch(error=>{if(!settled){settled=true;finishAcquisition(error)}});
  const result=await acquired;
  if(result!==true){
    if(result===false)throw new InspectionAlreadyActiveError();
    throw result;
  }
  let closed=false;
  return {async release(){if(closed)return;closed=true;releaseLease();await task;}};
}
