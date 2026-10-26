"""Run every test suite and record the facts the investor deck quotes (checks, suites, languages, playbooks, markets, date)
in deck/model/facts.json, so the deck never states a stale count. Exits non-zero if any suite fails."""
import json, os, re, subprocess, sys, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); B = os.path.join(ROOT, 'backend')
cmds = json.load(open(os.path.join(B, 'package.json')))['scripts']['test'].split(' && '); total = 0; bad = []
for c in cmds:
    p = subprocess.run(c, shell=True, capture_output=True, text=True, timeout=300, cwd=B); t = p.stdout + p.stderr
    m = re.search(r'(\d+) passed, (\d+) failed', t); total += int(m.group(1)) if m else len(re.findall(r'^\s+ok\b', t, re.M))
    if p.returncode != 0: bad.append(c)
langs = int(subprocess.run(['node', '-e', "console.log(require('./engine/languages').enabled().length)"], capture_output=True, text=True, cwd=B).stdout.strip())
markets = int(subprocess.run(['node', '-e', "console.log(Object.keys(require('./engine/markets').MARKETS).length)"], capture_output=True, text=True, cwd=B).stdout.strip())
playbooks = len([k for k in json.load(open(os.path.join(B, 'data', 'playbooks.json'))) if not k.startswith('_')])
facts = dict(checks=total, suites=len(cmds), failing=len(bad), languages=langs, markets=markets, playbooks=playbooks, date=datetime.date.today().isoformat())
json.dump(facts, open(os.path.join(ROOT, 'deck', 'model', 'facts.json'), 'w'), indent=1)
print(facts, 'FAILING: ' + ', '.join(bad) if bad else '')
sys.exit(1 if bad else 0)
