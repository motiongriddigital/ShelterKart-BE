# How we work in this repository

One rule: `main` is always deployable. Everything reaches it through a pull request.

## Branches

Short-lived branches off `main`, one topic each, merged within days.

| Prefix | For | Example |
| --- | --- | --- |
| `feature/` | new behaviour | `feature/mahrera-connector` |
| `fix/` | a bug | `fix/admin-number-format` |
| `chore/` | tooling, dependencies, CI | `chore/update-playwright` |
| `docs/` | documentation only | `docs/readme` |

There is no `develop` or `test` branch. Testing happens in CI on every pull request and in the staging environment after merge, not on a long-lived branch.

## Commits

`type(scope): summary`, for example `fix(admin): pin number format of tax thresholds`. Types: `feat`, `fix`, `build`, `chore`, `docs`, `test`, `refactor`. The body says why.

## Pull requests

1. Branch from an up-to-date `main`: `git switch main && git pull && git switch -c fix/name`.
2. Push and open a pull request. The template lists what to check.
3. CI runs three jobs: `logic` (all test suites), `real-run` (real Postgres, migrations, smoke test) and `image` (builds the Docker image and starts it). All three must pass.
4. Another person reviews when one is available; otherwise the author re-reads the diff once before merging.
5. Merge with rebase or squash, then delete the branch.

## From merge to production

```
pull request --CI--> merge to main --release--> image ghcr.io/<owner>/shelterkart-be:main and :sha-<commit>
                                                  |
                                          deploy to staging, verify
                                                  |
                         tag vX.Y.Z --release--> image :X.Y.Z --approval--> production
```

Production is released by tagging: `git tag v0.1.0 && git push origin v0.1.0`. Details and the missing hosting step are in `docs/DEPLOYMENT.md`.

## Settings to switch on in GitHub (repository admin)

Settings, Branches, rule for `main`: require a pull request, require the status checks `logic`, `real-run` and `image`, require the branch to be up to date, block force pushes and deletion. Add one required approval once two people are reviewing. Settings, Environments: create `staging` and `production`; on `production` add required reviewers.

## Run it locally

```
docker compose up --build      # Postgres, migrations, seed, API on http://localhost:4000
cd backend && npm ci && npm test
```

The compose database is published on host port 5440 (`DB_PORT` overrides it).
