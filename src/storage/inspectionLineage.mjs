/**
 * Inspection lineage and view-level counts. Exact image bytes + identical ROI
 * identify the same *photographic view*, NOT a verified physical product.
 * Count distinct views only; never invent a real unique-product defect rate.
 */
const validText = s => typeof s === 'string' && s.trim().length > 0;
const coordinate = n => typeof n === 'number' && Number.isFinite(n);
const kind = record => record?.status === 'held' ? 'held' : 'inferred';

export function sameInspectionView(left, right) {
  if (!left || !right || left.sourceId !== right.sourceId || left.sourceType !== right.sourceType ||
    kind(left) !== kind(right)) return false;
  if (kind(left) === 'held') return true; // same original repeatedly held; never claim a product identity
  if (!left.roi || !right.roi) return false;
  for (const key of ['x','y','width','height']) {
    if (!coordinate(left.roi[key]) || !coordinate(right.roi[key]) || left.roi[key] !== right.roi[key]) return false;
  }
  return (left.roiTransform?.rotationDegrees ?? 0) === (right.roiTransform?.rotationDegrees ?? 0);
}

/** Browser UI can preflight duplicates before starting a costly ONNX inference. */
export function findMatchingSourceViews(records, {sourceId, sourceType = 'user', roi = null} = {}) {
  if (!validText(sourceId) || !['user','demo'].includes(sourceType)) throw new TypeError('Valid source and provenance required');
  if (roi !== null && (!['x','y','width','height'].every(k => coordinate(roi[k])) ||
      roi.width <= 0 || roi.height <= 0)) throw new TypeError('Invalid ROI');
  const matchingSource = records.filter(r => r?.sourceId === sourceId && r?.sourceType === sourceType);
  const matchingView = matchingSource.filter(r => {
    if (roi === null) return r.status === 'inferred' && (!r.roiTransform || r.roiTransform.source === 'center_preflight');
    return r.status === 'inferred' && r.roi && ['x','y','width','height'].every(k => r.roi[k] === roi[k]) &&
      (r.roiTransform?.rotationDegrees ?? 0) === (roi.rotationDegrees ?? 0);
  });
  return {sourceId, matchingSource, matchingView, hasExactSource:matchingSource.length > 0,
    hasMatchingView:matchingView.length > 0};
}

export function validateReinspection(previous, record) {
  if (!previous || !record || record.reinspectionOf !== previous.id || previous.id === record.id) {
    throw new Error('재검사 원본 기록이 없거나 재검사 참조가 유효하지 않습니다.');
  }
  if (!sameInspectionView(previous, record)) {
    throw new Error('재검사는 동일 원본 사진·동일 ROI·동일 데이터 출처에만 연결할 수 있습니다.');
  }
  return true;
}

/**
 * Snapshot-level view statistics only. Neither AI labels nor hashes are human
 * confirmed product verdicts. Choose most recent retained inspection per view.
 */
export function summarizeInspectionViews(records, {sourceType = 'user'} = {}) {
  if (!Array.isArray(records) || !['user','demo'].includes(sourceType)) throw new TypeError('Valid records and sourceType required');
  const selected = records.filter(r => r?.sourceType === sourceType && validText(r.id) && validText(r.sourceId) &&
    ['inferred','held'].includes(r.status));
  const groups = [];
  for (const record of selected) {
    const existing = groups.find(group => sameInspectionView(group[0], record));
    if (existing) existing.push(record); else groups.push([record]);
  }
  const latest = groups.map(g => g.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]);
  const count = code => latest.filter(r => r.status === 'inferred' && r.candidate?.code === code).length;
  const inferred = latest.filter(r => r.status === 'inferred').length;
  return Object.freeze({
    sourceType, totalAttempts:selected.length, distinctViews:groups.length,
    repeatedAttempts:selected.length - groups.length, inferredViews:inferred,
    heldViews:latest.length-inferred,
    aiCandidateViewCounts:Object.freeze({normalCandidate:count('normal_candidate'),
      reviewRequired:count('review_required'), anomalyCandidate:count('anomaly_candidate')}),
    // No verified product identity nor final human verdict exists in v1 storage.
    uniqueProducts:null, confirmedDefectRate:null, confirmedInspectionRate:null,
    aggregationUnit:'exact_source_image_and_roi', finalVerdictAvailable:false,
  });
}
