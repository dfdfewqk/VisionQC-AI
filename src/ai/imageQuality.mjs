/**
 * Conservative, explainable PRE-INFERENCE image-quality precheck.
 *
 * These numbers are engineering safeguards for obviously unusable input,
 * NOT field-calibrated accuracy/acceptance thresholds. A preflight_ok result
 * never authorizes a final verdict or satisfies candidateDecision.quality='pass'.
 * The reference preflight currently inspects the CENTER CROP (not a located nut).
 */
export const IMAGE_QUALITY_POLICY = Object.freeze({
  minSourceShortSide: 256,  // 224px inference after 256px short-side resize and center crop
  maxSourcePixels: 80_000_000,
  maxFileBytes: 40 * 1024 * 1024,
  darkMeanLimit: 20,
  brightMeanLimit: 235,
  clippedFractionLimit: 0.98,
  clippedDarkLimit: 8,
  clippedBrightLimit: 247,
  transparentFractionLimit: 0.02,
  lowDetailContrastLimit: 12,
  suspectedBlurLaplacianVarianceLimit: 12,
});

export const QUALITY_REASON_MESSAGES = Object.freeze({
  invalid_image_dimensions: '이미지 크기 정보를 확인할 수 없습니다. 다시 촬영하거나 다른 파일을 사용해 주세요.',
  unsupported_resolution: '해상도가 부족합니다. 더 가까이에서 선명하게 다시 촬영해 주세요.',
  excessive_resolution: '이미지가 너무 커서 안전하게 분석할 수 없습니다. 원본을 별도로 보관하고 크기를 줄여 주세요.',
  pixel_data_unavailable: '이미지 픽셀을 읽지 못했습니다. 다른 이미지로 다시 시도해 주세요.',
  underexposed: '이미지가 지나치게 어둡습니다. 조명을 개선하고 다시 촬영해 주세요.',
  overexposed: '이미지가 지나치게 밝습니다. 과도한 반사를 줄이고 다시 촬영해 주세요.',
  transparent_pixels: '투명한 영역이 포함되어 정확한 촬영 이미지인지 확인할 수 없습니다.',
  suspected_blur_or_low_texture: '초점이 흐리거나 피사체 세부 정보가 부족할 수 있습니다. 초점·거리·조명을 확인해 주세요.',
  insufficient_visible_detail: '사진에서 윤곽과 세부 정보를 확인하기 어렵습니다. 다시 촬영해 주세요.',
  empty_file: '이미지 파일이 비어 있습니다.',
  excessive_file_size: '파일 용량이 너무 큽니다. 원본을 보관한 뒤 작은 파일로 다시 시도해 주세요.',
  unsupported_file_type: 'JPEG, PNG, WebP 이미지만 지원합니다.',
  image_decode_failed: '이미지 파일을 열지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.',
});

export class ImageQualityHoldError extends Error {
  constructor(report) {
    const reasons = report?.reasonCodes?.length ? report.reasonCodes : ['pixel_data_unavailable'];
    super('이미지 품질 확인 필요: ' + reasons.map(c => QUALITY_REASON_MESSAGES[c] ?? c).join(' '));
    this.name = 'ImageQualityHoldError';
    this.code = 'image_quality_hold';
    this.report = report;
    this.recoverable = true;
  }
}

function makeReport(reasonCodes, measurements = null) {
  const unique = [...new Set(reasonCodes)];
  return Object.freeze({
    status: unique.length ? 'hold' : 'preflight_ok',
    reasonCodes: Object.freeze(unique),
    measurements: measurements ? Object.freeze(measurements) : null,
    qualityVerifiedForClassification: false,
    requiresHumanReview: true,
    policyKind: 'uncalibrated_center_crop_preflight',
  });
}

/** Checks file metadata BEFORE bitmap decoding. No pixel inspection here. */
export function inspectImageInput({type, size} = {}) {
  const reasons = [];
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) reasons.push('unsupported_file_type');
  if (!Number.isSafeInteger(size) || size <= 0) reasons.push('empty_file');
  else if (size > IMAGE_QUALITY_POLICY.maxFileBytes) reasons.push('excessive_file_size');
  return makeReport(reasons);
}

/** Validate original bitmap dimensions before allocating a preprocessing canvas. */
export function inspectImageDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return makeReport(['invalid_image_dimensions']);
  }
  const reasons = [];
  if (Math.min(width, height) < IMAGE_QUALITY_POLICY.minSourceShortSide) reasons.push('unsupported_resolution');
  if (width * height > IMAGE_QUALITY_POLICY.maxSourcePixels) reasons.push('excessive_resolution');
  return makeReport(reasons);
}

/**
 * @param {{width:number, height:number, rgba:Uint8Array|Uint8ClampedArray,
 *   analysisWidth:number, analysisHeight:number}} image
 * width/height = original image resolution. rgba = already center-cropped
 * 224x224 preview, NOT the full-resolution source (avoid huge pixel copies).
 */
export function assessImageQuality(image = {}) {
  const {width, height, rgba, analysisWidth, analysisHeight} = image;
  const dimensionReport = inspectImageDimensions(width, height);
  if (dimensionReport.reasonCodes.includes('invalid_image_dimensions')) return dimensionReport;
  const reasons = [...dimensionReport.reasonCodes];
  if (!Number.isSafeInteger(analysisWidth) || !Number.isSafeInteger(analysisHeight) ||
      analysisWidth < 3 || analysisHeight < 3 ||
      !((rgba instanceof Uint8Array) || (rgba instanceof Uint8ClampedArray)) ||
      rgba.length !== analysisWidth * analysisHeight * 4) {
    reasons.push('pixel_data_unavailable');
    return makeReport(reasons);
  }
  const n = analysisWidth * analysisHeight;
  const lum = new Float32Array(n);
  let sum = 0, sumSquared = 0, dark = 0, bright = 0, alpha = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    const y = 0.2126 * rgba[k] + 0.7152 * rgba[k + 1] + 0.0722 * rgba[k + 2];
    lum[i] = y;
    sum += y; sumSquared += y * y;
    if (y <= IMAGE_QUALITY_POLICY.clippedDarkLimit) dark++;
    if (y >= IMAGE_QUALITY_POLICY.clippedBrightLimit) bright++;
    if (rgba[k + 3] < 255) alpha++;
  }
  const meanLuminance = sum / n;
  const contrastStd = Math.sqrt(Math.max(0, sumSquared / n - meanLuminance * meanLuminance));
  let lapSum = 0, lapSquared = 0, lapCount = 0;
  for (let y = 1; y < analysisHeight - 1; y++) {
    for (let x = 1; x < analysisWidth - 1; x++) {
      const i = y * analysisWidth + x;
      const lap = 4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - analysisWidth] - lum[i + analysisWidth];
      lapSum += lap; lapSquared += lap * lap; lapCount++;
    }
  }
  const laplacianVariance = Math.max(0, lapSquared / lapCount - (lapSum / lapCount) ** 2);
  const darkFraction = dark / n, brightFraction = bright / n;
  const transparentFraction = alpha / n;
  if (meanLuminance < IMAGE_QUALITY_POLICY.darkMeanLimit ||
      darkFraction >= IMAGE_QUALITY_POLICY.clippedFractionLimit) reasons.push('underexposed');
  if (meanLuminance > IMAGE_QUALITY_POLICY.brightMeanLimit ||
      brightFraction >= IMAGE_QUALITY_POLICY.clippedFractionLimit) reasons.push('overexposed');
  if (transparentFraction > IMAGE_QUALITY_POLICY.transparentFractionLimit) reasons.push('transparent_pixels');
  if (contrastStd < IMAGE_QUALITY_POLICY.lowDetailContrastLimit) {
    reasons.push('insufficient_visible_detail');
  } else if (laplacianVariance < IMAGE_QUALITY_POLICY.suspectedBlurLaplacianVarianceLimit) {
    reasons.push('suspected_blur_or_low_texture');
  }
  return makeReport(reasons, {
    sourceWidth: width, sourceHeight: height, analysisWidth, analysisHeight,
    meanLuminance, contrastStd, laplacianVariance,
    darkFraction, brightFraction, transparentFraction,
  });
}

/** A blocked precheck has no valid AI anomaly score or inferred defect label. */
export function assertImageQuality(report) {
  if (report?.status !== 'preflight_ok') throw new ImageQualityHoldError(report);
  return report;
}
