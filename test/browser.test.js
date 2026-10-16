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

test('real Clay onboarding connects, populates and validates without closing the page', {skip: !chromium()}, () => {
  const page = require('./helpers/clay-page')();
  const mock = `<script>
    window.testMode = 'success'; window.calls = [];
    window.WebSocket = function() {
      var self=this; this.close=function(){self.closed=true;};
      this.send=function(s) {
        var m=JSON.parse(s); window.calls.push(m.type);
        if(m.type==='auth') setTimeout(function(){self.onmessage({data:JSON.stringify({type:window.testMode==='auth-error'?'auth_invalid':'auth_ok'})});},0);
        if(m.type==='assist_pipeline/pipeline/list' && window.testMode!=='timeout') setTimeout(function(){self.onmessage({data:JSON.stringify({id:1,type:'result',success:true,result:{pipelines:window.testMode==='empty'?[]:[{id:'p1',name:'AI <safe>'}]}})});},0);
      };
      setTimeout(function(){self.onmessage({data:'{"type":"auth_required"}'});},0);
    };
  </script>`;
  const scenario = `<script>
    function check(c,m){if(!c)throw new Error(m);}
    function delay(ms){return new Promise(function(r){setTimeout(r,ms);});}
    setTimeout(async function(){
      try {
        var url=document.querySelector('input[type=url]'), token=document.querySelector('input[type=password]'), select=document.querySelector('select');
        var save=document.querySelector('button[type=submit]'), connect=document.querySelector('button[type=button]');
        function edit(node,value){node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));}
        check(save.disabled,'Initial save disabled');
        edit(url,'https://ha.test');edit(token,'fixture'); connect.click();
        await delay(50);
        check(select.options.length===2 && select.options[1].textContent==='AI <safe>','Assistant picker populated safely');
        check(save.disabled,'Explicit selection required');
        select.value='p1';select.dispatchEvent(new Event('change',{bubbles:true}));check(!save.disabled,'Save enabled after selection');
        check(calls.join(',')==='auth,assist_pipeline/pipeline/list','Read-only discovery');
        edit(token,'changed');check(save.disabled,'Changed token invalidates connection');
        window.testMode='auth-error';connect.click();await delay(50);
        check(document.body.textContent.indexOf('Authentication failed')>=0,'Inline authentication error');check(save.disabled,'Failed connection cannot save');
        window.testMode='empty';connect.click();await delay(50);
        check(select.options.length===1 && save.disabled,'Empty list requires retry');
        window.testMode='timeout';connect.click();await delay(10100);
        check(document.body.textContent.indexOf('timed out')>=0,'Inline timeout');check(!connect.disabled,'Retry after timeout');
        window.testMode='success';connect.click();edit(token,'latest');await delay(50);
        check(save.disabled,'Stale result ignored after editing');
        var submit=new Event('submit',{bubbles:true,cancelable:true});document.getElementById('main-form').dispatchEvent(submit);
        check(submit.defaultPrevented,'Keyboard submit blocked without validation');
        window.testMode='success';connect.click();await delay(50);
        select.value='p1';select.dispatchEvent(new Event('change',{bubbles:true}));check(!save.disabled,'Recovered without reopening');
        document.body.textContent='ONBOARDING_PASS';
      }catch(e){document.body.textContent='ONBOARDING_FAIL: '+e.message;}
    },0);
  </script>`;
  runRenderedPage(page, mock, scenario);
});

function runRenderedPage(page, mock, scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homeassist-clay-'));
  try {
    const filename = path.join(dir, 'settings.html');
    fs.writeFileSync(filename, page.replace('<head>', '<head>' + mock).replace('</body>', scenario + '</body>'));
    const result = spawnSync(chromium(), ['--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=12000', '--dump-dom', 'file://' + filename], {encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024});
    assert.ifError(result.error); assert.equal(result.status, 0);
    const outcome = result.stdout.match(/<body>ONBOARDING_(PASS|FAIL: [^<]*)<\/body>/);
    assert.equal(outcome && outcome[1], 'PASS', outcome ? outcome[1] : 'Settings page did not finish; inspect generated Clay page.');
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
}

test('existing settings reconnect in place, preserve selection and allow clearing credentials', {skip: !chromium()}, () => {
  const page = require('./helpers/clay-page')({url: 'https://ha.test', token: 'fixture', pipeline: 'p1'}, [{id:'p1',name:'AI'}]);
  const mock = `<script>
    window.WebSocket = function() {
      var self = this; this.close = function() {};
      this.send = function(s) {
        var m = JSON.parse(s);
        setTimeout(function(){self.onmessage({data: JSON.stringify(m.type==='auth'?{type:'auth_ok'}:{id:1,type:'result',success:true,result:{pipelines:[{id:'p1',name:'AI'}]}})});},0);
      };
      setTimeout(function(){self.onmessage({data:'{"type":"auth_required"}'});},0);
    };
  </script>`;
  const scenario = `<script>
    setTimeout(function(){
      try {
        var select=document.querySelector('select'), save=document.querySelector('button[type=submit]');
        if(select.value!=='p1'||save.disabled)throw new Error('Saved assistant not restored after connection');
        ['input[type=url]','input[type=password]'].forEach(function(selector){var input=document.querySelector(selector);input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));});
        if(save.disabled)throw new Error('Cannot clear saved credentials');
        document.body.textContent='ONBOARDING_PASS';
      }catch(e){document.body.textContent='ONBOARDING_FAIL: '+e.message;}
    },100);
  </script>`;
  runRenderedPage(page, mock, scenario);
});
