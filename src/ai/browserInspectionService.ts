/** Concrete browser adapter: preflight PatchCore -> optional PNG overlay -> transactional IndexedDB. */
import {runMetalNutPreflight, makeOverlayBlob} from './patchcore';
import {createInspectionService} from './inspectionService.mjs';
import {createManagedInspectionService} from './serviceLifecycle.mjs';
import {openInspectionDatabase, createInspectionRepository} from '../storage/inspectionDb.mjs';
import {acquireInspectionTabLock} from '../storage/inspectionLock.mjs';

/**
 * Open an exclusive session, usable in secure browser contexts only.
 * Every caller MUST await `service.close()` on unmount. Close rejects new
 * calls immediately, drains active inference / save / reads, then releases
 * IndexedDB and the one-active-tab Web Lock in that order.
 */
export async function openBrowserInspectionService() {
  const tabLock = await acquireInspectionTabLock();
  let db: IDBDatabase | undefined;
  try {
    db = await openInspectionDatabase();
    const repository = createInspectionRepository({db});
    const service = createInspectionService({repository, infer:runMetalNutPreflight, renderOverlay:makeOverlayBlob});
    const managed = createManagedInspectionService({
      methods: {
        inspectAndSave: service.inspectAndSave,
        list: repository.list,
        get: repository.get,
        remove: repository.remove,
      },
      dispose: async () => {
        try { repository.close(); }
        finally { await tabLock.release(); }
      },
    });
    return {...managed, databaseName: repository.databaseName};
  } catch (error) {
    try { db?.close(); }
    finally { await tabLock.release(); }
    throw error;
  }
}
