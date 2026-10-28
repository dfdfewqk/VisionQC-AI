import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCandidate, isApprovedCalibration } from '../src/ai/candidateDecision.mjs';

const revision = 'f1705b3e17bb7eecd0d192fd15b59fabbde5b0a9';
const calibration = () => ({
  id: 'calibration-2026-01',
  status: 'approved',
  modelRevision: revision,
  normalMaxScore: 1.5,
  anomalyMinScore: 3.5,
  evidence: {
    labelsHumanVerified: true,
    calibrationSetId: 'labelled-calibration',
    evaluationSetId: 'separate-evaluation',
    approvedBy: 'quality-reviewer',
  },
});
const checks = () => ({quality: 'pass', applicability: 'pass', roi: 'verified'});
const run = (score, more = {}) => assessCandidate({score, modelRevision: revision, calibration: calibration(), checks: checks(), ...more});

test('missing calibration: do not use published reference threshold as a three-way classifier', () => {
  const decision = assessCandidate({score: -9999, modelRevision: revision, checks: checks()});
  assert.equal(decision.code, 'review_required');
  assert.deepEqual(decision.reasonCodes, ['calibration_missing']);
  assert.equal(decision.requiresHumanReview, true);
  assert.equal(decision.isFinalVerdict, false);
});
test('unknown image conditions conservatively require review', () => {
  const result = assessCandidate({score: 0.5, modelRevision: revision, calibration: calibration()});
  assert.equal(result.code, 'review_required');
  assert.deepEqual(result.reasonCodes, [
    'image_quality_unverified', 'model_applicability_unverified', 'roi_unverified',
  ]);
});
test('invalid NaN and infinity scores are never allowed to bypass review', () => {
  for (const score of [NaN, Infinity, -Infinity, undefined]) {
    const d = run(score);
    assert.equal(d.code, 'review_required');
    assert.equal(d.score, null);
    assert.ok(d.reasonCodes.includes('invalid_score'));
  }
});
test('normal candidate requires an approved matching calibration and all gate passes', () => {
  const d = run(0.5);
  assert.equal(d.code, 'normal_candidate');
  assert.equal(d.label, '정상 후보');
  assert.equal(d.requiresHumanReview, false);
  assert.equal(d.isFinalVerdict, false);
  assert.equal(d.calibrationId, 'calibration-2026-01');
});
test('normal boundary is included in normal candidate', () => {
  assert.equal(run(1.5).code, 'normal_candidate');
});
test('uncertain band is review-required, including scores near boundaries', () => {
  for (const score of [1.50001, 2.5, 3.4999]) {
    const d = run(score);
    assert.equal(d.code, 'review_required');
    assert.deepEqual(d.reasonCodes, ['inside_uncertain_band']);
  }
});
test('anomaly candidate at and above the upper bound needs human review', () => {
  for (const score of [3.5, 50]) {
    const d = run(score);
    assert.equal(d.code, 'anomaly_candidate');
    assert.equal(d.label, '이상 후보');
    assert.equal(d.requiresHumanReview, true);
    assert.equal(d.isFinalVerdict, false);
  }
});
test('each safety gate can independently block automatic normal candidate', () => {
  for (const gate of Object.keys(checks())) {
    const changed = {...checks(), [gate]: 'failed'};
    const d = run(0, {checks: changed});
    assert.equal(d.code, 'review_required');
    assert.ok(d.reasonCodes.some(s => s.includes(gate === 'quality' ? 'quality' : gate === 'applicability' ? 'applicability' : 'roi')));
  }
});
test('calibration on different model revision is not accepted', () => {
  const profile = calibration();
  profile.modelRevision = 'outdated-model';
  assert.equal(isApprovedCalibration(profile, revision), false);
  assert.deepEqual(run(0, {calibration: profile}).reasonCodes, ['calibration_unapproved_or_mismatched']);
});
test('unapproved and incomplete calibration never classify as normal', () => {
  for (const status of ['draft', 'pending', 'invalid']) {
    const profile = {...calibration(), status};
    assert.equal(run(0, {calibration:profile}).code, 'review_required');
  }
  const profile = calibration();
  delete profile.evidence.approvedBy;
  assert.equal(run(0, {calibration:profile}).code, 'review_required');
});
test('calibration and independent evaluation data must differ', () => {
  const profile = calibration();
  profile.evidence.evaluationSetId = profile.evidence.calibrationSetId;
  assert.equal(isApprovedCalibration(profile, revision), false);
  assert.equal(run(0, {calibration:profile}).code, 'review_required');
});
test('invalid and inverted margin cannot silently classify', () => {
  for (const bounds of [{normalMaxScore:3.5, anomalyMinScore:1.5}, {normalMaxScore:2, anomalyMinScore:2}, {normalMaxScore:NaN, anomalyMinScore:5}]) {
    assert.equal(run(0, {calibration:{...calibration(),...bounds}}).code, 'review_required');
  }
});
test('normal decision cannot mutate into final approval', () => {
  const d = run(0.8);
  assert.throws(()=>{d.isFinalVerdict=true;}, TypeError);
  assert.throws(()=>{d.reasonCodes.push('approved');}, TypeError);
});
