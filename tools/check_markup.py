#!/usr/bin/env python3
"""Structural check of the website page. Catches the class of mistake where a removed block takes closing tags with it
and traps later windows inside an earlier one (which happened to Terms, Privacy, Restore and Reply in October 2026).
Checks: no window (.modal-bg) sits inside another; every window the page opens exists; every window has a close button
for itself; block-level tags open and close in balance.   python3 tools/check_markup.py"""
import os, re, sys
from html.parser import HTMLParser
PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shelterkart-frontend.html')
html = open(PAGE, encoding='utf-8').read()
BLOCK = ('div', 'aside', 'section', 'main', 'header', 'footer', 'nav', 'article', 'form', 'ul', 'ol')
class P(HTMLParser):
    def __init__(s): super().__init__(); s.stack = []; s.nested = []; s.windows = []; s.unbalanced = []
    def handle_starttag(s, tag, attrs):
        if tag not in BLOCK: return
        a = dict(attrs); cls = (a.get('class') or '').split()
        if 'modal-bg' in cls:
            s.windows.append(a.get('id'))
            if any('modal-bg' in c for _, c in s.stack): s.nested.append(a.get('id'))
        s.stack.append((tag, cls))
    def handle_endtag(s, tag):
        if tag not in BLOCK: return
        if not s.stack or s.stack[-1][0] != tag: s.unbalanced.append(tag); return
        s.stack.pop()
body = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.S)
p = P(); p.feed(body)
fails = 0
def ok(label, cond, detail=''):
    global fails
    if not cond: fails += 1
    print(('  ok   ' if cond else '  FAIL ') + label + ('' if cond else f'  ({detail})'))
ok('no window sits inside another window', not p.nested, p.nested)
opened = set(re.findall(r"openModal\('([A-Za-z]+)'\)", html))
ok('every window the page opens exists', opened <= set(p.windows), sorted(opened - set(p.windows)))
missing_close = [w for w in p.windows if w and f"closeModal('{w}')" not in html and w != 'guideModal']
ok('every window has a close button for itself', not missing_close, missing_close)
ok('block-level tags open and close in balance', not p.unbalanced and not p.stack, f'unbalanced {p.unbalanced[:5]}, still open {[t for t,_ in p.stack][:5]}')
print('\nall passing' if not fails else f'\n{fails} FAILED'); sys.exit(1 if fails else 0)
