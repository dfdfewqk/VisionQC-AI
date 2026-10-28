import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHumanReviewInput,makeHumanReviewEvent,summarizeHumanReviewEvents} from '../src/storage/humanReviewModel.mjs';
const input = () => ({inspectionId:'scan-1',verdict:'defective',operatorName:' 김기사 ',reason:' 홀 주변 균열 확인 ',expectedRevision:0});
const inspection={id:'scan-1',status:'inferred',sourceType:'user',candidate:{code:'normal_candidate'}};
test('worker review requires a reason, named operator, and explicit optimistic revision',()=>{
 const valid=validateHumanReviewInput(input());
 assert.equal(valid.operatorName,'김기사');assert.equal(valid.reason,'홀 주변 균열 확인');
 for(const invalid of [{verdict:'approved'},{operatorName:' '},{reason:''},{expectedRevision:undefined},{expectedRevision:-1},{inspectionId:' '}]) {
  assert.throws(()=>validateHumanReviewInput({...input(),...invalid}),/판정|작업자|사유|revision|검사/);
 }
});
test('AI candidate is independent of worker verdict in immutable event',()=>{
 const e=makeHumanReviewEvent({id:'hr-1',inspection,input:validateHumanReviewInput(input()),revision:1,recordedAt:'2026-10-28T08:40:00Z'});
 assert.equal(e.verdict,'defective');assert.equal(e.aiCandidateAtReview,'normal_candidate');
 assert.equal(e.isFinalHumanVerdict,true);assert.equal(e.revision,1);assert.equal(e.previousEventId,null);
 assert.throws(()=>{e.verdict='normal';},TypeError);
});
test('held photo can require reinspection but cannot become accepted/rejected as a product',()=>{
 const held={...inspection,status:'held',candidate:null};
 assert.throws(()=>makeHumanReviewEvent({id:'evt',inspection:held,input:validateHumanReviewInput(input()),revision:1,recordedAt:new Date().toISOString()}),/보류/);
 const review=makeHumanReviewEvent({id:'evt',inspection:held,input:validateHumanReviewInput({...input(),verdict:'reinspection'}),revision:1,recordedAt:new Date().toISOString()});
 assert.equal(review.label,'재검사');assert.equal(review.isFinalHumanVerdict,false);
});
test('review summaries count latest per inspection but never claim unique physical products or rate',()=>{
 const rows=[{id:'a',sourceType:'user'},{id:'b',sourceType:'user'},{id:'c',sourceType:'demo'}];
 const events=[{inspectionId:'a',revision:1,verdict:'defective'},{inspectionId:'a',revision:2,verdict:'normal'},
 {inspectionId:'b',revision:1,verdict:'reinspection'},{inspectionId:'c',revision:1,verdict:'defective'}];
 const u=summarizeHumanReviewEvents(rows,events);
 assert.deepEqual({total:u.inspectionAttempts,reviewed:u.reviewed,normal:u.normal,defective:u.defective,reinspection:u.reinspection},
 {total:2,reviewed:2,normal:1,defective:0,reinspection:1});
 assert.equal(u.uniqueProducts,null);assert.equal(u.confirmedProductDefectRate,null);
 assert.equal(summarizeHumanReviewEvents(rows,events,{sourceType:'demo'}).defective,1);
});
test('invalid timestamps and missing inspection targets cannot produce audit events',()=>{
 const params={id:'hr-1',inspection,input:validateHumanReviewInput(input()),revision:1,recordedAt:'INVALID'};
 assert.throws(()=>makeHumanReviewEvent(params));
 assert.throws(()=>makeHumanReviewEvent({...params,recordedAt:new Date().toISOString(),inspection:null}));
});
