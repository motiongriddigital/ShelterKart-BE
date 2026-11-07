'use strict';

/* Express 4 does not catch errors thrown in async handlers: the request
   hangs and the error escapes as an unhandled rejection. Five admin
   routes had no try/catch at all; they are wrapped in this. */
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ah };
