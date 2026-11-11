# Running costs (figures from vendors' own pages, read 2026-11-11)

Only figures read on a vendor's official page are listed; the page showed no date, so check the page again before quoting a price to anyone. Taxes (for example India's GST on a foreign vendor's invoice) were not shown on any page and are not included.

## Server for one Docker host (API 2 GB, 4 GB host, 2 vCPU)

| Option | Per month | Notes |
| --- | --- | --- |
| DigitalOcean Droplet 4 GiB, Bangalore | 24 USD | daily backups of the whole server add 30 percent (7.20 USD) |
| AWS Lightsail Linux 4 GB, Mumbai | 24 USD | about 2 TB transfer in Mumbai; snapshots 0.05 USD per GB-month |
| Hetzner CPX22, Singapore | 26.99 EUR excluding VAT | not in India; cheaper Hetzner types are not offered in Singapore |

## Database

| Option | Per month | Notes |
| --- | --- | --- |
| PostgreSQL in the compose file on the same server (what `docker-compose.prod.yml` does) | 0 extra | we run it: updates, disk space and restores are ours; the app's encrypted backups plus the off-site copy are the safety net |
| DigitalOcean managed PostgreSQL 2 GiB, Bangalore | 30.45 USD | backups and standby price not shown on the page |
| Lightsail managed database 2 GB | 30 USD | availability of Mumbai and of PostgreSQL 16 not checked |

## Total for the first months

- Single server with the database in the compose file: 24 USD, or 31.20 USD with daily server backups, plus the off-site bucket (price not read).
- Server plus managed database: about 54 to 62 USD.

## E-mail

| Service | Price | Notes |
| --- | --- | --- |
| Resend | free: 3,000 a month, 100 a day; Pro 20 USD for 50,000 | custom domains included on free |
| Postmark | free: 100 a month; Basic 15 USD for 10,000 | |
| Amazon SES | 0.10 USD per 1,000 e-mails | no standalone free tier for new accounts |
| Brevo | not confirmed on its own pages | a search summary said 300 a day free and from 9 USD; read the pricing page first |

## AI

No fixed price: it depends on how many paid reports are produced. The cost of one paid report has not been measured (SHEL-60 needs a test key and a budget). Prices that were read: DeepSeek flash 0.15 USD per million input tokens (0.003 on a cache hit) and 0.6 per million output tokens, search and fetch 0.75 USD per 1,000 requests; Gemini search grounding 5,000 free requests a month on the newest models, then 14 USD per 1,000; the free Gemini tier allows 500 grounded requests a day on 2.5 Flash and may train on what it reads.

## Not priced

Domain renewal, the mailbox service for the shared company addresses, an off-site backup bucket, uptime monitoring, the lawyer and the tax adviser.
