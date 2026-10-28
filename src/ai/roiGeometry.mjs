/**
 * VisionQC ROI contract. Coordinates are in the original, EXIF-oriented bitmap
 * (not CSS pixels). The chosen region is rotated counter-clockwise in source
 * coordinates as theta increases; canvas coordinates grow downward.
 *
 * A model pixel position p = (x,y) maps into the source image as:
 *  src = center + Rotate(theta) * ((p-centerPixel) .* (regionSize/modelSize))
 * The inverse transform is used to sample the original image into model space.
 * This is a geometric mapping, NOT a statement that ROI or nut identity is verified.
 */
export const MODEL_INPUT_SIDE = 224;
const MAX_ROI_ABS_ANGLE = 180;
const EPS = 1e-6;

export function validateRoiSelection(selection, sourceWidth, sourceHeight) {
  if (![sourceWidth, sourceHeight].every(v => Number.isSafeInteger(v) && v > 0)) {
    throw new RangeError('Invalid source bitmap dimensions');
  }
  if (!selection || typeof selection !== 'object') throw new TypeError('ROI selection is required');
  const {x, y, width, height} = selection;
  const angle = selection.rotationDegrees ?? 0;
  if (![x,y,width,height,angle].every(v=>typeof v==='number' && Number.isFinite(v)) ||
      width <= 0 || height <= 0 || Math.abs(angle) > MAX_ROI_ABS_ANGLE) {
    throw new RangeError('ROI coordinates/rotation must be finite and valid');
  }
  if (x < 0 || y < 0 || x+width > sourceWidth + EPS || y+height > sourceHeight + EPS) {
    throw new RangeError('ROI rectangle must be inside the source image');
  }
  const region = {x,y,width,height,rotationDegrees:angle};
  // Check all four corners of the actually rotated sampling footprint.
  const points = [[0,0],[MODEL_INPUT_SIDE,0],[0,MODEL_INPUT_SIDE],[MODEL_INPUT_SIDE,MODEL_INPUT_SIDE]];
  for (const [px,py] of points) {
    const pt = modelToSource(region, px, py);
    if (pt.x < -EPS || pt.y < -EPS || pt.x > sourceWidth+EPS || pt.y > sourceHeight+EPS) {
      throw new RangeError('Rotated ROI would sample outside the source image');
    }
  }
  return Object.freeze(region);
}

export function modelToSource(region, pixelX, pixelY, modelSize=MODEL_INPUT_SIDE) {
  const {x,y,width,height,rotationDegrees=0}=region;
  const rad=rotationDegrees*Math.PI/180;
  const dx=(pixelX/modelSize-0.5)*width;
  const dy=(pixelY/modelSize-0.5)*height;
  return {x:x+width/2 + Math.cos(rad)*dx - Math.sin(rad)*dy,
          y:y+height/2 + Math.sin(rad)*dx + Math.cos(rad)*dy};
}

export function sourceToModel(region, sourceX, sourceY, modelSize=MODEL_INPUT_SIDE) {
  const {x,y,width,height,rotationDegrees=0}=region;
  const rad=rotationDegrees*Math.PI/180;
  const dx=sourceX-x-width/2,dy=sourceY-y-height/2;
  return {x:modelSize*(0.5 + (Math.cos(rad)*dx + Math.sin(rad)*dy)/width),
          y:modelSize*(0.5 + (-Math.sin(rad)*dx + Math.cos(rad)*dy)/height)};
}

/** Transform a full-size image canvas context to sample a selected ROI as a square model image. */
export function applySourceToModelCanvas(ctx, region, modelSize=MODEL_INPUT_SIDE) {
  ctx.translate(modelSize/2, modelSize/2);
  ctx.scale(modelSize/region.width, modelSize/region.height);
  ctx.rotate(-(region.rotationDegrees??0)*Math.PI/180);
  ctx.translate(-region.x-region.width/2, -region.y-region.height/2);
}

/** Transform model heatmap coordinates back onto the original bitmap. */
export function applyModelToSourceCanvas(ctx, region, modelSize=MODEL_INPUT_SIDE) {
  ctx.translate(region.x+region.width/2,region.y+region.height/2);
  ctx.rotate((region.rotationDegrees??0)*Math.PI/180);
  ctx.scale(region.width/modelSize,region.height/modelSize);
  ctx.translate(-modelSize/2,-modelSize/2);
}
