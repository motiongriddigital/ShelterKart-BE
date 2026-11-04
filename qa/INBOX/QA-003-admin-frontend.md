---
id: QA-003-admin-frontend
title: Admin panel frontend: build, and a walkthrough of every screen
repo: ShelterKart-FE
branch: admin-console
sha: 3d1bdf9
created: 2026-11-04
---

# QA-003: admin panel frontend

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules.

## What is under test

Repository ShelterKart-FE (GitHub: motiongriddigital/ShelterKart-FE), branch `admin-console`, commit `3d1bdf9`. It adds a new admin console (sidebar, panels, dashboard, user map, health and errors, users and sessions, dark mode) on generated seed data. The builder ran lint, typecheck and format checks, but never ran `next build` and never looked at a narrow screen. Those two are the first things to check.

## Setup

Node 22 or newer, a browser you can drive (screenshots needed).

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
| A4 | `npm run build` | exits 0. Report any warning about the admin routes, the `world-50m.json` file, or CSS. |
| A5 | `npm run start` (port 3000) | starts; the next steps use `http://localhost:3000` |

## Part B: walkthrough. Take a screenshot of each numbered item (small jpg, at most 10 total, saved under `qa/OUTBOX/screenshots/QA-003/`).

Open `/admin`. There is no backend, so use the **Open the demo dashboard** button.

| # | Do this | Expect |
| --- | --- | --- |
| B1 | The login page, light theme | centred card, labelled fields, a show/hide password button, the demo box underneath |
| B2 | Open the demo. Look at the left sidebar | logo and "Admin", a search box, groups Overview, Business, Audience, Engine, People, an insights card above the footer, a footer with the avatar name, a pulse icon and a settings icon. No Database backups entry. |
| B3 | Type `ban` into the sidebar search and press Enter | goes to Users and sessions |
| B4 | Press `/` anywhere (not in a field) | focuses the search box |
| B5 | Dashboard | four number tiles, "Every day" chart with Visitors, Searches, Paid reports tabs and hover values, "Needs a person" with three tabs and working Mark resolved, funnel, traffic with three tabs, engine card, success metrics table |
| B6 | Click the footer avatar name | a menu opens upward with Account, Settings, three theme items, Sign out |
| B7 | Choose Dark theme | the whole page turns dark at once; no white boxes remain on the dashboard (look at the queue rows, the funnel, the success metrics table, the banner) |
| B8 | Reload the page in dark theme | no white flash before the dark theme appears (watch the first frame, or throttle CPU) |
| B9 | User map | the world map is shaded; hover India: it darkens and a tooltip follows the cursor smoothly without flicker; the Top countries bars stay inside their card; the table's number columns are right-aligned |
| B10 | Click the full-screen button on the map card (and press `F`) | the map fills the screen with a toolbar; click a country: a card with numbers and "Open the country page"; Esc leaves |
| B11 | Health and errors: Overview, Official registers, Error log, Failed jobs, E-mail and WhatsApp | each loads; in the Error log open a row and filter by Errors; Retry on a failed job removes it and shows a toast |
| B12 | Users and sessions: Bans, Active sessions, one user | the Sessions card search box is a normal small box beside the title (not full width); "Last seen" shows sensible times (not "0 min ago" on every row); Ban address opens a dialog with the address filled; submit with a short reason shows an inline error; a valid ban adds a toast and the user shows as banned in the list |
| B13 | Marketing dashboard and Marketing desk (sidebar, Business) | each shows its own header; the message "needs the live backend" is expected in demo mode. Check both in light AND dark theme and report anything unreadable. |
| B14 | Settings, Appearance | three theme cards; the chosen one has a tick |
| B15 | Resize the window to 390 pixels wide and go through B2, B5, B9, B11, B12 | no horizontal page scroll; the sidebar becomes a drawer opened by the top-left button; secondary panels become a scrolling row of chips; tables scroll inside their cards. Report every screen that breaks. |
| B16 | Browser console, while doing all of the above | no red errors. Quote any (the builder fixed a duplicate-key error on the map earlier). |
| B17 | Network tab on the map page | no request to another website; the map data loads from `/admin/world-50m.json` |
| B18 | Open `/` (the public site) and one of its inner pages, and compare with `git stash`-free master: `git checkout origin/master` in a second folder if you can | the public site looks the same as master; admin styles must not leak into it |

## Look hardest at

- Anything unreadable in dark theme: text with low contrast, borders that vanish, chart lines.
- The marketing and social desks (built by someone else, restyled only through variables): look for white panels in dark theme.
- Keyboard use: Tab through the sidebar and the ban dialog; Esc closes the dialog; focus is visible.
- Layout at widths 1024, 768 and 390.

## Report

Write `qa/OUTBOX/QA-003-admin-frontend.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md` (screenshots included, kept small).
