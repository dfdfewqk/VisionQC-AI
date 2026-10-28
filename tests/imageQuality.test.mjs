import test from 'node:test';
import assert from 'node:assert/strict';
import { assessImageQuality, assertImageQuality, inspectImageInput,
  ImageQualityHoldError, IMAGE_QUALITY_POLICY, inspectImageDimensions } from '../src/ai/imageQuality.mjs';

const N = 64;
const image = (pixel, width=1024, height=768) => {
  const rgba = new Uint8ClampedArray(N * N * 4);
  for (let y=0; y<N; y++) for (let x=0; x<N; x++) {
    const [r,g,b,a=255] = pixel(x,y);
    const i=(y*N+x)*4;
    rgba.set([r,g,b,a],i);
  }
  return {width,height,rgba,analysisWidth:N,analysisHeight:N};
};
const checker = () => image((x,y) => (x+y)%2 ? [60,60,60] : [180,180,180]);
const check = (img) => assessImageQuality(img);

test('reasonable textured source passes only preflight, never quality verification', () => {
  const result = check(checker());
  assert.equal(result.status,'preflight_ok');
  assert.equal(result.qualityVerifiedForClassification,false);
  assert.equal(result.requiresHumanReview,true);
  assert.equal(result.policyKind,'uncalibrated_center_crop_preflight');
  assert.equal(result.reasonCodes.length,0);
  assert.equal(assertImageQuality(result),result);
});
test('small image is held before model inference regardless of texture', () => {
  for (const [w,h] of [[255,400],[1000,100],[1,1000]]) {
    const r=check({...checker(),width:w,height:h});
    assert.equal(r.status,'hold');
    assert.ok(r.reasonCodes.includes('unsupported_resolution'));
    assert.throws(()=>assertImageQuality(r), e => e instanceof ImageQualityHoldError && e.code==='image_quality_hold' && e.recoverable);
  }
});
test('exact reference minimum short side is accepted',()=>{
  assert.equal(check({...checker(),width:256,height:600}).status,'preflight_ok');
});
test('black, white, very dark and very bright exposure is held', () => {
  for (const [luma,expected] of [[0,'underexposed'],[16,'underexposed'],[240,'overexposed'],[255,'overexposed']]) {
    const r=check(image(() => [luma,luma,luma]));
    assert.ok(r.reasonCodes.includes(expected));
    assert.equal(r.status,'hold');
  }
});
test('blurred gradient is conservatively held as blur OR low-texture suspicion',()=>{
  const r=check(image(x => [x*3,x*3,x*3]));
  assert.equal(r.status,'hold');
  assert.ok(r.reasonCodes.includes('suspected_blur_or_low_texture'));
  assert.ok(r.measurements.laplacianVariance < IMAGE_QUALITY_POLICY.suspectedBlurLaplacianVarianceLimit);
});
test('featureless gray image cannot be falsely approved as sharp',()=>{
  const r=check(image(()=>[128,128,128]));
  assert.ok(r.reasonCodes.includes('insufficient_visible_detail'));
});
test('transparency cannot be silently composited as black photograph',()=>{
  const r=check(image((x,y)=> (x+y)%2 ? [80,80,80,0] : [180,180,180,255]));
  assert.ok(r.reasonCodes.includes('transparent_pixels'));
});
test('invalid pixel dimensions and buffer size fail closed',()=>{
  const img=checker();
  for (const sample of [{...img,rgba:new Uint8Array(5)}, {...img,analysisWidth:0}, {...img,width:NaN}, {...img,height:0}]) {
    const r=check(sample);
    assert.equal(r.status,'hold');
    assert.ok(r.reasonCodes.length);
  }
});
test('excessively large decoded image is held even if pixels are sampled',()=>{
  const r=check({...checker(),width:100000,height:100000});
  assert.ok(r.reasonCodes.includes('excessive_resolution'));
});
test('file validation accepts supported formats and rejects invalid images',()=>{
  for (const type of ['image/png','image/jpeg','image/webp']) {
    assert.equal(inspectImageInput({type,size:1234}).status,'preflight_ok');
  }
  assert.deepEqual(inspectImageInput({type:'image/heic',size:200}).reasonCodes,['unsupported_file_type']);
  assert.deepEqual(inspectImageInput({type:'image/png',size:0}).reasonCodes,['empty_file']);
  assert.deepEqual(inspectImageInput({type:'image/png',size:IMAGE_QUALITY_POLICY.maxFileBytes+1}).reasonCodes,['excessive_file_size']);
});
test('quality error exposes safe explanation and structured report',()=>{
  const r=check(image(()=>[0,0,0]));
  assert.throws(()=>assertImageQuality(r),e=>{
    assert.equal(e.code,'image_quality_hold');
    assert.equal(e.report,r);
    assert.match(e.message,/이미지 품질 확인 필요/);
    return true;
  });
});
test('bitmap dimensions can be rejected before pixel allocation',()=>{
  assert.ok(inspectImageDimensions(80,1000).reasonCodes.includes('unsupported_resolution'));
  assert.ok(inspectImageDimensions(100000,100000).reasonCodes.includes('excessive_resolution'));
  assert.equal(inspectImageDimensions(1024,768).status,'preflight_ok');
});
test('no image input does not throw internal unhelpful TypeError',()=>{
  assert.deepEqual(inspectImageInput().reasonCodes,['unsupported_file_type','empty_file']);
  assert.equal(check().status,'hold');
});

test('a cropped ROI smaller than 224 source pixels is held even if the original image is large', () => {
  const n = 224*224;
  const rgba = new Uint8ClampedArray(n*4);
  for(let i=0;i<n;i++) {rgba[i*4]=i%256;rgba[i*4+1]=(i*7)%256;rgba[i*4+2]=(i*13)%256;rgba[i*4+3]=255;}
  const report=assessImageQuality({width:1200,height:800,rgba,analysisWidth:224,analysisHeight:224,
    roiWidth:140,roiHeight:180,policyKind:'uncalibrated_selected_roi_preflight'});
  assert.equal(report.status,'hold');
  assert.ok(report.reasonCodes.includes('roi_insufficient_resolution'));
  assert.equal(report.qualityVerifiedForClassification,false);
  assert.equal(report.policyKind,'uncalibrated_selected_roi_preflight');
});
