// webpack/global-polyfill.js
var global =
  typeof global !== 'undefined'
    ? global
    : typeof self !== 'undefined'
    ? self
    : typeof window !== 'undefined'
    ? window
    : {};

module.exports = global;
