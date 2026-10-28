# VisionQC AI — ChatGPT 담당 구현 완료 및 Antigravity 인수인계

## 기준과 상태

- 대상 저장소: `dfdfewqk/VisionQC-AI`, 통합 브랜치 `develop`.
- v1.0 1~95단계 **설계 확정**. 첫 공개 핵심 구현과 후속 확정 기능은 `docs/INTEGRATION_AUDIT.md`를 기준으로 구분한다.
- **ChatGPT 담당 선행 작업:** ONNX 출력 계약, 모델 무결성/캐시/세션, 보정 근거 기반 후보 판정, 이미지 품질 보류, IndexedDB 기본 저장 및 AI↔저장소 연결, **ROI 입력·역좌표 변환·다중 탭 잠금·재검사 연결·중복 시야 집계** 구현. 세부 API는 `docs/ROI_ENGINE_CONTRACT.md`, `docs/DUPLICATE_REINSPECTION_CONTRACT.md` 참조.
- **실제 Chrome에서 두 ONNX 모델을 읽고 사진으로 추론 성공했음을 입증한 것은 아니다.** 학습 모델의 산업 현장 성능도 미검증이다.
- 정상 후보·이상 후보는 **모델 검증, ROI/적용 가능 범위, 사진 품질, 외부에서 승인된 보정값이 모두 갖춰진 경우에만** 발생한다. 현재 중앙 크롭 사전 검증은 `확인 필요`가 정상이다.
- 모델/샘플 이미지 저작권: CC BY-NC-SA 비상업 제한 확인. 사전 승인 없는 라이선스 변경·상용 사용 불가.

## Antigravity가 호출할 브라우저 API

`src/ai/browserInspectionService.ts`:

```ts
import {openBrowserInspectionService} from './ai/browserInspectionService';
const service = await openBrowserInspectionService();
const record = await service.inspectAndSave({file: selectedFile, sourceType:'user', roi: selectedRoi}); // roi는 선택사항. 원본 비트맵 좌표
// 검사 시작 후 정상 추론 또는 이미지 품질 보류일 때만 저장 후 반환.
// 모델 다운로드/ONNX 실행 오류는 reject. 오류를 제품 '불량' 또는 '이미지 품질 문제'로 둔갑시키지 않음.
const duplicates = await service.findDuplicates({file:selectedFile,roi:selectedRoi,sourceType:'user'});
// 중복 사진/ROI는 안내하고 새 검사 또는 명시 재검사를 사용자가 선택하게 한다.
const rescan = await service.inspectAndSave({file:selectedFile,roi:selectedRoi,reinspectionOf:record.id});
const stats = await service.statistics({sourceType:'user'}); // 고유 시야 수, 실물 제품 수/확정 불량률은 null
const rows = await service.list({sourceType:'user', limit:50, offset:0});
const details = await service.get(record.id); // {inspection, source, overlay}
// 삭제는 화면에서 사용자 확인을 받은 이후에만 호출:
await service.remove(record.id);
await service.close(); // 진행 중 검사/저장 완료까지 대기한 뒤 DB 및 탭 잠금 해제
```

`src/storage/inspectionDb.mjs` 원본 해시 키는 **동일 파일 바이트**를 뜻할 뿐, 사진 두 장이 같은 물리적 너트라는 증거가 아니다. 동일 사진에 ROI를 여러 개 검사하면 검사 ID를 다르게 저장할 수 있다. 원본 Blob은 공유하고, 검사별 결과·히트맵 PNG는 별도 저장한다.

`src/storage/inspectionModel.mjs` 저장 구조(스냅샷 v2에서 회전 ROI 변환 추가, v3에서 재검사 참조 추가):

- **inferred:** 검사 ID, 원본 ID, 작성 시각, 테스트/사용자 데이터 구분, ROI와 ROI 변환 정보(있는 경우), 원시 점수, 참조 임계값, AI 후보와 사유, 품질 사전 점검, 모델 버전, 처리시간, 사람 최종 판정 `null`.
- **held:** 검사 보류 사유·시각·원본. 미실행 AI 점수/후보/임계값은 `null`로 둔다. 미해독 사진의 픽셀 크기는 **확인 불가(null)** 로 둔다.
- 원본 사진은 사용자의 브라우저 IndexedDB 내부에만 저장되고 서버 업로드 코드는 포함되지 않는다. 캐시 저장소는 모델 파일만 보관한다.
- 검사 결과는 변경 불가(add)로 보관한다. 기존 검사 ID 재사용은 저장소 트랜잭션을 취소한다.
- 검사 삭제 시 연결된 재검사 기록이 남아 있다면 부모 삭제를 거부한다(재검사부터 삭제). 같은 원본을 사용하는 **다른 검사 기록이 없을 때만** 원본을 제거한다. 삭제·저장은 단일 readwrite 트랜잭션에서 처리한다.
- 검사 목록은 원본 Blob과 히트맵을 기본 조회에 포함하지 않아 브라우저 메모리를 절약한다.

## 수정 금지 경계

- ChatGPT 선행 파일: `src/ai/patchcore.ts`, `src/ai/modelAssets.mjs`, `src/ai/modelContract.mjs`, `src/ai/geometry.mjs`, `src/ai/imageQuality.mjs`, `src/ai/candidateDecision.mjs`, `src/ai/inspectionService.mjs`, `src/ai/serviceLifecycle.mjs`, `src/ai/browserInspectionService.ts`, `src/storage/*`.
- Antigravity 작업 영역: `src/main.tsx`, `src/components/`, `src/styles/`, `src/camera/`, `src/detection/`. 필요하면 접점 함수를 먼저 합의한 후 수정.
- `main`은 안정 배포용으로 유지하고, Antigravity는 자체 기능 브랜치→`develop` PR 사용. CI 통과 전 병합 금지.

## Antigravity에서 반드시 확인할 브라우저 테스트

- **ROI 엔진 연결은 준비됨:** 선택 ROI를 `inspectAndSave({file,roi})`로 넘기면 원본 좌표를 저장하며 추론/히트맵에 실제로 반영된다. 다만 자동 탐지 모델과 사용자 ROI 검증은 여전히 미구현.
- Chrome 활성 검사 탭 한 개만 허용. 다른 탭에서는 `inspection_tab_busy`를 안내하고 종료 시 반드시 `await service.close()` 호출. 이 호출은 진행 중인 검사/조회/삭제가 종료될 때까지 기다린 후 DB와 Web Lock을 닫으며 종료가 시작된 뒤의 새 작업에는 `inspection_session_closed` 오류를 반환한다. React의 async unmount 정리에서는 Promise를 처리하고 중복 호출해도 안전하다.


1. Windows Chrome 최신 버전에서 `npm install`, `npm test`, `npm run build`, `npm run dev`를 실행한다.
2. CORS/CacheStorage 및 SHA-256 검증 후 모델 두 개의 WASM 세션 생성, 정상/불량 너트 사진 각 1장 이상 실제 추론 및 히트맵 계산을 확인한다.
3. 정상/결함 *후보* 판정은 승인된 분리 보정·평가 데이터 전까지 **확인 필요**로 유지한다.
4. 실제 감지 너트 ROI·수동 보정, 사진 촬영 즉시 자동 검사, 카메라 실패/권한 거부 대체 업로드 UI 연결을 검증한다.
5. 완성된 브라우저 통합에서 사용자 사진 한 장을 검사해 IndexedDB에 저장→새로고침→목록→원본/히트맵 보기→명시적 삭제→재확인까지 확인한다.
6. 같은 원본의 여러 ROI 검사·사진 형식 오류·저장 공간 부족·모델 다운로드 실패·인터넷 끊김·탭 재접속·다중 탭을 점검한다.
7. 샘플 데이터와 사용자 데이터가 통계에 섞이지 않도록 UI에서 출처를 명시하고, AI 후보와 사람의 최종 판정은 분리한다.

## 완료와 미완료 구분

- 구현/자동 CI 확인: Node 단위 테스트, fake-indexeddb 트랜잭션 검증, TypeScript/Vite 빌드 (실제 CI 결과에 한해서 완료로 기록).
- 아직 필요한 Antigravity 작업: 자동 너트 탐지와 ROI 확인, 카메라·화면, 브라우저로 실제 ONNX 추론/저장/검사 연계 실측.
- 이후 확정된 후속 작업(삭제된 것이 아님): 검토 감사 기록, LOT, PDF/CSV 보고서, 백업/복원, AI 재분석, 통계 대시보드, DeepSeek 관리자 분석.

## 브라우저 검사 대기열 및 수동 복구 (ChatGPT 선행 추가)

- IndexedDB v2는 기존 v1의 원본·검사·히트맵 저장소를 변경하지 않고 `inspectionQueue`를 추가한다. 큐는 사진 Blob과 사용자가 선택한 ROI·LOT·제품번호·재검사 원본을 보존한다. 페이지 종료나 새로고침을 해도 대기열이 삭제되지 않는다.
- `openBrowserInspectionService()`를 열면 이전 `running` 작업은 `interrupted`로 기록된다. **절대로 자동으로 재실행하지 않는다.** 화면에 `listInspectionQueue()` 결과를 표시한 후 사용자가 명시적으로 `startInspectionQueue()`를 눌러 재개한다.
- 사용법: `await service.enqueueInspection({file,roi,sourceType:'user'})`; 작업 실행/수동 복구는 `await service.startInspectionQueue()`; 이력 조회 `await service.listInspectionQueue()`; 사용자가 취소에 동의하면 `await service.cancelQueuedInspection(id)`. 개별 이미지 실패는 원본 보관(`failed_image`) 및 사용자 명시 재시도 `retryFailedQueueImage(id)`를 제공한다.
- 현재 검사가 실행 중인 경우 최대 **대기 사진 한 장**만 등록할 수 있다. 처음부터 검사 시작 전에 대기열에 두 장을 넣는 것은 허용하지 않는다. `inspection_queue_full`을 잡아 안내한다. 한 번에 검사 실행은 오직 한 장이며 `startInspectionQueue()`를 중복 클릭해도 실행 엔진은 공유된다.
- `ImageQualityHoldError`는 기존 검사 결과 `held`로 저장하고 다음 검사로 진행한다. 이미지 해독 오류처럼 파일 자체에 한정된 실패는 해당 사진만 `failed_image`로 기록하고 다음 사진으로 간다. 모델 다운로드·WASM·IndexedDB 오류는 `paused_system`으로 멈추고 나머지 대기 사진은 유지한다.
- 재시작 복구 시 큐 작업 ID를 **불변 검사 ID**로 사용한다. 검사 저장만 성공하고 큐 완료 업데이트 전에 브라우저가 닫힌 경우 기존 ID를 조회해 저장된 결과를 확인한 후 **중복 ONNX 추론 및 중복 검사 기록 생성 없이** 큐를 `completed`로 복구한다.
- 완료된 검사 사진은 검사 원본 저장소에 있으므로 큐의 보조 Blob 참조를 비운다. 실패/중단된 사진은 복구 전까지 큐에 남아 있다. 모델 오류를 이미지 오류나 제품 불량으로 표기하지 않는다.
- CI/fake-indexeddb 테스트는 브라우저 IndexedDB 계약을 검증할 뿐 **실제 Chrome 종료·복원 UI, 카메라 및 모델 ONNX 실행 성공**을 입증하지 않는다. Antigravity가 연결 후 실제 새로고침·닫기·복구를 검증해야 한다.

## 작업자 최종 판정 및 변경 이력 — ChatGPT 추가 구현 (DB v3)

- `src/storage/humanReviewDb.mjs`, `src/storage/humanReviewModel.mjs`: 기존 AI 검사 기록을 변경하지 않는 **추가형** 작업자 판정 및 변경 이벤트 관리.
- `openBrowserInspectionService()`에 `recordHumanReview({inspectionId,verdict,operatorName,reason,expectedRevision})`, `latestHumanReview(id)`, `listHumanReviewHistory(id)`, `summarizeHumanReviews({sourceType})` 연결.
- 판정은 `normal`/`defective`/`reinspection`, 품질 보류 사진은 `reinspection`만 허용. `expectedRevision=0`은 첫 판정, 이후는 최신 판정 이벤트의 `revision`을 사용.
- 실제 사람의 신원 인증이 아닌 로컬 식별명 기록임을 명시; AI 후보와 작업자 최종 판단을 분리 표시한다. 출고 자동 승인과 물리적 제품 단위 불량률을 생성하지 않는다.
- DB v2→v3은 스토어만 추가하고 기존 원본·검사·대기열을 유지한다. 사용자 명시적 검사 삭제 시 연관된 판정 감사 이벤트를 같은 트랜잭션에서 삭제한다.
- 상세 인터페이스와 안전 제한: `docs/HUMAN_REVIEW_AUDIT_CONTRACT.md`.


## 검사 이력 검색·품질 통계 연결 (ChatGPT 작업)

- `service.searchInspectionHistory({sourceType:'user', period:'7d', timezoneOffsetMinutes:540, humanVerdict:'defective',limit:50,offset:0})` 는 검사+최신 작업자 판정을 연결한 메타데이터 목록을 반환한다. 원본 이미지 Blob은 `get(id)`에서만 읽는다.
- `service.qualityStatistics({sourceType:'user',period:'30d',timezoneOffsetMinutes:540})` 는 AI **중복 제거 시야 비율**과 작업자 **확정 검사 실행 비율**을 분리한다. 물리적 제품 불량률은 `null`이다.
- 검색 조건, 시간대, 분모, 미확정 제외 규칙: `docs/INSPECTION_HISTORY_STATISTICS_CONTRACT.md`. 이력/통계 UI는 아직 미구현이며 Antigravity 범위다.
