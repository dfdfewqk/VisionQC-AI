/**
 * Candidate-only classification for VisionQC AI (design decisions 2-5, 28-33).
 *
 * IMPORTANT:
 *  - The public model's thresholds.json is reference metadata, NOT a validated
 *    three-way decision margin for photos taken by this application.
 *  - Do not generate boundaries from guessed percentages, model score range,
 *    or the per-image normalized heatmap.
 *  - Missing evidence, failed domain/ROI/quality checks, and uncalibrated scores
 *    must ALWAYS produce '확인 필요'. No candidate is a final human verdict.
 *  - This module deliberately has no persistence or UI dependency.
 */

const LABELS = Object.freeze({
  normal_candidate: '정상 후보',
  review_required: '확인 필요',
  anomaly_candidate: '이상 후보',
});

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Calibration profiles must come from separately labeled calibration and
 * evaluation sets, with a documented reviewer, and must match the loaded model.
 * The metadata flags make approval auditable, not a substitute for real review.
 */
export function isApprovedCalibration(calibration, modelRevision) {
  if (!calibration || typeof calibration !== 'object' || !nonEmpty(modelRevision)) return false;
  const evidence = calibration.evidence;
  return calibration.status === 'approved' &&
    nonEmpty(calibration.id) && calibration.modelRevision === modelRevision &&
    Number.isFinite(calibration.normalMaxScore) &&
    Number.isFinite(calibration.anomalyMinScore) &&
    calibration.normalMaxScore < calibration.anomalyMinScore &&
    !!evidence && evidence.labelsHumanVerified === true &&
    nonEmpty(evidence.calibrationSetId) && nonEmpty(evidence.evaluationSetId) &&
    evidence.calibrationSetId !== evidence.evaluationSetId &&
    nonEmpty(evidence.approvedBy);
}

function decision(code, score, reasonCodes, calibrationId = null) {
  return Object.freeze({
    code,
    label: LABELS[code],
    score: Number.isFinite(score) ? score : null,
    reasonCodes: Object.freeze([...reasonCodes]),
    calibrationId,
    requiresHumanReview: code !== 'normal_candidate',
    isFinalVerdict: false,
  });
}

/**
 * @param {object} input
 * @param {number} input.score Raw, UNNORMALIZED PatchCore image anomaly score.
 * @param {string} input.modelRevision Exact loaded ONNX model revision.
 * @param {object} [input.calibration] Externally approved, versioned calibration.
 * @param {object} [input.checks] All three gates must explicitly pass.
 * @returns {{code: string, label: string, score: number|null,
 *            reasonCodes: readonly string[], calibrationId: string|null,
 *            requiresHumanReview: boolean, isFinalVerdict: false}}
 */
export function assessCandidate({ score, modelRevision, calibration = null, checks = {} } = {}) {
  const reasons = [];
  if (!Number.isFinite(score)) reasons.push('invalid_score');
  if (checks?.quality !== 'pass') reasons.push('image_quality_unverified');
  if (checks?.applicability !== 'pass') reasons.push('model_applicability_unverified');
  if (checks?.roi !== 'verified') reasons.push('roi_unverified');
  if (!isApprovedCalibration(calibration, modelRevision)) {
    reasons.push(calibration ? 'calibration_unapproved_or_mismatched' : 'calibration_missing');
  }
  if (reasons.length) return decision('review_required', score, reasons);

  if (score <= calibration.normalMaxScore) {
    return decision('normal_candidate', score, ['below_validated_normal_limit'], calibration.id);
  }
  if (score >= calibration.anomalyMinScore) {
    return decision('anomaly_candidate', score, ['above_validated_anomaly_limit'], calibration.id);
  }
  return decision('review_required', score, ['inside_uncertain_band'], calibration.id);
}
