'use strict';
const express = require('express');

const HOSTILE_KEYS = new Set(['toString', 'valueOf', 'toJSON', 'constructor', '__proto__']);
const MAX_DEPTH = 20;

function clean(value, depth) {
  if (typeof value === 'string') return value.indexOf('\u0000') === -1 ? value : value.replace(/\u0000/g, '');
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) throw new Error('too deep');
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) value[i] = clean(value[i], depth + 1); return value; }
  for (const key of Object.keys(value)) {
    if (HOSTILE_KEYS.has(key)) throw new Error('hostile key');
    const k = key.indexOf('\u0000') === -1 ? key : key.replace(/\u0000/g, '');
    const v = clean(value[key], depth + 1);
    if (k !== key) delete value[key];
    value[k] = v;
  }
  return value;
}

function guard(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    try { clean(req.body, 0); } catch (e) { return res.status(400).json({ ok: false, error: 'The request body is not valid.' }); }
  }
  next();
}

function json(opts) {
  const parse = express.json(opts);
  return (req, res, next) => parse(req, res, err => (err ? next(err) : guard(req, res, next)));
}

module.exports = { json, guard, clean };
