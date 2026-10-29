/** Chromium smoke test for the actual compiled React UI, camera and IndexedDB UX.
 * Never downloads model weights and does not claim ONNX inference validation. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const context=await browser.newContext({permissions:['camera'],viewport:{width:1380,height:900}});
const page=await context.newPage();
page.on('pageerror',err=>{process.stderr.write(`Browser page error: ${err.stack||err}\n`);});
const root=process.env.WEB_BASE_URL||'http://127.0.0.1:5173/';
try{
  await page.goto(root,{waitUntil:'networkidle',timeout:60000});
  await page.locator('.connection.good').waitFor({timeout:30000});
  await page.getByRole('heading',{name:'너트 AI 검사'}).waitFor();
  await page.getByRole('button',{name:'카메라로 촬영'}).click();
  await page.getByRole('button',{name:'카메라 켜기'}).click();
  await page.getByRole('button',{name:'촬영 후 바로 검사'}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'카메라 끄기'}).click();
  await page.getByRole('button',{name:'촬영창 닫기'}).click();
  const file=page.locator('.file-drop input[type=file]');
  const png=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=320;const ctx=canvas.getContext('2d');
    const gradient=ctx.createLinearGradient(0,0,320,320);gradient.addColorStop(0,'#194477');gradient.addColorStop(1,'#d8eef8');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,320,320);return canvas.toDataURL('image/png').split(',')[1];
  }),'base64');
  await file.setInputFiles({name:'smoke.png',mimeType:'image/png',buffer:png});
  await page.locator('.roi-stage').waitFor();
  const stage=await page.locator('.roi-stage').boundingBox();
  assert.ok(stage?.width>100,'ROI image should render');
  await page.mouse.move(stage.x+stage.width*0.08,stage.y+stage.height*0.08);
  await page.mouse.down();
  await page.mouse.move(stage.x+stage.width*0.91,stage.y+stage.height*0.91,{steps:9});
  await page.mouse.up();
  await page.getByText(/선택 위치/).waitFor();
  // Insert a local data fixture in the real browser database; this verifies
  // the persisted-history and worker-review UI without faking a model score.
  await page.evaluate(async bytes=>{
    const raw=Uint8Array.from(atob(bytes),c=>c.charCodeAt(0));
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('visionqc-inspections-v1',4);
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    const tx=db.transaction(['sourceImages','inspections'],'readwrite');
    const sourceId='sha256:browser-smoke-source';
    tx.objectStore('sourceImages').add({id:sourceId,hash:'browser-smoke-source',blob:new Blob([raw],{type:'image/png'}),type:'image/png',bytes:raw.length});
    tx.objectStore('inspections').add({schemaVersion:3,id:'browser-smoke-001',sourceId,sourceType:'user',createdAt:'2026-10-29T00:00:00.000Z',
      status:'held',width:null,height:null,roi:null,roiTransform:null,score:null,threshold:null,candidate:null,
      quality:{status:'hold',reasonCodes:['low_light']},modelIds:[],elapsedMs:null,failureReasons:['low_light'],lotId:null,productId:null,
      reinspectionOf:null,humanVerdict:null});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});
    db.close();
  },png.toString('base64'));
  await page.getByRole('button',{name:/검사 기록/}).click();
  await page.getByText('browser-smoke-001').waitFor({timeout:15000});
  await page.getByRole('button',{name:'상세 열기'}).click();
  await page.getByText('사진 품질 보류').first().waitFor();
  await page.getByPlaceholder('예: 작업자 A').fill('브라우저 점검자');
  await page.getByPlaceholder('확인한 부위와 판정 근거를 입력하세요').fill('촬영 상태 불량: 재촬영');
  await page.getByLabel('확정 판정').selectOption('reinspection');
  await page.getByRole('button',{name:'최종 판정 이력 저장'}).click();
  await page.getByText('촬영 상태 불량: 재촬영').waitFor({timeout:15000});
  await page.getByRole('button',{name:/품질 현황/}).click();
  await page.getByRole('heading',{name:'검사 통계'}).waitFor();
  await page.getByRole('button',{name:/검사 작업대/}).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'이 검사 기록 삭제'}).click();
  await page.getByText(/선택한 검사 기록을 삭제했습니다/).waitFor({timeout:20000});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.connection.good').waitFor({timeout:30000});
  await page.getByRole('button',{name:/검사 기록/}).click();
  await page.getByText('browser-smoke-001').waitFor({state:'detached',timeout:10000});
  console.log('Browser smoke passed: camera permission, upload/ROI, IndexedDB history/detail, worker audit, stats, delete, reload.');
}finally{await browser.close();}
