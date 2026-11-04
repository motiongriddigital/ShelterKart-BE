---
id: QA-003-admin-frontend
status: pass
tested_sha: 3d1bdf9
machine: Windows 11, node v24.20.0, npm 11.2.0, Git Bash, no browser (clone with core.autocrlf=false)
finished: 2026-11-05
---

# Result for QA-003-admin-frontend (retest, corrected expectations)

## Summary

Against the corrected text everything passes: the build gates are clean, all 46 admin routes answer 200 with no application error, unknown admin addresses answer 200 with the "could not be found" text, and marketing and social show the sign-in gate. Three review items (config files changed outside the admin folders, a missing `--radius`/easing token in the dark block, duplicate page titles) are noted for the owner.

## Checks

| # | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | `npm run lint` exit 0, no warnings |
| A2 | PASS | `npm run typecheck` exit 0 |
| A3 | PASS | `All matched files use Prettier code style!` (LF clone; a default Windows CRLF clone fails this, an environment matter) |
| A4 | PASS | `npm run build` exit 0, 27 static pages. Only warning: `Next.js inferred your workspace root ... C:\Users\parab\package-lock.json` (stray lockfile on this machine); `brand/dist/tokens.css not found; keeping committed src/styles/_theme.scss`. Nothing on admin routes, world-50m.json or CSS. Route table: `/` (ƒ), `/_not-found`, `/about`, `/admin` 8.79 kB, `/admin/[section]` (SSG: sales, freemium, insights, +6 more), `/admin/[section]/[view]` (ƒ), `/admin/marketing` 7.85 kB, `/admin/social` 9.66 kB, `/contact`, `/corrections`, `/delivery`, `/independence`, `/manifest.webmanifest`, `/methodology`, `/pricing`, `/privacy`, `/refunds`, `/terms`; shared First Load JS 103 kB. |
| A5 | PASS | `npm run start -- -p 3100`; `/admin` `200` |
| B1 | PASS | crawl: `200 BAD-BODY /admin 13869b "ShelterKart — Admin"`, `pages: 1` (as expected; the BAD-BODY is the known false positive: the sign-in page embeds the framework's not-found template). Direct requests: **46 routes** requested, all `200`, none with `Application error` or `Internal Server Error`: `/admin`; the 11 nav routes `/admin/{sales,marketing,social,freemium,insights,traffic,map,ai-engine,health,users,settings}`; and 34 panel views: sales/{overview,orders,refunds,tax,reports}, freemium/{roadmap,funnel,drop-offs,cohorts}, traffic/{overview,pages,sources,devices,languages}, map/world, ai-engine/{overview,engines,agents,costs}, health/{overview,registers,errors,jobs,delivery}, settings/{account,appearance,notifications,backup-schedule,backup-history,backup-keys,backup-restore,admin-access}, users/{bans,sessions}. |
| B2 | PASS | `/admin/does-not-exist` status `200`, body contains "could not be found" (1), no application error; `/admin/users/does-not-exist` the same |
| B3 | PASS | `200`; `Topology [ 'countries', 'land' ]` |
| B4 | PASS (note) | no title empty. 44 of the 46 pages share `ShelterKart — Admin`; `/admin/marketing` is `Marketing dashboard`, `/admin/social` is `Marketing desk`. The duplicates are probably not wanted (the tab title does not change between screens). |
| B5 | PASS | both `200`; both show the sign-in gate: "No server connected? Open the demo: simulated visitor traffic computed by the real analytics code, and the five real sample reports. No sign-in is needed. Open the demo dashboard". Titles `Marketing dashboard` and `Marketing desk`. |
| C1 | PASS | matches: `src/constants/adminNav.ts:220` (`'Database backups every two weeks, encrypted, with key status and restore'`, the Settings item's "will do" bullet) and `src/constants/adminPanels.ts:114` (`label: 'Database backups'`, the Settings group). The main sidebar does not list backups. |
| C2 | PASS | hosts: www.w3.org, nextjs.org, react.dev, tailwindcss.com, openfontlicense.org, github.com, example.com, shelterkart.com, wa.me, maharerait.maharashtra.gov.in, rera.karnataka.gov.in, localhost, plus truncated regex artefacts `http://f`, `http://n`, `https://a`, `https://x`. No CDN, font host, analytics or API host. |
| C3 | PASS (list) | outside the admin folders: `package-lock.json` (+2940), `package.json` (+17), `postcss.config.mjs` (+2), `src/hooks/use-mobile.ts` (new), `src/hooks/useAdminLogin.ts`, `src/store/adminSession.ts`, `src/store/adminTheme.ts` (new), `src/store/consoleData.ts` (new), `src/utils/cn.ts` (new), `todo.txt`. None is a global stylesheet, layout or font file. `package.json`, `postcss.config.mjs` and the lockfile change the build and CSS pipeline for the whole app, so the owner should look at those; the public routes' sizes in the table are small and stable. |
| C4 | PASS | one match: `src/app/(admin)/layout.tsx:20 <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />` (a constant string that sets the dark class before paint) |
| C5 | PASS | no match |
| C6 | PASS (list) | importing `adminSeed`: `HealthViews.tsx`, `UserMapView.tsx`, `UsersViews.tsx`, `constants/adminPanels.ts`, `constants/adminSeedPeople.ts`, `store/consoleData.ts` |
| C7 | PASS (note) | dark theme is the `.dark` class. `console.css`: light 49 variables, dark 46; missing in dark: `--radius`, `--ease-out`, `--ease-in-out` (not colours; no visual effect). `admin.scss` has `--navy-900/-800/-600` only in the light block (brand constants, not checked visually). |
| C8 | PASS | 27 matches; 24 `<button>` elements scanned earlier, 0 icon-only buttons without `aria-label`/`title` (e.g. `Clear search`, `Health and errors`, `Settings`, `Account menu for ...`) |
| M1 to M7 | NOT RUN (owner Part M) | |

## Anything else you noticed

- Nothing fails against the corrected text. The shared tab title and the three config-file changes are for the owner to judge.

## Environment problems

- Windows git converts to CRLF by default, which fails A3; a clone with `core.autocrlf=false` was used. 127.0.0.1 instead of localhost.
