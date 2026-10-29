/**
 * Conservative local foreground-based ROI suggestions for isolated hardware on a
 * plain background. NOT a learned metal-nut detector and NOT evidence that a
 * bounding box contains a nut. The operator must verify each suggested crop.
 *
 * The detection path never sends source pixels over the network. On complex
 * backgrounds it deliberately returns no suggestions and falls back to manual
 * ROI selection, rather than inventing a positive detection.
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const median = values => {
  const items = [...values].sort((a, b) => a - b);
  return items[Math.floor(items.length / 2)];
};
const rgbDistance = (data, offset, rgb) => {
  const dr = data[offset] - rgb[0], dg = data[offset + 1] - rgb[1], db = data[offset + 2] - rgb[2];
  return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
};

/**
 * @param {{width:number,height:number,rgba:Uint8Array|Uint8ClampedArray,
 * sourceWidth?:number,sourceHeight?:number}} input
 * @returns {Array<{x:number,y:number,width:number,height:number,rotationDegrees:0,
 * confidence:number,source:'foreground_suggestion_unverified'}>}
 */
export function findForegroundRoiCandidates({width, height, rgba, sourceWidth=width, sourceHeight=height}={}) {
  if (![width, height, sourceWidth, sourceHeight].every(x => Number.isSafeInteger(x) && x > 0) ||
      width > 700 || height > 700 || width * height < 4096 ||
      !((rgba instanceof Uint8Array) || (rgba instanceof Uint8ClampedArray)) || rgba.length !== width * height * 4) {
    return [];
  }
  // Sample border in evenly spaced segments. Uniform backdrop is mandatory.
  const samples=[];
  const stride=Math.max(1,Math.floor(Math.min(width,height)/30));
  for(let x=0;x<width;x+=stride)for(const y of [0,height-1])samples.push((y*width+x)*4);
  for(let y=0;y<height;y+=stride)for(const x of [0,width-1])samples.push((y*width+x)*4);
  const bg=[0,1,2].map(channel=>median(samples.map(i=>rgba[i+channel])));
  const borderDeviation=median(samples.map(i=>rgbDistance(rgba,i,bg)));
  if(borderDeviation>37) return []; // busy/background with no trustworthy foreground separation
  const threshold=Math.max(38, borderDeviation*3.4+21);
  const mask=new Uint8Array(width*height);
  let foreground=0;
  for(let y=1;y<height-1;y++){
    for(let x=1;x<width-1;x++){
      const idx=y*width+x, at=idx*4;
      if(rgba[at+3]<248 || rgbDistance(rgba,at,bg)<=threshold)continue;
      mask[idx]=1;foreground++;
    }
  }
  if(foreground<width*height*.004 || foreground>width*height*.7) return [];
  const queue=new Int32Array(width*height), regions=[];
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const start=y*width+x;
    if(mask[start]!==1)continue;
    let front=0,back=1,size=0,x0=x,x1=x,y0=y,y1=y;
    queue[0]=start;mask[start]=2;
    while(front<back){
      const i=queue[front++], px=i%width, py=(i-px)/width;size++;
      x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,py);y1=Math.max(y1,py);
      for(const j of [i-1,i+1,i-width,i+width]){
        // Every first/last border pixel remains 0 because we did not segment it.
        if(mask[j]===1){mask[j]=2;queue[back++]=j;}
      }
    }
    const rw=x1-x0+1,rh=y1-y0+1,boxArea=rw*rh,aspect=rw/rh,fill=size/boxArea;
    if(size<width*height*.005 || boxArea>width*height*.62 ||
       aspect<.48 || aspect>2.1 || fill<.17 ||
       x0<2 || y0<2 || x1>width-3 || y1>height-3)continue;
    const margin=Math.max(3,Math.round(Math.max(rw,rh)*.08));
    const left=clamp(x0-margin,0,width),top=clamp(y0-margin,0,height);
    const right=clamp(x1+margin+1,0,width),bottom=clamp(y1+margin+1,0,height);
    const xx=Math.round(left*sourceWidth/width),yy=Math.round(top*sourceHeight/height);
    const rightSource=Math.min(sourceWidth,Math.round(right*sourceWidth/width));
    const bottomSource=Math.min(sourceHeight,Math.round(bottom*sourceHeight/height));
    const rect={x:xx,y:yy,width:rightSource-xx,height:bottomSource-yy};
    // PatchCore needs at least 224 original image pixels on each side.
    if(Math.min(rect.width,rect.height)<224)continue;
    const confidence=clamp((1-borderDeviation/50)*.45+Math.min(1,fill/.55)*.25+
      Math.min(1,size/(width*height*.08))*.3,0,1);
    regions.push({...rect,rotationDegrees:0,
      confidence:Math.round(confidence*1000)/1000,source:'foreground_suggestion_unverified'});
  }
  return regions.sort((a,b)=>b.confidence-a.confidence||b.width*b.height-a.width*a.height).slice(0,5);
}

/** Browser wrapper; all computation remains on the user's device. */
export async function suggestNutRois(file,{maxSize=384}={}){
  if(!(file instanceof Blob) || !['image/png','image/jpeg','image/webp'].includes(file.type) ||
      file.size===0 || file.size>40*1024*1024)return [];
  if(typeof createImageBitmap!=='function'||typeof document==='undefined')return [];
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
  try{
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>80_000_000)return [];
    const scale=Math.min(1,maxSize/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return [];
    ctx.drawImage(bitmap,0,0,width,height);
    const pixels=ctx.getImageData(0,0,width,height);
    return findForegroundRoiCandidates({width,height,rgba:pixels.data,
      sourceWidth:bitmap.width,sourceHeight:bitmap.height});
  }finally{bitmap.close();}
}
