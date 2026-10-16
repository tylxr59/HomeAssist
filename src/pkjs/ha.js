'use strict';
// Self-contained factory also serialized into the bundled Clay settings page.
function createApi(defaultTimers) {
function endpoint(base) {
  base = String(base || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/?#\s@]+(?::\d+)?(?:\/[^?#\s]*)?$/.test(base)) {
    throw new Error('Enter an HTTP or HTTPS Home Assistant base URL without query, fragment, or credentials.');
  }
  return base.replace(/^http/, 'ws') + '/api/websocket';
}
function readable(output) {
  var speech = output && output.response && output.response.speech;
  if (speech && speech.plain && speech.plain.speech) return speech.plain.speech;
  if (speech && speech.ssml && speech.ssml.speech) {
    return speech.ssml.speech.replace(/<[^>]*>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);/gi, function(_, n) {
      var code = n.charAt(0).toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
      return code > 0 && code <= 65535 ? String.fromCharCode(code) : '';
    }).replace(/&(amp|lt|gt|quot|apos);/g, function(_, n) {
      return {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"}[n];
    }).replace(/\s+/g, ' ').trim();
  }
  return output && output.response && output.response.response_type === 'error' ? 'The assistant could not handle that request.' : 'Done. The assistant returned no text.';
}
// Each operation owns one socket. Never reconnect or replay an uncertain command.
function Client(Socket, timers) {
  this.Socket = Socket;
  this.timers = timers || defaultTimers;
}
Client.prototype.perform = function(settings, command, callback) {
  var ws, timer, finished = false, authenticated = false, id = 1, self = this, output;
  function clearTimer() {
    if (timer !== undefined && timer !== null) self.timers.clear(timer);
    timer = null;
  }
  function finish(err, result) {
    if (finished) return;
    finished = true;
    clearTimer();
    if (ws) { try { ws.close(); } catch (_) {} }
    callback(err, result);
  }
  function deadline(ms) {
    clearTimer();
    timer = self.timers.set(function() { finish(new Error(command ? 'Timed out. The command may have run; check Home Assistant before trying again.' : 'Connection timed out. Check the URL and phone network.')); }, ms);
  }
  try { ws = new this.Socket(endpoint(settings.url)); } catch (_) { callback(new Error('Cannot connect. Check your Home Assistant URL.')); return function() {}; }
  deadline(10000);
  ws.onmessage = function(event) {
    if (finished) return;
    var m;
    try { m = JSON.parse(event.data); } catch (_) { finish(new Error('Invalid Home Assistant response.')); return; }
    if (m.type === 'auth_required') { ws.send(JSON.stringify({type: 'auth', access_token: settings.token})); return; }
    if (m.type === 'auth_invalid') { finish(new Error('Authentication failed. Replace the token in settings.')); return; }
    if (m.type === 'auth_ok' && !authenticated) {
      authenticated = true;
      deadline(command ? 60000 : 10000);
      var request = command ? {id: id, type: 'assist_pipeline/run', pipeline: settings.pipeline, start_stage: 'intent', end_stage: 'intent', input: {text: command.text}} : {id: id, type: 'assist_pipeline/pipeline/list'};
      if (command && command.conversationId) request.conversation_id = command.conversationId;
      ws.send(JSON.stringify(request)); return;
    }
    if (!authenticated || m.id !== id) return;
    if (m.type === 'result') {
      if (!m.success) { finish(new Error(m.error && m.error.code === 'pipeline-not-found' ? 'Assistant removed. Select another in settings.' : 'Home Assistant rejected the request. Check permissions and assistant settings.')); return; }
      if (!command) {
        if (!m.result || !Array.isArray(m.result.pipelines)) { finish(new Error('Invalid assistant list.')); return; }
        finish(null, m.result.pipelines); return;
      }
      // A successful result only acknowledges subscription, not command completion.
    }
    if (command && m.type === 'event' && m.event) {
      if (m.event.type === 'error') { finish(new Error('Assistant failed: ' + (m.event.data && m.event.data.message || 'check Home Assistant.'))); return; }
      if (m.event.type === 'intent-end') output = m.event.data && m.event.data.intent_output;
      if (m.event.type === 'run-end') {
        if (!output) { finish(new Error('Assistant finished without a response.')); return; }
        finish(null, {text: readable(output), conversationId: output.conversation_id || null});
      }
    }
  };
  ws.onerror = function() { finish(new Error(command ? 'Connection failed. The command may have run; check Home Assistant.' : 'Connection failed. Check URL, certificate, and phone network.')); };
  ws.onclose = function() { finish(new Error(command ? 'Connection lost. The command may have run; check Home Assistant.' : 'Home Assistant disconnected. Check URL and token.')); };
  return function() { finish(new Error('Configuration changed. Start a new command.')); };
};
return {Client: Client, endpoint: endpoint, readable: readable};
}
var api = createApi(require('./timers'));
api.createApi = createApi;
module.exports = api;
