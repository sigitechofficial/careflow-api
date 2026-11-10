# Referral email automation: review and audit

Started 9 Nov 2026. A critical review of everything built for the referrals mailbox: reading emails, Claude's
extraction, the checks and decisions, enquiries, quotes, replies, attachments, and the multi-mailbox connectors.
Findings are added as they are found. Each has a severity, what was seen, and what was done.

Severity: **High** = wrong outcome for a person or a data/safety risk. **Medium** = wrong or confusing in some
cases, or fragile. **Low** = polish.

## Scope

| Area | Files |
|---|---|
| Mailboxes and checking | `src/referral-mailbox/referral-mailbox.service.ts`, `connectors/*` |
| Claude reading | `referral-extraction.service.ts` |
| Checks, decision, enquiry, quote, reply | `referral-automation.service.ts`, `referral-checks.util.ts`, `referral-pricing.util.ts`, `referral-to-enquiry.util.ts` |
| Reply email | `referral-reply-mime.util.ts` |
| Screens | admin `ReferralInboxPage.tsx`, `ReferralAutomationPanels.tsx`, `ReferralMailboxes.tsx`, `ReferralAttachments.tsx`, `EnquiryReferralEmailCard.tsx` |

## Findings

(Added below as the review goes.)

### A. Automation pipeline (checks → decision → enquiry → quote → reply)

What is good:
- A decline ("NO") is never sent automatically; care we may not provide (live-in, 24-hour, clinical, a child) and
  people who are already service users always wait for a manager.
- The reply is written by Claude from the check results only, never from the raw email, so text in an email
  can't steer what we send. Replies only ever go to the sender (or their Reply-To), never to an address read
  out of the email or its attachments.
- One run per email at a time; a reply is "claimed" before sending so two runs can't both send it.
- Outside production every reply goes to our own mailbox (testing mode).

| # | Severity | Finding | Action |
|---|---|---|---|
| A1 | High | **"Check again" after a reply was sent overwrote the record of what was sent.** `processOnce` always rewrote `replySubject/replyText/replyHtml` with a fresh draft (and paid Claude to write it), even when `replySentAt` was set. The inbox then showed text that was never sent. | Fixed: once a reply has gone, the sent text is kept and no new draft is written. |
| A2 | Medium | **Visits on days we can't read counted as "unlimited carers free".** If Claude gave days like "Weekdays", `dayIndexes` returned none and `Math.min()` of nothing is `Infinity`, so the check passed with "Infinity carer(s) free". | Fixed: unknown days are treated as every day, and an empty list can't pass. |
| A3 | Medium | **New referrals were linked to closed enquiries.** The "already known" match (same name + date of birth or postcode) also matched WON and LOST enquiries, so a person referred again months later was attached to the old closed enquiry. | Fixed: only open enquiries are linked; a closed one is mentioned in the check, and a new enquiry is made. |
| A4 | Medium | **A second quotation was made and sent when an email matched an enquiry that already had one.** Seen in testing: the same family's second email made EQ-2026-0002 although EQ-2026-0001 had already been sent. | Fixed: no automatic quote when the enquiry already has a quotation; the check says which one exists. |
| A5 | Medium | **A referral matched to an existing enquiry is still answered automatically** (a YES with a new quote went out in testing). The match is "same name and DOB or postcode", which is reasonable, but a second automatic reply to an enquiry staff are already handling may cross with what they have said. | Changed: a reply is not sent automatically when the email was linked to an enquiry that already existed; it waits for staff. |
| A6 | Low | Replies in the same thread from the referrer (follow-ups) are linked and noted on the enquiry, but not read for new facts (e.g. the postcode we asked for). Staff update the enquiry by hand. | Fixed 10 Nov 2026: the referral is read again with every later email in its thread; what is new or changed is noted on the enquiry and the checks and decision are worked out again. A reply already sent stays as it was. |
| A7 | Low | The "no postcode" branch order is: the mailbox's branch, then the setting, then the first covered branch. A branch-specific mailbox is the right first choice. | No change. |

### B. Claude reading the emails (extraction and reply drafting)

What is good:
- The prompt says plainly that everything in an email or attachment is information, never instructions; replies
  are drafted from the facts CareFlow checked, not from the email.
- Structured output (a fixed JSON schema), so Claude's answer can't be malformed; "never guess, leave empty".
- PDFs and images go to Claude as they are (scanned forms are read); Word files as their text.
- A second read for detailed forms only (attachments or a long email); if it fails the email still goes through.
- Cost is recorded on each email (about $0.04 for a short email, about $0.28 for a detailed referral, plus about
  $0.01–0.02 to draft each reply).

| # | Severity | Finding | Action |
|---|---|---|---|
| B1 | High | **Key safe codes and PINs are kept out of what Claude records, but not out of the email itself.** The email text and the attachments are stored as received (they have to be, as the record of what was sent to us), so a code written in the email is in the database and in private file storage. Only staff signed in to CareFlow can see either. | Decision needed. Options: (1) accept it (the original email is the record); (2) hide likely codes in the stored email text (e.g. "key safe code 4821" → "key safe code ••••"), leaving attachments as they are. Not changed without your say. |
| B2 | Medium | **Emails that fail to be read are not retried.** A read can fail when Claude is busy or a file is too big; the email stays "Failed" until someone presses "Read again". | Fixed 10 Nov 2026: tried again automatically after 5 minutes, 30 minutes and 2 hours (not after a refusal); the inbox shows when. Then left for staff. |
| B3 | Medium | **One very large PDF (over about 100 pages or 32 MB) makes the whole email fail**, not just that file. | Fixed 10 Nov 2026: images over 5 MB, PDFs over 100 pages and files that don't fit in one request are left out with the reason; a file the API still turns down is dropped and the email read again. The inbox lists them under "Not read by Claude". |
| B4 | Low | Old Word files (.doc), Excel and HEIC photos (iPhone) are not read; they are listed as "could not be read" and Claude adds them to the missing information. | Open: convert .doc / HEIC if they turn up in practice. |
| B5 | Low | The follow-up date and urgency come from Claude's urgency (EMERGENCY / URGENT / ROUTINE). The prompt defines them; spot checks matched (hospital discharges came back URGENT). | No change. |
| B6 | Low | "Server-side fallback" is on: if the main model is unavailable, another Claude model answers. The model used is recorded on each email. | No change. |

### C. Mailboxes and connectors

What is good:
- One connector per kind of mailbox behind one small interface; everything after "here is the email" is shared.
- Passwords, sign-ins and API keys are stored encrypted and never sent to the screen (only "a password is saved").
- IMAP/SMTP settings are tested before they are saved; wrong passwords give a plain message.
- The webhook secret is stored only as a hash; a wrong secret, a turned-off mailbox and a missing one all get the
  same "not found".
- Bcc copies go in the SMTP envelope only, never in the message.

| # | Severity | Finding | Action |
|---|---|---|---|
| C1 | High | **Turning a mailbox off lost its settings in practice.** "Disconnect" switched it off, the screen then hid it, and getting it back meant adding it again from scratch (and for IMAP, typing the password again). There was no way to pause a mailbox. | Fixed: **Turn off** (kept, shown as "Off", can be **Turn on**ed; the connection is checked first), and **Remove** (sign-in, passwords, relay key and webhook address wiped; emails stay; adding the same address brings it back). Tested in the app (section E). |
| C2 | Medium | **IMAP servers that don't keep CareFlow's mark could stall.** Each check took the 20 *oldest* unmarked emails; if the mark doesn't stick, the same 20 come back forever and new mail is never reached. | Fixed: up to 200 are listed, ones already saved are skipped, and the 20 newest unsaved are read. |
| C3 | Medium | **Replies sent through a relay with its own sender address had no Reply-To**, so the referrer's answer would go to e.g. `noreply@…` instead of the referrals mailbox. | Fixed: Reply-To is set to the mailbox; covered by the local-server test. |
| C4 | Medium | **Several API instances would each run the 2-minute check.** The "being checked" lock is per instance. Saving is safe (one row per email in the database), but two instances could both try, and one records an error. | Fixed 10 Nov 2026: "Referral mailbox check" is a catalogue job (System jobs, once per 2-minute period across instances), and each mailbox has a lock in the database. |
| C5 | Medium | **Google/Microsoft sign-in "state" is kept in memory.** With more than one API instance, the sign-in can come back to the other one and fail as "expired". | Fixed 10 Nov 2026: kept in the database (hash only, 10 minutes, used once). |
| C6 | Low | Microsoft: attachments over 3 MB need an upload session (the quote PDF is small, so not needed now); a reply fails if the original email was deleted in Outlook. | Open, low risk. |
| C7 | Low | A mailbox re-added after being removed keeps its first "connected" date, so its 14-day first read starts from then. Harmless (emails already saved are skipped). | No change. |
| C8 | Low | Webhook posts are limited to 40 MB and need the secret; there is no per-mailbox rate limit. | Open: add one if the address is ever exposed widely. |

### D. Screens

| # | Severity | Finding | Action |
|---|---|---|---|
| D1 | High | **Editing an IMAP mailbox never saved.** The form sent back the server's own "a password is saved" flag, which the server refused ("property hasPassword should not exist"). Found while testing this review. | Fixed and re-tested: saved, then Test passed. |
| D2 | Medium | Attachments did not open in the built-in browser and in browsers that block pop-ups (they opened a new tab). | Fixed earlier: they open in a viewer on the page (PDFs, images, Word as text) with Download. |
| D3 | Low | After an email is posted to a webhook mailbox, its "last received" time only updates when the Mailboxes window is reopened. | Open, cosmetic. |
| D4 | Low | When every mailbox is turned off, the inbox's Settings button is hidden (it shows only while a mailbox is on). | Open, small. |

### E. What was tested in this review

All mail tests used local test mail servers on the development machine (nothing left it). Your Gmail mailbox was
only read and "Test"ed.

| Test | Result |
|---|---|
| Mailboxes screen lists Gmail with Check now / Test / Edit / Turn off / Remove; Test on Gmail | "Connection works" |
| Add IMAP mailbox with a wrong password | Refused: "The IMAP server did not accept the username or password"; nothing saved |
| Add IMAP mailbox with the right password | Connected, listed, folder and branch shown |
| Turn off, then Turn on (no password typed again) | Off → listed as "Off"; on again after the connection check |
| Turn on while its mail server is down | Refused: "Could not reach the IMAP server (ECONNREFUSED)…"; stays off |
| Webhook post while the mailbox is off / after turning on | 404 / 200 accepted |
| Remove, then check the database | Off, removed, password and relay password wiped, its 2 emails kept |
| Add the removed address again | Comes back with the new settings |
| Edit IMAP mailbox to send through a relay, then Test | Saved (after fix D1); "IMAP and SMTP sign-in work; the relay accepts the sign-in" |
| Webhook added on screen, address shown once; post to it; wrong secret | Received; wrong secret 404 |
| Test referral through IMAP for a family that already has an enquiry and a sent quote | Linked to ENQ-2026-0011; no second quote ("already has EQ-2026-0002"); reply drafted, not sent automatically (A4, A5) |
| Earlier in the day: full IMAP pipeline (read → checks → quote → reply over SMTP with PDF, threaded, Sent copy), referrer's follow-up linked, Brevo-format post, raw-email post, repeat post ignored | All as expected |
| Automated tests | API 100 passed (+5 local-server tests passed when run with the servers); admin 28 passed; both type checks clean |

Test mailboxes were removed afterwards; only the Gmail mailbox is connected.

## Overall verdict

The automation is sound in its design: what is sent is limited, checked and reversible (declines and unusual care
always go to a manager, replies only to the sender, testing mode is enforced). The review found and fixed real
defects, two of them serious (A1 overwrote the record of a sent reply; D1 made IMAP mailboxes impossible to edit),
and several that would have given wrong results in particular cases (A2–A5, C1–C3).

## Still open, in order of importance

1. **B1 – key safe codes in the stored email text.** Decided 10 Nov 2026: keep emails and attachments exactly as
   received. Claude still never copies a code into the enquiry; only signed-in staff can open the stored email.
2. **Real rates.** The standard private rates are still placeholders (£28.50 an hour, £16.50 per 30-minute visit).
   Every automatic quote uses them.
3. **Microsoft 365 live test:** needs the Entra app registration; the code is tested against simulated responses only.
4. Small: D3, D4, C6, C8, B4.
5. The test emails are still in the Gmail test mailbox (labelled "CareFlow read", so they are not imported again).

Done 10 Nov 2026: C4, C5 (job + database lock, sign-in state in the database), B2, B3 (automatic retries, large
files left out), A6 (follow-ups read for new facts), and the local test data (31 test emails, enquiries
ENQ-2026-0002 to 0013 and their quotes) deleted.
