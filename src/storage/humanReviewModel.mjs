/** Human review events are append-only and separate from original AI snapshots.
 * Operator names are locally supplied identifiers, NOT authenticated identities.
 */
export const HUMAN_VERDICTS = Object.freeze({
  normal: '정상',
  defective: '불량',
  reinspection: '재검사',
});

const text = value => typeof value === 'string' && value.trim().length > 0;

export function validateHumanReviewInput({inspectionId, verdict, operatorName, reason, expectedRevision} = {}) {
  if (!text(inspectionId)) throw new TypeError('검사 ID가 필요합니다.');
  if (!Object.hasOwn(HUMAN_VERDICTS, verdict)) throw new TypeError('작업자 판정은 정상/불량/재검사 중 하나여야 합니다.');
  if (!text(operatorName) || operatorName.trim().length > 120) throw new TypeError('작업자 식별명이 필요합니다(최대 120자).');
  if (!text(reason) || reason.trim().length > 2000) throw new TypeError('판정 사유가 필요합니다(최대 2000자).');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new TypeError('현재 판정 revision을 명시해야 합니다.');
  }
  return {inspectionId: inspectionId.trim(), verdict, operatorName: operatorName.trim(),
    reason: reason.trim(), expectedRevision};
}

export function makeHumanReviewEvent({id, inspection, input, revision, recordedAt, previousEventId = null}) {
  if (!inspection || inspection.id !== input.inspectionId) throw new Error('대상 검사 기록이 없습니다.');
  if (inspection.status === 'held' && input.verdict !== 'reinspection') {
    throw new Error('이미지 품질 보류 건은 정상/불량으로 확정할 수 없습니다. 재검사를 요청해 주세요.');
  }
  if (!['inferred', 'held'].includes(inspection.status)) throw new Error('지원하지 않는 검사 상태입니다.');
  if (!text(id) || !Number.isSafeInteger(revision) || revision < 1 ||
      !text(recordedAt) || !Number.isFinite(Date.parse(recordedAt))) {
    throw new TypeError('작업자 판정 이벤트의 식별자·시각·버전이 올바르지 않습니다.');
  }
  return Object.freeze({id, inspectionId: input.inspectionId, revision, previousEventId,
    verdict: input.verdict, label: HUMAN_VERDICTS[input.verdict], operatorName: input.operatorName,
    reason: input.reason, recordedAt, sourceType: inspection.sourceType,
    aiCandidateAtReview: inspection.candidate?.code ?? null, isFinalHumanVerdict: input.verdict !== 'reinspection'});
}

/** Inspection-event counts, not unique products and not defect rates. */
export function summarizeHumanReviewEvents(inspections, events, {sourceType = 'user'} = {}) {
  if (!['user', 'demo'].includes(sourceType)) throw new TypeError('잘못된 검사 데이터 출처입니다.');
  const targets = inspections.filter(row => row.sourceType === sourceType);
  const ids = new Set(targets.map(row => row.id));
  const latest = new Map();
  for (const event of events) {
    if (!ids.has(event.inspectionId)) continue;
    if (!latest.has(event.inspectionId) || latest.get(event.inspectionId).revision < event.revision) {
      latest.set(event.inspectionId, event);
    }
  }
  const result = {sourceType, inspectionAttempts: targets.length, unreviewed: 0,
    reviewed: 0, normal: 0, defective: 0, reinspection: 0,
    uniqueProducts: null, confirmedProductDefectRate: null};
  for (const row of targets) {
    const event = latest.get(row.id);
    if (!event) result.unreviewed++;
    else {result.reviewed++;result[event.verdict]++;}
  }
  return Object.freeze(result);
}
