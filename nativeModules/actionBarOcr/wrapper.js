// wrapper.js

// Load the native addon's exports object, which is { recognizeNumber: [Function] }
const addon = require('./build/Release/actionBarOcr.node');

// Export the entire addon object directly.
module.exports = addon;