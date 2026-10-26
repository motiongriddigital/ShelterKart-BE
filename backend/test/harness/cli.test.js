// The cron path: separate runs, sharing memory only through the database.
Object.assign(process.env, { DATABASE_URL: 'postgres://stub', ALERT_WEBHOOK_URL: 'https://hooks.example.com/x' });
require('dns').promises.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const SG_OK = { result: { records: [{ uen: '197600660W', entity_name: 'GUOCOLAND LIMITED', uen_status_desc: 'Registered', entity_type_desc: 'Local Company' }] } };
const net = { sg: 'ok', hooks: [] };
const R = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (u.host === 'hooks.example.com') { net.hooks.push(JSON.parse(o.body)); return R(200, 'ok'); }
  if (u.pathname === '/robots.txt') return R(404, '');
  if (u.host === 'data.gov.sg') return net.sg === 'ok' ? R(200, SG_OK) : R(500, {});
  return R(500, {});
};
const path = require('path');
const { main } = require(path.join(__dirname, '..', '..', 'source_health_cli.js'));
const H = require(path.join(__dirname, '..', '..', 'engine', 'health.js'));
const { _db } = require('pg');
let failures = 0;
const ok = (label, c) => { if (!c) failures++; console.log((c ? '  ok   ' : '  FAIL ') + label); };
process.on('exit', () => { console.log(failures ? '\n' + failures + ' FAILED' : '\nall passing'); if (failures) process.exitCode = 1; });
const cronRun = async () => { H._health.clear();                       // a brand-new process every time
  const out = []; const res = await main({ log: l => out.push(l) }); return { res, out }; };
const sg = r => r.res.find(x => x.market === 'sg');
const quietRun = async () => { const o = console.error; console.error = () => {}; try { return await cronRun(); } finally { console.error = o; } };

(async () => {
  let r = await quietRun();
  ok('first process: Singapore healthy, and the table lists every register', sg(r).state === 'healthy' && r.out.length >= 9);
  ok('the result is in the database', _db.health.get('sg').state === 'healthy' && _db.health.get('sg').ever_healthy === true);
  net.sg = 'broken';
  r = await quietRun();
  ok('second process, one failure: degraded -- it remembered Singapore had been healthy', sg(r).state === 'degraded');
  const hooksBefore = net.hooks.length;
  r = await quietRun();
  ok('third process, a second failure ACROSS processes: switched off', sg(r).state === 'down');
  ok('...and exactly one alert about it', net.hooks.length === hooksBefore + 1 && /Singapore/.test(net.hooks[net.hooks.length - 1].text));
  r = await quietRun();
  ok('a fourth process: still down, no repeat alert', sg(r).state === 'down' && net.hooks.length === hooksBefore + 1);
  net.sg = 'ok';
  r = await quietRun();
  ok('it recovers across processes too', sg(r).state === 'healthy' && /recovered/.test(net.hooks[net.hooks.length - 1].text));
})();
