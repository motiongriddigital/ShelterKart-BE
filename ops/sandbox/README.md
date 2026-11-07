# Sandbox

Runs the test suite, the AI engine and the register connectors in Docker with guardrails, so they can be tested against real services without a key, a bill, or a way to reach anything else.

```
ops/sandbox/run.sh                      everything, including the live Latvian download (about 10 minutes)
ops/sandbox/run.sh --no-live-registers  tests and the engine only
```

Needs Docker with Compose. Nothing is installed on the host and nothing is mounted from it except the stand-in AI server script, read-only. The run writes a log and removes its containers and database when it ends.

## What the guardrails are

| Guardrail | How | Who can change it |
|---|---|---|
| The application cannot widen its network | It shares the network of the `fw` container and has no `NET_ADMIN` | only `fw` |
| Nothing leaves except what is allowed | `fw` drops everything, then allows the sandbox network, DNS, and TCP 443 to the addresses of `ALLOW_HOSTS` (default `api-krs.ms.gov.pl`, `data.gov.lv`), re-resolved every 30 s | `fw` environment |
| A download cannot run away | Bytes coming back from allowed hosts are capped by a quota (`QUOTA_BYTES`, default 300 MB), then dropped | `fw` environment |
| A loop cannot hammer a host | New connections per address are rate-limited (`NEW_CONN_PER_MIN`, default 120) | `fw` environment |
| No real AI key and no spend | The AI engine talks to a local stand-in server (`fake-anthropic.js`) that keeps its own ledger of what it billed. `ANTHROPIC_API_URL` is honoured only when `NODE_ENV` is not `production` | the compose file |
| The application cannot damage its container | Read-only filesystem (only `/tmp`, 256 MB, is writable), non-root user, all capabilities dropped, `no-new-privileges`, 1 GB memory, 1.5 CPUs, 256 processes | the compose file |
| The database is throwaway | Postgres 16 on a memory filesystem, reachable only inside the sandbox network | the compose file |

The run proves these from inside before it uses them: it prints the user id, effective capabilities and read-only writes, and tries raw requests to hosts that are not allowed (including the cloud metadata address) and expects every one to be refused.

## What each phase checks

1. **The full test suite** with the environment blanked (the stub-based tests expect no database and no keys).
2. **The AI engine over real sockets.** The real Claude adapter, router, meter and job cost tracker talk HTTP to the stand-in server, which plays back scripted replies (a three-round lead, 429 with Retry-After, a dropped connection, a failure after paid rounds, an outage, a bad key, a reply cut at the token limit). Every scenario compares the engine's token accounting with the server's own ledger and counts requests, so a failure that wastes tokens shows as a difference.
3. **The register connectors against the real services.** Poland: the live canary and a lookup. Latvia: the real 129 MB daily file through the real loader into the sandbox database, then lookups, then a second run that must cost one request. The US register is skipped: it needs a declared identity.
4. **The report.** Bytes and packets that crossed the boundary per address, and how much the firewall refused.

## What it does not cover

- It does not use a real AI key, so it says nothing about real cost or answer quality.
- The firewall allows DNS to any resolver; a determined program could leak small amounts of data through DNS names. It is a test guardrail for our own code, not a containment for hostile code.
- Allowed hosts are allowed by address. A host that shares an address with another site (a CDN) lets that address through.
