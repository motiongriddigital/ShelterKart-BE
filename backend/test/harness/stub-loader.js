'use strict';
// Forces the in-memory stand-ins for these packages even after `npm install`,
// so the payment tests exercise server.js's real routes and SQL paths without
// a database, a network or a live payment provider.
const Module = require('module'), path = require('path');
// Saved investigations from tests go to a temporary folder, never into backend/data/live-jobs.
if (!process.env.LIVE_JOBS_DIR) process.env.LIVE_JOBS_DIR = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'sk-test-jobs-'));
// Report PDFs are printed by a real browser that stays open; the harness switches the automatic making off so no test leaves one running. The PDF route test turns it on.
if (!process.env.PDF_AUTO) process.env.PDF_AUTO = 'off';
const STUBS = new Set(['express', 'cors', 'helmet', 'pg', 'dotenv', 'express-rate-limit']);
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (STUBS.has(request)) return path.join(__dirname, 'stubs', request, 'index.js');
  return orig.call(this, request, ...rest);
};
