# VisionQC AI — 검사 이력 검색·기초 품질 통계 연동 계약

## 구현 범위

- `src/storage/inspectionHistory.mjs`: 순수 이력 검색·통계 집계. 검사 원본 `inspections` 및 작업자 감사 이벤트 `humanReviewEvents`를 **읽기 전용**으로 합산한다.
- `src/storage/inspectionHistoryDb.mjs`: 두 IndexedDB object store에서 **동일한 readonly 트랜잭션**으로 스냅샷을 읽는다. 원본 Blob과 히트맵은 조회 결과에 포함되지 않는다.
- `src/ai/browserInspectionService.ts`: `searchInspectionHistory`, `qualityStatistics` 메서드 노출. 기존 `list/statistics/summarizeHumanReviews` API와 호환되며 수정하지 않는다.
- IndexedDB 버전 변경 없음: 기존 **DB_VERSION = 3** 보존.

## 호출 예시

```ts
const svc = await openBrowserInspectionService();
const page = await svc.searchInspectionHistory({
  sourceType: 'user', period: '7d', timezoneOffsetMinutes: 540,
  inspectionId: 'qi-', operatorName: '작업자 A', humanVerdict: 'defective',
  limit: 50, offset: 0,
});
// {total, offset, limit, items:[{...inspection,latestHumanReview: event|null}]}
const stats = await svc.qualityStatistics({
  sourceType: 'user', period: '30d', timezoneOffsetMinutes: 540,
});
await svc.close();
```

지원 검색 필터: `sourceType: 'user'|'demo'` (기본 `user`), `status:'inferred'|'held'`, `aiCandidate:'normal_candidate'|'review_required'|'anomaly_candidate'`, `humanVerdict:'normal'|'defective'|'reinspection'|'unreviewed'`, `inspectionId`, `operatorName`, `lotId`, `productId` 부분 문자열, `period:'all'|'today'|'7d'|'30d'|'custom'`, `limit`(1~1000), `offset`(0 이상). `operatorName`/`humanVerdict`는 **가장 최근 판정 이벤트만** 대상으로 필터한다.

- 지정 기간은 **최초 검사 저장 시각 `createdAt` 기준**이지 판정 수정 시각이 아니다.
- `period:'custom'`의 `createdFrom`은 포함, `createdBefore`는 제외하는 ISO-8601 **타임존 명시** 시각 (`2026-10-28T00:00:00+09:00`). 날짜 역순·잘못된 필터는 오류로 보고한다.
- `today/7d/30d`는 로컬 하루 시작점부터 계산한다. `timezoneOffsetMinutes`는 **UTC보다 앞서는 시간대가 양수** (한국 +540). 7일은 오늘 포함 7일, 30일은 오늘 포함 30일. 화면에서 실제 사용자의 날짜/타임존을 전달해야 한다.
- `qualityStatistics`는 출처·기간만 받는다. 작업자/AI 상태 검색 옵션을 그대로 전달하면 암묵적 분모 변경이 일어나지 않도록 **거절**한다.

## 지표 및 분모

| 필드 | 의미 | 분모 |
|---|---|---|
| `totalAttempts` | 사용자/시연 구분 + 지정 기간에서 보존된 전체 검사 실행 수 | 없음 |
| `distinctPhotographicViews` | 같은 원본 **파일 바이트 + 동일 ROI/회전**의 중복을 묶은 검사 시야 수 | 없음 |
| `aiCandidateViewCounts` | 각 시야의 **가장 최근 검사** AI 후보 수 | `inferredViews` |
| `aiAnomalyCandidateViewRate` | 이상 후보 시야 수 ÷ AI 추론 시야 수 | `inferredViews`가 0이면 `null` |
| `humanAttemptCounts` | 각 검사 ID의 **최신 작업자 판정**별 횟수와 미검토 | 검사 실행 수 |
| `humanConfirmedDefectiveAttemptRate` | 작업자 불량 판정 검사 실행 수 ÷ (작업자 정상 + 불량 확정 검사 실행 수) | 확정 검사 실행 수가 0이면 `null` |
| `trendByInspectionDate` | 검사 최초 저장 날짜별 시도/보류/AI 후보/작업자 확정 개수 | 일자별 검사 실행 수 |

**매우 중요한 금지:** `humanConfirmedDefectiveAttemptRate`는 확정 **검사 실행 기준** 비율이다. 동일 제품의 반복 촬영·재검사가 포함될 수 있으므로 실제 제품 불량률, 생산량 대비 불량률, 품질 합격률로 설명하면 안 된다. `uniqueProducts`, `confirmedProductDefectRate`, `confirmedProductInspectionRate`는 현재 `null`로 유지한다. `sourceType:'demo'`는 사용자 통계에 절대 섞지 않는다. 보류/재검사/미검토는 작업자 확정 정상·불량 비율의 분모에서 제외된다.

## 안전성·남은 검증

- 조회·통계 함수는 기록·이미지·판정 이벤트를 수정하지 않는다. 삭제 시 기존 저장소 원자적 삭제 규칙에 따라 다음 조회부터 자동 갱신된다.
- `get(id).inspection.humanVerdict`는 원본 스냅샷 호환 때문에 `null`로 남는다. UI는 `latestHumanReview`를 사용한다.
- 향후 LOT·고유 제품 ID·복수 촬영의 합산 판정은 별도 검증된 정책으로 계산해야 하며 현재 사진 해시만으로 제품을 식별하지 않는다.
- 자동 테스트(fake-indexeddb 포함)는 실제 Windows Chrome의 ONNX 추론·카메라 검증이나 실제 품질 지표의 보정 근거를 대신하지 않는다.
