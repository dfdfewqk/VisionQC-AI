/** Real Chromium -> published PatchCore model ONNX smoke.
 * Synthetic input only verifies WASM/CORS/shape/persistence wiring.
 * It does not establish any defect-detection accuracy. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1360,height:900}});
page.on('pageerror',e=>console.error('BROWSER ERROR',e));
page.on('requestfailed',request=>console.error('FETCH FAILED',request.url().slice(0,250),request.failure()?.errorText));
page.on('console',msg=>{if(['error','warning'].includes(msg.type()))console.log('BROWSER CONSOLE',msg.text().slice(0,500));});
try{
  const addr=process.env.WEB_BASE_URL||'http://127.0.0.1:5173/';
  await page.goto(addr,{waitUntil:'domcontentloaded',timeout:60_000});
  await page.locator('.connection.good').waitFor({timeout:30000});
  const base64=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
    const ctx=canvas.getContext('2d');const img=ctx.createImageData(512,512);
    for(let y=0;y<512;y++)for(let x=0;x<512;x++){
      const index=(y*512+x)*4;const nx=x-256,ny=y-256,r=Math.hypot(nx,ny),hex=Math.max(Math.abs(nx),Math.abs(.5*nx+.866*ny),Math.abs(-.5*nx+.866*ny));
      const metal=hex<146&&r>62;
      const grain=(x*23+y*19)%43;const shade=metal?125+Math.round(35*(x/512))+grain:65+grain+Math.round(30*y/512);
      img.data[index]=shade;img.data[index+1]=shade;img.data[index+2]=metal?shade+8:shade+15;img.data[index+3]=255;
    }
    ctx.putImageData(img,0,0);return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('.file-drop input').setInputFiles({name:'synthetic-nut-smoke.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')});
  await page.getByRole('button',{name:'AI 검사 및 기록 저장'}).click();
  try{
    await page.waitForFunction(() => !!document.querySelector('.results-grid') || (document.querySelector('.system-message')?.textContent ?? '').includes('검사 실패'),null,{timeout:180_000});
    if(!await page.locator('.results-grid').count())throw new Error(await page.locator('.system-message').innerText());
    const score=await page.locator('.results-grid strong').first().innerText();
    assert.ok(!['확인 불가','실행되지 않음'].includes(score),`No valid inference score: ${score}`);
    const text=await page.locator('.system-message').innerText();
    console.log('BROWSER ONNX PASS',score,text.slice(0,250));
  }catch(e){
    console.error('BROWSER ONNX FAILURE MESSAGE:',await page.locator('.system-message').innerText());
    throw e;
  }
}finally{await browser.close();}
