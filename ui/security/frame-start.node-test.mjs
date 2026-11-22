import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startApp} from './frame-client.mjs';

test('offline top-level starts immediately without fetching configuration', async t => {
  const top = {}; top.self = top; top.top = top;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {value:top, configurable:true});
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const doc = {documentElement:{innerHTML:'cached shell'}};
  Object.defineProperty(globalThis, 'document', {value:doc, configurable:true});
  try {
    let loaded = false;
    const started = startApp(async config => { loaded = true; assert.deepEqual(config, {frameAllowedAncestors:[]}); });
    assert.equal(loaded, true);
    await started;
    assert.equal(globalThis.fetch.mock.callCount(), 0);
    assert.equal(doc.documentElement.innerHTML, 'cached shell');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window;
    if (documentBefore) Object.defineProperty(globalThis, 'document', documentBefore); else delete globalThis.document;
  }
});
