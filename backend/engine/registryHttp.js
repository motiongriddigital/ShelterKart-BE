'use strict';
/**
 * The one HTTP client every registry connector uses.
 *
 * It lives in its own module because the server's inline version once
 * accepted only `headers`: the Czech connector's name search is a POST
 * with a JSON body, and both were silently dropped, so every Czech
 * lookup went out as a GET and came back "no match". Nothing noticed:
 * every test injected its own fake http, so the real wrapper was never
 * exercised. Now it is a factory with a test that checks what actually
 * reaches the network layer.
 */
function makeRegistryHttp({ guardedFetch, allowSet, timeoutMs = 12000 }) {
  return async function registryHttp(url, { headers, method, body } = {}) {
    const { response } = await guardedFetch(url, { allowSet, headers, method, body, timeoutMs });
    return response;
  };
}
module.exports = { makeRegistryHttp };
