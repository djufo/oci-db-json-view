import {test} from 'node:test';import assert from 'node:assert/strict';import {frameAllowed} from './frame-client.mjs';
const entries=[{origin:'https://host.example',name:'embed'}];
const top={};top.self=top;top.top=top;
const framed=(origin,name='embed',referrer='')=>({self:{},top:{},name,location:{ancestorOrigins:origin?[origin]:[]},document:{referrer}});
for(const [name,win,want] of [['top',top,true],['allowed',framed('https://host.example'),true],['wrong name',framed('https://host.example','wrong'),false],['disallowed',framed('https://other.example'),false],['missing info',framed(null),false],['referrer',framed(null,'embed','https://host.example/path'),true],['ancestor precedence',framed('https://other.example','embed','https://host.example'),false]]) test(name,()=>assert.equal(frameAllowed(win,entries),want));
