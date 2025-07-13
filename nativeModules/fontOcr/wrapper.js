// wrapper.js

// Load the native addon's exports object, which is { recognizeText: [Function] }
const addon = require('./build/Release/fontOcr.node');

// Export the entire addon object directly.
module.exports = addon;
