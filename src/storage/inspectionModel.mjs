/** Immutable local inspection snapshot contract. Images and heatmaps live in separate IDB stores. */
import {validateRoiSelection} from '../ai/roiGeometry.mjs';
export const INSPECTION_SCHEMA_VERSION = 2; // additive ROI transform, no IndexedDB store migration
export const CANDIDATE_CODES = Object.freeze(['normal_candidate', 'review_required', 'anomaly_candidate']);
export const RECORD_STATUSES = Object.freeze(['inferred', 'held']);

const isText = value => typeof value === 'string' && value.trim().length > 0;
const finiteOrNull = value => value === null || (typeof value === 'number' && Number.isFinite(value));
const positiveInt = n => Number.isSafeInteger(n) && n > 0;

function validateRoi(roi, width, height) {
  if (!roi || ![roi.x, roi.y, roi.width, roi.height].every(v => typeof v === 'number' && Number.isFinite(v)) ||
    roi.x < 0 || roi.y < 0 || roi.width <= 0 || roi.height <= 0 ||
    roi.x + roi.width > width + 0.001 || roi.y + roi.height > height + 0.001) {
    throw new TypeError('ROI coordinates must be finite and inside the source image');
  }
  return {x: roi.x, y: roi.y, width: roi.width, height: roi.height};
}

/**
 * Build a safe serializable snapshot, with no model tensors, raw pixels or unverifiable final verdict.
 * @param {object} input
 */
export function createInspectionSnapshot({id, sourceId, createdAt, sourceType = 'user', status,
  width, height, roi = null, roiTransform = null, score = null, threshold = null, candidate = null, quality = null,
  modelIds = [], elapsedMs = null, failureReasons = [], lotId = null, productId = null} = {}) {
  if (!isText(id) || !isText(sourceId) || !isText(createdAt) || !Number.isFinite(Date.parse(createdAt))) {
    throw new TypeError('Inspection requires id, sourceId, and valid timestamp');
  }
  if (!['user', 'demo'].includes(sourceType)) throw new TypeError('Invalid source provenance');
  if (!RECORD_STATUSES.includes(status)) throw new TypeError('Invalid inspection status');
  if ((status === 'inferred' && (!positiveInt(width) || !positiveInt(height))) ||
      (status === 'held' && !((width === null && height === null) || (positiveInt(width) && positiveInt(height))))) {
    throw new TypeError('Invalid original image dimensions');
  }
  if (!finiteOrNull(score) || !finiteOrNull(threshold) || !finiteOrNull(elapsedMs)) throw new TypeError('Invalid numeric inspection data');
  if (elapsedMs !== null && elapsedMs < 0) throw new TypeError('Invalid inference duration');
  if (!Array.isArray(modelIds) || !modelIds.every(isText) ||
      !Array.isArray(failureReasons) || !failureReasons.every(isText)) throw new TypeError('Invalid model IDs or reasons');
  if (lotId !== null && !isText(lotId)) throw new TypeError('Invalid lot ID');
  if (productId !== null && !isText(productId)) throw new TypeError('Invalid product ID');
  if (status === 'inferred') {
    if (score === null || !roi || !candidate || !CANDIDATE_CODES.includes(candidate.code) ||
        candidate.isFinalVerdict !== false || !Array.isArray(candidate.reasonCodes) ||
        !candidate.reasonCodes.every(isText)) throw new TypeError('Invalid AI-only inference result');
  } else {
    if (score !== null || threshold !== null || roi !== null || candidate !== null || modelIds.length || elapsedMs !== null ||
        failureReasons.length === 0) throw new TypeError('Held image cannot have a fabricated AI inference');
  }
  let safeTransform = null;
  if (roiTransform !== null) {
    if (status !== 'inferred' || !roi || !['center_preflight','user_selected_unverified'].includes(roiTransform.source) ||
      roiTransform.modelSize !== 224) {
      throw new TypeError('ROI transform must describe an inferred, known-model crop');
    }
    const selected = validateRoiSelection(roiTransform, width, height);
    if (![roi.x,roi.y,roi.width,roi.height].every((v,i)=>v ===
        [selected.x,selected.y,selected.width,selected.height][i])) {
      throw new TypeError('ROI transform differs from stored crop');
    }
    safeTransform = { ...selected, source:roiTransform.source, modelSize:224 };
  }
  const safeCandidate = candidate ? {
    code: candidate.code,
    label: ['정상 후보','확인 필요','이상 후보'][CANDIDATE_CODES.indexOf(candidate.code)],
    reasonCodes: [...candidate.reasonCodes],
    calibrationId: isText(candidate.calibrationId) ? candidate.calibrationId : null,
    requiresHumanReview: candidate.code !== 'normal_candidate',
    isFinalVerdict: false,
  } : null;
  return {
    schemaVersion: INSPECTION_SCHEMA_VERSION, id, sourceId, sourceType, createdAt, status,
    width, height, roi: roi ? validateRoi(roi, width, height) : null, roiTransform:safeTransform, score, threshold,
    candidate: safeCandidate,
    quality: quality ? {status: String(quality.status ?? 'unknown'),
      reasonCodes: Array.isArray(quality.reasonCodes) ? quality.reasonCodes.filter(isText) : [],
      qualityVerifiedForClassification: false, // never auto-promote heuristic precheck
      policyKind: String(quality.policyKind ?? 'uncalibrated')} : null,
    modelIds: [...modelIds], elapsedMs, failureReasons: [...failureReasons],
    lotId, productId, humanVerdict: null, // human review is a separate later audited action
  };
}

export function createInferredSnapshot({id, sourceId, createdAt, sourceType, inference, lotId, productId}) {
  if (!inference || !inference.candidate) throw new TypeError('AI inference result missing');
  return createInspectionSnapshot({id, sourceId, createdAt, sourceType, lotId, productId,
    status:'inferred', width:inference.width, height:inference.height, roi:inference.crop,
    roiTransform:inference.roiTransform ?? null,
    score:inference.score, threshold:inference.threshold, candidate:inference.candidate,
    quality:inference.quality, modelIds:inference.modelIds, elapsedMs:inference.elapsedMs });
}

export function createHeldSnapshot({id, sourceId, createdAt, sourceType, width, height, report, lotId, productId}) {
  const reasons = report?.reasonCodes?.filter(isText);
  if (!Array.isArray(reasons) || reasons.length === 0) throw new TypeError('Hold report must contain reasons');
  return createInspectionSnapshot({id, sourceId, createdAt, sourceType, lotId, productId,
    status:'held', width, height, failureReasons:reasons, quality:report});
}
