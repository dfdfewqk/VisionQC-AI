import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {openBrowserInspectionService} from './ai/browserInspectionService';
import {releaseModel, type RoiSelection} from './ai/patchcore';
import RoiPicker from './components/RoiPicker';
import CameraCapture from './camera/CameraCapture';
import './styles/main.css';

type Page='inspect'|'history'|'metrics'|'registry';
type Status='연결 중'|'준비'|'검사 중'|'오류';
type InspectDetail={inspection:any;source:any;overlay:Blob|null};
const PERIODS=[{code:'all',label:'전체'},{code:'today',label:'오늘'},{code:'7d',label:'7일'},{code:'30d',label:'30일'}];
const LABELS:Record<string,string>={normal_candidate:'정상 후보',review_required:'확인 필요',anomaly_candidate:'이상 후보',
  inferred:'AI 검사 완료',held:'사진 품질 보류',normal:'정상',defective:'불량',reinspection:'재검사 요청',
  queued:'대기',running:'검사 중',interrupted:'중단됨',paused_system:'시스템 오류로 중단',failed_image:'사진 오류',completed:'완료',canceled:'취소'};
const label=(v:any)=>LABELS[String(v??'')]??String(v??'기록 없음');
const formatDate=(v:any)=>typeof v==='string'&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleString('ko-KR'):'확인 불가';
const num=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(4):'확인 불가';
const pct=(v:any)=>typeof v==='number'&&Number.isFinite(v)?`${(v*100).toFixed(1)}%`:'집계 불가';
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
const sampleType=(v:string)=>v==='demo'?'체험 데이터':'내 검사 기록';

function App(){
  const service=useRef<any>(null);
  const alive=useRef(true);
  const processing=useRef(false);
  const [connected,setConnected]=useState<Status>('연결 중');
  const [page,setPage]=useState<Page>('inspect');
  const [notice,setNotice]=useState('저장소 연결 중입니다. 사진은 별도 서버에 업로드하지 않습니다.');
  const [sourceType,setSourceType]=useState<'user'|'demo'>('user');
  const [file,setFile]=useState<File|null>(null);
  const [fileUrl,setFileUrl]=useState('');
  const [detail,setDetail]=useState<InspectDetail|null>(null);
  const [detailPhoto,setDetailPhoto]=useState('');
  const [detailHeat,setDetailHeat]=useState('');
  const [roi,setRoi]=useState<RoiSelection|null>(null);
  const [captureOpen,setCaptureOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [queue,setQueue]=useState<any[]>([]);
  const [history,setHistory]=useState<any[]>([]);
  const [total,setTotal]=useState(0);
  const [offset,setOffset]=useState(0);
  const [period,setPeriod]=useState('all');
  const [humanFilter,setHumanFilter]=useState('');
  const [stats,setStats]=useState<any>(null);
  const [review,setReview]=useState<any>(null);
  const [reviewHistory,setReviewHistory]=useState<any[]>([]);
  const [operator,setOperator]=useState('');
  const [reason,setReason]=useState('');
  const [verdict,setVerdict]=useState('normal');
  const [lots,setLots]=useState<any[]>([]);
  const [products,setProducts]=useState<any[]>([]);
  const [selectedLot,setSelectedLot]=useState('');
  const [newLot,setNewLot]=useState('');
  const [newProduct,setNewProduct]=useState('');
  const [plannedQuantity,setPlannedQuantity]=useState('');
  const [assignment,setAssignment]=useState<any>(null);
  const isReady=connected==='준비'||connected==='검사 중';
  const activeInspection=detail?.inspection;
  const currentPhoto=detail?detailPhoto:fileUrl;
  const tz=-new Date().getTimezoneOffset();

  useEffect(()=>{
    alive.current=true;let cancelled=false;
    (async()=>{
      try{
        const opened=await openBrowserInspectionService();
        if(cancelled){await opened.close();return;}
        service.current=opened;setConnected('준비');setNotice('준비됨 · 내 검사 결과는 이 브라우저의 IndexedDB에 보관됩니다.');
        await Promise.allSettled([reloadQueue(opened),reloadHistory(opened,'user','all','',0),reloadStats(opened,'user','all'),reloadLots(opened,'user')]);
      }catch(e){if(!cancelled){setConnected('오류');setNotice(`저장소 연결 실패: ${errorText(e)}`);}}
    })();
    return()=>{cancelled=true;alive.current=false;const opened=service.current;service.current=null;void opened?.close().catch(console.error);};
  },[]);
  useEffect(()=>{
    if(!file){setFileUrl('');return;}
    const url=URL.createObjectURL(file);setFileUrl(url);return()=>URL.revokeObjectURL(url);
  },[file]);
  useEffect(()=>{
    if(!detail?.source?.blob){setDetailPhoto('');setDetailHeat('');return;}
    const original=URL.createObjectURL(detail.source.blob);
    const heat=detail.overlay?URL.createObjectURL(detail.overlay):'';
    setDetailPhoto(original);setDetailHeat(heat);
    return()=>{URL.revokeObjectURL(original);if(heat)URL.revokeObjectURL(heat);};
  },[detail]);

  const fail=(e:unknown,context:string)=>{setNotice(`${context}: ${errorText(e)}`);};
  async function reloadQueue(s:any=service.current){if(!s)return;const jobs=await s.listInspectionQueue();if(alive.current)setQueue(jobs);}
  async function reloadHistory(s:any=service.current,t=sourceType,p=period,f=humanFilter,off=offset){
    if(!s)return;const r=await s.searchInspectionHistory({sourceType:t,period:p,
      timezoneOffsetMinutes:tz,humanVerdict:f||null,limit:20,offset:off});
    if(alive.current){setHistory(r.items);setTotal(r.total);}
  }
  async function reloadStats(s:any=service.current,t=sourceType,p=period){
    if(!s)return;const result=await s.qualityStatistics({sourceType:t,period:p,timezoneOffsetMinutes:tz});
    if(alive.current)setStats(result);
  }
  async function reloadLots(s:any=service.current,t=sourceType){
    if(!s)return;const l=await s.listLots({sourceType:t});if(alive.current)setLots(l);
  }
  async function refresh(){const s=service.current;if(!s)return;try{
    await Promise.all([reloadQueue(s),reloadHistory(s),reloadStats(s),reloadLots(s)]);
  }catch(e){fail(e,'자료 새로고침 실패');}}
  async function changeSource(t:'user'|'demo'){
    setSourceType(t);setDetail(null);setReview(null);setSelectedLot('');setProducts([]);setOffset(0);
    try{await Promise.all([reloadHistory(service.current,t,period,humanFilter,0),reloadStats(service.current,t,period),reloadLots(service.current,t)]);}catch(e){fail(e,'자료 조회 실패');}
  }
  async function changePeriod(p:string){setPeriod(p);setOffset(0);try{
    await Promise.all([reloadHistory(service.current,sourceType,p,humanFilter,0),reloadStats(service.current,sourceType,p)]);
  }catch(e){fail(e,'기간 조회 실패');}}
  function selectFile(item:File|null){if(!item)return;
    setDetail(null);setRoi(null);setReview(null);
    if(!['image/png','image/jpeg','image/webp'].includes(item.type)||item.size>40*1024*1024||item.size===0){
      setNotice('JPEG/PNG/WebP, 40MB 이하의 사진 파일만 사용할 수 있습니다.');return;
    }
    setFile(item);setNotice(`${item.name} 선택됨 · 너트 영역을 지정하거나 중앙 영역으로 검사할 수 있습니다.`);
  }
  async function showRecord(id:string){const s=service.current;if(!s)return;
    try{
      const [d,last,events,identity]=await Promise.all([s.get(id),s.latestHumanReview(id),s.listHumanReviewHistory(id),s.getInspectionIdentity(id)]);
      if(!d)throw new Error('검사 기록을 찾을 수 없습니다.');
      setDetail(d);setFile(null);setRoi(null);setReview(last);setReviewHistory(events);setAssignment(identity);
      setVerdict(last?.verdict??'normal');setPage('inspect');setNotice(`검사 ${id} 상세 기록을 열었습니다.`);
    }catch(e){fail(e,'검사 기록 조회 실패');}
  }
  async function runInspection(item:File|null=file,selection:RoiSelection|null=roi){
    const s=service.current;if(!s||!item){setNotice('저장소 연결 및 검사 사진이 필요합니다.');return;}
    if(processing.current)return;
    if(selection&&(selection.width<224||selection.height<224)){setNotice('선택 ROI는 가로·세로 각각 최소 224px이어야 합니다.');return;}
    processing.current=true;setBusy(true);setConnected('검사 중');setDetail(null);setReview(null);
    setNotice('사진 품질 확인 → 모델 로딩 및 ONNX 추론 → IndexedDB 저장을 진행합니다.');
    try{
      const result=await s.inspectAndSave({file:item,roi:selection,sourceType});
      if(!alive.current)return;
      const [d,last,events]=await Promise.all([s.get(result.id),s.latestHumanReview(result.id),s.listHumanReviewHistory(result.id)]);
      if(!d)throw new Error('검사 결과 저장 확인에 실패했습니다.');
      setDetail(d);setReview(last);setReviewHistory(events);
      setNotice(result.status==='held'?'사진 품질 확인이 필요하여 검사를 보류하고 기록했습니다.':
        'AI 추론 결과를 저장했습니다. 후보 점수는 작업자의 최종 판정이 아닙니다.');
      await Promise.allSettled([reloadHistory(s),reloadStats(s)]);
    }catch(e){if(alive.current)fail(e,'검사 실패 (저장 여부를 이력에서 확인하세요)');}
    finally{processing.current=false;if(alive.current){setBusy(false);setConnected('준비');}}
  }
  async function onCapture(item:File){selectFile(item);setCaptureOpen(false);await runInspection(item,null);}
  async function queueCurrent(){if(!file||!service.current)return;try{
    await service.current.enqueueInspection({file,roi,sourceType});await reloadQueue();setNotice('사진을 검사 대기열에 저장했습니다. 대기열 시작 버튼을 눌러 진행합니다.');
  }catch(e){fail(e,'대기열 등록 실패');}}
  async function startQueue(){const s=service.current;if(!s||processing.current)return;processing.current=true;setBusy(true);
    setNotice('대기열 검사 중입니다. 새로고침하거나 닫으면 다음에 수동 재개할 수 있습니다.');
    try{const result=await s.startInspectionQueue();setNotice(result.haltedOn?`시스템 오류로 일시정지: ${result.message}`:
      `대기열 완료 ${result.completed}건 · 사진 오류 ${result.failedImage}건`);await Promise.allSettled([reloadQueue(s),reloadHistory(s),reloadStats(s)]);
    }catch(e){fail(e,'대기열 실행 실패');}
    finally{processing.current=false;if(alive.current)setBusy(false);}}
  async function deleteRecord(){if(!activeInspection||!service.current)return;
    if(!window.confirm('이 검사와 관련된 히트맵·작업자 판정 이력을 삭제합니다. 복원할 수 없습니다. 삭제할까요?'))return;
    try{await service.current.remove(activeInspection.id);setDetail(null);setNotice('선택한 검사 기록을 삭제했습니다.');await refresh();}
    catch(e){fail(e,'삭제 실패');}}
  async function saveReview(){if(!activeInspection||!service.current)return;
    if(!operator.trim()||!reason.trim()){setNotice('작업자 식별명과 판정 사유를 입력해 주세요.');return;}
    try{
      const event=await service.current.recordHumanReview({inspectionId:activeInspection.id,verdict,
        operatorName:operator,reason,expectedRevision:review?.revision??0});
      setReview(event);setReason('');setReviewHistory(await service.current.listHumanReviewHistory(activeInspection.id));
      setNotice('작업자 판정 이력을 기록했습니다. 이전 판정은 보존됩니다.');await Promise.allSettled([reloadHistory(),reloadStats()]);
    }catch(e){fail(e,'판정 저장 실패 (최신 revision 확인 필요)');}}
  async function registerLot(){if(!service.current||!newLot.trim()||!operator.trim()||!reason.trim()){setNotice('LOT 번호·작업자·사유를 입력하세요.');return;}
    try{const lot=await service.current.registerLot({lotId:newLot,plannedQuantity:plannedQuantity.trim()?Number(plannedQuantity):null,
      sourceType,operatorName:operator,reason});setNewLot('');setPlannedQuantity('');setSelectedLot(lot.key);setReason('');
      setProducts([]);setNotice('LOT 번호를 저장했습니다.');await reloadLots();}catch(e){fail(e,'LOT 등록 실패');}}
  async function selectLot(key:string){setSelectedLot(key);try{setProducts(key?await service.current.listProducts({lotKey:key}):[]);}catch(e){fail(e,'제품 목록 조회 실패');}}
  async function registerProduct(){if(!selectedLot||!newProduct.trim()||!operator.trim()||!reason.trim()){
      setNotice('LOT와 제품 번호·작업자·사유가 필요합니다.');return;}
    try{await service.current.registerProduct({lotKey:selectedLot,productId:newProduct,operatorName:operator,reason});
      setNewProduct('');setReason('');setNotice('제품 번호가 등록되었습니다.');await selectLot(selectedLot);}catch(e){fail(e,'제품 등록 실패');}}
  async function connectProduct(productKey:string|null){if(!activeInspection||!operator.trim()||!reason.trim()){
      setNotice('작업자 식별명과 변경 사유를 입력해 주세요.');return;}
    try{const result=await service.current.assignInspection({inspectionId:activeInspection.id,productKey,
      expectedRevision:assignment?.revision??0,operatorName:operator,reason});setAssignment(result);setReason('');
      setNotice('검사와 제품 연결 정보를 기록했습니다. AI 원본 기록은 변경하지 않았습니다.');}
    catch(e){fail(e,'제품 연결 실패');}}

  return <div className="app-shell">
    <aside className="sidebar"><div className="identity"><div className="brand-icon">V</div><div><strong>VisionQC <em>AI</em></strong><span>검사 운영 워크스페이스</span></div></div>
      <nav aria-label="주 메뉴">
        <button className={page==='inspect'?'nav-item active':'nav-item'} onClick={()=>setPage('inspect')}>◉ <span>검사 작업대</span></button>
        <button className={page==='history'?'nav-item active':'nav-item'} onClick={()=>{setPage('history');void reloadHistory();}}>▤ <span>검사 기록</span></button>
        <button className={page==='metrics'?'nav-item active':'nav-item'} onClick={()=>{setPage('metrics');void reloadStats();}}>▥ <span>품질 현황</span></button>
        <button className={page==='registry'?'nav-item active':'nav-item'} onClick={()=>{setPage('registry');void reloadLots();}}>▦ <span>LOT / 제품</span></button>
      </nav>
      <div className="sidebar-note"><span className="pulse"/>브라우저 로컬 데이터 저장<p>현재 공개된 모델은 비상업 시연용이며, 측정값은 실제 품질을 보증하지 않습니다.</p></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><span className="eyebrow">INSPECTION WORKSPACE / LOCAL AI</span><h1>{page==='inspect'?'너트 AI 검사':page==='history'?'검사 기록':page==='metrics'?'품질 현황':'LOT 및 제품 관리'}</h1></div>
        <div className="top-tools"><span className={`connection ${connected==='오류'?'bad':busy?'working':'good'}`}>● {connected}</span>
          <select aria-label="데이터 출처" value={sourceType} disabled={busy} onChange={e=>void changeSource(e.target.value as 'user'|'demo')}><option value="user">내 검사 데이터</option><option value="demo">체험 데이터</option></select>
        </div></header>
      <div role="status" aria-live="polite" className={`system-message ${connected==='오류'?'warning-message':''}`}>{notice}</div>
      {connected==='오류'&&<p className="text-warning">브라우저 저장소·보안 컨텍스트·다른 검사 탭을 확인하고 페이지를 새로고침해 주세요.</p>}
      {page==='inspect'&&<>
        <div className="summary-strip"><div><span className="summary-label">진행 상태</span><strong>{busy?'AI 검사 중':'검사 준비'}</strong><small>사진 파일 또는 카메라</small></div>
          <div><span className="summary-label">현재 검사</span><strong>{activeInspection?label(activeInspection.status):'선택 없음'}</strong><small>{activeInspection?activeInspection.id.slice(0,17):'검사 후 자동 저장'}</small></div>
          <div><span className="summary-label">AI 후보</span><strong>{activeInspection?label(activeInspection.candidate?.code):'확인 전'}</strong><small>작업자 최종 판정과 별도</small></div>
          <div><span className="summary-label">대기열</span><strong>{queue.filter(x=>['queued','running','interrupted','paused_system'].includes(x.status)).length}건</strong><small>검사 중 1장 · 대기 1장</small></div></div>
        <section className="card"><div className="section-heading"><div><span className="section-kicker">STEP 01</span><h2>사진 준비</h2><p>촬영하거나 파일을 선택한 뒤 검사할 너트 영역을 확인해 주세요.</p></div>
          <button type="button" className="btn-ghost btn-sm" onClick={()=>setCaptureOpen(!captureOpen)}>{captureOpen?'촬영창 닫기':'카메라로 촬영'}</button></div>
          {captureOpen&&<CameraCapture disabled={busy||!isReady} onCapture={f=>void onCapture(f)}/>}
          <label className="file-drop"><span className="file-icon">＋</span><strong>{file?file.name:'검사할 사진을 선택하세요'}</strong><span>JPG · PNG · WEBP / 최대 40 MB</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||!isReady} onChange={e=>{selectFile(e.target.files?.[0]??null);e.currentTarget.value='';}}/></label>
          {fileUrl&&!detail&&<RoiPicker imageUrl={fileUrl} roi={roi} onChange={setRoi} disabled={busy}/>}
          <div className="actions"><button disabled={!isReady||!file||busy} onClick={()=>void runInspection()}>AI 검사 및 기록 저장</button>
            <button className="btn-secondary" disabled={!isReady||!file||busy} onClick={()=>void queueCurrent()}>검사 대기열에 추가</button>
            <button className="btn-ghost" disabled={busy} onClick={()=>{setFile(null);setDetail(null);setRoi(null);}}>선택 초기화</button></div>
        </section>
        <section className="card"><div className="section-heading"><div><span className="section-kicker">STEP 02</span><h2>AI 분석 결과</h2><p>원본과 히트맵을 비교하고 최종 판단은 작업자가 별도로 기록합니다.</p></div>
          {activeInspection&&<span className="tag">{label(activeInspection.status)}</span>}</div>
          <div className="compare-grid"><div className="photo-box"><div className="photo-title">원본 이미지</div>{currentPhoto?<img src={currentPhoto} alt="검사 사진 원본"/>:<div className="empty-image">검사할 사진을 선택해 주세요</div>}</div>
            <div className="photo-box"><div className="photo-title">AI 이상 반응 히트맵</div>{detailHeat?<img src={detailHeat} alt="저장된 AI 이상 반응 지도"/>:<div className="empty-image">AI 추론 이후 표시됩니다</div>}</div></div>
          {activeInspection?<><div className="results-grid"><div><span>원시 이상 점수</span><strong>{num(activeInspection.score)}</strong></div>
              <div><span>AI 판정 후보</span><strong>{label(activeInspection.candidate?.code)}</strong></div>
              <div><span>검사 처리시간</span><strong>{activeInspection.elapsedMs===null?'실행되지 않음':`${activeInspection.elapsedMs} ms`}</strong></div>
              <div><span>검사 ID</span><strong className="mono small">{activeInspection.id}</strong></div></div>
            <p className="explain">{activeInspection.status==='held'?`보류 이유: ${activeInspection.failureReasons?.join(', ')||'사진 품질 확인 필요'}`:
              '사전 검증 결과입니다. ROI와 촬영 환경·임계값이 아직 실측 인증되지 않아 정상·불량을 자동 확정하지 않습니다.'}</p>
            <div className="actions"><button className="btn-ghost text-danger" onClick={()=>void deleteRecord()} disabled={busy}>이 검사 기록 삭제</button></div>
          </>:<p className="explain">검사가 끝나면 원시 점수, 후보 판정, 원본 이미지와 히트맵이 표시되며 브라우저에 보존됩니다.</p>}
        </section>
        {activeInspection&&<section className="card"><div className="section-heading"><div><span className="section-kicker">STEP 03</span><h2>작업자 최종 판정</h2><p>AI와 별도로 기록하며 이전 판정과 변경 사유는 유지됩니다.</p></div><span className="tag">현재: {review?label(review.verdict):'미검토'}</span></div>
          <div className="fields-grid"><label>작업자 표시명<input value={operator} onChange={e=>setOperator(e.target.value)} placeholder="예: 작업자 A" maxLength={120}/></label>
            <label>확정 판정<select value={verdict} onChange={e=>setVerdict(e.target.value)}><option value="normal" disabled={activeInspection.status==='held'}>정상</option><option value="defective" disabled={activeInspection.status==='held'}>불량</option><option value="reinspection">재검사 요청</option></select></label></div>
          <label className="block-label">판정·수정 사유<textarea rows={2} value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder="확인한 부위와 판정 근거를 입력하세요"/></label>
          <div className="actions"><button disabled={busy} onClick={()=>void saveReview()}>최종 판정 이력 저장</button></div>
          {reviewHistory.length>0&&<div className="audit"><h3>판정 변경 이력</h3>{reviewHistory.map((event:any)=><div className="audit-row" key={event.id}><strong>{label(event.verdict)}</strong><span>{event.operatorName} · {formatDate(event.recordedAt)}</span><span>{event.reason}</span></div>)}</div>}
        </section>}
        <section className="card"><div className="section-heading"><div><span className="section-kicker">QUEUE</span><h2>연속 검사 대기열</h2><p>종료 후에도 대기·중단 사진은 남으며, 재시작은 사용자가 직접 합니다.</p></div>
          <button type="button" className="btn-secondary btn-sm" disabled={busy||!isReady} onClick={()=>void startQueue()}>대기열 시작 / 중단 검사 재개</button></div>
          {queue.length?queue.slice(-12).map((item:any)=><div className="queue-line" key={item.id}><span><b>{label(item.status)}</b><small>{item.id} · {formatDate(item.createdAt)}</small>{item.errorMessage&&<small className="text-warning">{item.errorMessage}</small>}</span>
            <span className="queue-controls">{item.status==='failed_image'&&<button className="btn-ghost btn-sm" onClick={async()=>{try{await service.current.retryFailedQueueImage(item.id);await reloadQueue();}catch(e){fail(e,'재시도 오류');}}}>재시도 대기</button>}
              {['queued','failed_image','interrupted','paused_system'].includes(item.status)&&<button className="btn-ghost btn-sm" onClick={async()=>{if(!window.confirm('이 대기 검사를 취소할까요?'))return;try{await service.current.cancelQueuedInspection(item.id);await reloadQueue();}catch(e){fail(e,'대기열 취소 실패');}}}>취소</button>}</span></div>):<p className="muted">대기 중인 검사가 없습니다.</p>}
        </section>
        <p className="license">PatchCore 공개 모델 · CC BY-NC-SA 4.0 · 비상업적 기술 시연. 너트 자동 탐지 및 현장 판정 성능은 별도로 검증해야 합니다.</p>
      </>}
      {page==='history'&&<section className="card"><div className="section-heading"><div><span className="section-kicker">HISTORY</span><h2>저장된 검사 이력</h2><p>{sampleType(sourceType)} · 데이터는 이 브라우저 프로필에 보관됩니다.</p></div><button className="btn-ghost btn-sm" onClick={()=>void reloadHistory()}>새로고침</button></div>
        <div className="filter-row"><label>검사 기간 <select value={period} onChange={e=>void changePeriod(e.target.value)}>{PERIODS.map(p=><option value={p.code} key={p.code}>{p.label}</option>)}</select></label>
          <label>작업자 판정 <select value={humanFilter} onChange={e=>{const v=e.target.value;setHumanFilter(v);setOffset(0);void reloadHistory(service.current,sourceType,period,v,0);}}>
            <option value="">전체</option><option value="unreviewed">미검토</option><option value="normal">정상</option><option value="defective">불량</option><option value="reinspection">재검사 요청</option></select></label></div>
        <div className="table-scroll"><table><thead><tr><th>검사 시각</th><th>검사 ID</th><th>AI 후보</th><th>작업자 판정</th><th>보기</th></tr></thead><tbody>
          {history.map(item=><tr key={item.id}><td>{formatDate(item.createdAt)}</td><td className="mono">{item.id.slice(0,26)}</td><td>{label(item.candidate?.code)}</td>
            <td>{item.latestHumanReview?label(item.latestHumanReview.verdict):'미검토'}</td><td><button className="btn-ghost btn-sm" onClick={()=>void showRecord(item.id)}>상세 열기</button></td></tr>)}
          {!history.length&&<tr><td colSpan={5} className="empty-table">이 조건에 해당하는 검사 기록이 없습니다.</td></tr>}</tbody></table></div>
        <div className="pager"><span>총 {total}건 · {offset+1}~{Math.min(offset+20,total)}건</span><div><button className="btn-ghost btn-sm" disabled={offset===0} onClick={()=>{const n=Math.max(0,offset-20);setOffset(n);void reloadHistory(service.current,sourceType,period,humanFilter,n);}}>이전</button><button className="btn-ghost btn-sm" disabled={offset+20>=total} onClick={()=>{const n=offset+20;setOffset(n);void reloadHistory(service.current,sourceType,period,humanFilter,n);}}>다음</button></div></div>
      </section>}
      {page==='metrics'&&<><section className="card"><div className="section-heading"><div><span className="section-kicker">QUALITY STATISTICS</span><h2>검사 통계</h2><p>AI 후보 점수와 작업자 확정 판정의 분모가 서로 다릅니다.</p></div><select aria-label="품질 통계 기간" value={period} onChange={e=>void changePeriod(e.target.value)}>{PERIODS.map(p=><option key={p.code} value={p.code}>{p.label}</option>)}</select></div>
          <div className="metric-tiles"><div><span>검사 실행 횟수</span><strong>{stats?.totalAttempts??'—'}</strong><small>재검사 포함</small></div>
            <div><span>중복 제외 검사 시야</span><strong>{stats?.distinctPhotographicViews??'—'}</strong><small>동일 사진·ROI 중복 제외</small></div>
            <div><span>AI 이상 후보 비율</span><strong>{pct(stats?.aiAnomalyCandidateViewRate)}</strong><small>AI 실행된 사진 시야 기준</small></div>
            <div><span>작업자 확정 불량 검사 비율</span><strong>{pct(stats?.humanConfirmedDefectiveAttemptRate)}</strong><small>확정된 검사 실행 기준</small></div></div>
          <div className="metric-details"><p>미검토: {stats?.humanAttemptCounts?.unreviewed??'—'}건 · 재검사 요청: {stats?.humanAttemptCounts?.reinspection??'—'}건 · 확정 검사: {stats?.humanConfirmedAttemptCount??'—'}건</p>
            <p className="text-warning">실제 고유 제품 불량률: 확인 불가 · 등록한 번호나 사진 해시만으로 실물 제품을 인증하지 않습니다.</p></div></section>
          <section className="card"><h2>검사일 기준 추이</h2><div className="table-scroll"><table><thead><tr><th>검사일</th><th>검사 횟수</th><th>AI 이상 후보 실행</th><th>작업자 확정 불량</th><th>미검토</th></tr></thead><tbody>
            {(stats?.trendByInspectionDate??[]).map((day:any)=><tr key={day.date}><td>{day.date}</td><td>{day.inspectionAttempts}</td><td>{day.aiAnomalyCandidateAttempts}</td><td>{day.humanDefectiveAttempts}</td><td>{day.unreviewedAttempts}</td></tr>)}
            {!stats?.trendByInspectionDate?.length&&<tr><td colSpan={5} className="empty-table">기간 내 저장된 검사가 없습니다.</td></tr>}</tbody></table></div></section></>}
      {page==='registry'&&<section className="card"><div className="section-heading"><div><span className="section-kicker">TRACEABILITY</span><h2>LOT·제품 관리</h2><p>제품번호는 작업자 입력 정보이며 실제 생산 실적을 자동 인증하지 않습니다.</p></div></div>
        <div className="fields-grid"><label>공통 작업자 식별명<input value={operator} onChange={e=>setOperator(e.target.value)} maxLength={120} placeholder="작업자 A"/></label>
          <label>등록·변경 사유<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} placeholder="LOT/제품 확인 사유"/></label></div>
        <div className="registry-split"><div className="subcard"><h3>LOT 등록</h3><label>LOT 번호<input value={newLot} onChange={e=>setNewLot(e.target.value)} placeholder="LOT-001"/></label>
          <label>계획 수량 (선택)<input type="number" min="0" step="1" value={plannedQuantity} onChange={e=>setPlannedQuantity(e.target.value)} placeholder="미입력 가능"/></label>
          <button disabled={!isReady} onClick={()=>void registerLot()}>LOT 저장</button>
          <h3 className="section-gap">등록된 LOT</h3><div className="record-stack">{lots.map(item=><button key={item.key} className={`record-pill ${selectedLot===item.key?'selected':''}`} onClick={()=>void selectLot(item.key)}>
            <b>{item.code}</b><small>계획수량: {item.plannedQuantity??'미입력'} · 제품은 별도 등록</small></button>)}{!lots.length&&<p className="muted">등록된 LOT가 없습니다.</p>}</div></div>
          <div className="subcard"><h3>선택 LOT의 제품</h3><p className="muted">{lots.find(x=>x.key===selectedLot)?.code??'먼저 LOT를 선택하세요.'}</p>
            <label>제품 번호<input value={newProduct} onChange={e=>setNewProduct(e.target.value)} disabled={!selectedLot} placeholder="NUT-001"/></label>
            <button disabled={!selectedLot||!isReady} onClick={()=>void registerProduct()}>제품 등록</button>
            <div className="record-stack section-gap">{products.map(item=><div className="product-line" key={item.key}><b>{item.code}</b><span className="muted">현재 등록된 번호</span></div>)}{!products.length&&<p className="muted">제품 등록 내역이 없습니다.</p>}</div>
            <p className="explain">검사 기록을 제품에 연결할 때는 먼저 검사 기록 상세 화면을 열고 아래의 연결 메뉴를 사용하세요.</p></div></div>
        {activeInspection&&<div className="subcard section-gap"><h3>열려 있는 검사와 제품 연결</h3><p className="muted">검사 ID: {activeInspection.id} · 현재 연결: {assignment?.productKey??'없음'}</p>
          <div className="actions"><select aria-label="검사 연결 제품 선택" id="target-product"><option value="">연결 해제</option>{products.map(p=><option key={p.key} value={p.key}>{p.code}</option>)}</select>
            <button disabled={!selectedLot} onClick={()=>{const v=(document.getElementById('target-product') as HTMLSelectElement).value;void connectProduct(v||null);}}>연결 변경 기록</button></div></div>}
        <p className="license">LOT 마감·제품별 복수 방향 판정·재작업·백업·보고서는 아직 후속 통합 대상입니다.</p>
      </section>}
      <footer className="footer"><span>VisionQC AI · 브라우저 로컬 검사 · 비상업적 평가용</span><span>원본 및 판정 자료는 이 브라우저 프로필에 저장됩니다.</span>
        <button className="link-button" disabled={busy} onClick={async()=>{try{await releaseModel();setNotice('모델 메모리를 해제했습니다. 다운로드 캐시는 유지됩니다.');}catch(e){fail(e,'모델 해제 실패');}}}>모델 메모리 해제</button></footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
