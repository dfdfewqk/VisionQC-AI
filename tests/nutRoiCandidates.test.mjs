import test from 'node:test';
import assert from 'node:assert/strict';
import {findForegroundRoiCandidates} from '../src/detection/nutRoiCandidates.mjs';
function image(width=128,height=128){
 const rgba=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<rgba.length;i+=4){rgba[i]=235;rgba[i+1]=235;rgba[i+2]=235;rgba[i+3]=255;}
 const rect=(x,y,w,h)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){
   const i=(yy*width+xx)*4;rgba[i]=40;rgba[i+1]=40;rgba[i+2]=40;
 }};
 return {rgba,rect};
}
test('plain background yields no fabricated ROI',()=>{
 const {rgba}=image();assert.deepEqual(findForegroundRoiCandidates({width:128,height:128,rgba,sourceWidth:1024,sourceHeight:1024}),[]);
});
test('one isolated foreground item yields conservative unverified region',()=>{
 const {rgba,rect}=image();rect(39,37,50,50);
 const results=findForegroundRoiCandidates({width:128,height:128,rgba,sourceWidth:1024,sourceHeight:1024});
 assert.equal(results.length,1);assert.ok(results[0].x<39*8);assert.ok(results[0].width>=400);
 assert.equal(results[0].source,'foreground_suggestion_unverified');
});
test('two separated regions have separate proposed ROIs',()=>{
 const {rgba,rect}=image(256,128);rect(45,35,45,48);rect(161,35,47,48);
 const v=findForegroundRoiCandidates({width:256,height:128,rgba,sourceWidth:1536,sourceHeight:768});
 assert.equal(v.length,2);assert.notEqual(v[0].x,v[1].x);
});
test('small or clipped component is never offered as a validated ROI',()=>{
 const {rgba,rect}=image();rect(51,51,16,16);
 const v=findForegroundRoiCandidates({width:128,height:128,rgba,sourceWidth:512,sourceHeight:512});
 assert.deepEqual(v,[]);
});
test('invalid pixel data is rejected with no guessing',()=>{
 assert.deepEqual(findForegroundRoiCandidates({width:128,height:128,rgba:new Uint8Array(20)}),[]);
});
