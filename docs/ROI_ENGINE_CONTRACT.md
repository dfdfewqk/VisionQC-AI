# VisionQC AI — AI 엔진 ROI·좌표 보존·다중 탭 계약

## 현재 ChatGPT 개발 결과

- `src/ai/roiGeometry.mjs`는 **EXIF 회전 반영 후 원본 비트맵의 픽셀 좌표계**를 사용한다. CSS 렌더링 크기, 화면 확대 비율, 기기 DPI 좌표를 직접 넣지 않는다.
- `runMetalNutPreflight(file, {roi?: {x,y,width,height,rotationDegrees?}})`의 선택 ROI는 ONNX 입력 224×224 픽셀로 변환된다. `rotationDegrees`는 화면의 아래 방향을 양의 y로 사용하는 원본 비트맵 기준 각도다. ROI 모서리가 원본 바깥으로 나가면 실패한다.
- ROI 크기/회전은 항상 결과 `roiTransform:{x,y,width,height,rotationDegrees,source,modelSize:224}`로 돌려주며, 원본 이미지의 히트맵 역변환도 같은 정보를 사용한다. `source`는 `center_preflight` 또는 `user_selected_unverified`다. 자동 탐지 완성 여부를 거짓 주장하지 않는다.
- `openBrowserInspectionService()`의 `inspectAndSave({file,roi?,sourceType?,lotId?,productId?})`가 ROI 입력을 최종 추론까지 넘기고, IndexedDB에 `roi`/`roiTransform`·원본·PNG 히트맵을 저장한다. ROI 변환은 스냅샷 v2부터 보존한다. 최신 스냅샷 v3에는 재검사 참조(`reinspectionOf`)도 추가되지만 IndexedDB 스토어 버전(`DB_VERSION=1`)은 바꾸지 않았다. 과거 기록은 `roiTransform` 없이 조회 가능하다.
- `src/storage/inspectionLock.mjs`는 Chromium Web Locks의 `ifAvailable`을 사용하여 **동일 프로필의 동시 검사 탭 두 개를 방지**한다. 연결이 이미 있으면 `code:'inspection_tab_busy'` 오류를 보여주고, 앱 해제 시 **반드시** `await service.close()`를 호출한다. 이 함수는 `src/ai/serviceLifecycle.mjs`를 통해 진행 중인 추론/IndexedDB 작업을 기다린 뒤 DB 연결과 Web Lock을 순서대로 해제한다. 종료 도중 또는 종료 후 새로운 작업은 `code:'inspection_session_closed'`로 거절되며 `close()`를 여러 번 불러도 해제는 한 번만 수행한다. 브라우저가 Web Locks를 지원하지 않으면 검사 실행을 안전하게 보류한다.
- 파일 품질 사전검사는 선택 ROI 원본 너비·높이가 224px 미만일 경우 `roi_insufficient_resolution`을 반환한다. 세부 선명도·노출 기준은 현장 미보정 사전검사만 의미한다.
- PNG 히트맵은 `makeOverlayBlob`으로 인코딩해 base64/data URL의 추가 메모리 복제를 피한다. 기존 UI용 `makeOverlay` 함수는 그대로 유지한다.

## Antigravity에게 남기는 연결 지침

1. 탐지/수동 ROI UI에서 픽셀 좌표를 원본 비트맵에 맞추고 `inspectAndSave({file,roi})`를 호출한다. UI 박스만 움직이고 중앙 크롭을 추론하는 **가짜 ROI 검사 금지**.
2. 임의로 `checks.roi='verified'`, `checks.applicability='pass'` 또는 보정 프로필을 설정하지 않는다. 실제 모델 적합성·ROI 검증·보정 근거가 없으므로 현재 후보는 **확인 필요**다.
3. 원본 사진과 결과 히트맵을 나란히 보여주며 저장 후 새로고침/조회/삭제를 검증한다. 동일 원본에서 복수 ROI 검사 ID가 독립적으로 남는지 확인한다.
4. 검사 화면 하나에만 `openBrowserInspectionService`를 유지한다. 컴포넌트 재렌더링마다 DB를 새로 열지 않는다. 화면을 닫거나 Unmount할 때 `await service.close()`를 호출한다. 중복 탭 오류는 명확히 표시한다.
5. 실제 Chrome에서 회전 ROI의 히트맵 원본 위치, 작은 ROI 보류, 파일 손상, 재촬영 흐름, 브라우저 종료 후 세션 잠금 해제 및 모델 WASM/CORS를 확인한다.

## 검증 범위

- 좌표 역변환 수학·입력 경계·저장 계약·잠금 추상 인터페이스를 단위 테스트한다.
- **실물 사진의 ROI 탐지 정확도, 실제 브라우저 Canvas 렌더링/카메라/ONNX 결과 정확도는 미검증**이며 Antigravity와 현장 브라우저 통합 시 검증한다.
- 모델 라이선스는 CC BY-NC-SA 비상업적 시연 범위로 제한한다.
