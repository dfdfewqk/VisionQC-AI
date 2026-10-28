# VisionQC AI v1.0 — 1차 개발본 (v0.1.1 검증 보강)

**현재 단계: 사전학습 PatchCore ONNX의 브라우저 실행 가능성 확인용 개발본.**

이 저장소는 최종 품질검사 제품이 아닙니다. 현재는 이미지 중앙 영역을 PatchCore 모델에 전달하는 **실제 모델 추론 검증 화면**만 구현되어 있으며, 자동 너트 탐지·실제 촬영·LOT·판정·DB·Vercel 배포는 아직 미완료입니다. 성공했다고 표시할 수 있는 결과는 직접 실행·검증한 것뿐입니다.

## 실행

```bash
npm install
npm test
npm run dev
```

- Node.js 22 이상 권장. Vite 화면은 터미널에 표시되는 로컬 URL에서 확인합니다.
- 최초 추론 시 Hugging Face 원본 저장소에서 `backbone.onnx` (~50MB), `knn_metal_nut.onnx` (~53MB), `thresholds.json`을 가져옵니다.
- 사진은 브라우저 메모리에서 처리합니다. 모델 파일은 CacheStorage에 저장을 시도합니다. **이미지는 이 개발본에서 서버로 보내거나 IndexedDB에 저장하지 않습니다.** 원본 이미지 로컬 자동 저장은 후속 필수 개발입니다.
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
- GitHub Actions 테스트/빌드 설정 (원격 실행은 GitHub에 올린 이후)

## 미구현 / 다음 단계

1. 공개 ONNX 두 모델의 실제 브라우저 세션 생성/추론 확인 및 로딩 속도 계측 (외부 접속 가능한 Chrome/Edge 필요)
2. 객체 탐지 모델 선택·검증, OpenCV 보조, 실제 너트 ROI 보정
3. 카메라·다중 이미지·품질 게이트·3단계 AI 후보 판정
4. IndexedDB, 작업자 판정, 검사 이력
5. Vercel 배포, 운영 보안, 재분석, 보고서, LOT·대시보드, 백업

## 검증 현황

| 대상 | 상태 |
| --- | --- |
| Node.js 기초 단위 테스트 | 12개 통과 (2026-10-28; 5개 출력 계약 검증 추가) |
| 공개 Hugging Face 모델 파일 존재 여부 | 확인됨 (model card) |
| ONNX 브라우저 실제 로딩 및 추론 | **미검증** — 이 개발 환경의 외부 네트워크 차단 |
| Vite 전체 빌드 | **미검증** — 현재 실행 환경에서 npm 레지스트리 DNS 접근 불가로 의존성 설치 실패 |
| 자동 너트 탐지 / 촬영 | 아직 미구현 |
| GitHub 원격 저장소 | `dfdfewqk/VisionQC-AI` 확인됨. 초기 업로드 진행 예정. |
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

현재 환경에서 `npm test`는 12/12 통과했습니다. npm 레지스트리 연결 제한으로 `package-lock.json`을 생성하지 못했으며, 실제 `npm install` 및 전체 빌드는 CI에서 확인해야 합니다. 이 상태를 빌드 성공이라고 표시하지 않습니다.
