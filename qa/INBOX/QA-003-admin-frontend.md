---
id: QA-003-admin-frontend
title: Admin panel frontend: build gates and command-line checks (no browser)
repo: ShelterKart-FE
branch: admin-console
sha: 3d1bdf9
created: 2026-11-04
---

# QA-003: admin panel frontend, without a browser

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules. You do not drive a browser in this prompt: everything below runs in a terminal. What needs eyes (dark theme, narrow screens, the map) is listed in Part M for the owner; do not try to do Part M.

## What is under test

Repository ShelterKart-FE (GitHub: motiongriddigital/ShelterKart-FE), branch `admin-console`, commit `3d1bdf9`. It adds a new admin console (sidebar, panels, dashboard, user map, health and errors, users and sessions, dark mode) on generated seed data.

## What the builder did and how it was tested

Built: the whole console under `src/app/(admin)` and `src/components/console`, on seed data from `src/constants/adminSeed*.ts`. Tested by the builder: lint, typecheck and the Prettier check pass. The builder never ran `next build` before this prompt and has no automated UI tests; the screens were looked at on the builder's own machine only. So the build and the routes are the first things to confirm, and the visual side is left to the owner.

## Setup

Node 22 or newer and curl. No browser.

```
git clone https://github.com/motiongriddigital/ShelterKart-FE.git sk-fe-under-test && cd sk-fe-under-test
git checkout 3d1bdf9 && npm ci
```

## Part A: the build

| # | Do this | Expect |
| --- | --- | --- |
| A1 | `npm run lint` | exit 0, no warnings |
| A2 | `npm run typecheck` | exit 0 |
| A3 | `npm run format:check` | `All matched files use Prettier code style!` |
| A4 | `npm run build` | exits 0. Report any warning about the admin routes, the `world-50m.json` file, or CSS. Copy the route table at the end of the output into your result. |
| A5 | `npm run start -- -p 3100 > /tmp/sk-fe3.log 2>&1 &` then wait 5 seconds | starts; the next steps use `http://localhost:3100` |

## Part B: the routes, by crawling

Save this as `/tmp/crawl.mjs` and run `node /tmp/crawl.mjs`. It starts at `/admin`, follows every `/admin...` link it finds in the HTML (three levels deep) and prints each address with its status and size.

```
const base = 'http://localhost:3100';
const seen = new Map(), queue = [['/admin', 0]];
while (queue.length) {
  const [path, depth] = queue.shift();
  if (seen.has(path)) continue;
  const r = await fetch(base + path), html = await r.text();
  seen.set(path, { status: r.status, bytes: html.length, bad: /Application error|This page could not be found|Internal Server Error/.test(html) && r.status === 200, title: (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '' });
  if (depth < 3) for (const m of html.matchAll(/href="(\/admin[^"#?]*)"/g)) if (!seen.has(m[1])) queue.push([m[1], depth + 1]);
}
for (const [p, v] of [...seen].sort()) console.log(v.status, v.bad ? 'BAD-BODY' : '', p, v.bytes + 'b', JSON.stringify(v.title));
console.log('pages:', seen.size);
```

| # | Do this | Expect |
| --- | --- | --- |
| B1 | run the crawl; the crawl only finds `/admin` (the console is behind a client-side sign-in, so the HTML has no `/admin...` links); that is expected. Then request every `/admin` route listed in the route table that `next build` printed (and the slugs in `src/constants/adminNav.ts`) directly with curl | every request answers `200`; no body contains `Application error` or `Internal Server Error`; `BAD-BODY` on `/admin` alone is a known false positive (the sign-in page embeds the framework's not-found template), say so but do not fail it; report the exact number of routes you requested and list the paths |
| B2 | `curl -s -w '\n%{http_code}\n' http://localhost:3100/admin/does-not-exist` and `/admin/users/does-not-exist` | never 500. The app answers `200` with the framework's "This page could not be found" text in the body (the console is a client-side app behind a sign-in, so the status is not meaningful). PASS if the body says not found; report the status you get |
| B3 | `curl -s http://localhost:3100/admin/world-50m.json \| node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.type, Object.keys(j.objects))})"` | prints `Topology` and the object names (e.g. `countries`); status 200 |
| B4 | Every page has a title: look at the crawl's titles | none empty; report any duplicates that look wrong |
| B5 | `/admin/marketing` and `/admin/social` | `200`; they show the sign-in gate (text such as "No server connected" and "Open the demo"). Report the text you find and each page's title |

## Part C: static checks on the code

| # | Do this | Expect |
| --- | --- | --- |
| C1 | `grep -rn "Database backups" src` | the only matches may be the Settings item's "will do" bullet in `adminNav.ts` and the Settings group in `adminPanels.ts` (backups are a planned admin item). FAIL only if the main sidebar lists backups as a live, working feature; report every match |
| C2 | External hosts: `grep -rhoE "https?://[a-zA-Z0-9.-]+" .next/static src public/admin 2>/dev/null \| sort -u` | only well-known documentation or namespace hosts (for example `www.w3.org`, `react.dev`, `nextjs.org`); no CDN, font host, analytics or API host. Paste the full list. |
| C3 | `git diff --stat origin/master...origin/admin-console -- . ':!src/app/(admin)' ':!src/components/console' ':!src/constants' ':!public/admin'` (use `main` if there is no `master`) | list every file changed outside the admin folders. For each one say if it can change the public site (global styles, layout, fonts, config). Report the full list; do not guess. |
| C4 | `grep -rn "dangerouslySetInnerHTML\|eval(\|new Function(" src/components/console "src/app/(admin)"` | no match, or each one explained |
| C5 | `grep -rn "console\.\(log\|error\)" src/components/console "src/app/(admin)"` | no match, or each one explained |
| C6 | Seed data: `grep -rln "adminSeed" src` and list the files that import it | the list of screens that still use seed data. Report it as a list; the Users and Sessions screens are expected to be on it. |
| C7 | Theme tokens: find the CSS block for the dark theme (search `data-theme` in `src` and `scripts`) and list every `--` variable defined in the light theme but missing in the dark one | none missing, or the names |
| C8 | Keyboard: `grep -rn "onKeyDown\|aria-label\|role=" src/components/console \| wc -l` and name three icon-only buttons you find (`grep -rn "<button" -A3 src/components/console \| head -60`) | each icon-only button has an `aria-label` or visible text. List any that have neither. |

## Part M: for the owner, not for the QA AI

Do not run these. The owner marks them on the board after looking.

| # | Do this | Expect |
| --- | --- | --- |
| M1 | Login page, light theme | centred card, labelled fields, a show/hide password button, the demo box underneath |
| M2 | Open the demo dashboard: sidebar | logo and "Admin", a search box, groups Overview, Business, Audience, Engine, People, no Database backups entry |
| M3 | Dashboard | four number tiles, a chart with tabs and hover values, a queue with Mark resolved, funnel, traffic, engine card |
| M4 | Choose Dark theme, then reload | the whole page turns dark at once, no white boxes, no white flash on reload |
| M5 | User map: hover India, then the full-screen button | the country darkens with a tooltip, no flicker; full screen has a toolbar and Esc leaves it |
| M6 | Resize to 390 pixels wide | no sideways page scroll; the sidebar becomes a drawer; tables scroll inside their cards |
| M7 | Users and sessions: Bans, Active sessions, one user, Ban address | the dialog opens with the address filled; a short reason shows an inline error; a valid ban shows a toast |

## Look hardest at

- A4: the build. It was never run before this prompt.
- B1 and B2: any route that is not 200, or a page that returns 200 but shows an error.
- C3: any change outside the admin folders that could leak into the public site.
- C7: dark-theme variables that are missing.

## Teardown

`kill %1` (or stop the server by its process id); remove `/tmp/crawl.mjs`.

## Report

Write `qa/OUTBOX/QA-003-admin-frontend.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`. Leave Part M as `NOT RUN (owner)`.
