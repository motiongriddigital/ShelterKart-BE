---
id: QA-003-admin-frontend
status: fail
tested_sha: 3d1bdf9
machine: Windows 11, node v24.20.0, npm 11.2.0, Git Bash, no browser (no database needed)
finished: 2026-11-04
---

# Result for QA-003-admin-frontend

## Summary

Lint, typecheck, format check (on an LF checkout) and `next build` pass and every admin route answers 200, but four things do not match the prompt: the crawl finds only 1 page (the console is behind a client-side sign-in, so there are no links in the HTML), unknown admin addresses answer 200 instead of 404 (B2), marketing/social do not say they need the live backend (B5), and "Database backups" is still in the code (C1).

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `npm run lint` exit 0, no warnings |
| A2 | PASS | `npm run typecheck` exit 0 |
| A3 | PASS (see note) | In a default Windows clone (`core.autocrlf=true`, working files CRLF) it FAILS: exit 1, `Code style issues found in 253 files`; `prettier --check . --end-of-line crlf` passes. In a clone with `core.autocrlf=false` (LF, as stored in git): `All matched files use Prettier code style!`, exit 0. |
| A4 | PASS | `npm run build` exit 0, 27 static pages. Warnings: `Next.js inferred your workspace root ... multiple lockfiles ... C:\Users\parab\package-lock.json` (a stray lockfile on this machine), and `brand/dist/tokens.css not found; keeping committed src/styles/_theme.scss`. Nothing about admin routes, world-50m.json or CSS. Route table below. |
| A5 | PASS | `npm run start -- -p 3100` started; `/admin` `200` |
| B1 | FAIL | the crawl printed `200 BAD-BODY /admin 13869b "ShelterKart — Admin"` and `pages: 1`. `/admin` is only a sign-in form ("Open the demo dashboard" is a button, not a link), so no `/admin...` links are in the HTML. BAD-BODY looks like a false positive: the page's embedded Next.js not-found template contains the text `This page could not be found` (4 times), while `Application error` and `Internal Server Error` occur 0 times. Supplementary direct probes (from the slugs in adminNav.ts) all `200`: /admin/sales, marketing, social, freemium, insights, traffic, map, ai-engine, health, users, settings (11 pages with `/admin`: 12). Fewer than 25. |
| B2 | FAIL | `/admin/does-not-exist` `200`, `/admin/users/does-not-exist` `200` (both are soft 404s: the body says "could not be found" but the status is 200). Not a 500. |
| B3 | PASS | `200`; `Topology [ 'countries', 'land' ]` |
| B4 | PASS (note) | no title empty. `/admin`, sales, freemium, insights, traffic, map, ai-engine, health, users and settings all share the title `ShelterKart — Admin`; marketing is `Marketing dashboard`, social is `Marketing desk`. The duplicates are probably not wanted. |
| B5 | FAIL | both `200`, but `grep -io "live backend"` finds nothing. Both pages render the sign-in gate: "Use the admin username and password set on the server ... No server connected? Open the demo". |
| C1 | FAIL (as written) | `src/constants/adminNav.ts:220`: `'Database backups every two weeks, encrypted, with key status and restore'` (a "will do" bullet of the Settings item); `src/constants/adminPanels.ts:114`: `label: 'Database backups'` (a group in the Settings panel, items Schedule, History, Encryption keys). The main sidebar groups themselves do not list it. |
| C2 | PASS (note) | hosts: www.w3.org, nextjs.org, react.dev, tailwindcss.com, openfontlicense.org, github.com, example.com, shelterkart.com, wa.me, maharerait.maharashtra.gov.in, rera.karnataka.gov.in, localhost, plus truncated regex artefacts `http://f`, `http://n`, `https://a`, `https://x`. No CDN, font host, analytics or API host. |
| C3 | PASS (list) | changed outside the admin folders (base `e7b2ceb` to origin/admin-console): `package-lock.json` (+2940), `package.json` (+17), `postcss.config.mjs` (+2), `src/hooks/use-mobile.ts` (new), `src/hooks/useAdminLogin.ts`, `src/store/adminSession.ts`, `src/store/adminTheme.ts` (new), `src/store/consoleData.ts` (new), `src/utils/cn.ts` (new), `todo.txt`. None is a global stylesheet, layout or font file. `package.json`/`postcss.config.mjs`/lockfile change the build and CSS pipeline for the whole app (the public pages' route sizes in the build table are small and similar: /about 278 B, /pricing 317 B), so the owner should look at those two config changes. |
| C4 | PASS (explained) | one match: `src/app/(admin)/layout.tsx:20: <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />`, a constant string that sets the dark class before paint from localStorage. |
| C5 | PASS | no match |
| C6 | PASS (list) | importing `adminSeed`: `components/console/views/HealthViews.tsx`, `UserMapView.tsx`, `UsersViews.tsx`, `constants/adminPanels.ts`, `constants/adminSeedPeople.ts`, `store/consoleData.ts` |
| C7 | PASS (note) | the dark theme is the `.dark` class. In `console.css`, light `:root` defines 49 variables, `.dark` 46; missing in dark: `--radius`, `--ease-out`, `--ease-in-out` (not colours, no visual effect). In `admin.scss` `--navy-900`, `--navy-800`, `--navy-600` appear only in the light block (brand constants used directly, line 150 and 465); not checked visually. |
| C8 | PASS | 27 lines match; 24 `<button>` elements scanned, 0 icon-only buttons without `aria-label`/`title`. Examples: `aria-label="Clear search"`, `aria-label="Health and errors"`, `aria-label="Settings"`, `aria-label="Account menu for ${username}"`. |
| M1 to M7 | NOT RUN (owner Part M) | |

Route table (A4):
```
┌ ƒ /  ├ ○ /_not-found  ├ ○ /about  ├ ○ /admin 8.79 kB  ├ ● /admin/[section] (sales, freemium, insights, +6 more)
├ ƒ /admin/[section]/[view]  ├ ○ /admin/marketing 7.85 kB  ├ ○ /admin/social 9.66 kB  ├ ○ /contact  ├ ○ /corrections  ├ ○ /delivery
├ ○ /independence  ├ ○ /manifest.webmanifest  ├ ○ /methodology  ├ ○ /pricing  ├ ○ /privacy  ├ ○ /refunds  └ ○ /terms
First Load JS shared by all 103 kB
```
(the numbers for the build page counts are "27/27"; the number to carry into QA-008 C8 is the crawl's page count: 1 from the link crawl, 12 including direct probes.)

## Anything else you noticed

- The `/admin/[section]` route is static-generated for 9 slugs, but any other slug renders 200 with a not-found body (B2).
- `/admin/marketing` and `/admin/social` have their own titles and are not in the dynamic `[section]` route.

## Environment problems

- Windows git converts to CRLF by default, which makes A3 fail; used a clone with `core.autocrlf=false` for the results above (the first clone was removed). 
- The crawl was run with `127.0.0.1` instead of `localhost`; `/tmp/crawl.mjs` kept under the Windows temp folder and removed afterwards.
