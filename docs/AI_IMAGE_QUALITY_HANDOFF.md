# VisionQC AI — 4단계 이미지 품질 사전 검사 계약

## 구현 범위

- `src/ai/imageQuality.mjs`: 브라우저 Canvas에서 추출한 **224×224 중앙 크롭**과 원본 이미지 크기를 입력받는 순수 함수. JPEG·PNG·WebP 파일 메타데이터, 원본 해상도, 밝기·노출·저대비·미세윤곽 부족(초점 흐림 가능성)·투명 영역을 점검한다.
- `src/ai/patchcore.ts`: 파일 메타데이터 검사 → 이미지 열기 → 크기 검사 → 중앙 크롭 품질 검사 → (문제 없을 때만) 정규화 및 ONNX 실행. 문제 사진에 대해 모델을 새로 다운로드하거나 추론하지 않는다.
- `tests/imageQuality.test.mjs`: 정상 텍스처, 초저해상도, 과다 노출, 너무 어두움, 부드러운 흐림, 정보 부족, 투명 PNG, 버퍼 오류, 파일 형식 및 용량 관련 테스트.

## 중요한 안전 구분

- `inspectImageInput()` / `inspectImageDimensions()` / `assessImageQuality()`의 결과 `status`는 `hold` 또는 `preflight_ok`.
- **`preflight_ok`는 품질 확정 승인이 아니다.** `qualityVerifiedForClassification:false`, `requiresHumanReview:true`, `policyKind:'uncalibrated_center_crop_preflight'`를 유지한다. 실촬영 검증 전에는 `candidateDecision.checks.quality='pass'`로 매핑 **금지**.
- 품질이 심하게 나쁘면 `ImageQualityHoldError`를 발생시킨다. 구조는 `name:'ImageQualityHoldError'`, `code:'image_quality_hold'`, `recoverable:true`, `report:{ status:'hold', reasonCodes, measurements? }`. *검사 보류/재촬영 유도*이며 모델 결함 감지나 작업자 확정 불량이 아니다.
- 사용자에게 보여주는 한국어 안내는 예외의 `message` 또는 `QUALITY_REASON_MESSAGES[reason]`를 사용한다. 지금 `src/main.tsx`는 Antigravity 담당이므로 수정하지 않았다. **기존 UI에서는 해당 예외를 일반 '오류' 상태로 보여줄 수 있으므로, Antigravity에서 별도 '품질 확인 필요' 상태와 재촬영 버튼을 표시해야 한다.**
- PNG의 투명 영역은 검은색 배경으로 오인하지 않도록 보류한다.

## 이 단계에 사용한 *잠정* 방어 임계값

| 항목 | 코드상 잠정 기준 | 근거/제한 |
|---|---|---|
| 원본 해상도 | 짧은 변 256px 미만 보류 | 기존 256px resize → 224px crop에서 상향 리사이즈 방지용, 모델 정확도 요구 해상도가 아님 |
| 입력 파일 | JPEG/PNG/WebP, 0 < size <= 40 MiB | 브라우저 메모리 안전 가이드, 환경별 검증 필요 |
| 이미지 크기 | 8천만 화소 초과 보류 | 메모리 보호, 환경별 조정 가능 |
| 심한 암부/명부 | 평균 휘도 <20 또는 >235, 또는 극단적 검/백 픽셀 98% 이상 | 조명 문제의 초기 휴리스틱, 산업용 합격 기준이 아님 |
| 투명 영역 | 2% 초과 보류 | 실물 사진 출처·합성 가능성 검토 필요 |
| 정보 부족 | 표준편차 <12 | 무늬가 원래 적은 물체도 오탐 가능. 재촬영/수동 확인 권고 |
| 흐림 가능성 | Laplacian 분산 <12 (저대비 제외) | 단일 중심 크롭 기준 휴리스틱. 저질감 금속·배경에 대해 오탐/미탐 가능 |

**중요:** 이 숫자들은 현장 샘플로 보정된 값이 아니며 결함탐지 정확도 지표로 쓰면 안 된다. 특히 중심 크롭 전체의 선명도는 **너트 ROI만의 선명도**를 입증하지 못한다. 자동 너트 탐지/ROI 구현 후 ROI 기반 측정으로 연결해야 한다.

## 다음 담당 통합 계약

1. Antigravity: `ImageQualityHoldError`를 `error.code === 'image_quality_hold'`로 인식해 `확인 필요`와 `reasonCodes` 설명/재촬영을 화면에 표시한다. 사진은 원본으로 보존하고 판정 점수는 만들지 않는다.
2. Antigravity: 카메라·탐지 완료 후 실제 너트 ROI의 비율과 방향을 고려해 `assessImageQuality`를 실행하되 기존 중심 크롭 사전 검사 정책을 생산 품질 승인값으로 사용하지 않는다.
3. ChatGPT: 모델 적합성·ROI·보정 이력 검증은 여전히 별도 게이트이며 이 사전 검사는 자동 정상/불량 후보 판정을 활성화하지 않는다.

## 확인 사항

- Node 단위 테스트는 휴리스틱 구현과 오류 분기를 검증한다.
- Windows Chrome 실제 사진·WebAssembly 실행·실환경 임계값 보정은 **미검증**. 앞으로 수동 검증이 필요하다.
