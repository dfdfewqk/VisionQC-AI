import test from 'node:test';
import assert from 'node:assert/strict';
import {code,source,quantity,revision,actor,checkRevision,changed} from '../src/storage/lotProductModel.mjs';

test('LOT and product codes normalize Unicode identifiers',()=>{
 assert.equal(code(' LOT-한글_1 '),'LOT-한글_1');
 assert.equal(code('A.1'), 'A.1');
 for(const s of ['', ' ', 'A/B', 'a space', 'a'.repeat(101)])assert.throws(()=>code(s));
});
test('LOT planned quantity distinguishes unknown from explicitly zero',()=>{
 assert.equal(quantity(null),null);assert.equal(quantity(0),0);assert.equal(quantity(300),300);
 for(const value of [-1,2.5,NaN,Infinity,undefined,'3'])assert.throws(()=>quantity(value));
});
test('worker audit requires author and reason with a legal provenance',()=>{
 assert.deepEqual(actor(' Alice ',' correction '),{operatorName:'Alice',reason:'correction'});
 assert.equal(source('demo'),'demo');assert.throws(()=>source('other'));
 assert.throws(()=>actor('','reason'));assert.throws(()=>actor('Alice',''));
});
test('stale revisions cannot overwrite previously recorded identities',()=>{
 assert.equal(revision(0),0);
 assert.doesNotThrow(()=>checkRevision({revision:2},2));
 assert.throws(()=>checkRevision({revision:2},1),e=>e.code==='identity_revision_conflict');
 for(const v of [-1,1.5,undefined])assert.throws(()=>revision(v));
});
test('unchanged data cannot fabricate an audit event',()=>{
 assert.throws(()=>changed({code:'A'},{code:'A'}));
 assert.doesNotThrow(()=>changed({code:'A'},{code:'B'}));
});
