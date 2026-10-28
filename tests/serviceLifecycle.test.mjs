import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedInspectionService, InspectionServiceClosedError} from '../src/ai/serviceLifecycle.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
const flush = async () => {await Promise.resolve(); await Promise.resolve();};

test('closing a session waits for an in-progress inference and persistent save', async () => {
  const blocked = deferred();
  const order = [];
  const session = createManagedInspectionService({
    methods: {inspectAndSave: async () => {order.push('started'); await blocked.promise; order.push('saved'); return 'id-1';}},
    dispose: async () => {order.push('disposed');},
  });
  const running = session.inspectAndSave();
  const closing = session.close();
  await flush();
  assert.deepEqual(order, ['started']);
  await assert.rejects(() => session.inspectAndSave(), InspectionServiceClosedError);
  blocked.resolve();
  assert.equal(await running, 'id-1');
  await closing;
  assert.deepEqual(order, ['started', 'saved', 'disposed']);
});

test('get, list and remove are also tracked until all settle', async () => {
  const get = deferred(), remove = deferred();
  let released = false;
  const service = createManagedInspectionService({
    methods: {get: () => get.promise, remove: () => remove.promise, list: () => []},
    dispose: () => {released = true;},
  });
  const retrieving = service.get('id');
  const deleting = service.remove('id');
  assert.deepEqual(await service.list(), []);
  const closing = service.close();
  get.resolve('record');
  await retrieving;
  await flush();
  assert.equal(released, false);
  remove.resolve(true);
  assert.equal(await deleting, true);
  await closing;
  assert.equal(released, true);
});

test('close is idempotent and runs disposal just once', async () => {
  let closed = 0;
  const service = createManagedInspectionService({methods:{get:()=>null},dispose:async()=>{closed++;}});
  const a = service.close();
  const b = service.close();
  assert.strictEqual(a,b);
  await Promise.all([a,b]);
  await service.close();
  assert.equal(closed,1);
  await assert.rejects(() => service.get('id'), {code:'inspection_session_closed'});
});

test('failed in-flight operations do not prevent resource release', async () => {
  const blocked = deferred();
  let closed = 0;
  const service = createManagedInspectionService({
    methods:{inspectAndSave:()=>blocked.promise},
    dispose:()=>{closed++;},
  });
  const running = service.inspectAndSave();
  const assertion = assert.rejects(running,/model download failed/);
  const closing = service.close();
  blocked.reject(new Error('model download failed'));
  await assertion;
  await closing;
  assert.equal(closed,1);
});

test('disposal failure still closes session and is reported to caller', async () => {
  const service = createManagedInspectionService({methods:{get:()=>1},dispose:()=>{throw Error('dispose failed');}});
  await assert.rejects(() => service.close(),/dispose failed/);
  await assert.rejects(() => service.get('id'), InspectionServiceClosedError);
  await assert.rejects(() => service.close(),/dispose failed/);
});

test('synchronous method failure is represented as a rejected promise', async () => {
  const service = createManagedInspectionService({methods:{get:()=>{throw Error('db closed');}},dispose:()=>{}});
  await assert.rejects(() => service.get('id'),/db closed/);
  await service.close();
});

test('invalid lifecycle wiring fails before any resources can be leaked', () => {
  assert.throws(() => createManagedInspectionService({methods:{},dispose:()=>{}}),/Valid inspection/);
  assert.throws(() => createManagedInspectionService({methods:{close:()=>{}},dispose:()=>{}}),/Valid inspection/);
  assert.throws(() => createManagedInspectionService({methods:{get:5},dispose:()=>{}}),/Valid inspection/);
});
