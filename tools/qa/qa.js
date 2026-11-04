#!/usr/bin/env node
'use strict';
/** QA handoff helper. list: what is queued and what came back. new: start a prompt from the template. show: print a prompt as one block to paste. See qa/README.md. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'qa'), IN = path.join(ROOT, 'INBOX'), OUT = path.join(ROOT, 'OUTBOX');

function front(file) {
  const m = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(file, 'utf8')), o = {};
  if (m) for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  return o;
}
const prompts = () => fs.readdirSync(IN).filter(f => f.endsWith('.md')).sort();
const arg = (name, argv) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : ''; };

function list() {
  const rows = prompts().map(f => {
    const p = front(path.join(IN, f)), r = path.join(OUT, f);
    return { id: p.id || f, title: p.title || '', branch: p.branch || '', sha: (p.sha || '').slice(0, 7), state: fs.existsSync(r) ? (front(r).status || 'unreadable') : 'queued' };
  });
  if (!rows.length) return console.log('No prompts yet.');
  const w = k => Math.max(k.length, ...rows.map(r => String(r[k]).length));
  const cols = ['id', 'state', 'branch', 'sha', 'title'];
  console.log(cols.map(c => c.padEnd(w(c))).join('  '));
  for (const r of rows) console.log(cols.map(c => String(r[c]).padEnd(w(c))).join('  '));
  const q = rows.filter(r => r.state === 'queued').length;
  console.log(`\n${q} queued, ${rows.length - q} answered`);
}

function create(argv) {
  const id = arg('id', argv), title = arg('title', argv), repo = arg('repo', argv) || 'BE', branch = arg('branch', argv), sha = arg('sha', argv);
  if (!/^QA-\d{3}[a-z-]*(-[a-z0-9-]+)?$/.test(id) || !title || !branch || !sha) {
    console.error('usage: qa.js new --id QA-009-short-name --title "..." --repo BE|FE --branch <branch> --sha <commit>'); process.exit(2);
  }
  const file = path.join(IN, id + '.md');
  if (fs.existsSync(file)) { console.error(`${id} already exists`); process.exit(1); }
  const text = fs.readFileSync(path.join(ROOT, 'PROMPT-TEMPLATE.md'), 'utf8').replace(/\{\{id\}\}/g, id).replace(/\{\{title\}\}/g, title)
    .replace(/\{\{repo\}\}/g, repo === 'FE' ? 'ShelterKart-FE' : 'ShelterKart-BE').replace(/\{\{branch\}\}/g, branch).replace(/\{\{sha\}\}/g, sha).replace(/\{\{date\}\}/g, new Date().toISOString().slice(0, 10));
  fs.writeFileSync(file, text); console.log('created ' + path.relative(process.cwd(), file));
}

function show(argv) {
  const id = argv[0], file = path.join(IN, (id || '') + '.md');
  if (!id || !fs.existsSync(file)) { console.error('usage: qa.js show <id>'); process.exit(2); }
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').split('## For the builder')[0];
  process.stdout.write(`${readme}\n---- PROMPT ----\n${fs.readFileSync(file, 'utf8')}\n---- RESULT TEMPLATE ----\n${fs.readFileSync(path.join(ROOT, 'RESULT-TEMPLATE.md'), 'utf8')}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'list') list(); else if (cmd === 'new') create(rest); else if (cmd === 'show') show(rest);
else { console.error('usage: qa.js list | new --id ... | show <id>'); process.exit(2); }
