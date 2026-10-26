#!/usr/bin/env python3
"""Puts the built guide into the website page, the way the sample reports are put there, so it opens inside the page and
reads offline.
    python3 guide/embed_in_frontend.py            writes it
    python3 guide/embed_in_frontend.py --check    exits 1 if the page's copy is not the current guide/dist copy"""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, '..', 'shelterkart-frontend.html')
DIST = os.path.join(HERE, 'dist', 'ShelterKart-Home-Buying-Guide.html')
START, END, ANCHOR = '<!--GUIDE_START-->', '<!--GUIDE_END-->', '<!--DOSSIER_SAMPLES_END-->'

def block():
    html = open(DIST, encoding='utf-8').read()
    # JSON inside a script tag: "<" is escaped so the guide's own markup can never close the tag
    j = json.dumps(html, ensure_ascii=False).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    return START + '<script type="application/json" id="sk-guide">' + j + '</script>' + END

page = open(PAGE, encoding='utf-8').read()
if START in page: new = re.sub(re.escape(START) + '.*?' + re.escape(END), lambda m: block(), page, flags=re.S)
else:
    assert ANCHOR in page, 'the page has no sample-reports block to place the guide after'
    new = page.replace(ANCHOR, ANCHOR + '\n' + block(), 1)
if '--check' in sys.argv:
    print('the guide in the page is current' if new == page else 'the guide in the page is OUT OF DATE: run guide/embed_in_frontend.py')
    sys.exit(0 if new == page else 1)
open(PAGE, 'w', encoding='utf-8').write(new)
print('guide embedded:', round(len(block()) / 1024), 'KB')
