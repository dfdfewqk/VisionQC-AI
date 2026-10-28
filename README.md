# VisionQC AI v1.0 — 1차 개발본 (v0.1.1 검증 보강)

**현재 단계: AI 엔진과 로컬 데이터 계층 선행 개발본 (실제 브라우저 AI 추론은 아직 미검증).**

이 저장소는 최종 품질검사 제품이 아닙니다. 현재는 이미지 중앙 영역을 PatchCore 모델에 전달하는 **실제 모델 추론 검증 화면**만 구현되어 있으며, 자동 너트 탐지·실제 촬영·LOT·사용자 화면 연동·Vercel 배포는 아직 미완료입니다. IndexedDB 저장 API는 구현했지만 아직 화면에서 호출하지 않습니다. 성공했다고 표시할 수 있는 결과는 직접 실행·검증한 것뿐입니다.

## 2026-10-28 ChatGPT 선행 개발 최신 현황

- **구현:** ONNX 검증·다운로드/세션, 3단계 후보 판정 안전 관문, 이미지 품질 보류, IndexedDB 원본/검사별 기록/PNG 히트맵, AI→브라우저 저장소 연결 API.
- **보류:** 원본이 단순 중앙 크롭인 동안 실제 너트 자동 탐지/적합성 검증이 안 됐으므로 AI 결과는 `확인 필요`로 유지한다.
- **완료되지 않은 작업:** 카메라/탐지/화면 연동, 실제 Chrome ONNX 추론 실측, 검증 데이터 기반 임계값 승인, Vercel 배포.
- **데이터:** 현재 화면(`src/main.tsx`)은 아직 IndexedDB 저장 서비스를 호출하지 않는다. Antigravity에서 `src/ai/browserInspectionService.ts`를 연결해야 자동 저장이 활성화된다. 원본은 외부 서버에 전송하지 않는다.
- **테스트:** `npm test`에는 `fake-indexeddb`를 이용한 실제 IndexedDB 트랜잭션 시뮬레이션 테스트가 포함된다. 최신 검증 결과는 GitHub Actions를 참고한다.
- **인수인계:** [Antigravity 연동 계약](docs/PRE_ANTIGRAVITY_HANDOFF.md).

## 실행

```bash
npm install
npm test
npm run dev
```

- Node.js 22 이상 권장. Vite 화면은 터미널에 표시되는 로컬 URL에서 확인합니다.
- 최초 추론 시 Hugging Face 원본 저장소에서 `backbone.onnx` (~50MB), `knn_metal_nut.onnx` (~53MB), `thresholds.json`을 가져옵니다.
- 사진은 브라우저 메모리에서 처리합니다. 모델 파일은 CacheStorage에 저장을 시도합니다. **현재 화면에는 저장 버튼이 연결되지 않았습니다.** 저장 API 코드는 구현됐으며 Antigravity의 화면 연결 뒤 IndexedDB 로컬 저장이 활성화됩니다.
- 현재는 원본 이미지 중앙 크롭을 사용합니다. 너트가 중앙에 놓인 사진을 사용하십시오. 이것은 **자동 너트 탐지 기능이 아닙니다.**
- ONNX 모델 네트워크·CORS·브라우저 메모리 문제가 있다면 화면에 오류를 그대로 표시합니다.
- 별도 API 키가 필요하지 않습니다. `VITE_` 환경변수에 비밀키를 넣지 마세요.

## 이미 구현한 코드

- React + TypeScript + Vite 구조
- PatchCore ONNX 두 단계: `image(1,3,224,224)` -> backbone features -> metal_nut KNN anomaly map + score
- 원본 모델 카드의 전처리: 짧은 변 256, 중앙 224 크롭, ImageNet 채널 정규화
- 원본 좌표에 크롭된 히트맵 역투영 (참조 전처리의 위치에 한정)
- 로컬 CacheStorage 모델 재사용 시도, WASM 실행, 모델 세션 해제
- 수치 임계값은 모델의 `thresholds.json`에서 읽으며 **진짜 정상·불량 판정은 아직 표시하지 않음**
- Node 내장 테스트: 좌표, 히트맵 수치, 임계값, ONNX 단계별 출력 계약 검증
- GitHub Actions 테스트/빌드 설정 및 원격 실행

## 미구현 / 다음 단계

1. 공개 ONNX 두 모델의 실제 브라우저 세션 생성/추론 확인 및 로딩 속도 계측 (외부 접속 가능한 Chrome/Edge 필요)
2. 객체 탐지 모델 선택·검증, OpenCV 보조, 실제 너트 ROI 보정
3. 카메라·다중 이미지 UI 및 구현된 품질 게이트·후보 판정 연동
4. IndexedDB 저장 API의 UI 연결, 작업자 판정, 이력 화면
5. Vercel 배포, 운영 보안, 재분석, 보고서, LOT·대시보드, 백업

## 검증 현황

| 대상 | 상태 |
| --- | --- |
| Node.js 단위 테스트 | 테스트 확대 완료, GitHub Actions에서 검증 |
| 공개 Hugging Face 모델 파일 존재 여부 | 확인됨 (model card) |
| ONNX 브라우저 실제 로딩 및 추론 | **미검증** — 이 개발 환경의 외부 네트워크 차단 |
| Vite 전체 빌드 | GitHub Actions 환경에서 검증, 실제 Chrome WASM 추론은 미검증 |
| 자동 너트 탐지 / 촬영 | 아직 미구현 |
| GitHub 원격 저장소 | 초기 소스 및 ChatGPT AI 브랜치 `develop`에 통합 완료 |
| Vercel 공개 URL | 아직 미배포 |

## 데이터·라이선스

모델 제공처: https://huggingface.co/yandyassine/patchcore-mvtec-ad

원본 모델 카드는 모델/메모리 뱅크에 **CC BY-NC-SA 4.0 (비상업적)** 조건을 표시합니다. 타인이 저작권을 보유한 가중치와 샘플 이미지는 Git 저장소에 포함하지 않으며, 사용 조건을 확인하지 않은 자료도 배포하지 않습니다. 게시된 기존 모델의 AUROC/F1 수치는 사용자 자신의 검증 결과가 아닙니다.

## 설계 명세

- [통합 설계·충돌 점검](docs/INTEGRATION_AUDIT.md)
- [1~95단계 결정 인덱스](docs/DECISION_INDEX.md)
- [개발 순서와 수락 기준](docs/IMPLEMENTATION_PLAN.md)

## GitHub 연동 및 공개 상태 (2026-10-28)

GitHub 원격 저장소는 `dfdfewqk/VisionQC-AI`로 확인되었습니다. 이 저장소는 현재 **Public**이며, 개발 중 Private을 유지하려던 초기 설계와 다릅니다. 필요한 경우 저장소 설정에서 Private으로 변경해야 합니다. 이 저장소의 샘플 소스에는 실제 API 키·모델 가중치·검사 이미지가 포함되지 않습니다.

초기 버전과 달리 GitHub Actions에서 실제 의존성 설치·자동 테스트·TS/Vite 빌드를 수행합니다. 로컬 네트워크 제한으로 `package-lock.json`은 아직 만들지 못했으며, 추후 고정 잠금 파일을 생성해 CI를 `npm ci`로 전환해야 합니다. 웹 브라우저 실측 성공으로 오해하지 마세요.
