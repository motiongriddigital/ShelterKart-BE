'use strict';
const { ah } = require('./asyncHandler');

/** Turns a handler that reads the request and returns { status, body, headers? } into an Express handler, so the logic needs no response object. */
const respond = handler => ah(async (req, res) => {
  const r = await handler(req);
  if (r.headers) res.set(r.headers);
  res.status(r.status).json(r.body);
});

module.exports = { respond };
