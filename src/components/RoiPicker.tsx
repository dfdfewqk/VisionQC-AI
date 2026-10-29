import React, { useRef, useState } from 'react';
import type { RoiSelection } from '../ai/patchcore';

type Point = { x:number; y:number };
function bound(value:number, max:number) { return Math.min(max, Math.max(0,value)); }
export default function RoiPicker({imageUrl, roi, onChange, disabled=false}:{
  imageUrl:string; roi:RoiSelection|null; onChange:(roi:RoiSelection|null)=>void; disabled?:boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const start = useRef<Point|null>(null);
  const [dimensions, setDimensions] = useState<Point|null>(null);
  const [drag, setDrag] = useState<{a:Point;b:Point}|null>(null);
  const point = (ev: React.PointerEvent<HTMLDivElement>):Point => {
    const r=stage.current!.getBoundingClientRect();
    return {x:bound((ev.clientX-r.left)/r.width,1),y:bound((ev.clientY-r.top)/r.height,1)};
  };
  function finish(ev: React.PointerEvent<HTMLDivElement>) {
    if(!start.current || !dimensions) return;
    const a=start.current,b=point(ev);start.current=null;
    try{stage.current?.releasePointerCapture(ev.pointerId);}catch { /* release on browser cancellation */ }
    setDrag(null);
    const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);
    if(w<0.01 || h<0.01) return;
    onChange({x:Math.round(x*dimensions.x),y:Math.round(y*dimensions.y),
      width:Math.round(w*dimensions.x),height:Math.round(h*dimensions.y),rotationDegrees:0});
  }
  function editField(field:'x'|'y'|'width'|'height'|'rotationDegrees',value:string){
    if(!roi||!dimensions||!value.trim())return;
    const parsed=Number(value);if(!Number.isFinite(parsed))return;
    const current={...roi,rotationDegrees:roi.rotationDegrees??0};
    if(field==='rotationDegrees'){
      onChange({...current,rotationDegrees:Math.max(-180,Math.min(180,parsed))});return;
    }
    const integer=Math.max(0,Math.round(parsed));
    const maxX=dimensions.x-1,maxY=dimensions.y-1;
    if(field==='x')current.x=Math.min(integer,maxX);
    if(field==='y')current.y=Math.min(integer,maxY);
    if(field==='width')current.width=Math.max(1,Math.min(integer,dimensions.x-current.x));
    if(field==='height')current.height=Math.max(1,Math.min(integer,dimensions.y-current.y));
    current.width=Math.min(current.width,dimensions.x-current.x);
    current.height=Math.min(current.height,dimensions.y-current.y);
    onChange(current);
  }
  const bounds=drag&&dimensions?{x:Math.min(drag.a.x,drag.b.x)*dimensions.x,
    y:Math.min(drag.a.y,drag.b.y)*dimensions.y,
    width:Math.abs(drag.a.x-drag.b.x)*dimensions.x,
    height:Math.abs(drag.a.y-drag.b.y)*dimensions.y}:roi;
  return <div className="roi-picker">
    <div className="roi-tools"><strong>너트 영역 선택</strong><span className="muted">사진 위를 드래그해 검사할 영역을 지정할 수 있습니다.</span>
      <button type="button" className="btn-ghost btn-sm" disabled={!roi||disabled} onClick={()=>onChange(null)}>중앙 영역 사용</button></div>
    <div className="roi-stage" ref={stage} role="group" aria-label="드래그로 검사 영역을 선택하는 원본 사진"
      onPointerDown={ev=>{if(disabled||!dimensions)return;const p=point(ev);start.current=p;setDrag({a:p,b:p});ev.currentTarget.setPointerCapture(ev.pointerId);}}
      onPointerMove={ev=>{if(start.current)setDrag({a:start.current,b:point(ev)});}}
      onPointerUp={finish} onPointerCancel={()=>{start.current=null;setDrag(null);}}>
      <img src={imageUrl} alt="검사 영역을 선택할 원본 사진" draggable={false} onLoad={ev=>setDimensions({x:ev.currentTarget.naturalWidth,y:ev.currentTarget.naturalHeight})}/>
      {bounds&&dimensions&&<div className="roi-outline" style={{transform:`rotate(${drag?0:(roi?.rotationDegrees??0)}deg)`,left:`${100*bounds.x/dimensions.x}%`,top:`${100*bounds.y/dimensions.y}%`,
        width:`${100*bounds.width/dimensions.x}%`,height:`${100*bounds.height/dimensions.y}%`}}/>}
    </div>
    {roi&&dimensions&&<div className="roi-coordinate-fields" aria-label="검사 영역 좌표와 회전 직접 보정">
      {([['x','시작 X'],['y','시작 Y'],['width','너비'],['height','높이'],['rotationDegrees','회전 °']] as const).map(([field,label])=><label key={field}>{label}
        <input type="number" value={field==='rotationDegrees'?(roi.rotationDegrees??0):roi[field]}
          min={field==='rotationDegrees'?-180:0} max={field==='rotationDegrees'?180:undefined}
          step={field==='rotationDegrees'?1:1} disabled={disabled} onChange={e=>editField(field,e.target.value)}/>
      </label>)}
    </div>}
    <div className="roi-meta">{roi?`선택 위치 ${Math.round(roi.x)}, ${Math.round(roi.y)} · ${Math.round(roi.width)}×${Math.round(roi.height)}px`:
      '별도 선택이 없으면 중앙 영역을 사전 검사합니다.'}</div>
    {roi&&(roi.width<224||roi.height<224)&&<p className="text-warning">선택 영역의 가로·세로는 각각 224px 이상이어야 합니다.</p>}
    <p className="muted small">선택 영역은 모델 적용 여부를 자동 인증하지 않습니다. 이상 점수는 최종 불량 판정이 아닙니다.</p>
  </div>;
}
