/** Concrete browser adapter: preflight PatchCore -> optional PNG overlay -> transactional IndexedDB. */
import {runMetalNutPreflight, makeOverlayBlob} from './patchcore';
import {createInspectionService} from './inspectionService.mjs';
import {openInspectionDatabase, createInspectionRepository} from '../storage/inspectionDb.mjs';
import {acquireInspectionTabLock} from '../storage/inspectionLock.mjs';

/**
 * Only run in a secure browser context. The owning UI must close this repository
 * when its inspection screen is unmounted. No auto-upload/network telemetry.
 */
export async function openBrowserInspectionService() {
  const tabLock = await acquireInspectionTabLock();
  let db: IDBDatabase;
  try { db = await openInspectionDatabase(); }
  catch (error) { await tabLock.release(); throw error; }
  let repository: ReturnType<typeof createInspectionRepository>;
  try { repository = createInspectionRepository({db}); }
  catch (error) { db.close(); await tabLock.release(); throw error; }
  const service = createInspectionService({repository, infer:runMetalNutPreflight, renderOverlay:makeOverlayBlob});
  return {
    inspectAndSave: service.inspectAndSave,
    list: repository.list,
    get: repository.get,
    remove: repository.remove,
    close() { repository.close(); return tabLock.release(); },
    databaseName: repository.databaseName,
  };
}
