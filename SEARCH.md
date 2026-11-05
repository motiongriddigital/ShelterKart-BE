# The search (backend/search)

Built 31 Oct 2026. Whatever a buyer types, the search offers up to five projects, each with what tells it apart (developer,
area, city, registration number, phases) and a plain reason it matched, and research starts only on the one the buyer confirms.

## How it reads a query
- Typos and sound-alike spellings: "vasant hieghts", "wasant", "Shriji Reality". Short words must match exactly ("park" is never "pork").
- Hindi, Marathi and Arabic script, including English property words written in Hindi ("वसंत हाइट्स" finds Vasant Heights).
- Registration numbers however written ("rera no p-519-000-678-90"); phases and towers ("phase two", "Phase II", "Tower B").
- Hints that boost but never exclude: configuration (2BHK), status, possession year, views and landmarks, price, size.
- Developer only, area only, developer plus area, former names, the legal company behind a brand.

## Confidence
- **sure**: a registration number, or every name word matched with a clear lead and nothing contradicting the location.
- **likely**, **possible**: shown as a choice. Generic words alone ("Park") are never more than possible.
- Same name in two cities: both shown, neither called the best match. A location that names a different place lowers the score.
- Nothing found: says so, shows the closest projects, asks "tell us what you remember" (developer, area, year), and offers research anyway.

## Switch (SEARCH_V2)
- `shadow` (default): the screen is unchanged. The new search runs beside every search on both routes (`/api/research` and the
  live investigator `/api/investigate`) and the comparison is kept: `GET /api/admin/search/shadow`.
- `on`: the page shows candidates first. **Turn on only after reading the shadow comparison, and with the founder's approval of the screen.**
- `off`: neither runs.

## The index
Empty at start: there is no verified project list yet. It grows from every project ShelterKart researches, and an admin can load
projects with `POST /api/admin/search/projects` (format in `backend/data/search/README.md`; every entry needs its source).
Saved in `SEARCH_DATA_DIR` (or `SOCIAL_DATA_DIR`). Until the index has projects, almost every live search ends in "not found" and
"research anyway" in `on` mode, which is why the default is `shadow`.

## Tests
- `backend/test/search/search.test.js`: reading, hints, the index, and 37 messy test queries on a fictional index (TEST ONLY):
  the right project first in 30 of 30, in the top five in 30 of 30, never confidently wrong.
- `backend/test/search/service.test.js`: the switch, the routes, the shadow categories, the investigator path, saving and reloading.
- `tools/search_ui_check.py`: 13 browser checks of the `on` screen (not part of npm test).

## Not done (the second step)
Pasted links, brochure and photo reading, map and "near me", per-market playbooks with locality gazetteers and ID formats,
and a registry import. The rates above are measured on fictional projects; real rates need real queries from the shadow.
