# Delivery pipeline

How a change travels from a branch to production. The rules for branches, commits and pull requests are in [CONTRIBUTING.md](../CONTRIBUTING.md); what a host must provide is in [DEPLOYMENT.md](DEPLOYMENT.md).

## From pull request to production

Merging to `main` publishes an image tagged `:main` and `:sha-<commit>`; a version tag publishes `:X.Y.Z`. The two deploy steps are drawn dashed because no hosting target is chosen yet, so nothing starts the image on a server.

```mermaid
%% title: Delivery pipeline
%% type: deployment
flowchart LR
  PR["Pull request"] --> CI{"CI: logic,<br/>real-run, image"}
  CI -->|fail| FIX["Fix on the branch"]
  FIX --> PR
  CI -->|pass| MG["Merge to main"]
  MG --> REL["release.yml publishes<br/>ghcr.io image :main, :sha"]
  REL -.-> STG["Deploy to staging<br/>(not built yet)"]
  STG -.-> VER["Verify on staging"]
  VER --> TAG["Tag vX.Y.Z"]
  TAG --> IMG["release.yml publishes :X.Y.Z"]
  IMG -.-> APP["Approval, then<br/>deploy to production<br/>(not built yet)"]
```

## Branches

Short-lived branches off `main`, merged through pull requests. There is no `develop` or `test` branch: testing is CI on every pull request and the staging environment after merge.

```mermaid
%% title: Branch flow
%% type: other
gitGraph
  commit id: "baseline"
  branch fix-baseline-tests
  checkout fix-baseline-tests
  commit id: "playwright, ci"
  commit id: "locale fix"
  checkout main
  branch feature-pipeline
  checkout feature-pipeline
  commit id: "docker, release"
  checkout main
  merge fix-baseline-tests tag: "PR"
  merge feature-pipeline tag: "PR"
  commit id: "tag v0.1.0" tag: "v0.1.0"
```
