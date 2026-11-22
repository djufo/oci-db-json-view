import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFramePolicy } from './frame-policy.mjs';
import { frameAllowed } from './frame-client.mjs';

test('default deny and origin/name pairs', () => {
  assert.deepEqual(parseFramePolicy({}), []);
  assert.deepEqual(parseFramePolicy({FRAME_ALLOWED_ANCESTORS:'https://host.example|embed'}), [{origin:'https://host.example', name:'embed'}]);
});
for (const value of ['*|embed','https://*.example|embed','https://host.example/path|embed','https://host.example/|embed','https://host.example','https://host.example|','https://host.example|x|y','https://user@host.example|embed','https://host.example?x|embed','https://host.example#x|embed','https://host.example|x,','http://localhost|embed','http://127.0.0.1|embed','https://host;script-src|embed',"https://host'|embed",'https://-host.example|embed','https://host..example|embed']) {
  test('startup refuses '+value, () => assert.throws(() => parseFramePolicy({FRAME_ALLOWED_ANCESTORS:value})));
}
test('HTTP requires an explicit insecure hostname', () => {
  assert.equal(parseFramePolicy({FRAME_ALLOWED_ANCESTORS:'http://localhost:8080|embed',FRAME_ALLOWED_INSECURE_HOSTS:'localhost'})[0].origin,'http://localhost:8080');
  assert.throws(() => parseFramePolicy({FRAME_ALLOWED_ANCESTORS:'http://other:8080|embed',FRAME_ALLOWED_INSECURE_HOSTS:'localhost'}));
});
const entries=[{origin:'https://host.example',name:'embed'}];
const top={}; top.self=top; top.top=top;
function framed(origin, name='embed', referrer='') { return {self:{},top:{},name,location:{ancestorOrigins:origin===null?[]:[origin]},document:{referrer}}; }
for (const [name,win,want] of [
 ['top',top,true], ['allowed origin and name',framed('https://host.example'),true],
 ['wrong name',framed('https://host.example','wrong'),false], ['disallowed origin',framed('https://other.example'),false],
 ['missing ancestor',framed(null),false], ['referrer fallback',framed(null,'embed','https://host.example/page'),true],
 ['ancestor takes precedence',framed('https://other.example','embed','https://host.example/'),false],
 ['opaque origin',framed('null'),false], ['malformed referrer',framed(null,'embed','broken'),false],
]) test('client '+name, () => assert.equal(frameAllowed(win,entries),want));

import {frameCSP} from './frame-policy.mjs';
test('empty allowlist preserves an explicit route denial', () => {
  assert.equal(frameCSP([], "default-src 'none'; FRAME-ANCESTORS 'none'; sandbox"), "default-src 'none'; sandbox; frame-ancestors 'none'");
  assert.equal(frameCSP([], "default-src 'none'"), "default-src 'none'; frame-ancestors 'self'");
  assert.equal(frameCSP([{origin:'https://host.example',name:'embed'}], "frame-ancestors 'none'"), "frame-ancestors 'self' https://host.example");
});
