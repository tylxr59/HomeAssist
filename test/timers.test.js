'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function browserRuntime() {
  const context = vm.createContext({});
  vm.runInContext(`
    var pending = new Map(), counter = 0;
    function setTimeout(fn) {
      'use strict';
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      pending.set(++counter, fn); return counter;
    }
    function clearTimeout(id) {
      'use strict';
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      if (id === undefined || id === null) throw new TypeError('Invalid timer handle');
      pending.delete(id);
    }
  `, context);
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name].exports;
    const module = {exports: {}}; cache[name] = module;
    const source = fs.readFileSync(path.join(__dirname, '../src/pkjs', name + '.js'), 'utf8');
    vm.runInContext('(function(require, module, exports) {' + source + '\n})', context)(request => load(request.replace('./', '')), module, module.exports);
    return module.exports;
  }
  return {context, load};
}
test('default HA timers support browser receivers and guard uninitialized handles', () => {
  const {load, context} = browserRuntime();
  let socket, result;
  class Socket {constructor() {socket = this;} close() {}}
  const cancel = new (load('ha').Client)(Socket).perform({url: 'https://ha.test'}, null, err => {result = err;});
  assert.equal(vm.runInContext('pending.size', context), 1);
  socket.onclose(); assert.match(result.message, /disconnected/);
  cancel(); assert.equal(vm.runInContext('pending.size', context), 0);
  const timers = load('timers'); assert.doesNotThrow(() => timers.clear(undefined)); assert.doesNotThrow(() => timers.clear(null));
});
test('default transfer timers start, acknowledge and cancel with browser receivers', () => {
  const {load, context} = browserRuntime();
  const sent = [];
  const t = new (load('protocol').Transfer)(m => sent.push(m), null, () => assert.fail('transfer failed'));
  t.start(1, 'a'.repeat(900)); t.ack(1, 0); t.ack(1, 1); t.ack(1, 2);
  assert.equal(sent.length, 3); assert.equal(vm.runInContext('pending.size', context), 0);
  t.start(2, 'next'); t.cancel(); assert.equal(vm.runInContext('pending.size', context), 0);
});
