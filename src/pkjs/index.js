'use strict';
var Clay = require('@rebble/clay');
var keys = require('message_keys');
var config = require('./config');
var customConfig = require('./custom-config');
var ha = require('./ha');
var protocol = require('./protocol');
var T = protocol.TYPE;
function read(name, fallback) { try { return JSON.parse(localStorage.getItem(name)) || fallback; } catch (_) { return fallback; } }
// Keep the original storage keys so upgrades preserve saved connections.
var settings = read('homeassist-settings', {});
var pipelines = read('homeassist-pipelines', []);
var status = read('homeassist-status', 'Open phone settings, connect to Home Assistant, and select an assistant.');
var validated = read('homeassist-validated', false);
var client = new ha.Client(WebSocket);
var conversationId = null, cancelOperation = null, busy = false, discovering = false, generation = 0, configRevision = 1, clay;
function send(dict) { Pebble.sendAppMessage(dict, function() {}, function() {}); }
var transfer = new protocol.Transfer(send, null, function(id) { send({Type: T.ERROR, RequestId: id, Text: 'Reply transfer failed. The command may have run; check Home Assistant.'}); });
function selected() { return pipelines.filter(function(p) { return p.id === settings.pipeline; })[0]; }
function ready() { return !!(validated && settings.url && settings.token && selected()); }
function notify() {
  var p = selected();
  send({Type: T.CONFIG, RequestId: configRevision, Ready: ready() ? 1 : 0, Assistant: p ? p.name.slice(0, 30) : '', Text: ready() ? 'Ready' : !settings.url || !settings.token ? 'Open QuickAssist settings on your phone to connect your voice assistant.' : status.slice(0, 350)});
}
function persist() {
  localStorage.setItem('homeassist-settings', JSON.stringify(settings));
  localStorage.setItem('homeassist-pipelines', JSON.stringify(pipelines));
  localStorage.setItem('homeassist-status', JSON.stringify(status));
  localStorage.setItem('homeassist-validated', JSON.stringify(validated));
}
function reset() {
  generation++; conversationId = null; busy = false; discovering = false; transfer.cancel();
  var cancel = cancelOperation; cancelOperation = null;
  if (cancel) cancel();
}
function discover() {
  validated = false;
  status = 'Checking your selected assistant…';
  persist(); notify();
  var gen = generation;
  busy = true; discovering = true;
  function complete(err, list) {
    if (gen !== generation) return;
    cancelOperation = null; busy = false; discovering = false;
    if (err) status = err.message;
    else {
      pipelines = list.filter(function(p) { return p && typeof p.id === 'string' && typeof p.name === 'string'; });
      validated = true;
      if (!selected()) settings.pipeline = '';
      status = !pipelines.length ? 'No assistants found. Configure a voice assistant in Home Assistant.' : selected() ? 'Connected. Assistant: ' + selected().name : 'Open settings, connect, select an assistant, and save.';
    }
    persist(); notify();
  }
  try {
    var cancel = client.perform(settings, null, complete);
    if (discovering && gen === generation) cancelOperation = cancel;
  } catch (_) {
    complete(new Error('Could not start assistant discovery. Reopen QuickAssist and save settings again.'));
  }
}
Pebble.addEventListener('ready', function() {
  if (!validated && settings.url && settings.token) discover();
  else notify();
});
Pebble.addEventListener('showConfiguration', function() {
  clay = new Clay(config(settings, pipelines), customConfig, {autoHandleEvents: false});
  clay.meta.userData = {createApi: ha.createApi};
  clay.setSettings({Url: settings.url || '', Token: settings.token || '', Pipeline: settings.pipeline || ''});
  Pebble.openURL(clay.generateUrl());
});
Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response || e.response === 'CANCELLED' || !clay) return;
  var dict;
  try { dict = clay.getSettings(e.response, false); } catch (_) { status = 'Could not read settings. Open settings and try again.'; persist(); notify(); return; }
  function field(name) { var v = protocol.value(dict, keys, name); return String(v && typeof v === 'object' ? v.value || '' : v || '').trim(); }
  var next = {url: field('Url'), token: field('Token'), pipeline: field('Pipeline')};
  reset(); configRevision++;
  if (next.url !== settings.url || next.token !== settings.token) { pipelines = []; }
  settings = next;
  if (!settings.url || !settings.token) { validated = false; status = 'Open QuickAssist settings on your phone. Enter URL and token, connect, select an assistant, and save.'; persist(); notify(); return; }
  try { ha.endpoint(settings.url); } catch (err) { validated = false; status = err.message; persist(); notify(); return; }
  discover();
});
Pebble.addEventListener('appmessage', function(e) {
  var p = e.payload, type = protocol.value(p, keys, 'Type');
  var id = protocol.value(p, keys, 'RequestId');
  if (type === T.ACK) { transfer.ack(id, protocol.value(p, keys, 'ChunkIndex')); return; }
  if (type === T.HELLO) {
    // Opening the watch during setup must not cancel assistant discovery.
    if (discovering) { conversationId = null; transfer.cancel(); }
    else reset();
    notify(); return;
  }
  if (type !== T.COMMAND) return;
  if (busy || transfer.active) { send({Type: T.ERROR, RequestId: id, Text: 'Another request is still processing.'}); return; }
  if (!ready()) { send({Type: T.ERROR, RequestId: id, Text: 'Open phone settings and select an available assistant.'}); return; }
  var text = protocol.value(p, keys, 'Text');
  if (typeof text !== 'string' || !text.trim() || protocol.bytes(text) > 1024) { send({Type: T.ERROR, RequestId: id, Text: 'Dictation is empty or too long. Please try a shorter command.'}); return; }
  busy = true;
  var gen = generation;
  cancelOperation = client.perform(settings, {text: text, conversationId: conversationId}, function(err, result) {
    if (gen !== generation) return;
    busy = false; cancelOperation = null;
    if (err) { send({Type: T.ERROR, RequestId: id, Text: err.message.slice(0, 350)}); return; }
    conversationId = result.conversationId;
    transfer.start(id, result.text);
  });
});
