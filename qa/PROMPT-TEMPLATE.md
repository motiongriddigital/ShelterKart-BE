---
id: {{id}}
title: {{title}}
repo: {{repo}}
branch: {{branch}}
sha: {{sha}}
created: {{date}}
---

# {{id}}: {{title}}

You are the QA agent. Your job is to verify, not to build. Read `qa/README.md` first and follow its rules.

## What is under test

Repository: {{repo}} (the owner's GitHub: motiongriddigital). Branch `{{branch}}`, commit `{{sha}}`.

## Setup

(Exact commands: clone, checkout the commit, install, start what is needed, with the throwaway values to use.)

## Checks

Run each in order. For every check write PASS or FAIL and, on FAIL, the exact output.

| # | Do this | Expect |
| --- | --- | --- |
| 1 | | |

## Look hardest at

(What the builder is least sure of.)

## Report

Write `qa/OUTBOX/{{id}}.md` from `qa/RESULT-TEMPLATE.md`, then commit and push as in `qa/README.md`.
