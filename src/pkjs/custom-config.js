'use strict';
// Clay serializes this function: all dependencies must come from its arguments
// or metadata, rather than module-scope variables or require().
module.exports = function() {
  var clay = this;
  clay.on(clay.EVENTS.AFTER_BUILD, function() {
    var url = clay.getItemByMessageKey('Url');
    var token = clay.getItemByMessageKey('Token');
    var pipeline = clay.getItemByMessageKey('Pipeline');
    var connect = clay.getItemById('connect');
    var save = clay.getItemById('save');
    var status = clay.getItemById('connection-status').$manipulatorTarget[0];
    var select = pipeline.$manipulatorTarget[0];
    var connectButton = connect.$manipulatorTarget[0];
    var saveButton = save.$manipulatorTarget[0];
    var api = clay.meta.userData.createApi({
      set: function(fn, delay) { return setTimeout(fn, delay); },
      clear: function(handle) { if (handle !== undefined && handle !== null) clearTimeout(handle); }
    });
    var client = new api.Client(WebSocket);
    var verified = null, cancel = null, sequence = 0, loading = false;
    function credentials() { return {url: String(url.get() || '').trim(), token: String(token.get() || '').trim()}; }
    var initial = credentials();
    var hadSavedCredentials = !!(initial.url || initial.token);
    function matches() {
      var current = credentials();
      return verified && verified.url === current.url && verified.token === current.token;
    }
    function clearing() { var current = credentials(); return hadSavedCredentials && !current.url && !current.token; }
    function canSave() { return !loading && (clearing() || (matches() && !!select.value)); }
    function updateSave() { saveButton.disabled = !canSave(); }
    function cancelPending() {
      sequence++;
      var pending = cancel; cancel = null;
      if (pending) pending();
      loading = false; connectButton.disabled = false;
    }
    function edited() {
      cancelPending(); verified = null;
      pipeline.set(''); pipeline.hide(); updateSave();
      status.textContent = clearing() ? 'Save to remove your Home Assistant connection.' : 'Credentials changed. Connect to load your voice assistants.';
    }
    function loadAssistants() {
      cancelPending(); verified = null; updateSave();
      var settings = credentials(), preferred = pipeline.get();
      pipeline.hide();
      if (!settings.url || !settings.token) { status.textContent = 'Enter your Home Assistant URL and token first.'; return; }
      try { api.endpoint(settings.url); } catch (err) { status.textContent = err.message; return; }
      loading = true; connectButton.disabled = true;
      status.textContent = 'Connecting to Home Assistant…';
      var current = sequence;
      function complete(err, list) {
        if (current !== sequence) return;
        cancel = null; loading = false; connectButton.disabled = false;
        if (err) { status.textContent = err.message; updateSave(); return; }
        var available = list.filter(function(p) { return p && typeof p.id === 'string' && typeof p.name === 'string'; });
        while (select.firstChild) select.removeChild(select.firstChild);
        var placeholder = document.createElement('option');
        placeholder.value = ''; placeholder.textContent = 'Select an assistant…'; select.appendChild(placeholder);
        available.forEach(function(p) {
          var option = document.createElement('option'); option.value = p.id; option.textContent = p.name; select.appendChild(option);
        });
        verified = settings;
        pipeline.set(available.some(function(p) { return p.id === preferred; }) ? preferred : '');
        pipeline.show();
        status.textContent = available.length ? 'Connected. Choose a voice assistant, then save.' : 'No assistants found. Configure a voice assistant in Home Assistant, then connect again.';
        connect.set('Refresh assistants');
        updateSave();
      }
      try {
        var pending = client.perform(settings, null, complete);
        if (loading && current === sequence) cancel = pending;
      } catch (_) { complete(new Error('Could not connect. Check the URL and try again.')); }
    }
    [url, token].forEach(function(item) {
      item.$manipulatorTarget[0].addEventListener('input', edited);
      item.$manipulatorTarget[0].addEventListener('change', edited);
    });
    select.addEventListener('change', updateSave);
    connectButton.addEventListener('click', loadAssistants);
    // Capture before Clay's submit listener, including keyboard submissions.
    document.getElementById('main-form').addEventListener('submit', function(event) {
      if (!canSave()) {
        event.preventDefault(); event.stopImmediatePropagation();
        status.textContent = 'Connect and select an assistant before saving.';
      }
    }, true);
    window.addEventListener('pagehide', cancelPending);
    pipeline.hide(); updateSave();
    if (initial.url && initial.token) loadAssistants();
  });
};
