import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRoiSelection,modelToSource,sourceToModel,applySourceToModelCanvas,applyModelToSourceCanvas} from '../src/ai/roiGeometry.mjs';
const region={x:250,y:150,width:240,height:160,rotationDegrees:30};
test('source image ROI validation accepts a rotated interior ROI',()=>{
  assert.deepEqual(validateRoiSelection(region,1200,900),region);
});
test('model/source coordinates form a round trip for non-square rotated ROI',()=>{
  for(const [x,y] of [[0,0],[224,224],[112,112],[180,42]]){
    const pt=modelToSource(region,x,y);
    const back=sourceToModel(region,pt.x,pt.y);
    assert.ok(Math.abs(back.x-x)<1e-9);
    assert.ok(Math.abs(back.y-y)<1e-9);
  }
});
test('right angle rotates source coverage without altering center',()=>{
  const r={x:400,y:500,width:200,height:100,rotationDegrees:90};
  assert.deepEqual(modelToSource(r,112,112),{x:500,y:550});
  const edge=modelToSource(r,224,112);assert.ok(Math.abs(edge.x-500)<1e-9);assert.ok(Math.abs(edge.y-650)<1e-9);
});
test('rejects invalid, off-image, out-of-range, or clipped rotated rectangles',()=>{
  for(const bad of [null,{...region,width:0},{...region,rotationDegrees:Infinity},
    {...region,rotationDegrees:181},{...region,x:-1},{...region,x:990},
    {x:0,y:0,width:100,height:100,rotationDegrees:45}]){
    assert.throws(()=>validateRoiSelection(bad,1200,900));
  }
});
test('canvas forward and inverse pipelines use opposite rotation with matching model scale',()=>{
  const ops=()=>{const record=[];return {record,translate:(...a)=>record.push(['translate',...a]),scale:(...a)=>record.push(['scale',...a]),rotate:(...a)=>record.push(['rotate',...a])}};
  const a=ops(),b=ops();applySourceToModelCanvas(a,region);applyModelToSourceCanvas(b,region);
  assert.ok(a.record.some(x=>x[0]==='rotate'&&x[1]<0));
  assert.ok(b.record.some(x=>x[0]==='rotate'&&x[1]>0));
  assert.deepEqual(a.record.filter(x=>x[0]==='scale')[0].slice(1),[224/240,224/160]);
  assert.deepEqual(b.record.filter(x=>x[0]==='scale')[0].slice(1),[240/224,160/224]);
});
