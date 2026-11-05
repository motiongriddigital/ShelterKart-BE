'use strict';
const scrub = text => String(text == null ? '' : text).replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, '[url]').replace(/(password|passwd|pwd)\s*[=:]\s*\S+/gi, '$1=[hidden]').slice(0, 200);

function guardPool(pool, log = console) {
  if (!pool || typeof pool.on !== 'function') return pool;
  pool.on('error', e => log.error('[db] an idle connection failed, the pool will reconnect on the next query:', scrub(e && e.message)));
  return pool;
}

module.exports = { guardPool, scrub };
