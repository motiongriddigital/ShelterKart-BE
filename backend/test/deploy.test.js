'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const SCRIPT = path.join(__dirname, '..', '..', 'ops', 'deploy.sh');
const STUB = `#!/bin/bash
echo "docker $*" >> "$STUB_LOG"
case " $* " in
  *" up "*) printf '%s' "\${TAG:-}" > "$STUB_STATE" ;;
  *" exec "*) case " $BAD_TAG " in *" $(cat "$STUB_STATE" 2>/dev/null) "*) exit 1 ;; esac ;;
esac
exit 0
`;

function host(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-deploy-'));
  fs.mkdirSync(path.join(dir, 'ops')); fs.mkdirSync(path.join(dir, 'bin'));
  fs.copyFileSync(SCRIPT, path.join(dir, 'ops', 'deploy.sh')); fs.chmodSync(path.join(dir, 'ops', 'deploy.sh'), 0o755);
  fs.writeFileSync(path.join(dir, 'bin', 'docker'), STUB, { mode: 0o755 });
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, k), v);
  return dir;
}
function run(dir, env) {
  const r = spawnSync('bash', [path.join(dir, 'ops', 'deploy.sh')], { cwd: dir, encoding: 'utf8',
    env: { PATH: path.join(dir, 'bin') + ':' + process.env.PATH, STUB_LOG: path.join(dir, 'log'), STUB_STATE: path.join(dir, 'state'), HEALTH_TRIES: '2', HEALTH_WAIT: '0', ...env } });
  return { code: r.status, out: r.stdout + r.stderr, log: fs.existsSync(path.join(dir, 'log')) ? fs.readFileSync(path.join(dir, 'log'), 'utf8') : '', tag: fs.existsSync(path.join(dir, '.deployed-tag')) ? fs.readFileSync(path.join(dir, '.deployed-tag'), 'utf8').trim() : null };
}

(async () => {
  await t('a healthy release is pulled, started and remembered', async () => {
    const d = host({ '.deployed-tag': 'v1\n' });
    const r = run(d, { TAG: 'v2', BAD_TAG: 'never' });
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.tag, 'v2');
    assert.ok(/pull api migrate proxy/.test(r.log) && /up -d --remove-orphans/.test(r.log));
  });
  await t('an unhealthy release is rolled back to the previous tag and reported as failed', async () => {
    const d = host({ '.deployed-tag': 'v1\n' });
    const r = run(d, { TAG: 'v2', BAD_TAG: 'v2' });
    assert.strictEqual(r.code, 1);
    assert.strictEqual(r.tag, 'v1');
    assert.ok(r.out.includes('putting v1 back') && r.out.includes('v2 is NOT deployed'));
    assert.strictEqual(fs.readFileSync(path.join(d, 'state'), 'utf8'), 'v1');
  });
  await t('a first release that is unhealthy fails and writes no state', async () => {
    const d = host();
    const r = run(d, { TAG: 'v1', BAD_TAG: 'v1' });
    assert.strictEqual(r.code, 1);
    assert.strictEqual(r.tag, null);
    assert.ok(r.out.includes('no previous tag'));
  });
  await t('no tag is refused before anything is touched', async () => {
    const d = host();
    const r = run(d, { BAD_TAG: 'never' });
    assert.notStrictEqual(r.code, 0);
    assert.strictEqual(r.log, '');
  });
  await t('when the old tag is unhealthy too the failure says so', async () => {
    const d = host({ '.deployed-tag': 'v1\n' });
    const r = run(d, { TAG: 'v2', BAD_TAG: 'v1 v2' });
    assert.strictEqual(r.code, 1);
    assert.strictEqual(r.tag, 'v1');
    assert.ok(r.out.includes('v1 is not healthy either'));
  });
  console.log(`\n${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
