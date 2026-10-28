# VisionQC AI — 3단계 AI 후보 판정·안전 보류 계약 (ChatGPT 3단계)

## 완료된 코드

- `src/ai/candidateDecision.mjs`는 **실제 ONNX 이미지 점수(raw score)**만 입력받고, 임의로 정규화한 히트맵의 값으로 판정하지 않는다.
- 결과는 `normal_candidate` / `review_required` / `anomaly_candidate`이며 한국어 표시는 `정상 후보` / `확인 필요` / `이상 후보`다. 이 결과는 **사람의 최종 판정이 아니며** `isFinalVerdict: false`이다.
- 정상 후보는 `requiresHumanReview: false`로 *AI 단계의 잠정 분류*만 가능하다. 최종 출고/품질 적합 확정과는 구분한다. 다른 두 상태는 `requiresHumanReview: true`이다.
- 응답 필드: `{ code, label, score, reasonCodes, calibrationId, requiresHumanReview, isFinalVerdict }`. 미확정 사유 코드는 `reasonCodes` 배열로 제공한다.
- 다음 조건이 **전부 충족**되어야 정상/이상 후보 판정이 가능하다. 하나라도 미검증이면 반드시 `확인 필요`가 된다.
  1. `checks: { quality: 'pass', applicability: 'pass', roi: 'verified' }` — 사진 품질, 해당 모델 적용 가능한 너트, 실제 너트 ROI 검사 완료.
  2. `calibration`은 `status:'approved'`이고 로딩한 ONNX 리비전과 같은 `modelRevision`을 가진다.
  3. 보정 식별자 `id`, 사람이 확인한 레이블 `evidence.labelsHumanVerified`, 서로 다른 보정·독립 평가 데이터셋 ID, 승인 담당자의 `approvedBy`를 기록한다.
  4. 별도 데이터에서 근거를 검증한 `normalMaxScore`와 `anomalyMinScore`가 유한한 수치이고 `normalMaxScore < anomalyMinScore`.
- 판정 경계: `score <= normalMaxScore` → 정상 후보, `score >= anomalyMinScore` → 이상 후보, 중간 영역 → 확인 필요. 이 경계값은 실제 자료로 보정 후 승인해야 한다. 코드 내 **임의 경계값은 없다**.
- `thresholds.json`의 참고 임계값은 화면에 표시할 수 있지만, 실제 촬영 사진에 대한 3분류 근거로 사용하지 않는다.

## 현재 통합 상태와 Antigravity 인계

- `runMetalNutPreflight()`의 출력에는 `candidate`가 들어가지만 **현재 중앙 크롭 사전 검증 모드이므로 모든 사진에 대해 기본 `확인 필요`**를 반환한다. 임의의 정상 확정이 발생하지 않도록 한 의도적인 동작이다.
- Antigravity가 담당할 **실제 너트 탐지/ROI 확정과 이미지 품질 검사**, 촬영 환경별 모델 적합성 검증이 완성되기 전에는 `checks`를 모두 통과로 설정하지 말 것.
- 신뢰 가능한 레이블 샘플과 보정·독립 평가 자료가 수집되기 전에는 테스트용 calibration 객체를 생산 설정에 넣지 말 것.
- 결과 화면에서는 AI 후보 상태와 작업자 최종 정상/불량/재검사 판정을 명확히 분리하여 표시한다. 현 버전의 `src/main.tsx`는 Antigravity 관리 파일이므로 변경하지 않았다.

## 검증 범위

- `node --test tests/candidateDecision.test.mjs`로 경계·승인/모델 일치·정보 누락·오류 처리 테스트를 실행할 수 있다.
- Node/CI 단위 테스트 결과는 실제 Chrome ONNX 로딩·실측 정확도 및 적합성 검증을 대체하지 않는다.
