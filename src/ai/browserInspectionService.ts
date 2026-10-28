/** Concrete browser adapter: preflight PatchCore -> optional PNG overlay -> transactional IndexedDB. */
import {runMetalNutPreflight, makeOverlayBlob} from './patchcore';
import {createInspectionService} from './inspectionService.mjs';
import {createManagedInspectionService} from './serviceLifecycle.mjs';
import {openInspectionDatabase, createInspectionRepository} from '../storage/inspectionDb.mjs';
import {acquireInspectionTabLock} from '../storage/inspectionLock.mjs';
import {createInspectionQueueRepository} from '../storage/inspectionQueueDb.mjs';
import {createInspectionQueueRunner} from './inspectionQueue.mjs';

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
    const opened = await openInspectionDatabase();
    db = opened;
    const repository = createInspectionRepository({db: opened});
    const service = createInspectionService({repository, infer:runMetalNutPreflight, renderOverlay:makeOverlayBlob});
    const queue = createInspectionQueueRepository({db:opened});
    // No automatic run on page load. Interrupted work survives and needs
    // an explicit user action to resume after reviewing queue metadata.
    await queue.recoverInterrupted();
    const runner = createInspectionQueueRunner({queue,
      inspectAndSave:service.inspectAndSave,findExisting:repository.get});
    const managed = createManagedInspectionService({
      methods: {
        inspectAndSave: service.inspectAndSave,
        list: repository.list,
        get: repository.get,
        remove: repository.remove,
        findDuplicates: repository.findDuplicates,
        statistics: repository.statistics,
        enqueueInspection: queue.enqueue,
        listInspectionQueue: queue.list,
        startInspectionQueue: runner.runQueue,
        cancelQueuedInspection: queue.cancel,
        retryFailedQueueImage: queue.retryFailedImage,
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
