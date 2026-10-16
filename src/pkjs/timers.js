'use strict';
// Browser timer functions require their native global receiver. Do not store
// them directly as object methods: calling timers.set() can throw in WebViews.
exports.set = function(callback, delay) { return setTimeout(callback, delay); };
exports.clear = function(handle) {
  if (handle !== undefined && handle !== null) clearTimeout(handle);
};
