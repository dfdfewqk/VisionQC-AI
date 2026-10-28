import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHistoryFilters, searchInspectionHistory, summarizeQualityStatistics} from '../src/storage/inspectionHistory.mjs';

const at=(hour='08')=>`2026-10-28T${hour}:00:00Z`;
const view=(id,{sourceId='sha256:same',sourceType='user',createdAt=at(),
  roi={x:0,y:0,width:260,height:260},status='inferred',code='review_required',
  lotId=null,productId=null,rotationDegrees=0}={})=>({id,sourceId,sourceType,createdAt,status,
    roi:status==='inferred'?roi:null,roiTransform:status==='inferred'?{rotationDegrees}:null,
    candidate:status==='inferred'?{code}:null,lotId,productId});
const review=(inspectionId,verdict,{operatorName='작업자 A',revision=1,recordedAt=at('09')}={})=>({
  id:`${inspectionId}-r${revision}`,inspectionId,verdict,operatorName,revision,recordedAt,
});

test('search is ordered by original inspection date, not the human review date',()=>{
  const rows=[view('first',{createdAt:at('08')}),view('second',{sourceId:'sha256:second',createdAt:at('10')})];
  const reviews=[review('first','defective',{recordedAt:at('23')})];
  const found=searchInspectionHistory(rows,reviews);
  assert.deepEqual(found.items.map(x=>x.id),['second','first']);
  assert.equal(found.total,2);
  assert.equal(found.items[1].latestHumanReview?.verdict,'defective');
});
test('search filters inspection/LOT/product/operator and latest revision, with no stale verdict',()=>{
  const rows=[view('i-aa',{lotId:'LOT-02',productId:'P-1'}),view('i-bb',{sourceId:'sha256:other',lotId:'LOT-01'})];
  const reviews=[review('i-aa','defective'),review('i-aa','normal',{revision:2,operatorName:'Kim'}),review('i-bb','defective')];
  assert.deepEqual(searchInspectionHistory(rows,reviews,{operatorName:'kIm',humanVerdict:'normal',lotId:'lot-02',
    productId:'p-1',inspectionId:'aa'}).items.map(x=>x.id),['i-aa']);
  assert.equal(searchInspectionHistory(rows,reviews,{humanVerdict:'defective'}).total,1);
  assert.equal(searchInspectionHistory(rows,reviews,{operatorName:'작업자 A',humanVerdict:'defective'}).items[0].id,'i-bb');
});
test('search distinguishes held, AI anomaly, review requested and unreviewed',()=>{
  const rows=[view('held',{status:'held'}),view('ai',{code:'anomaly_candidate'}),view('pending',{sourceId:'x'})];
  const events=[review('held','reinspection'),review('ai','defective')];
  assert.deepEqual(searchInspectionHistory(rows,events,{status:'held',humanVerdict:'reinspection'}).items.map(r=>r.id),['held']);
  assert.equal(searchInspectionHistory(rows,events,{aiCandidate:'anomaly_candidate'}).items[0].id,'ai');
  assert.equal(searchInspectionHistory(rows,events,{humanVerdict:'unreviewed'}).items[0].id,'pending');
});
test('search source provenance segregates demo scans even for same source image',()=>{
  const rows=[view('user'),view('demo',{sourceType:'demo'})];
  const events=[review('demo','defective')];
  assert.deepEqual(searchInspectionHistory(rows,events).items.map(x=>x.id),['user']);
  assert.deepEqual(searchInspectionHistory(rows,events,{sourceType:'demo'}).items.map(x=>x.id),['demo']);
  assert.equal(summarizeQualityStatistics(rows,events).humanConfirmedAttemptCount,0);
});
test('search applies UTC timestamp range inclusive start/exclusive end and stable pagination',()=>{
  const rows=[view('a',{createdAt:at('08')}),view('b',{createdAt:at('09')}),view('c',{createdAt:at('10')})];
  const opts={period:'custom',createdFrom:at('08'),createdBefore:at('10'),limit:1,offset:1};
  const found=searchInspectionHistory(rows,[],opts);
  assert.deepEqual(found.items.map(x=>x.id),['a']);assert.equal(found.total,2);
  assert.throws(()=>normalizeHistoryFilters({period:'custom',createdFrom:at('10'),createdBefore:at('08')}),/increasing/);
});
test('today/7d/30d use configured local day, not implicit computer timezone',()=>{
  const now='2026-10-28T16:20:00+09:00';
  const today=normalizeHistoryFilters({period:'today',now,timezoneOffsetMinutes:540});
  assert.equal(new Date(today.createdFromMs).toISOString(),'2026-10-27T15:00:00.000Z');
  assert.equal(new Date(today.createdBeforeMs).toISOString(),'2026-10-28T15:00:00.000Z');
  const seven=normalizeHistoryFilters({period:'7d',now,timezoneOffsetMinutes:540});
  const thirty=normalizeHistoryFilters({period:'30d',now,timezoneOffsetMinutes:540});
  assert.equal((seven.createdBeforeMs-seven.createdFromMs)/86400000,7);
  assert.equal((thirty.createdBeforeMs-thirty.createdFromMs)/86400000,30);
});
test('invalid filters rejected rather than silently removing safety restriction',()=>{
  for(const opts of [{sourceType:'all'},{status:'bad'},{humanVerdict:'any'},
    {aiCandidate:'defective'},{limit:0},{offset:-1},{period:'week'},
    {period:'custom',createdFrom:'2026-10-28'},{createdFrom:at()},
    {timezoneOffsetMinutes:900}]) assert.throws(()=>normalizeHistoryFilters(opts));
});
test('AI anomaly is distinct-view percentage while human defect is confirmed-attempt percentage',()=>{
  const rows=[view('old',{code:'normal_candidate',createdAt:at('08')}),
    view('new',{code:'anomaly_candidate',createdAt:at('09')}),
    view('other',{sourceId:'other',code:'review_required'}),
    view('held',{sourceId:'held',status:'held'})];
  const events=[review('old','defective'),review('new','normal'),review('other','reinspection')];
  const stats=summarizeQualityStatistics(rows,events);
  assert.equal(stats.totalAttempts,4);assert.equal(stats.distinctPhotographicViews,3);
  assert.equal(stats.repeatedAttempts,1);assert.equal(stats.inferredViews,2);
  assert.deepEqual(stats.aiCandidateViewCounts,{normalCandidate:0,reviewRequired:1,anomalyCandidate:1});
  assert.equal(stats.aiAnomalyCandidateViewRate,0.5);
  assert.equal(stats.humanConfirmedAttemptCount,2);assert.equal(stats.humanConfirmedDefectiveAttemptRate,0.5);
  assert.equal(stats.humanAttemptCounts.reinspection,1);assert.equal(stats.humanAttemptCounts.unreviewed,1);
  assert.equal(stats.uniqueProducts,null);assert.equal(stats.confirmedProductDefectRate,null);
});
test('no AI or human denominator returns null not misleading zero',()=>{
  const rows=[view('held',{status:'held'})];
  const stats=summarizeQualityStatistics(rows,[]);
  assert.equal(stats.aiAnomalyCandidateViewRate,null);
  assert.equal(stats.humanConfirmedDefectiveAttemptRate,null);
  assert.equal(stats.humanAttemptCounts.unreviewed,1);
});
test('trend uses first inspection date, and reviewer changes do not move inspection to new day',()=>{
  const rows=[view('a',{createdAt:'2026-10-27T23:30:00Z',code:'anomaly_candidate'}),
    view('b',{createdAt:'2026-10-28T00:30:00Z'})];
  const events=[review('a','defective',{recordedAt:'2026-10-29T20:00:00Z'})];
  const stats=summarizeQualityStatistics(rows,events,{timezoneOffsetMinutes:0});
  assert.deepEqual(stats.trendByInspectionDate.map(x=>x.date),['2026-10-27','2026-10-28']);
  assert.equal(stats.trendByInspectionDate[0].humanDefectiveAttempts,1);
  const seoul=summarizeQualityStatistics(rows,events,{timezoneOffsetMinutes:540});
  assert.equal(seoul.trendByInspectionDate.length,1);
  assert.equal(seoul.trendByInspectionDate[0].inspectionAttempts,2);
});
test('date range excludes records outside window for both AI and human ratios',()=>{
  const rows=[view('old',{createdAt:'2026-10-20T09:00:00Z',code:'anomaly_candidate'}),
    view('recent',{createdAt:'2026-10-28T09:00:00Z',code:'normal_candidate',sourceId:'other'})];
  const ev=[review('old','defective'),review('recent','normal')];
  const stats=summarizeQualityStatistics(rows,ev,{period:'custom',createdFrom:'2026-10-27T00:00:00Z'});
  assert.equal(stats.totalAttempts,1);assert.equal(stats.humanConfirmedDefectiveAttemptRate,0);
  assert.equal(stats.aiAnomalyCandidateViewRate,0);
});

test('statistics reject unsupported search filters rather than silently changing denominator',()=>{
  assert.throws(()=>summarizeQualityStatistics([],[],{humanVerdict:'defective'}),/Unsupported/);
  assert.throws(()=>summarizeQualityStatistics([],[],{limit:1}),/Unsupported/);
});
