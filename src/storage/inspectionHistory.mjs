/** Search + reporting over immutable inspection attempts and append-only human reviews.
 * Photos, model scores and worker events remain separate; this is read-only.
 * A repeated byte-identical source + ROI is a photographic view, NOT one product.
 */
import {sameInspectionView} from './inspectionLineage.mjs';

const SOURCE_TYPES = ['user', 'demo'];
const STATUSES = ['inferred','held'];
const CANDIDATES = ['normal_candidate','review_required','anomaly_candidate'];
const VERDICTS = ['normal','defective','reinspection','unreviewed'];
const PERIODS = ['all','today','7d','30d','custom'];
const isoTimestamp = /\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const textFilter = (v, field) => {
  if (v === null || v === undefined || v === '') return null;
  if (!nonempty(v) || v.length > 256) throw new TypeError(`Invalid ${field} search filter`);
  return v.trim().toLocaleLowerCase();
};
const oneOf = (value, choices, field) => {
  if (value === null || value === undefined) return null;
  if (!choices.includes(value)) throw new TypeError(`Invalid ${field} filter`);
  return value;
};
function instant(value, field) {
  if (!nonempty(value) || !isoTimestamp.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${field} must be an ISO timestamp with timezone`);
  }
  return Date.parse(value);
}
function asDay(ms, timezoneOffsetMinutes) {
  return new Date(ms + timezoneOffsetMinutes * 60_000).toISOString().slice(0,10);
}
/** Inclusive createdFrom / exclusive createdBefore in absolute time. Timezone applies only to day presets/trends. */
export function normalizeHistoryFilters({sourceType='user',status=null,aiCandidate=null,humanVerdict=null,
  inspectionId=null,operatorName=null,lotId=null,productId=null,
  period='all',createdFrom=null,createdBefore=null,now=new Date().toISOString(),
  timezoneOffsetMinutes=0,limit=50,offset=0}={}) {
  if (!SOURCE_TYPES.includes(sourceType)) throw new TypeError('Invalid sourceType');
  if (!PERIODS.includes(period)) throw new TypeError('Invalid period');
  if (!Number.isSafeInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes)>840) {
    throw new TypeError('Invalid timezone offset');
  }
  if (!Number.isSafeInteger(limit)||limit<1||limit>1000||!Number.isSafeInteger(offset)||offset<0) {
    throw new RangeError('Invalid pagination');
  }
  if (period!=='custom' && (createdFrom !== null || createdBefore !== null)) {
    throw new TypeError('Explicit dates require custom period');
  }
  let start=null,end=null;
  if (period==='custom') {
    if (createdFrom !== null) start=instant(createdFrom,'createdFrom');
    if (createdBefore !== null) end=instant(createdBefore,'createdBefore');
  } else if (period!=='all') {
    const nowMs=instant(now,'now');
    const minuteMs=timezoneOffsetMinutes*60_000;
    const todayStart=Math.floor((nowMs+minuteMs)/86_400_000)*86_400_000-minuteMs;
    start=todayStart-(period==='30d'?29:period==='7d'?6:0)*86_400_000;
    end=todayStart+86_400_000;
  }
  if (start!==null && end!==null && start>=end) throw new RangeError('Date range must be increasing');
  return Object.freeze({sourceType,status:oneOf(status,STATUSES,'status'),aiCandidate:oneOf(aiCandidate,CANDIDATES,'AI candidate'),
    humanVerdict:oneOf(humanVerdict,VERDICTS,'human verdict'),
    inspectionId:textFilter(inspectionId,'inspection ID'),operatorName:textFilter(operatorName,'operator'),
    lotId:textFilter(lotId,'LOT'),productId:textFilter(productId,'product'),
    period,createdFromMs:start,createdBeforeMs:end,timezoneOffsetMinutes,limit,offset});
}

export function latestReviewsByInspection(events, validIds) {
  const latest=new Map();
  for (const e of events) {
    if (!validIds.has(e?.inspectionId) || !Number.isSafeInteger(e.revision)) continue;
    const previous=latest.get(e.inspectionId);
    if (!previous || e.revision>previous.revision ||
      (e.revision===previous.revision && e.id>previous.id)) latest.set(e.inspectionId,e);
  }
  return latest;
}
function selectedRows(inspections,events,f) {
  const rows=inspections.filter(r=>r?.sourceType===f.sourceType && nonempty(r.id) && nonempty(r.createdAt) &&
    STATUSES.includes(r.status) && Number.isFinite(Date.parse(r.createdAt)) &&
    (f.createdFromMs===null || Date.parse(r.createdAt)>=f.createdFromMs) &&
    (f.createdBeforeMs===null || Date.parse(r.createdAt)<f.createdBeforeMs));
  const latest=latestReviewsByInspection(events,new Set(rows.map(x=>x.id)));
  return {rows,latest};
}
const includes=(value,filter)=>filter===null || (typeof value==='string' && value.toLocaleLowerCase().includes(filter));
const textEqual=(value,filter)=>filter===null || (typeof value==='string' && value.toLocaleLowerCase()===filter);

/** Return lightweight inspection metadata enriched with latest worker verdict, not source Blob/heatmap. */
export function searchInspectionHistory(inspections,events,options={}) {
  if (!Array.isArray(inspections)||!Array.isArray(events)) throw new TypeError('History arrays required');
  const f=normalizeHistoryFilters(options);
  const {rows,latest}=selectedRows(inspections,events,f);
  const filtered=rows.filter(row=>{
    const review=latest.get(row.id);
    return (f.status===null||row.status===f.status) &&
      (f.aiCandidate===null||row.candidate?.code===f.aiCandidate) &&
      (f.humanVerdict===null || (f.humanVerdict==='unreviewed' ? !review : review?.verdict===f.humanVerdict)) &&
      includes(row.id,f.inspectionId) && includes(row.lotId,f.lotId) &&
      includes(row.productId,f.productId) && includes(review?.operatorName,f.operatorName);
  }).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id));
  const items=filtered.slice(f.offset,f.offset+f.limit).map(row=>Object.freeze({
    ...row, latestHumanReview:latest.get(row.id)??null,
  }));
  return Object.freeze({sourceType:f.sourceType,total:filtered.length,offset:f.offset,limit:f.limit,items});
}

/** AI is latest attempt per photographic view. Human count denominator is confirmed inspection attempts.
 * Neither can be relabeled as physical product count or product defect rate.
 */
export function summarizeQualityStatistics(inspections,events,options={}) {
  if (!Array.isArray(inspections)||!Array.isArray(events)) throw new TypeError('History arrays required');
  // Statistics can only be scoped by provenance/date. Ignoring a search filter silently
  // would make the denominator appear filtered when it is not.
  const allowed=new Set(['sourceType','period','createdFrom','createdBefore','now','timezoneOffsetMinutes']);
  for (const [key,value] of Object.entries(options)) {
    if (!allowed.has(key) && value !== null && value !== undefined) {
      throw new TypeError(`Unsupported quality statistics filter: ${key}`);
    }
  }
  const f=normalizeHistoryFilters({...options,limit:50,offset:0});
  const {rows,latest}=selectedRows(inspections,events,f);
  const latestViews=[];
  for (const record of rows) {
    const index=latestViews.findIndex(existing=>sameInspectionView(existing,record));
    if (index<0) latestViews.push(record);
    else if (Date.parse(record.createdAt)>Date.parse(latestViews[index].createdAt) ||
      (Date.parse(record.createdAt)===Date.parse(latestViews[index].createdAt) && record.id>latestViews[index].id)) latestViews[index]=record;
  }
  const inferred=latestViews.filter(x=>x.status==='inferred');
  const counts={normalCandidate:0,reviewRequired:0,anomalyCandidate:0};
  for (const row of inferred){
    if (row.candidate?.code==='normal_candidate')counts.normalCandidate++;
    else if (row.candidate?.code==='review_required')counts.reviewRequired++;
    else if (row.candidate?.code==='anomaly_candidate')counts.anomalyCandidate++;
  }
  const human={normal:0,defective:0,reinspection:0,unreviewed:0};
  const dayMap=new Map();
  for (const row of rows) {
    const verdict=latest.get(row.id)?.verdict;
    if (verdict && Object.hasOwn(human,verdict)) human[verdict]++;
    else human.unreviewed++;
    const day=asDay(Date.parse(row.createdAt),f.timezoneOffsetMinutes);
    if (!dayMap.has(day)) dayMap.set(day,{date:day,inspectionAttempts:0,heldAttempts:0,aiAnomalyCandidateAttempts:0,
      humanConfirmedAttempts:0,humanDefectiveAttempts:0,unreviewedAttempts:0});
    const item=dayMap.get(day);
    item.inspectionAttempts++;
    if (row.status==='held') item.heldAttempts++;
    if (row.status==='inferred' && row.candidate?.code==='anomaly_candidate') item.aiAnomalyCandidateAttempts++;
    if (verdict==='normal'||verdict==='defective') item.humanConfirmedAttempts++;
    if (verdict==='defective') item.humanDefectiveAttempts++;
    if (!verdict) item.unreviewedAttempts++;
  }
  const confirmed=human.normal+human.defective;
  const result={sourceType:f.sourceType,period:f.period,createdFromMs:f.createdFromMs,
    createdBeforeMs:f.createdBeforeMs,timezoneOffsetMinutes:f.timezoneOffsetMinutes,
    totalAttempts:rows.length,distinctPhotographicViews:latestViews.length,repeatedAttempts:rows.length-latestViews.length,
    inferredViews:inferred.length,heldViews:latestViews.length-inferred.length,
    aiCandidateViewCounts:Object.freeze(counts),
    aiAnomalyCandidateViewRate:inferred.length>0?counts.anomalyCandidate/inferred.length:null,
    humanAttemptCounts:Object.freeze(human),humanConfirmedAttemptCount:confirmed,
    humanConfirmedDefectiveAttemptRate:confirmed>0?human.defective/confirmed:null,
    trendByInspectionDate:Object.freeze([...dayMap.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>Object.freeze(x))),
    uniqueProducts:null,confirmedProductDefectRate:null,confirmedProductInspectionRate:null,
    aiRateUnit:'distinct_photographic_views',humanRateUnit:'confirmed_inspection_attempts',
    note:'사진 시야 및 검사 실행 기준 지표이며 고유 물리적 제품 불량률이 아님',
  };
  return Object.freeze(result);
}
