'use strict';
module.exports = function(settings, pipelines, status) {
  var options = [{label: 'Select an assistant…', value: ''}];
  pipelines.forEach(function(p) { options.push({label: p.name, value: p.id}); });
  return [
    {type: 'heading', defaultValue: 'HomeAssist'},
    {type: 'text', defaultValue: status || 'Enter your Home Assistant URL and token, then save. Reopen settings to select an assistant.'},
    {type: 'section', items: [
      {type: 'input', messageKey: 'Url', label: 'Home Assistant URL', defaultValue: settings.url || '', attributes: {type: 'url', placeholder: 'https://home.example.com'}},
      {type: 'input', messageKey: 'Token', label: 'Long-lived access token', defaultValue: settings.token || '', attributes: {type: 'password'}},
      {type: 'select', messageKey: 'Pipeline', label: 'Voice assistant', defaultValue: settings.pipeline || '', options: options}
    ]},
    {type: 'text', defaultValue: 'Save refreshes the assistant list using your phone. Wait a moment, then reopen settings. Credentials stay in the phone companion. Your phone must be able to reach this URL.'},
    {type: 'submit', defaultValue: 'Save and refresh assistants'}
  ];
};
