import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { makeOverlay, releaseModel, runMetalNutPreflight, type InferenceResult } from './ai/patchcore';
import './styles/main.css';

type Phase = '대기' | '모델 로딩 및 추론 중' | '완료' | '오류';
function App() {
  const [file, setFile] = useState<File | null>(null);
  const [photo, setPhoto] = useState<string>('');
  const [overlay, setOverlay] = useState<string>('');
  const [result, setResult] = useState<InferenceResult | null>(null);
  const [phase, setPhase] = useState<Phase>('대기');
  const [message, setMessage] = useState('너트가 화면 중앙에 놓인 사진을 사용해 주세요.');
  const generation = useRef(0);

  useEffect(() => {
    if (!file) { setPhoto(''); return; }
    const url = URL.createObjectURL(file);
    setPhoto(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onSelect = (item: File | undefined) => {
    if (!item) return;
    generation.current++;
    setResult(null); setOverlay(''); setPhase('대기');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(item.type)) {
      setMessage('이 단계에서는 JPEG / PNG / WebP 파일만 지원합니다.');
      setFile(null); return;
    }
    setMessage('이미지 선택 완료. 추론 실행 버튼을 누르면 실제 ONNX 모델을 불러옵니다.');
    setFile(item);
  };

  const run = async () => {
    if (!file || phase === '모델 로딩 및 추론 중') return;
    const id = ++generation.current;
    setPhase('모델 로딩 및 추론 중');
    setMessage('공개 모델 2개를 다운로드하고 로컬에서 추론합니다. 최초 다운로드는 약 100MB입니다.');
    try {
      const inference = await runMetalNutPreflight(file);
      const composed = await makeOverlay(file, inference);
      if (id !== generation.current) return;
      setResult(inference); setOverlay(composed); setPhase('완료');
      setMessage('모델 추론 응답 수신. 실제 품질 판정은 아직 검증하지 않았습니다.');
    } catch (error) {
      if (id !== generation.current) return;
      setPhase('오류');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return <main className="shell">
    <header>
      <div><span className="eyebrow">VisionQC AI · 첫 개발 단계</span><h1>PatchCore 브라우저 호환성 검증</h1></div>
      <span className="chip">비생산용 사전 검증</span>
    </header>
    <p className="intro">실제 공개 ONNX 가중치 2개를 브라우저에서 불러와 너트 이미지의 이상 점수와 위치 지도를 생성하는 기술 검증 화면입니다.</p>
    <section className="panel">
      <h2>검사 이미지 선택</h2>
      <input aria-label="너트 이미지" type="file" disabled={phase === '모델 로딩 및 추론 중'} accept="image/png,image/jpeg,image/webp" onChange={e=>onSelect(e.target.files?.[0])} />
      <div className="actions">
        <button disabled={!file || phase==='모델 로딩 및 추론 중'} onClick={run}>실제 ONNX 추론 실행</button>
        <button className="subtle" disabled={phase === '모델 로딩 및 추론 중'} onClick={async()=>{await releaseModel();setMessage('모델 실행 세션을 해제했습니다. 저장된 다운로드 캐시는 유지됩니다.');}}>모델 메모리 해제</button>
      </div>
      <div role="status" className="status"><strong>{phase}</strong> · {message}</div>
    </section>
    <section className="panel">
      <h2>원본과 이상 위치 비교</h2>
      <div className="comparisons">
        <div className="imagePane"><h3>원본 이미지</h3>{photo?<img src={photo} alt="업로드한 원본 이미지"/>:<div className="placeholder">이미지를 선택해 주세요</div>}</div>
        <div className="imagePane"><h3>AI 히트맵</h3>{overlay?<img src={overlay} alt="상대적인 이상 반응을 색으로 표시한 이미지"/>:<div className="placeholder">추론 완료 후 표시</div>}</div>
      </div>
      {result && <div className="metrics">
        <div><span>원시 이상 점수</span><strong>{result.score.toFixed(5)}</strong></div>
        <div><span>참조 임계값</span><strong>{result.threshold?.toFixed(5) ?? '확인 불가'}</strong></div>
        <div><span>전체 처리 시간</span><strong>{result.elapsedMs.toLocaleString()} ms</strong></div>
        <div><span>판정 상태</span><strong>검증 전 · 판정 보류</strong></div>
      </div>}
      <p className="warning">이 화면은 자동 너트 탐지 전의 기술 검증 단계입니다. 사진 중앙을 기준으로 224px 전처리를 하며, 히트맵 색상은 이미지 내부의 상대적 강도입니다. 실제 불량 여부·정확도·출고 적합성을 뜻하지 않습니다.</p>
    </section>
    <footer>모델 출처: <a href="https://huggingface.co/yandyassine/patchcore-mvtec-ad" target="_blank" rel="noreferrer">yandyassine/patchcore-mvtec-ad</a> · CC BY-NC-SA 4.0 · 비상업적 시연 한정</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
