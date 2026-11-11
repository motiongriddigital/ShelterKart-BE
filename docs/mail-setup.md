# Mail setup

The back end sends four kinds of e-mail: sign-in codes, the finished report, the payment receipt and operator alerts. All go through one sender chosen by `DELIVERY_EMAIL_PROVIDER` (resend, postmark or brevo); if it is empty, the first provider that is fully configured is used.

| Provider | Settings | Notes |
| --- | --- | --- |
| Brevo | `BREVO_API_KEY`, `DELIVERY_FROM` | transactional API at api.brevo.com/v3/smtp/email |
| Resend | `RESEND_API_KEY`, `DELIVERY_FROM` | |
| Postmark | `POSTMARK_SERVER_TOKEN`, `DELIVERY_FROM`, optional `POSTMARK_STREAM` | |

`DELIVERY_FROM` is `Name <address>` or a bare address, on the authenticated sending domain. `PUBLIC_BASE_URL` is the address used in links. `OPS_ALERT_EMAIL` is where operator alerts go.

Free-tier limits and prices change: read the provider's own pricing page before choosing (daily caps matter for sign-in codes on a busy day).

## Sending domain

Send from a subdomain such as `mail.shelterkart.com`, not the main domain, so a sending problem cannot hurt the company's ordinary mail.

1. In the provider, add the sending domain. It shows the DNS records to create.
2. At whoever controls the DNS for shelterkart.com, create exactly those records: the DKIM key(s) the provider names, and the SPF include for the provider. One SPF record per name: if one already exists, extend it, never add a second.
3. Add a DMARC record at `_dmarc.shelterkart.com`, starting with `v=DMARC1; p=none; rua=mailto:<a mailbox that is read>`. After two weeks of clean reports raise it to `p=quarantine`.
4. In the provider, press verify. Send a test through `POST /api/auth/request-code` to an address you control and read the message headers: SPF, DKIM and DMARC should all say pass.
5. Check `GET /api/admin/delivery` shows the provider, and `GET /api/admin/readiness` shows `mail.ready: true`.

## Mailboxes

Receiving mail is a different service from sending it. Use an ordinary mailbox provider for the company domain (the client chooses) and create at least: `research@` (the SEC identity, read daily), `support@`, `grievance@` (the Grievance Officer named on the site), `corrections@` (promised in the privacy policy and every report), `legal@`, and `no-reply@` (sender only; replies go nowhere). Set `SEC_USER_AGENT` to `ShelterKart Research research@shelterkart.com` only after `research@` exists and is read.

## Before the first real send

- A new sending domain starts with no reputation: send first to a few real addresses, not a list.
- Bounces and complaints are shown in the provider's dashboard; watch them for the first week.
- Never put the API key in chat or e-mail: put it in the host's secret settings.
