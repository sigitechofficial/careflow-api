# Referral mailboxes: more than one, from any provider

Status: plan agreed 9 Nov 2026; built and tested in the same piece of work.

## What we have today

- One active mailbox, Gmail only (Google sign-in, Gmail API).
- Reads one label, marks each email with "CareFlow-read", replies through the same Gmail account in the same thread.
- Everything after "here is an email with attachments" (Claude reads it, checks, enquiry, quote, reply text) does not care where the email came from.

## Goal

Any number of mailboxes, each from any of these:

| Connector | Covers | Reads with | Sends with | New mail seen |
|---|---|---|---|---|
| Gmail | Gmail, Google Workspace | Gmail API (Google sign-in) | Gmail API | 2-minute check |
| Microsoft 365 | Outlook, Microsoft 365, GoDaddy "Microsoft 365" | Microsoft Graph (Microsoft sign-in) | Graph `sendMail` (MIME) | 2-minute check |
| IMAP / SMTP | cPanel, GoDaddy Workspace Email, Zoho Mail, IONOS, Yahoo, most hosts | IMAP (password, stored encrypted) | SMTP + copy put in the Sent folder | 2-minute check |
| Inbound webhook | Brevo inbound parsing; any service that can POST the raw email | The service posts each email to CareFlow | A "send through" relay (below) | Instantly |

"Send through" (optional, any mailbox): send replies through an SMTP relay instead of the mailbox itself.
One SMTP setting covers ZeptoMail (`smtp.zeptomail.com`), Brevo (`smtp-relay.brevo.com`), SendGrid, Mailgun, Postmark.
Needed for the inbound webhook (it can't send); optional for the others.

## Design

### Data

`ReferralMailbox` gains:
- `provider`: `GMAIL | MICROSOFT | IMAP | INBOUND_WEBHOOK`.
- `displayName`: what staff call it ("Hammersmith referrals").
- `defaultLocationId`: branch to use when the email gives no postcode (falls back to the setting that exists today).
- `encryptedRefreshToken` becomes optional (OAuth only).
- `encryptedSecret`: IMAP password, or the webhook's Brevo API key (to download attachments). Encrypted, never returned.
- `config` (JSON, no secrets): IMAP/SMTP host, port, security, username, Sent folder; webhook format.
- `webhookTokenHash`: SHA-256 of the secret in the webhook address. The address is shown once.
- `sendVia`: `MAILBOX | SMTP_RELAY`; `relayConfig` (JSON) + `encryptedRelaySecret`.
- `lastConnectedAt`.

Several mailboxes can be active. Connecting Gmail no longer switches the others off.

### Connectors

One small interface, one class per provider (`src/referral-mailbox/connectors/`):

```
list new emails (not yet marked)       → ids
fetch one email                         → raw MIME (or parsed parts for Gmail)
mark as read by CareFlow                → label / category / IMAP keyword
reply headers for an email              → Message-ID, References, Reply-To
send a reply (raw MIME)                 → provider message id, copy kept in Sent
test the connection                     → ok / error message
```

Raw MIME from IMAP, Graph (`$value`) and webhooks is parsed with `mailparser` into the same shape Gmail gives today,
so saving attachments, threading and follow-ups are written once.

Threads: Gmail keeps its thread id. Others use the conversation root: the first id in `References`, else
`In-Reply-To`, else the email's own `Message-ID` (Microsoft: `conversationId`).
A referrer answering our reply lands in the same thread, so it is linked as a follow-up, as with Gmail today.

Marking as read:
- Gmail: "CareFlow-read" label (today).
- Microsoft: "CareFlow read" category (visible in Outlook).
- IMAP: `$CareFlowRead` keyword; where the server doesn't keep keywords, the database record stops it being saved twice.
- Webhook: nothing to mark.

Only mail from the last 14 days before the mailbox was connected is read the first time (an IMAP Inbox can hold years).

Sending:
- Bcc is never written into the message for SMTP; it goes in the envelope only.
- SMTP: a copy is appended to the Sent folder so staff see it in their mail client.
- Testing mode is unchanged: outside production every reply goes to the mailbox itself (and the allowed copy addresses).

### Checking

- The 2-minute check goes through every active polled mailbox (Gmail, Microsoft, IMAP), one at a time, each with its own error.
- "Check now" checks all, or one.
- Webhook mailboxes are not polled.

### Inbound webhook

`POST /api/referral-mailbox/inbound/:mailboxId/:token`. No login; the token is the secret, compared against its hash.
Accepts:
1. Brevo inbound parsing JSON (`items[]`, attachments downloaded with the Brevo API key).
2. Raw email (`Content-Type: message/rfc822`), or JSON `{ "raw": "<base64>" }` (SendGrid "raw", Cloudflare Email Workers, Mailgun `body-mime`).

Needs CareFlow on a public HTTPS address in production; tested locally by posting to it.

### Microsoft sign-in

Entra app registration (any organisation + personal accounts), delegated scopes
`offline_access User.Read Mail.ReadWrite Mail.Send`. Settings: `MICROSOFT_OAUTH_CLIENT_ID`,
`MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_REDIRECT_URI`, optional `MICROSOFT_OAUTH_TENANT` (default `common`).
The folder to read is found by name anywhere in the mailbox (default "Referrals").

### Screens

Referral inbox → Mailboxes:
- list of mailboxes: name, address, provider, branch, last checked, last error; Check now; Edit; Disconnect;
- "Add mailbox": Gmail (sign-in), Microsoft 365 (sign-in), IMAP/SMTP (form with "Test connection"),
  Inbound webhook (shows the address to paste into Brevo once);
- per mailbox: folder/label, branch, "Send replies through" (mailbox itself or SMTP relay, with a test).
- The inbox list shows which mailbox each email came to when there is more than one.

## Testing

| What | How |
|---|---|
| Multiple mailboxes, checking, follow-ups | Gmail (existing) + a local IMAP server at the same time |
| IMAP read, keyword, thread, attachments, Sent copy | GreenMail (local test mail server in Docker), real IMAP/SMTP |
| SMTP relay "send through" | Same local SMTP server as the relay |
| Inbound webhook | Post a Brevo-format JSON and a raw email to the local endpoint |
| Microsoft Graph | Unit tests against recorded Graph responses (no Microsoft tenant here); live test needs the app registration |
| ZeptoMail / Brevo live | Needs their keys; the code path is the SMTP relay tested above |
| Everything after the email (Claude, checks, enquiry, reply) | One short test referral through each connector |

## Not in this piece

- Instant push for Gmail (Pub/Sub) and Microsoft (Graph subscriptions) — both need a public address.
- Microsoft "shared mailboxes" (works later with `Mail.ReadWrite.Shared`).
