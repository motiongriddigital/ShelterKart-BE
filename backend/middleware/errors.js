'use strict';

module.exports.install = function install(app, c) {

  // Generic error handler. It used to sit mid-file, before the admin
  // routes, so their errors never reached it. Registered last, it covers
  // every route, and never leaks a stack trace or database text.
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'Malformed JSON' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Request body too large' });
    if (err && (err.status === 400 || err.statusCode === 400)) return res.status(400).json({ ok: false, error: 'That address or request could not be read.' });   // for example a malformed %-escape in the path
    console.error('[http] ' + req.method + ' ' + ((req.route && req.route.path) || 'unmatched route') + ' failed: ' + (err && err.message), err);
    if (err && err.message === 'Origin not allowed') return res.status(403).json({ ok: false, error: 'Origin not allowed' });
    res.status(500).json({ ok: false, error: 'Internal server error' });
  });
};
