'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const protocol = require('../src/pkjs/protocol');
function harness(options = {}) {
  const handlers = {}, sent = [], ops = [], store = {}, pages = [];
  const keys = {Type: 0, RequestId: 1, Text: 2, Ready: 3, Assistant: 4, ChunkIndex: 5, ChunkLast: 6, Url: 7, Token: 8, Pipeline: 9};
  class Clay { constructor(config) {this.meta = {}; pages.push(config);} setSettings() {} generateUrl() {return 'data:local';} getSettings(s) {return JSON.parse(s);} }
  class Client {perform(settings, command, cb) {if (options.discoveryThrows && !command) throw new TypeError('Illegal invocation'); const op = {settings: {...settings}, command, cb}; ops.push(op); return () => cb(new Error('Cancelled'));}}
  const context = {require(name) {
    if (name === '@rebble/clay') return Clay;
    if (name === 'message_keys') return keys;
    if (name === './ha') return {Client, endpoint: require('../src/pkjs/ha').endpoint};
    return require(path.resolve('src/pkjs', name));
  }, Pebble: {addEventListener(name, fn) {handlers[name] = fn;}, sendAppMessage(m) {sent.push(m);}, openURL() {}}, WebSocket: function() {}, localStorage: {getItem(k) {return store[k];}, setItem(k,v) {store[k] = v;}}, setTimeout, clearTimeout};
  vm.runInNewContext(fs.readFileSync('src/pkjs/index.js', 'utf8'), context);
  return {handlers, sent, ops, store, pages, save(pipeline = '', url = 'http://ha.test') {handlers.showConfiguration(); handlers.webviewclosed({response: JSON.stringify({Url: {value: url}, Token: {value: 'secret'}, Pipeline: {value: pipeline}})});}, command(id, text = 'hello') {handlers.appmessage({payload: {Type: 2, RequestId: id, Text: text}});}, ack(id) {handlers.appmessage({payload: {Type: 5, RequestId: id, ChunkIndex: 0}});}};
}
test('saved configuration requires an explicit valid assistant and sends no credentials to watch', () => {
  const h = harness(); h.handlers.ready(); assert.equal(h.sent.at(-1).Ready, 0);
  h.save(); assert.equal(h.ops.length, 1); h.ops[0].cb(null, [{id: 'p1', name: 'Local'}]);
  assert.equal(h.sent.at(-1).Ready, 0);
  h.handlers.showConfiguration(); assert.match(JSON.stringify(h.pages.at(-1)), /Local/);
  h.save('p1'); h.ops[1].cb(null, [{id: 'p1', name: 'Local'}]); assert.equal(h.sent.at(-1).Ready, 1);
  assert.ok(!JSON.stringify(h.sent).includes('secret')); assert.ok(!JSON.stringify(h.sent).includes('http://ha.test'));
});
test('conversation continues until HELLO or configuration change, and overlapping commands are rejected', () => {
  const h = harness(); h.save(); h.ops[0].cb(null, [{id: 'p1', name: 'Local'}]); h.save('p1'); h.ops[1].cb(null, [{id: 'p1', name: 'Local'}]);
  h.command(1); const op = h.ops.at(-1); h.command(2); assert.equal(h.ops.at(-1), op); assert.match(h.sent.at(-1).Text, /still processing/);
  op.cb(null, {text: 'Hi', conversationId: 'c1'}); h.ack(1);
  h.command(3); assert.equal(h.ops.at(-1).command.conversationId, 'c1'); h.ops.at(-1).cb(null, {text: 'Follow up', conversationId: 'c1'}); h.ack(3);
  h.handlers.appmessage({payload: {Type: 0}}); h.command(4); assert.equal(h.ops.at(-1).command.conversationId, null);
  h.save('p1'); const count = h.sent.length; h.ops.at(-2).cb(null, {text: 'stale', conversationId: 'old'}); assert.equal(h.sent.length, count);
});
test('credential change preserves the page selection for validation; removed pipeline requires reselection', () => {
  const h = harness(); h.save(); h.ops[0].cb(null, [{id: 'p1', name: 'Local'}]); h.save('p1'); h.ops[1].cb(null, []); assert.equal(h.sent.at(-1).Ready, 0);
  const count = h.ops.length; h.handlers.webviewclosed({response: 'CANCELLED'}); assert.equal(h.ops.length, count);
  h.save('p1', 'https://new-ha.test'); assert.equal(h.ops.at(-1).settings.pipeline, 'p1');
  h.ops.at(-1).cb(new Error('Authentication failed')); assert.equal(h.sent.at(-1).Ready, 0);
});
test('opening watch during discovery preserves the pending setup operation', () => {
  const h = harness(); h.save(); const op = h.ops[0];
  h.handlers.appmessage({payload: {Type: 0}});
  op.cb(null, [{id: 'p1', name: 'Local'}]);
  assert.equal(JSON.parse(h.store['homeassist-pipelines'])[0].id, 'p1');
  h.handlers.showConfiguration(); assert.match(JSON.stringify(h.pages.at(-1)), /Local/);
});

test('synchronous discovery failure persists an error and can be retried', () => {
  const options = {discoveryThrows: true}, h = harness(options);
  assert.doesNotThrow(() => h.save());
  assert.match(h.sent.at(-1).Text, /Could not start assistant discovery/);
  assert.equal(h.sent.at(-1).Ready, 0);
  assert.match(JSON.parse(h.store['homeassist-status']), /Could not start/);
  h.handlers.showConfiguration();
  assert.match(JSON.stringify(h.pages.at(-1)), /Connect/);
  options.discoveryThrows = false;
  h.save(); h.ops.at(-1).cb(null, [{id: 'p1', name: 'AI'}]);
  h.handlers.showConfiguration(); assert.match(JSON.stringify(h.pages.at(-1)), /AI/);
  h.save('p1'); h.ops.at(-1).cb(null, [{id: 'p1', name: 'AI'}]);
  assert.equal(h.sent.at(-1).Ready, 1);
  h.handlers.showConfiguration();
  const select = h.pages.at(-1)[2].items.find(item => item.messageKey === 'Pipeline');
  assert.equal(select.defaultValue, 'p1');
});
