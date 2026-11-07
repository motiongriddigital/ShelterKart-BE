'use strict';
// Prints the route table the server registers, in registration order, using the same in-memory stand-ins as the harness tests.
// Usage: node -r ./backend/test/harness/stub-loader.js tools/dump_routes.js <bare|accounts>
const mode = process.argv[2] || 'bare';
if (mode === 'accounts') Object.assign(process.env, { ACCOUNTS_ENABLED: 'on', AUTH_PEPPER: 'x'.repeat(40), ACCOUNTS_ALLOW_MEMORY: 'true', PAYMENTS_ENABLED: 'true', ACCESS_TOKEN_SECRET: 'tok-secret', GSTIN: '27ABCDE1234F1Z5', PUBLIC_BASE_URL: 'https://shelterkart.test' });
delete process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
const app = require('../backend/server.js');
console.log(JSON.stringify(app.routes.map(r => ({ method: r.method, path: String(r.path), handlers: r.handlers.length })), null, 0).replace(/\},\{/g, '},\n{'));
