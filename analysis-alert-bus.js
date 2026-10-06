'use strict';
module.exports = new (require('events').EventEmitter)();
// Authenticated analysis streams remove their listener on disconnect.
module.exports.setMaxListeners(0);
