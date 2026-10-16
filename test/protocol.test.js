'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {chunks, bytes, value, Transfer} = require('../src/pkjs/protocol');
function clock() { let id = 0; const map = new Map(); return {set(fn) {map.set(++id, fn); return id;}, clear(id) {map.delete(id);}, tick() {const f = [...map.values()]; map.clear(); f.forEach(fn => fn());}}; }
test('UTF-8 chunks preserve complete characters and explicitly truncate oversized replies', () => {
  const text = 'aé🌍'.repeat(900); const parts = chunks(text);
  assert.equal(parts.join(''), text); assert.ok(parts.every(s => bytes(s) <= 400));
  const large = chunks('🌍'.repeat(3000)).join(''); assert.ok(bytes(large) <= 8192); assert.match(large, /\[Reply truncated\]$/);
  assert.equal(chunks('\ud800')[0], '\ufffd');
});
test('numeric and named payload keys are supported', () => { assert.equal(value({2: 'abc'}, {Text: 2}, 'Text'), 'abc'); assert.equal(value({Text: 'abc'}, {}, 'Text'), 'abc'); });
test('chunks advance only with matching acknowledgement and ignore stale acknowledgements', () => {
  const sent = [], timers = clock(); const t = new Transfer(m => sent.push(m), timers, () => assert.fail('transfer failed'));
  t.start(7, 'a'.repeat(900)); t.ack(6, 0); t.ack(7, 1); assert.equal(sent.length, 1);
  timers.tick(); assert.deepEqual(sent[0], sent[1]);
  t.ack(7, 0); t.ack(7, 0); assert.equal(sent.length, 3);
  t.ack(7, 1); t.ack(7, 2); assert.equal(t.active, null); assert.equal(sent.at(-1).ChunkLast, 1);
});
test('lost acknowledgements exhaust bounded retries; cancellation discards old transfer', () => {
  const sent = [], failed = [], timers = clock(); const t = new Transfer(m => sent.push(m), timers, id => failed.push(id));
  t.start(1, 'reply'); for (let i = 0; i < 3; i++) timers.tick();
  assert.equal(sent.length, 3); assert.deepEqual(failed, [1]);
  t.start(2, 'new'); t.cancel(); timers.tick(); assert.equal(sent.length, 4);
});
