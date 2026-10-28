/**
 * Own the browser inspection session from opening until the LAST in-flight
 * operation settles. A React unmount / tab switch must never release the
 * cross-tab Web Lock or close IndexedDB during a running save/inference.
 *
 * This module deliberately has no browser dependency so the critical
 * lifecycle can be verified with deterministic deferred promises.
 */
export class InspectionServiceClosedError extends Error {
  constructor() {
    super('검사 화면이 종료 중이거나 이미 종료되었습니다. 새 검사 화면을 열어 주세요.');
    this.name = 'InspectionServiceClosedError';
    this.code = 'inspection_session_closed';
  }
}

/**
 * @param {{methods: Record<string, Function>, dispose: ()=>Promise<void>|void}} options
 */
export function createManagedInspectionService({methods, dispose} = {}) {
  if (!methods || typeof methods !== 'object' || Array.isArray(methods) ||
      Object.keys(methods).length === 0 || typeof dispose !== 'function' ||
      Object.values(methods).some(action => typeof action !== 'function') ||
      Object.keys(methods).some(name => name === 'close')) {
    throw new TypeError('Valid inspection methods and a disposal callback are required');
  }

  const pending = new Set();
  let state = 'open';
  let closePromise = null;
  const wrapped = {};

  for (const [name, action] of Object.entries(methods)) {
    wrapped[name] = (...args) => {
      if (state !== 'open') return Promise.reject(new InspectionServiceClosedError());
      // Track synchronous throws as well as asynchronous work so all calls
      // have the same contract and close() cannot race a newly started call.
      let request;
      try { request = Promise.resolve(action(...args)); }
      catch (error) { request = Promise.reject(error); }
      pending.add(request);
      // DO NOT use an unhandled .finally() return for a rejected request.
      request.then(() => pending.delete(request), () => pending.delete(request));
      return request;
    };
  }

  function close() {
    if (closePromise) return closePromise;
    state = 'closing'; // prevent new work before yielding to any microtask
    closePromise = (async () => {
      try {
        // Only calls started while open can be in this set. Do not dispose
        // until both successful and failed operations finish their cleanups.
        await Promise.allSettled([...pending]);
        await dispose();
      } finally {
        state = 'closed';
      }
    })();
    return closePromise;
  }

  return Object.freeze({...wrapped, close});
}
