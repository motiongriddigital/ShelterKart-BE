// Suspected item 6 of the 2026-10 review: the public progress stream held a socket until the job ended, with no limit on how many one address or
// one report could open. Now an address may hold EVENT_STREAMS_PER_IP (6) and a report EVENT_STREAMS_PER_JOB (25); the next is refused with a 429.
const path = require('path');
Object.assign(process.env, { ADMIN_USERNAME: 'a', ADMIN_PASSWORD: 'b', ACCESS_TOKEN_SECRET: 'tok-secret', PUBLIC_BASE_URL: 'https://shelterkart.test' });
delete process.env.DATABASE_URL; delete process.env.EVENT_STREAMS_PER_IP; delete process.env.EVENT_STREAMS_PER_JOB;
const app = require(path.join(__dirname, '..', '..', 'server.js'));
const { c } = require(path.join(__dirname, '..', '..', 'app.js'));
const route = app.routes.find(r => r.method === 'get' && r.path === '/api/investigate/:ref/events');
let failures = 0;
const ok = (label, x) => { if (!x) failures++; console.log((x ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });

// Opens one stream and resolves once the route has answered (a refusal, or the stream held open). close() hangs up like a browser tab.
function open(ref, ip) {
  return new Promise(resolve => {
    const closers = [];
    const res = { code: 200, body: null, status(x) { this.code = x; return this; }, set() { return this; }, flushHeaders() { resolve({ code: this.code, res: this, close: () => closers.forEach(f => f()) }); }, write() {}, end() { resolve({ code: this.code, res: this, close() {} }); },
      json(o) { this.body = o; resolve({ code: this.code, body: o, close() {} }); } };
    const req = { params: { ref }, query: {}, ip, headers: {}, get: () => undefined, on(ev, fn) { if (ev === 'close') closers.push(fn); } };
    let i = 0; const next = err => { if (err) return resolve({ code: 500, body: { error: err.message }, close() {} }); const h = route.handlers[i++]; if (h) h(req, res, next); }; next();
  });
}
const running = ref => { const job = { ref, status: 'sweeping', events: [], listeners: new Set(), input: {} }; c.liveJobs.set(ref, job); return job; };

(async () => {
  console.log('open progress streams');
  const a = running('SK-AAAAAAAAAAAA'), held = [];
  for (let i = 0; i < 6; i++) held.push(await open(a.ref, '5.5.5.5'));
  ok('one address may hold six streams on a running report', held.every(h => h.code === 200) && a.listeners.size === 6);
  const seventh = await open(a.ref, '5.5.5.5');
  ok('the seventh from the same address is refused with a 429 and holds nothing', seventh.code === 429 && /Too many/.test(seventh.body.error) && a.listeners.size === 6);
  const other = await open(a.ref, '6.6.6.6');
  ok('another address is not affected', other.code === 200 && a.listeners.size === 7);
  held[0].close();
  const again = await open(a.ref, '5.5.5.5');
  ok('closing a stream frees a place for that address', again.code === 200 && a.listeners.size === 7);
  held.slice(1).concat(again, other).forEach(h => h.close());
  ok('every closed stream is forgotten', a.listeners.size === 0);

  console.log('\nopen streams on one report');
  const b = running('SK-BBBBBBBBBBBB'), many = [];
  for (let i = 0; i < 25; i++) many.push(await open(b.ref, '10.0.' + Math.floor(i / 5) + '.' + (i % 5)));
  ok('twenty-five streams from different addresses are all served', many.every(m => m.code === 200) && b.listeners.size === 25);
  const over = await open(b.ref, '10.9.9.9');
  ok('the twenty-sixth is refused whoever asks', over.code === 429 && b.listeners.size === 25);
  many.forEach(m => m.close());

  console.log('\nnothing to hold');
  const done = await open('SK-CCCCCCCCCCCC', '5.5.5.5');
  ok('a report with no running job answers and ends, and uses no place', done.code === 200 && (await open('SK-CCCCCCCCCCCC', '5.5.5.5')).code === 200);
  process.env.EVENT_STREAMS_PER_IP = '1';
  const d = running('SK-DDDDDDDDDDDD'); const first = await open(d.ref, '4.4.4.4'), second = await open(d.ref, '4.4.4.4');
  ok('the limit can be changed with EVENT_STREAMS_PER_IP', first.code === 200 && second.code === 429);
  process.exit(failures ? 1 : 0);
})();
