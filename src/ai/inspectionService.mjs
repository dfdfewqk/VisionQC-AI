/** AI-to-IndexedDB glue that does not import or alter Antigravity-owned UI/camera code. */
import {createHeldSnapshot, createInferredSnapshot} from '../storage/inspectionModel.mjs';
import {ImageQualityHoldError} from './imageQuality.mjs';

const makeId = () => globalThis.crypto.randomUUID();
/** Only capture a return value once persistence transaction successfully commits. */
export function createInspectionService({repository, infer, renderOverlay = null, uuid = makeId,
  clock = () => new Date().toISOString()} = {}) {
  if (!repository?.fingerprint || !repository?.save || typeof infer !== 'function') {
    throw new TypeError('Repository fingerprint/save and AI inference functions are required');
  }
  return {
    async inspectAndSave({file, sourceType = 'user', lotId = null, productId = null} = {}) {
      // Source hash computation occurs before inference, ensuring exact photo-identity linkage.
      const sourceId = await repository.fingerprint(file);
      const id = uuid();
      const createdAt = clock();
      let snapshot, overlay = null;
      try {
        const inference = await infer(file);
        snapshot = createInferredSnapshot({id,sourceId,createdAt,sourceType,lotId,productId,inference});
        if (renderOverlay) overlay = await renderOverlay(file,inference);
      } catch (error) {
        // Only recoverable image-quality holds may become saved inspection holds.
        // Model/network/runtime errors remain errors; never masquerade as quality/defect labels.
        if (!(error instanceof ImageQualityHoldError)) throw error;
        const width = Number.isSafeInteger(error.report?.sourceWidth) && error.report.sourceWidth > 0
          ? error.report.sourceWidth : null;
        const height = Number.isSafeInteger(error.report?.sourceHeight) && error.report.sourceHeight > 0
          ? error.report.sourceHeight : null;
        snapshot = createHeldSnapshot({id,sourceId,createdAt,sourceType,lotId,productId,
          width,height,report:error.report});
      }
      await repository.save({file,snapshot,overlay});
      return snapshot;
    },
  };
}
