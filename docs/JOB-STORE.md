# The job store (SHEL-9)

A running investigation (the free first look, and the paid research that follows a payment) is a job. Until now a job lived in memory and in one JSON file per report in `LIVE_JOBS_DIR`. That works for one server on one disk. It fails in two ways that matter at launch:

- On a host whose disk is thrown away at each deploy (most container hosts), a paid report that is still being researched is lost, and the buyer has paid for nothing.
- During a rolling deploy, or with two instances, both servers load the same jobs. One marks a free search failed while the other is still running it, or both run the same paid report and its AI cost is paid twice.

`JOB_STORE=postgres` keeps the jobs in the database and gives each working job to one instance at a time.

## Turning it on

```
DATABASE_URL=...        # already needed for reports
JOB_STORE=postgres
JOB_LEASE_SECONDS=60    # optional
```

Run the migrations (`live_jobs.sql`). Without `JOB_STORE` nothing changes: jobs stay in files. In production a start-up warning says when there is a database but jobs are still files.

## How it works

One row per report reference in `live_jobs`: the same record the file held, `owner` (the instance running it) and `lease_until`.

- **A working job belongs to one instance.** A job is working while it sweeps or completes, or is paid and not yet finished. The instance that runs it writes its id and a lease into the row and renews the lease every quarter of `JOB_LEASE_SECONDS` while it works. Another instance cannot overwrite or remove a job whose lease is live.
- **A start-up takes only what is free.** Saved jobs nobody is working on (finished previews, finished reports, failed ones) are loaded by every instance, as before. Working jobs are claimed only when nobody holds them or the lease has run out. A job another instance holds is left alone: it is not marked failed and not resumed. This is what makes a rolling deploy safe.
- **A crashed instance is noticed without a restart.** Every instance checks on a timer for working jobs whose lease has run out and takes them over: a paid report resumes from its saved state (the research is not paid for twice), a free search is marked failed with reason `restarted` so the buyer can search again.
- **A payment goes through the lease.** When a payment is confirmed, the instance that received the notice (the buyer's return or the merchant's webhook, on any instance) asks to take the job. If another instance holds it, the payment is written down on the row and the holder picks it up on its next check. If nobody holds it, this instance takes it and runs the paid work. A duplicate notice for a job someone else holds does not start a second run.
- **A browser connected to another instance still follows the job.** A report or page for a job this instance is not working on is read again from the database (it does not trust what it remembered), and the progress stream follows the saved record by polling.
- Writes are queued and coalesced (the newest record of a report wins), so a request never waits for the database.

## What is still per instance

Running two instances is not yet fully supported. These are counted in each instance's memory, so with N instances each limit is N times larger or each figure only sees its own share:

| What | Effect with several instances | What to do |
|---|---|---|
| Rate limits (`express-rate-limit`) | Each limit is multiplied by the number of instances | Keep the limits generous enough for that, or move them to a shared store |
| Today's AI spend and `AI_DAILY_MAX_USD` | The ceiling applies to each instance separately | Set the ceiling to the total divided by the number of instances, until the spend is read from `engine_usage` |
| The daily cap of new investigations and per-account allowance | Counted per instance | Same as above |
| `INVESTIGATE_CONCURRENCY` | Per instance | Same as above |
| The "same project searched again" lookup | An instance only reuses the first looks it knows of, so two instances can each research the same project once | Costs one extra research; no wrong result |
| PDF files | Kept on each instance's own disk and rebuilt on demand | None needed |

Until those are shared, the supported launch shape is one instance, with `JOB_STORE=postgres` so that a deploy loses nothing, plus a rolling deploy where the old and the new instance overlap for a few minutes. That overlap is exactly what the lease makes safe.

## Checks

- `tools/check_job_store.js` runs against a real Postgres with two store instances sharing it: ownership, lease renewal, take-over, a payment handed from one instance to another, burst writes. It is part of CI's real-database stage.
- Verified once by hand with two real server processes on one database and a stand-in AI and payment provider: a second instance started in the middle of a search left it alone and served its result; a payment whose notice reached the other instance ran the paid work once, there; the same notice replayed on the first instance started nothing; a `kill -9` of the instance working a search was noticed and the job settled within the lease time.
