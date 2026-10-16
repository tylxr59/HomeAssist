'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {Client, endpoint, readable} = require('../src/pkjs/ha');
function clock() {
  let id = 0; const pending = new Map();
  return {set(fn) { pending.set(++id, fn); return id; }, clear(id) { pending.delete(id); }, tick() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn()); }, pending};
}
function harness(command) {
  let socket, calls = [];
  class Socket {
    constructor(url) { this.url = url; this.sent = []; socket = this; }
    send(s) { this.sent.push(JSON.parse(s)); }
    close() { this.closed = true; if (this.onclose) this.onclose(); }
    receive(m) { this.onmessage({data: JSON.stringify(m)}); }
  }
  const timers = clock();
  const cancel = new Client(Socket, timers).perform({url: 'https://ha.test/prefix/', token: 'secret', pipeline: 'p1'}, command, (err, result) => calls.push({err, result}));
  return {get ws() {return socket;}, timers, calls, cancel, auth() { socket.receive({type: 'auth_required'}); socket.receive({type: 'auth_ok'}); }};
}
test('URL conversion preserves path and rejects credentials/query/unsupported schemes', () => {
  assert.equal(endpoint(' http://ha.test:8123/proxy/ '), 'ws://ha.test:8123/proxy/api/websocket');
  for (const url of ['ftp://ha', 'https://user:pass@ha', 'https://ha/?token=x', 'https://ha/#x', '']) assert.throws(() => endpoint(url));
});
test('authenticates before fetching assistants and closes exactly once', () => {
  const h = harness(null);
  assert.equal(h.ws.sent.length, 0); h.auth();
  assert.deepEqual(h.ws.sent, [{type: 'auth', access_token: 'secret'}, {id: 1, type: 'assist_pipeline/pipeline/list'}]);
  h.ws.receive({type: 'result', id: 1, success: true, result: {pipelines: [{id: 'p1', name: 'Local'}]}});
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].result[0].id, 'p1'); assert.equal(h.timers.pending.size, 0); assert.ok(h.ws.closed);
});
test('auth failures, permissions, malformed list and invalid JSON fail safely', () => {
  const bad = harness(null); bad.ws.receive({type: 'auth_invalid'}); assert.match(bad.calls[0].err.message, /Authentication/);
  const denied = harness(null); denied.auth(); denied.ws.receive({type: 'result', id: 1, success: false, error: {code: 'unauthorized'}}); assert.match(denied.calls[0].err.message, /permissions/);
  const list = harness(null); list.auth(); list.ws.receive({type: 'result', id: 1, success: true, result: {}}); assert.match(list.calls[0].err.message, /Invalid/);
  const json = harness(null); json.ws.onmessage({data: '{'}); assert.match(json.calls[0].err.message, /Invalid/);
});
test('runs only intent stage, waits for run-end, ignores unrelated events and preserves conversation', () => {
  const h = harness({text: 'lights on', conversationId: 'conversation-1'}); h.auth();
  assert.deepEqual(h.ws.sent[1], {id: 1, type: 'assist_pipeline/run', pipeline: 'p1', start_stage: 'intent', end_stage: 'intent', input: {text: 'lights on'}, conversation_id: 'conversation-1'});
  h.ws.receive({type: 'result', id: 1, success: true}); assert.equal(h.calls.length, 0);
  h.ws.receive({type: 'event', id: 2, event: {type: 'error'}}); assert.equal(h.calls.length, 0);
  h.ws.receive({type: 'event', id: 1, event: {type: 'intent-end', data: {intent_output: {conversation_id: 'conversation-2', response: {speech: {plain: {speech: 'Lights on'}}}}}}});
  assert.equal(h.calls.length, 0);
  h.ws.receive({type: 'event', id: 1, event: {type: 'run-end'}});
  assert.deepEqual(h.calls[0].result, {text: 'Lights on', conversationId: 'conversation-2'});
});
test('timeout, disconnect, pipeline errors and cancellation never replay commands', () => {
  for (const fail of [h => h.timers.tick(), h => h.ws.onclose(), h => h.ws.onerror(), h => h.cancel(), h => h.ws.receive({type: 'event', id: 1, event: {type: 'error', data: {message: 'Agent unavailable'}}})]) {
    const h = harness({text: 'unlock door'}); h.auth(); fail(h); h.ws.onclose();
    assert.equal(h.calls.length, 1); assert.ok(h.calls[0].err); assert.equal(h.ws.sent.filter(m => m.type === 'assist_pipeline/run').length, 1);
  }
  const missing = harness({text: 'hi'}); missing.auth(); missing.ws.receive({id: 1, type: 'result', success: false, error: {code: 'pipeline-not-found'}}); assert.match(missing.calls[0].err.message, /Select another/);
});
test('plain, SSML, empty and error replies are readable', () => {
  assert.equal(readable({response: {speech: {ssml: {speech: '<speak>Kitchen &amp; hall &#33;</speak>'}}}}), 'Kitchen & hall !');
  assert.match(readable({response: {response_type: 'error'}}), /could not/);
  assert.match(readable({}), /no text/);
});
