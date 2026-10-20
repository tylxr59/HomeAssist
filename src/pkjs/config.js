'use strict';
module.exports = function(settings, pipelines) {
  var options = [{label: 'Select an assistant…', value: ''}];
  pipelines.forEach(function(p) { options.push({label: p.name, value: p.id}); });
  return [
    {type: 'heading', defaultValue: 'QuickAssist'},
    {type: 'text', id: 'connection-status', defaultValue: 'Enter your Home Assistant URL and token, then connect to choose a voice assistant.'},
    {type: 'section', items: [
      {type: 'input', messageKey: 'Url', label: 'Home Assistant URL', defaultValue: settings.url || '', attributes: {type: 'url', placeholder: 'https://home.example.com'}},
      {type: 'input', messageKey: 'Token', label: 'Long-lived access token', defaultValue: settings.token || '', attributes: {type: 'password'}},
      {type: 'button', id: 'connect', defaultValue: 'Connect', primary: true},
      {type: 'select', messageKey: 'Pipeline', label: 'Voice assistant', defaultValue: settings.pipeline || '', options: options}
    ]},
    {type: 'slider', messageKey: 'IdleTimeout', label: 'Close after inactivity (seconds)', defaultValue: settings.idleTimeout || 30, min: 5, max: 300, step: 5},
    {type: 'text', defaultValue: 'After a successful reply, QuickAssist closes when this time passes without a button press. Scrolling restarts the timer.'},
    {type: 'text', defaultValue: 'Your phone must be able to reach Home Assistant. Settings are applied only when you save.'},
    {type: 'submit', id: 'save', defaultValue: 'Save', attributes: {disabled: 'disabled'}}
  ];
};
