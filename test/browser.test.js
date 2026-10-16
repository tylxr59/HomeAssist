'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
function chromium() {
  const candidates = [process.env.CHROMIUM_BIN, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  if (fs.existsSync(cache)) for (const folder of fs.readdirSync(cache)) if (folder.startsWith('chromium-')) candidates.push(path.join(cache, folder, 'chrome-linux64/chrome'));
  return candidates.find(p => p && fs.existsSync(p));
}
test('actual HA client and reply transfer work with Chromium native timers', {skip: !chromium()}, () => {
  const sources = {};
  for (const name of ['ha', 'protocol', 'timers']) sources['./' + name] = fs.readFileSync(path.join(__dirname, '../src/pkjs', name + '.js'), 'utf8');
  const html = '<body><script>var sources=' + JSON.stringify(sources).replace(/</g, '\\u003c') + `;
    var modules = {};
    function load(name) {
      if (modules[name]) return modules[name].exports;
      var module = {exports: {}}; modules[name] = module;
      new Function('require', 'module', 'exports', sources[name])(load, module, module.exports);
      return module.exports;
    }
    function check(condition, message) { if (!condition) throw new Error(message); }
    var sockets = [];
    function Socket() { sockets.push(this); this.sent = []; }
    Socket.prototype.send = function(s) { this.sent.push(JSON.parse(s)); };
    Socket.prototype.close = function() { this.closed = true; if (this.onclose) this.onclose(); };
    function receive(ws, m) { ws.onmessage({data: JSON.stringify(m)}); }
    try {
      var Client = load('./ha').Client, client = new Client(Socket), settings = {url:'https://ha.test', token:'fixture'};
      var completed = 0;
      client.perform(settings, null, function(err, list) {check(!err && list[0].name === 'AI', 'Discovery completion'); completed++;});
      var ws = sockets[0];
      receive(ws, {type:'auth_required'}); check(ws.sent[0].type === 'auth', 'Authentication');
      receive(ws, {type:'auth_ok'}); check(ws.sent[1].type === 'assist_pipeline/pipeline/list', 'Discovery request');
      receive(ws, {type:'result', id:1, success:true, result:{pipelines:[{id:'p1', name:'AI'}]}});
      check(completed === 1 && ws.closed, 'Discovery cleanup');
      client.perform(settings, null, function(err) {check(/Authentication failed/.test(err.message), 'Authentication failure'); completed++;});
      receive(sockets[1], {type:'auth_invalid'});
      var sent = [], t = new (load('./protocol').Transfer)(function(m){sent.push(m);}, null, function(){throw new Error('Transfer failure');});
      t.start(1, 'a'.repeat(900)); t.ack(1,0); t.ack(1,1); t.ack(1,2);
      check(sent.length === 3 && !t.active, 'Transfer completion');
      t.start(2,'cancel'); t.cancel();
      client.perform(settings, null, function(err) {
        try {check(/timed out/.test(err.message), 'Timeout callback'); check(completed === 2, 'Prior callbacks'); document.body.textContent = 'BROWSER_PASS';}
        catch(e) {document.body.textContent = 'BROWSER_FAIL: ' + e.message;}
      });
    } catch(e) {document.body.textContent = 'BROWSER_FAIL: ' + e.name + ': ' + e.message;}
  </script></body>`;
  const result = spawnSync(chromium(), ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=11000', '--dump-dom', 'data:text/html,' + encodeURIComponent(html)], {encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /<body>BROWSER_PASS<\/body>/);
});
