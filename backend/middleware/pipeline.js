'use strict';
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

module.exports.install = function install(app, c) {
  const { ACCOUNTS, CONTRACT, TIMING, adminLimiter } = c;
  const TRUST = require('../engine/trustproxy').parse(process.env.TRUST_PROXY);
  app.set('trust proxy', TRUST.setting);
  if (TRUST.problem) console.error('[proxy] ' + TRUST.problem);
  else if (!TRUST.setting && process.env.NODE_ENV === 'production') console.warn('[proxy] TRUST_PROXY is not set: every client is counted by the address that connects to this server. Behind a load balancer that is one address for everyone; set the number of proxies in front, or their addresses.');
  app.use(TIMING.middleware);
  /* helmet()'s bare default sets script-src 'self' with no allowance for
     Razorpay, and script-src-attr 'none' -- meaning the moment payments
     are switched on, Razorpay's checkout script, its own payment iframe,
     and its own calls to api.razorpay.com would all be silently blocked
     by the CSP this same code ships. Confirmed against helmet's own
     documented default and Razorpay's own guidance to allow *.razorpay.com
     for exactly this.

     style-src and script-src still need 'unsafe-inline' here, honestly:
     the whole frontend is one inline <script> and <style> block today,
     plus a number of onclick="..." attributes -- a strict policy would
     break the page outright, not just tighten it. Removing that need is
     a real, separate piece of work (moving onclick handlers to delegated
     listeners throughout, and the inline script to its own file or a
     nonce) -- not something to fake by shipping a policy that doesn't
     match what the page actually does. Everything else below is real:
     no other third-party script origin, no framing of this site by
     anyone, no plugin/object embeds. */
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://*.razorpay.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],   // the Home Buying Guide embeds its headline font
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'https://*.razorpay.com'],
        frameSrc: ['https://*.razorpay.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));

  // Locked-down CORS: only your real frontend origin(s) may call this API in
  // production. Comma-separate multiple origins in ALLOWED_ORIGINS. Wide-open
  // CORS is one of the easiest ways a competitor's script scrapes this API
  // directly from a browser — don't leave it at "*".
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  app.use(cors({
    credentials: true,
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server / curl / health checks
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // Previously an EMPTY list allowed every origin -- failing open, the
      // exact risk the comment above warns about. Now an empty list is only
      // tolerated outside production, for local development.
      if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') return cb(null, true);
      cb(new Error('Origin not allowed'));
    }
  }));
  /* The global JSON parser must NOT touch these paths. The webhook's
     signature is checked against the exact raw bytes the provider sent;
     before this fix the global parser ran first, turned the body into an
     object, the webhook's own raw parser then skipped it, and hashing an
     object threw -- so no payment confirmation could ever be processed.
     The document check needs a larger limit than 10 KB. */
  const OWN_BODY_PARSER = new Set(['/api/payments/webhook', '/api/payments/razorpay/webhook', '/api/payments/mor/webhook', '/api/research/document-check']);
  const jsonSmall = express.json({ limit: '10kb' });
  app.use((req, res, next) => OWN_BODY_PARSER.has(req.path.toLowerCase().replace(/\/+$/, '')) ? next() : jsonSmall(req, res, next));
  app.use((req, res, next) => ACCOUNTS.csrf(req, res, next));
  app.use(CONTRACT.middleware);
  app.use(require('../engine/httpcache').createHttpCache().middleware);
  app.use('/api/admin', adminLimiter);
};
