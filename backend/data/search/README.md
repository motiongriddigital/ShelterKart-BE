# The search index seed

`projects.json` is a list of projects the search can offer as candidates before any research. It is empty: ShelterKart has no
verified list of projects yet. The index also grows on its own from every project ShelterKart researches, and an admin can load
projects with `POST /api/admin/search/projects` (a list, up to 5,000 at a time).

Each project:

```json
{ "id": "in-mh-p51900012345", "market": "in", "name": "Project name", "aliases": ["Former or brand name"],
  "city": "Mumbai", "locality": "Worli", "localityAliases": [], "neighbours": ["Lower Parel"],
  "developer": { "name": "Brand name", "legal": ["Legal company Pvt Ltd"], "aliases": [] },
  "status": "under_construction", "configs": ["2bhk"], "features": ["sea_view"],
  "phases": [{ "name": "Phase 1", "regId": "P51900012345", "status": "ready", "possession": 2027 }],
  "regIds": [], "origin": "registry", "source": { "label": "MahaRERA", "url": "https://...", "date": "2026-10-31" } }
```

Only facts from an official register or ShelterKart's own research belong here: a candidate list names developers, so every entry
must carry its source. `market` uses the site's two-letter market codes.
