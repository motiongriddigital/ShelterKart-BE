# QA handoff: how test prompts move between the two machines

The builder (an AI on the owner's Mac) writes the code and its own unit tests. An independent QA agent (an AI on another computer) verifies the work: a real database, a real server, a real browser. The builder never runs these prompts, so the check is not marked by the one who wrote the code.

The channel is this git branch, `ops/admin-plan-and-qa`, on GitHub. No ports are opened, no secrets are shared, and the history is the audit trail.

## For the QA agent: your loop

1. Get this branch in its own folder, separate from the code you test:
   `git clone <repo url> sk-qa && cd sk-qa && git checkout ops/admin-plan-and-qa`
   Later: `git pull`.
2. List what is waiting: `node tools/qa/qa.js list`. A prompt is waiting when its state is `queued`.
3. Open the oldest queued prompt in `qa/INBOX/`. Each one names the repository, branch and commit to test, and is self-contained.
4. Check out that commit in a second folder (the prompt gives the commands), run the steps exactly as written, and record what you saw.
5. Write your result to `qa/OUTBOX/<same file name>` using `qa/RESULT-TEMPLATE.md`. Then:
   `git add qa/OUTBOX && git commit -m "qa: <id> <pass|fail|blocked>" && git push origin ops/admin-plan-and-qa`
6. Go back to step 2.

## Rules for the QA agent

- Do not edit code in the repositories under test, and do not push to any branch except this one. If something is wrong, report it; the builder fixes it.
- Do not change a prompt's steps to make them pass. If a step cannot be run as written, report it as `blocked` or `fail` and say why.
- Quote the exact failing output (the command, the status code, the message). A claim without output is not a result.
- Never paste or commit secrets, keys or real personal data. The prompts use throwaway values.
- If the prompt says a thing is "known" or "not verified", verify it anyway and say what you saw.
- Stop and write `blocked` when the environment is missing (no Docker, no network); do not improvise a different environment.

## For the builder: your loop

1. When a slice is built and pushed, run `node tools/qa/qa.js new --id QA-0NN-short-name --title "..." --repo BE --branch <branch> --sha <commit>` and edit the prompt with the slice's checks.
2. Commit and push this branch. Tell the owner a prompt is queued.
3. Later: `git pull`, `node tools/qa/qa.js list`, read the result in `qa/OUTBOX`, fix what failed, and queue a new prompt for the fix (QA-0NN-b).

## If git is not available between the machines

Each prompt is one markdown file. `node tools/qa/qa.js show <id>` prints it as a single block that can be pasted into the QA agent by hand; its result file can be pasted back. This is slower and loses the history, so use it only as a fallback.

## Files

| Path | What |
| --- | --- |
| `qa/INBOX/*.md` | The prompts, one per slice, written by the builder |
| `qa/OUTBOX/*.md` | The results, one per prompt, written by the QA agent |
| `qa/PROMPT-TEMPLATE.md` | The shape of a prompt |
| `qa/RESULT-TEMPLATE.md` | The shape of a result |
| `tools/qa/qa.js` | `list`, `new`, `show` |
