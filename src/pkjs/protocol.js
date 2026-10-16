'use strict';
var TYPE = {HELLO: 0, CONFIG: 1, COMMAND: 2, CHUNK: 3, ERROR: 4, ACK: 5};
function value(payload, keys, name) { return payload[name] !== undefined ? payload[name] : payload[keys[name]]; }
function bytes(s) { return unescape(encodeURIComponent(s)).length; }
function chunks(text) {
  text = String(text);
  var parts = [], current = '', total = 0, truncated = false;
  for (var i = 0; i < text.length; i++) {
    var c = text.charAt(i);
    if (/[\uD800-\uDBFF]/.test(c) && i + 1 < text.length && /[\uDC00-\uDFFF]/.test(text.charAt(i + 1))) c += text.charAt(++i);
    else if (/[\uD800-\uDFFF]/.test(c)) c = '\uFFFD';
    var size = bytes(c);
    if (total + size > 8100) { truncated = true; break; }
    if (bytes(current) + size > 400) { parts.push(current); current = ''; }
    current += c; total += size;
  }
  if (truncated) current += '\n[Reply truncated]';
  if (current || !parts.length) parts.push(current);
  return parts;
}
function Transfer(send, timers, failure) { this.send = send; this.timers = timers || require('./timers'); this.failure = failure; this.active = null; }
Transfer.prototype.cancel = function() {
  if (this.active && this.active.timer !== undefined && this.active.timer !== null) this.timers.clear(this.active.timer);
  this.active = null;
};
Transfer.prototype.start = function(id, text) { this.cancel(); this.active = {id: id, parts: chunks(text), index: 0, attempts: 0}; this.next(); };
Transfer.prototype.next = function() {
  var self = this, a = this.active;
  if (!a) return;
  if (++a.attempts > 3) { this.cancel(); this.failure(a.id); return; }
  a.timer = this.timers.set(function() { if (self.active === a) self.next(); }, 2500);
  this.send({Type: TYPE.CHUNK, RequestId: a.id, Text: a.parts[a.index], ChunkIndex: a.index, ChunkLast: a.index === a.parts.length - 1 ? 1 : 0});
};
Transfer.prototype.ack = function(id, index) {
  var a = this.active;
  if (!a || a.id !== id || a.index !== index) return;
  this.timers.clear(a.timer);
  if (++a.index === a.parts.length) { this.active = null; return; }
  a.attempts = 0; this.next();
};
module.exports = {TYPE: TYPE, value: value, bytes: bytes, chunks: chunks, Transfer: Transfer};
