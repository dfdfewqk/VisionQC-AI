import React, {useEffect, useRef, useState} from 'react';

type CameraDevice={deviceId:string;label:string};
export default function CameraCapture({onCapture, disabled=false}:{onCapture:(file:File)=>void;disabled?:boolean}) {
  const video=useRef<HTMLVideoElement>(null);
  const stream=useRef<MediaStream|null>(null);
  const mounted=useRef(true);
  const [devices,setDevices]=useState<CameraDevice[]>([]);
  const [deviceId,setDeviceId]=useState('');
  const [active,setActive]=useState(false);
  const [error,setError]=useState('');
  const [starting,setStarting]=useState(false);
  const release=()=>{stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;
    if(video.current)video.current.srcObject=null;setActive(false);};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;release();};},[]);
  async function start(id=deviceId){
    if(!navigator.mediaDevices?.getUserMedia){setError('카메라를 사용할 수 없습니다. HTTPS 또는 localhost에서 Chrome으로 열어 주세요.');return;}
    release();setError('');setStarting(true);
    try{
      const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:id?{deviceId:{ideal:id}}:{facingMode:{ideal:'environment'}}});
      if(!mounted.current){acquired.getTracks().forEach(t=>t.stop());return;}
      stream.current=acquired;
      if(video.current){video.current.srcObject=acquired;await video.current.play();}
      setActive(true);
      try{const list=await navigator.mediaDevices.enumerateDevices();if(mounted.current)setDevices(list.filter(d=>d.kind==='videoinput').map((d,i)=>({deviceId:d.deviceId,label:d.label||`카메라 ${i+1}`})));}catch {/* devices may be unavailable */}
    }catch(e){release();if(mounted.current)setError(e instanceof Error?e.message:'카메라 권한을 확인하거나 파일 업로드를 사용해 주세요.');}
    finally{if(mounted.current)setStarting(false);}
  }
  function capture(){
    const el=video.current;if(!el||!el.videoWidth||!el.videoHeight){setError('카메라 영상이 아직 준비되지 않았습니다.');return;}
    const canvas=document.createElement('canvas');canvas.width=el.videoWidth;canvas.height=el.videoHeight;
    const ctx=canvas.getContext('2d');if(!ctx){setError('캔버스 사용 불가');return;}
    ctx.drawImage(el,0,0);canvas.toBlob(blob=>{
      if(!blob){setError('사진 인코딩에 실패했습니다.');return;}
      onCapture(new File([blob],`visionqc-${new Date().toISOString().replace(/[:.]/g,'-')}.png`,{type:'image/png'}));
    },'image/png');
  }
  return <section className="camera-panel">
    <div className="section-line"><div><h3>카메라 촬영</h3><p className="muted">브라우저에서 카메라 권한을 허용해야 합니다. 촬영한 사진은 PC 안에서 검사합니다.</p></div></div>
    <div className="camera-video"><video ref={video} autoPlay playsInline muted aria-label="실시간 카메라 미리보기"/>{!active&&<div className="camera-empty">카메라 연결 전입니다. 파일 업로드도 사용할 수 있습니다.</div>}</div>
    <div className="actions">
      {!active?<button type="button" disabled={disabled||starting} onClick={()=>void start()}>{starting?'연결 중…':'카메라 켜기'}</button>:
        <><button type="button" disabled={disabled} onClick={capture}>촬영 후 바로 검사</button><button type="button" className="btn-ghost" onClick={release}>카메라 끄기</button></>}
      {active&&devices.length>1&&<label className="field-inline">장치 <select value={deviceId} onChange={e=>{setDeviceId(e.target.value);void start(e.target.value);}}>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}</select></label>}
    </div>
    {error&&<p className="text-warning" role="alert">{error} · 권한이 없으면 아래 사진 업로드를 이용해 주세요.</p>}
  </section>;
}
