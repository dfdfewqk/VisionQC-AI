/** Concrete browser adapter: preflight PatchCore -> optional PNG overlay -> transactional IndexedDB. */
import {runMetalNutPreflight, makeOverlay} from './patchcore';
import {createInspectionService} from './inspectionService.mjs';
import {openInspectionDatabase, createInspectionRepository} from '../storage/inspectionDb.mjs';

async function overlayAsPngBlob(file: File, inference: Awaited<ReturnType<typeof runMetalNutPreflight>>) {
  const dataUrl = await makeOverlay(file, inference);
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Heatmap PNG encoding is not supported');
  }
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (blob.type !== 'image/png' || blob.size === 0) throw new Error('Heatmap PNG is invalid');
  return blob;
}

/**
 * Only run in a secure browser context. The owning UI must close this repository
 * when its inspection screen is unmounted. No auto-upload/network telemetry.
 */
export async function openBrowserInspectionService() {
  const db = await openInspectionDatabase();
  const repository = createInspectionRepository({db});
  const service = createInspectionService({repository, infer:runMetalNutPreflight, renderOverlay:overlayAsPngBlob});
  return {
    inspectAndSave: service.inspectAndSave,
    list: repository.list,
    get: repository.get,
    remove: repository.remove,
    close: repository.close,
    databaseName: repository.databaseName,
  };
}
