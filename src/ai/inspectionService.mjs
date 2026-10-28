/** AI-to-IndexedDB glue that does not import or alter Antigravity-owned UI/camera code. */
import {createHeldSnapshot, createInferredSnapshot} from '../storage/inspectionModel.mjs';
import {ImageQualityHoldError} from './imageQuality.mjs';

const makeId = () => globalThis.crypto.randomUUID();
/**
 * Only capture a return value once persistence transaction successfully commits.
 * @param {{repository: {fingerprint: (file: Blob)=>Promise<string>, save: (args: any)=>Promise<any>},
 *   infer: (file: File, options?: {roi?: any|null})=>Promise<any>,
 *   renderOverlay?: ((file: File, inference: any)=>Promise<Blob>)|null,
 *   uuid?: ()=>string, clock?: ()=>string}} options
 */
export function createInspectionService({repository, infer, renderOverlay = null, uuid = makeId,
  clock = () => new Date().toISOString()} = {}) {
  if (!repository?.fingerprint || !repository?.save || typeof infer !== 'function') {
    throw new TypeError('Repository fingerprint/save and AI inference functions are required');
  }
  return {
    async inspectAndSave({file, sourceType = 'user', lotId = null, productId = null, roi = null, reinspectionOf = null, inspectionId = null} = {}) {
      // Source hash computation occurs before inference, ensuring exact photo-identity linkage.
      const sourceId = await repository.fingerprint(file);
      // Persistent queue job ID is also the immutable inspection ID. If a crash
      // occurs after saving but before marking its job complete, recovery can
      // reconcile without creating a duplicate inspection record.
      if (inspectionId !== null && (typeof inspectionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(inspectionId))) {
        throw new TypeError('Invalid persistent inspection ID');
      }
      const id = inspectionId ?? uuid();
      const createdAt = clock();
      let snapshot, overlay = null;
      try {
        const inference = await infer(file, {roi});
        snapshot = createInferredSnapshot({id,sourceId,createdAt,sourceType,lotId,productId,reinspectionOf,inference});
        if (renderOverlay) overlay = await renderOverlay(file,inference);
      } catch (error) {
        // Only recoverable image-quality holds may become saved inspection holds.
        // Model/network/runtime errors remain errors; never masquerade as quality/defect labels.
        if (!(error instanceof ImageQualityHoldError)) throw error;
        const width = Number.isSafeInteger(error.report?.sourceWidth) && error.report.sourceWidth > 0
          ? error.report.sourceWidth : null;
        const height = Number.isSafeInteger(error.report?.sourceHeight) && error.report.sourceHeight > 0
          ? error.report.sourceHeight : null;
        snapshot = createHeldSnapshot({id,sourceId,createdAt,sourceType,lotId,productId,reinspectionOf,
          width,height,report:error.report});
      }
      await repository.save({file,snapshot,overlay});
      return snapshot;
    },
  };
}
