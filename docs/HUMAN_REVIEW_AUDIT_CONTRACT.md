# VisionQC AI — 작업자 판정 및 변경 감사 이력 계약 (ChatGPT 담당)

## 구현 목적

AI가 출력하는 `정상 후보 / 확인 필요 / 이상 후보`는 **최종 작업자 판정이 아니다**. 과거 AI 점수, 모델 버전, 히트맵, 후보 결과를 변경하지 않고, 별도의 추가형 IndexedDB `humanReviewEvents`에 사람의 결정만 기록한다.

## 판정 API

`openBrowserInspectionService()`가 반환하는 서비스에서 다음을 사용할 수 있다.

```ts
const existing = await service.latestHumanReview(inspectionId);
// 첫 판정은 expectedRevision: 0, 변경은 조회한 최신 revision을 지정한다.
const event = await service.recordHumanReview({
  inspectionId,
  verdict: 'defective', // 'normal' | 'defective' | 'reinspection'
  operatorName: '작업자 식별명',
  reason: '눈으로 확인한 결함 부위와 변경 사유',
  expectedRevision: existing?.revision ?? 0,
});
const fullHistory = await service.listHumanReviewHistory(inspectionId);
const counts = await service.summarizeHumanReviews({sourceType: 'user'});
```

- 모든 판정에서 작업자 식별명(1~120자)·사유(1~2000자)·유효한 판정 코드·현재 revision을 **필수**로 받는다.
- `recordedAt`은 시스템에서 자동 생성한다. **브라우저 시계의 기록이며, 외부 공인 시각 인증은 아니다.** 사용자 입력 식별명 역시 인증된 계정이 아닌 로컬 표기다.
- 최초 이벤트 revision 1, 이후 2, 3…으로 증가하며 이전 이벤트 ID와 연결된다. 이미 저장한 이벤트와 원래 `inspections` AI 스냅샷은 `put`으로 변경하지 않는다.
- 판정 수정은 이전 이벤트를 덮어쓰는 작업이 아닌 새로운 판정 이벤트를 추가하는 작업이다.
- 다중 탭·오래된 화면에서 제출한 `expectedRevision`이 최신과 다르면 `human_review_revision_conflict`를 반환한다. 오류를 무시해 자동 덮어쓰지 않는다.
- **`held` 품질 보류 검사는 `reinspection`만 가능.** 정상·불량 확정 불가.
- `reinspection`은 '재검사 요구'라는 작업자 상태일 뿐, 원본 재검사 사진이나 검사를 자동 생성하지 않는다.
- `normal`과 `defective`는 사용자 판단 기록이다. AI가 확정하거나 제품 출고를 보증한 것으로 표시하면 안 된다.

## IndexedDB 호환성과 명시 삭제

- DB 이름 `visionqc-inspections-v1` 유지, `DB_VERSION = 3`으로 **추가형 업그레이드**.
- 기존 v1 원본/검사/히트맵과 v2 대기열을 보존한 채 `humanReviewEvents` 스토어와 `byInspection` 인덱스만 추가한다.
- 검사 삭제를 사용자가 명시 요청하면 **같은 트랜잭션에서** 해당 검사의 모든 작업자 이벤트와 히트맵·검사·(참조가 끊긴) 원본을 정리한다. 연결된 재검사 자식이 있을 때 부모 삭제 방지 규칙도 유지한다.
- 이벤트만 따로 변경·삭제하는 API는 제공하지 않는다. 외부로 내보낸 백업은 삭제할 수 없다.

## 통계 해석

`summary({sourceType})`는 해당 **검사 실행 ID**의 최신 작업자 판정별 횟수 및 미검토 횟수만 제공한다. 같은 제품의 서로 다른 사진이나 재검사 결과가 물리적 제품 단위 중복 없이 집계된다는 근거는 없다. 따라서 `uniqueProducts`와 `confirmedProductDefectRate`는 계속 `null`이다. 사용자 데이터와 시연 데이터는 별도로 집계한다.

## Antigravity/UI 인계

- 기존 `get(id).inspection.humanVerdict`는 과거 AI 스냅샷 호환을 위해 `null`이다. 작업자 판정 화면에서는 **별도** `latestHumanReview()`/`listHumanReviewHistory()`를 조회해야 한다.
- 작업자 식별명·사유 입력, AI 후보와 작업자 판정 구분, 판정 변경 히스토리 및 버전 충돌 재조회 UX를 구현한다.
- `service.close()`를 await해 미완료 판정 트랜잭션까지 종료한 뒤 연결을 해제한다.
- 실제 작업장 신뢰성·정확도, 로그인 신원 확인, 인증/권한/감사 수집의 외부 위변조 방지 등은 아직 구현/검증 대상이다.

## 자동 검증

`tests/humanReviewModel.test.mjs`, `tests/humanReviewDb.test.mjs`는 순수 검증·v2→v3 마이그레이션·이벤트 불변·동시 판정 충돌·저장 실패 원자성·삭제 연관 정리·통계 출처 분리를 검증한다. CI 결과와 별개로 실제 Windows Chrome ONNX/카메라 연동은 미검증이다.
