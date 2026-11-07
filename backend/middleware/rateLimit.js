'use strict';
const rateLimitFactory = require('express-rate-limit');

/* The limiter's own check for a request that carries X-Forwarded-For while no proxy is trusted is switched off: it printed a stack trace for
   every such request, and the trust setting is explained once at start (TRUST_PROXY, engine/trustproxy.js). */
const rateLimit = opts => rateLimitFactory({ validate: { xForwardedForHeader: false }, ...opts });

module.exports = { rateLimit };
