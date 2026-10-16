'use strict';
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const vm = require('node:vm');
// Use Clay's distributed bundle, including its real templates and serialization.
module.exports = function(settings = {}, pipelines = []) {
  const root = path.dirname(require.resolve('@rebble/clay'));
  const store = {};
  const Pebble = {platform: 'android', addEventListener() {}};
  const localStorage = {getItem(k) {return store[k] || null;}, setItem(k, v) {store[k] = v;}};
  const module = {exports: {}};
  vm.runInNewContext(execFileSync('unzip', ['-p', path.join(root, 'dist.zip'), 'js/index.js'], {encoding: 'utf8'}), {
    module, exports: module.exports, Pebble, localStorage, console,
    require(name) {
      if (name === 'message_keys') return {};
      throw new Error('Unexpected Clay dependency: ' + name);
    }
  });
  const Clay = module.exports;
  const clay = new Clay(require('../../src/pkjs/config')(settings, pipelines), require('../../src/pkjs/custom-config'), {autoHandleEvents: false});
  clay.meta.userData = {createApi: require('../../src/pkjs/ha').createApi};
  clay.setSettings({Url: settings.url || '', Token: settings.token || '', Pipeline: settings.pipeline || ''});
  const url = clay.generateUrl();
  const encoded = url.slice(url.indexOf(',') + 1);
  return /;base64,/.test(url) ? Buffer.from(encoded, 'base64').toString('utf8') : decodeURIComponent(encoded);
};
