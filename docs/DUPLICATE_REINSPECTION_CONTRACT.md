# VisionQC AI — 동일 사진 중복 감지·재검사 관계·중복 집계 계약

## 목적과 적용 범위

확정 설계 79~80단계와 75·83~88단계 통계의 구분을 존중한다.

- **동일 원본**: 업로드한 파일의 **동일 바이트 SHA-256**가 같음. 다른 시점·각도에서 촬영한 사진은 별개 원본이다.
- **동일 검사 시야(view)**: 동일 원본/데이터 출처/상태에 더해 같은 ROI(x, y, width, height, 회전각). 이는 **동일 물리 제품**을 증명하지 않는다.
- **검사 시도(attempt)**: 원본이 동일해도 호출 때마다 고유 검사 ID를 발급하며 기존 검사 기록은 수정/덮어쓰지 않는다.
- **재검사(reinspection)**: 사용자가 과거 기록을 명시적으로 지정했을 때만 `reinspectionOf`로 연결한다. 자동으로 합격/불합격을 확정하거나 과거 점수를 덮어쓰지 않는다.

## ChatGPT 구현 (src/storage · src/ai)

`openBrowserInspectionService()`에서:

```ts
const session = await openBrowserInspectionService();
const duplicate = await session.findDuplicates({file, roi: selectedRoi, sourceType: 'user'});
// {sourceId, matchingSource, matchingView, hasExactSource, hasMatchingView}
// 파일이 동일한 경우를 사용자에게 알리되, 다른 ROI는 별개 검사 허용.
const first = await session.inspectAndSave({file, roi: selectedRoi});
const repeat = await session.inspectAndSave({file, roi: selectedRoi, reinspectionOf: first.id});
// 명시 재검사 관계. 원본과 이미지 출처, ROI, 상태가 모두 일치해야 저장 가능.
const stats = await session.statistics({sourceType:'user'});
await session.close();
```

- `reinspectionOf`는 새 검사 스냅샷의 선택 필드(기본 `null`)이며 스냅샷 스키마 v3에 추가됐다. **IndexedDB DB 버전은 1 그대로**이므로 기존 스토어 변경 없이 과거 기록을 조회한다. 이전 기록의 `reinspectionOf`가 없으면 독립 검사다.
- 재검사 부모가 없거나 이미 삭제됐거나 원본 해시·ROI·회전각·데이터 출처·상태가 다른 경우 **동일 IndexedDB 쓰기 트랜잭션에서 전체 저장을 취소**한다. 다른 사진의 같은 물리 제품 재검사 연결은 추후 제품 식별·작업자 확인 프로세스에서 구현한다.
- 부모 검사에 연결된 재검사 자식이 남아 있는 상태에서 부모 삭제는 거부한다. 사용자는 **가장 최근 재검사부터 명시적으로 삭제**할 수 있다. 삭제 시 이전 기록의 원본 이미지는 다른 검사와 공유되면 보존한다.
- 실제 검사 화면에서는 `findDuplicates`로 **추론 이전에** 같은 원본·시야의 존재를 표시할 수 있다. **중복 경고가 자동으로 검사를 차단하거나 재검사 관계를 생성하지는 않는다.** UI에서 새 검사/명시 재검사를 선택해야 한다.

## 통계 집계 및 안전한 제한

`statistics({sourceType:'user'})`는 **해당 브라우저에 저장된 레코드 전체**를 입력으로 다음 정보를 반환한다:

- `totalAttempts`: 보존된 전체 검사 시도 수
- `distinctViews`: 중복을 제거한 원본-ROI 단위 시야 수
- `repeatedAttempts`: 같은 시야에 대한 추가 검사 횟수
- `inferredViews`, `heldViews`: 동일 시야의 가장 최신 보존 상태 기준
- `aiCandidateViewCounts`: 같은 시야에서는 최신 AI 후보 **한 번만** 계산. AI 후보는 작업자 확정 불량과 다르다.
- `uniqueProducts`, `confirmedDefectRate`, `confirmedInspectionRate`: **`null`**. ID만 입력되었다고 신뢰 가능한 제품 식별이나 확정 판정이 되는 것은 아니다.

샘플(`demo`)과 사용자(`user`)는 출처별로 별도 조회·집계한다. 동일 원본 바이트라도 출처가 다르면 섞지 않는다. 원검사·재검사 이력은 모두 남고, 각 조회는 삭제한 데이터를 제외하여 재계산한다.

## 검증·남은 작업

- `tests/inspectionLineage.test.mjs`: 시야 식별, ROI 구별, 중복 집계, 샘플 구별, 연결 관계 9개 테스트.
- `tests/inspectionDb.test.mjs`: fake-indexeddb로 동일 시야 검색, 명시 재검사, 원자적 오류 처리, 삭제 보호, 서비스 전달까지 검증.
- 미완료: 실제 Chrome·제품 ID 신뢰 확인, 작업자 최종 판정/재작업/폐기, LOT 고유 제품 불량률, 화면 중복 안내. 이를 단위 테스트 성공으로 완료 처리하지 않는다.
