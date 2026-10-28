# VisionQC AI — 연속 검사 대기열·중단 복구 계약

## 확정 정책

- 66단계: 한 번에 **한 장만** 추론, 현재 검사 중일 때 **대기 사진 최대 한 장**.
- 67단계: 개별 사진 오류면 해당 건만 실패 처리하고 다음 검사 계속. 모델/네트워크/저장소 등 시스템 오류면 대기열 일시중지.
- 68단계: 종료·새로고침 중단 작업은 IndexedDB에 보존하며 **반드시 사용자가 수동 재개**.
- 69단계: 동일 브라우저에서 하나의 검사 탭만 허용 (기존 Web Locks 그대로 사용).

## API

```ts
const service = await openBrowserInspectionService();
const job = await service.enqueueInspection({file,sourceType:'user',roi:null});
const queue = await service.listInspectionQueue(); // 파일 Blob을 제외한 메타정보
// 재시작 후에도 아래 호출 전에는 아무 이미지도 자동 실행하지 않는다.
const report = await service.startInspectionQueue();
// report = {completed,failedImage,haltedOn,message,state}
// 사용자가 취소 승인한 경우에만:
await service.cancelQueuedInspection(job.id);
// 사용자가 실패 이미지를 재검토하고 승인한 경우에만:
await service.retryFailedQueueImage(job.id);
await service.close();
```

`startInspectionQueue()`는 진행 중에 반복 호출되어도 같은 실행 Promise를 공유한다. 검사 단위의 식별자 `qi-<uuid>`가 최종 불변 검사 ID가 된다. 검사 성공 직후 큐 완료 기록에 실패했다면 재시작 후 동일 ID가 이미 검사 저장소에 있는지 확인해 중복 저장 없이 완료로 복구한다.

## IndexedDB

- DB 이름 `visionqc-inspections-v1`, **DB_VERSION=3** (현재; v2 대기열 보존 + 작업자 판정 저장소 추가). 버전 1의 `sourceImages`, `inspections`, `heatmaps` 유지. `inspectionQueue` 스토어 추가(v2); 작업자 판정 이벤트 스토어 추가(v3).
- 상태: `queued`, `running`, `interrupted`, `paused_system`, `completed`, `failed_image`, `canceled`.
- 큐 작업의 파일 Blob은 불변 검사 결과가 저장될 때까지 큐에 보존한다. `completed`나 명시적 `canceled`는 큐 Blob 참조를 비워 저장 공간을 절약한다. **검사 원본과 검사 기록은 자동 삭제하지 않는다.**
- 페이지 재개 시 `running` 상태는 `interrupted`로 기록만 변경. 사용자가 `startInspectionQueue()`를 다시 눌러야 처리됨.
- 저장한 큐 작업을 사용자 동의 없이 재시도하지 않는다. 시스템 오류는 계속 진행하지 않고 `paused_system` 반환.
- 사용자·데모 검사 출처, ROI·LOT·제품 번호·재검사 관계는 큐에서 검사 서비스로 전달한다.

## 현재 제한

실제 Windows Chrome에서 ONNX/카메라/브라우저 크래시 복원은 테스트 전이다. 브라우저 저장 공간 제한과 실제 저장 용량은 기기별로 다르며 비상업적 모델 사용 조건은 그대로 유효하다. 모든 자동 테스트는 계약·상태 전이·트랜잭션 보존 확인이며 산업용 품질 판정 정확도와 무관하다.
