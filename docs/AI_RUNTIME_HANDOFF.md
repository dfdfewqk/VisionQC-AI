# VisionQC AI — PatchCore 브라우저 실측 검증 인수인계

## 이번 변경 범위 (ChatGPT / work/ai-runtime)

- 모델은 Hugging Face `f1705b3e17bb7eecd0d192fd15b59fabbde5b0a9`의 고정 리비전만 사용한다.
- `backbone.onnx` (49,734,896 bytes / SHA-256 `220153c1693b2fc5a00b9f3261c35ab4ec3d66ac2e554d596407a8e83c867e5e`), `knn_metal_nut.onnx` (53,026,215 bytes / SHA-256 `32b3aa7b53bc043d9b70ccf90d7d5806c4c65646c0c15c7a3afaf1b5eebc1d1d`)를 내려받아 검증한 후만 추론에 사용한다.
- 무결성 실패 시 모델을 캐시하지 않는다. 캐시에 손상된 파일이 있으면 삭제 후 다시 내려받는다. 캐시 불능은 다운로드 자체를 막지 않는다.
- 세션 초기화에서 실패하면 부분 생성 세션도 해제한다. 사용자 요청의 추론과 모델 메모리 해제는 같은 작업 대기열을 사용한다.
- `thresholds.json`은 `metal_nut.threshold` 유효성 검사 후 사용한다. 공개 test-set 기반 임계값은 현장 정확도 증빙이 아니다.

## Antigravity / Windows Chrome 실제 검증 (아직 미실행)

1. 최신 `develop` 체크아웃, Node.js 22+, `npm install`, `npm run dev` 실행.
2. Chrome에서 표시된 로컬 주소 열기. 개발자 도구 Network에서 `backbone.onnx`와 `knn_metal_nut.onnx`가 위 리비전 URL에서 수신되는지 확인.
3. 실제 정상 너트 사진 한 장을 업로드하고 실제 ONNX 추론 실행. Console 오류, 입력/출력, 점수, 히트맵 유무, 최초 로딩/실행 시간 기록.
4. 실제 결함 너트 사진으로 반복하고, 점수를 품질 판정으로 단정하지 말 것.
5. 새로고침 후 동일 사진 재실행. CacheStorage 캐시를 사용해 대형 모델 재다운로드가 발생하지 않는지 확인.
6. DevTools Offline 또는 네트워크 차단에서 캐시 재사용 확인. 캐시 삭제 후 오프라인일 때 사용자에게 연결 오류가 표시되는지 확인.
7. `모델 메모리 해제` 후 재실행, 다른 사진 검사까지 반복하여 세션/브라우저 메모리 오류가 없는지 확인.
8. 기록: Chrome 버전, OS, 최초 추론 시간/재추론 시간, 다운로드·캐시 상태, 오류 로그, 정상/결함 각 이미지 출처. 실제 사진은 원본 출처·공개 라이선스를 별도로 확인.

## 완료 구분

- Node 단위 테스트 및 GitHub CI TypeScript/Vite 빌드는 **코드 검증**.
- 실제 브라우저 다운로드·CORS·WASM ONNX 실행·히트맵과 실측 정확도는 **별도 현장 검증이 필요**.
- 나중에 자동 너트 탐지/ROI를 구현할 때 `src/ai/modelAssets.mjs`는 유지하고, AI 엔진 연동은 함수 계약에 따라 통합한다.

모델 출처: https://huggingface.co/yandyassine/patchcore-mvtec-ad (CC BY-NC-SA 4.0, 비상업적 시연 한정).
