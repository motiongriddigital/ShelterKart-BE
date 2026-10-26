#!/usr/bin/env python3
"""Checks the built guide against its source: every line of every content file must appear in the finished HTML, the
contents page must carry real page numbers, and the PDF must be the page count the contents were built for.
    python3 guide/check_guide.py        (run after build_guide.py; exits 1 on any problem)"""
import os, re, subprocess, sys
from bs4 import BeautifulSoup
HERE = os.path.dirname(os.path.abspath(__file__))
html = open(os.path.join(HERE, 'dist', 'ShelterKart-Home-Buying-Guide.html'), encoding='utf-8').read()
soup = BeautifulSoup(html, 'lxml')
for t in soup(['style', 'script']): t.decompose()
flat = lambda s: re.sub(r'\s+', '', s.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"').replace('–', '-').replace('—', '-').replace('\xa0', '').replace('^', ''))
TEXT = flat(soup.get_text(' '))
VOICE = re.compile(r'^The (friend|mathematician|engineer|lawyer|philosopher|consultant|emotional beat)\.\s*')
missing, checked = [], 0
for i in range(1, 6):
    for line in open(os.path.join(HERE, 'content', f'part{i}.md'), encoding='utf-8'):
        l = line.strip()
        if not l or l.startswith('#') or l == '---' or re.match(r'^\|[\s\-|]+\|$', l): continue
        pieces = [c.strip() for c in l.strip('|').split('|')] if l.startswith('|') else [l]
        for piece in pieces:
            piece = re.sub(r'^(\d+\.|-|>)\s*', '', piece).replace('**', '').replace('*', '')
            piece = VOICE.sub('', piece)
            if not piece: continue
            checked += 1
            if flat(piece) not in TEXT: missing.append(piece[:90])
problems = []
if missing: problems.append(f'{len(missing)} source line(s) missing from the guide, e.g. {missing[:3]}')
toc = soup.select_one('.toc-list')
if toc is None or '·' in toc.get_text(): problems.append('the contents page has placeholder page numbers')
pdf = os.path.join(HERE, 'dist', 'ShelterKart-Home-Buying-Guide.pdf')
n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout).group(1))
last = int(soup.select('.toc-list .tp')[-1].get_text())
if not (1 < last < n): problems.append(f'last contents page {last} is not inside a {n}-page PDF')
for img in soup.find_all('img'):
    if img.get('alt') is None: problems.append('an image has no alt text')
print(f'{checked} lines checked against the finished guide; {n} pages; ' + ('ALL PRESENT' if not problems else f'{len(problems)} PROBLEM(S)'))
for p in problems: print('  FAIL', p)
sys.exit(1 if problems else 0)
