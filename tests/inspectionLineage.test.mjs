import test from 'node:test';
import assert from 'node:assert/strict';
import {sameInspectionView,validateReinspection,findMatchingSourceViews,summarizeInspectionViews} from '../src/storage/inspectionLineage.mjs';
const sample=(id, {sourceId='sha256:photo-a',sourceType='user',roi={x:10,y:20,width:240,height:260},status='inferred',
  time='2026-10-28T08:00:00Z',code='review_required',rotationDegrees=0}={})=>({id,sourceId,sourceType,
    status,createdAt:time,roi:status==='inferred'?roi:null,
    roiTransform:status==='inferred'?{rotationDegrees,source:'user_selected_unverified'}:null,
    candidate:status==='inferred'?{code}:null});

test('same image, same ROI are one photographic view; repeated scans are not new physical products',()=>{
 const a=sample('a'), b=sample('b',{time:'2026-10-28T09:00:00Z'});
 assert.ok(sameInspectionView(a,b));
 const summary=summarizeInspectionViews([a,b]);
 assert.equal(summary.totalAttempts,2);assert.equal(summary.distinctViews,1);
 assert.equal(summary.repeatedAttempts,1);assert.equal(summary.uniqueProducts,null);
 assert.equal(summary.confirmedDefectRate,null);
});
test('two different ROI in one exact image count as separate views, not proven separate products',()=>{
 const a=sample('a'), b=sample('b',{roi:{x:400,y:20,width:250,height:260}});
 assert.equal(sameInspectionView(a,b),false);
 const stats=summarizeInspectionViews([a,b]);assert.equal(stats.distinctViews,2);assert.equal(stats.uniqueProducts,null);
});
test('rotation, source bytes, or provenance change image identity',()=>{
 const a=sample('a');
 assert.equal(sameInspectionView(a,sample('b',{rotationDegrees:15})),false);
 assert.equal(sameInspectionView(a,sample('c',{sourceId:'sha256:other'})),false);
 assert.equal(sameInspectionView(a,sample('d',{sourceType:'demo'})),false);
});
test('newer rescan determines displayed AI candidate without erasing raw attempt history',()=>{
 const old=sample('old',{code:'normal_candidate'});
 const newer=sample('new',{code:'anomaly_candidate',time:'2026-10-28T09:00:00Z'});
 const stats=summarizeInspectionViews([old,newer]);
 assert.deepEqual(stats.aiCandidateViewCounts,{normalCandidate:0,reviewRequired:0,anomalyCandidate:1});
 assert.equal(stats.totalAttempts,2);assert.equal(stats.inferredViews,1);
});
test('demo sample never enters user statistics, even with same image hash',()=>{
 const user=sample('u');const demo=sample('d',{sourceType:'demo',code:'anomaly_candidate'});
 assert.equal(summarizeInspectionViews([user,demo]).totalAttempts,1);
 assert.equal(summarizeInspectionViews([user,demo],{sourceType:'demo'}).aiCandidateViewCounts.anomalyCandidate,1);
});
test('holds remain held, without fabricated anomaly or final human verdict',()=>{
 const a=sample('a',{status:'held'}),b=sample('b',{status:'held'});
 const stats=summarizeInspectionViews([a,b]);assert.equal(stats.heldViews,1);
 assert.equal(stats.inferredViews,0);assert.equal(stats.finalVerdictAvailable,false);
 assert.equal(stats.confirmedInspectionRate,null);
});
test('same-source duplicate detection separates exact ROI from other ROI and warns for center preflight',()=>{
 const a=sample('a'),b=sample('b',{roi:{x:400,y:20,width:250,height:260}});
 const result=findMatchingSourceViews([a,b],{sourceId:a.sourceId,roi:a.roi});
 assert.equal(result.matchingSource.length,2);assert.equal(result.matchingView.length,1);
 assert.equal(result.matchingView[0].id,'a');
 const center=sample('center');center.roiTransform.source='center_preflight';
 assert.equal(findMatchingSourceViews([a,center],{sourceId:a.sourceId}).matchingView.length,1);
});
test('a linked reinspection must be identical original, ROI, status and provenance',()=>{
 const original=sample('a');const child={...sample('b'),reinspectionOf:'a'};
 assert.equal(validateReinspection(original,child),true);
 assert.throws(()=>validateReinspection(null,child),/원본 기록/);
 assert.throws(()=>validateReinspection(original,{...child,sourceId:'another'}),/동일 원본/);
 assert.throws(()=>validateReinspection(original,{...child,roi:{x:11,y:20,width:240,height:260}}),/동일 원본/);
 assert.throws(()=>validateReinspection(original,{...child,reinspectionOf:'nonexistent'}),/원본 기록/);
});
test('rejects malformed grouping query and never silently assigns physical products',()=>{
 assert.throws(()=>findMatchingSourceViews([], {sourceId:''}));
 assert.throws(()=>findMatchingSourceViews([],{sourceId:'x',roi:{x:0,y:0,width:-1,height:10}}));
 assert.throws(()=>summarizeInspectionViews([], {sourceType:'other'}));
});
