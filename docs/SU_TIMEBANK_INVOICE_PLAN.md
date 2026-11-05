# Timebank hours on the weekly invoice (plan)

Status: BUILT 5 Nov 2026 (uncommitted), P1–P5 approved. Results in §6. Builds on the Timebank (`docs/SU_TIMEBANK_USE_PLAN.md`), late cancellation
billing (`docs/SU_LATE_CANCELLATION_BILLING_PLAN.md`) and over care (`docs/SU_OVER_CARE_ADJUST_PLAN.md`).

## 1. What exists today (verified)

| Fact | Evidence |
|---|---|
| A finished week puts `freeMinutes` (weekly hours − care counted) in the bank: cancelled with no charge (service user / agency / other), missed, called off, shorter, not approved, and weekly hours never put on the rota. | `src/service-user-hours/service-user-timebank.util.ts` `TimebankShortReason`, `computeTimebankWeeks` |
| Invoice runs bill `VISIT_CHARGE` lines (approved visit reconciliations), `ADJUSTMENT`, and `LATE_CANCELLATION`. Nothing from the timebank. | `prisma/schema.prisma` `InvoiceRunLineType`; `src/billing/invoice-runs.service.ts` |
| Charge card rules have a day type and time band; sleeping nights bill a fixed `SLEEP_IN` amount, waking nights an hourly night rate. | `ChargeCardRule`; `visit-reconciliation.util.ts` `calculateBillableAmount` |
| A sleeping night counts its full length in the weekly hours (e.g. 22:00–07:00 = 9h). | `visit-plan-weekly-hours.service.ts:227` |
| Bank use (`useTimebank`): a visit over the weekly hours takes the hours over from the bank (ledger RESERVED per visit). Five places call `cover`. | `visit-plan-weekly-hours.service.ts:442,561`; `service-user-visit-plans.service.ts:1905,3114,3669` |
| Payments are matched to an invoice (run + service user): UNPAID / PART_PAID / PAID per invoice, not per line. | `Payment`, `PaymentAllocation`; `invoice-runs.service.ts` ~L610 |
| A charge is locked with the invoice (late cancellation: `includedInInvoiceRunId`), so it is never billed twice. | late cancellation billing |

## 2. Decisions (user, 5 Nov)

| # | Decision |
|---|---|
| T1 | **All** bank hours of a finished week are charged on that week's invoice. |
| T2 | Hours with a visit (cancelled, missed, shorter…) are priced at that visit's own day and time on the charge card. Weekly hours never put on the rota (no time) use the charge card's **weekday hourly rate**. |
| T3 | A visit later paid from the bank is **not charged again**: the bank part is £0 with "Used Xh of the timebank hours from week … · already paid on INV-… · no charge". |
| T4 | Bank hours **cannot be used for night visits** (sleeping or waking): those go through the normal over-hours route and are billed at their own rate (the fixed sleep-in rate does not match hourly bank hours). |
| T5 | If a billed (locked) week's bank hours later go down (e.g. a visit approved later), the difference is a **credit line** on the next weekly invoice. |
| T6 | Setting "Charge timebank hours on the invoice", **default On**. |
| T7 | The timebank shows which bank hours are paid: **Not invoiced yet / Not paid / Paid**. Payment is recorded per invoice, so bank hours on an invoice count as Paid only when the whole invoice is paid (a part-paid invoice shows Not paid). |

## 3. My proposals — to confirm

| # | Proposal | Why |
|---|---|---|
| P1 | **Live safety:** only weeks starting on/after the day the setting is first on (set by the server, like over care) are charged. | With default On, the first invoice run after deploy would otherwise bill every service user's whole past bank. |
| P2 | A bank-paid visit is £0 only up to the **charged bank hours not used yet**. Bank hours from before the start day (never charged) are billed when used. | Else hours never paid for become free care. |
| P3 | Funded care: timebank lines split between funders like a visit. | Same as visits and late cancellations. |
| P4 | The weekly invoice takes the bank hours of the weeks it covers that are finished. A week not finished yet waits for the next run. | Bank hours exist only for finished weeks. |
| P5 | The timebank's "Over contract" / over care are unchanged; chargeable cancellations stay billed as late cancellations (never in the bank, so never twice). | No overlap. |

## 4. Build

API
1. Settings `chargeTimebankOnInvoice` (default true) + server-set `chargeTimebankFrom`.
2. Migration: line type `TIMEBANK_HOURS`; table `ServiceUserTimebankCharge` (service user, week, minutes, amount, invoice run, locked) — one locked row per service user per week; credits as negative rows.
3. Invoice run: add `TIMEBANK_HOURS` lines per short visit / not-booked hours (T2), funder splits (P3); on lock, record the week as charged; recalculate drops/redoes open lines; a lower bank after lock → credit line next run (T5).
4. Visit lines: the bank-paid part of a visit is £0 up to charged-and-unused bank minutes (T3, P2).
5. Bank use: `cover` refuses sleeping/waking night visits (T4) in all five places.
6. Timebank: bank hours by payment status (T7).

Admin
1. Settings → Dom Rules toggle (+ hint).
2. Invoice views (run preview, service user invoices): "Timebank hours (kept for later)" section and the £0 "paid from timebank" wording.
3. Timebank pages: bank hours split Not invoiced yet / Not paid / Paid.

## 5. Tests
All bank hours of a week billed once; rate per visit time and weekday rate for not-booked; funder split; lock then second run (no double); week reduced after lock → credit next run; bank-paid visit £0 with wording; bank hours from before the start day billed when used; sleeping/waking night never covered by the bank; setting off; payment status split on the timebank.

## 6. Results (5 Nov 2026, local)

Files: API `src/billing/invoice-timebank.service.ts` (+ spec), `invoice-runs.service.ts` (calculate + lock), `billing.module.ts`,
ledger `heldByJob`, timebank detail (`chargeTimebank`, `timebankCharges`), settings `chargeTimebankOnInvoice` / `chargeTimebankFrom`,
night visits never covered (`isNightDutyVisit` in weekly hours checks, generate, plan amendment, extra visits), migration
`20261123090000_su_timebank_invoice`. Admin: Dom Rules toggle; service user invoice dialog rows "Timebank hours" / "Paid from
timebank"; SU timebank page "Paid / Not paid / Not invoiced yet" per week and in the "In timebank" card.

Note vs the mockup: a visit paid from the bank keeps its normal visit line and gets a second line "Paid from timebank" with the
same amount as a minus, so the visit nets to £0 (the visit pricing code is not changed).

| Check | Result |
|---|---|
| Unit: setting off; first run only sets the start day; week charged in full not charged again; credit at the charged rate; bank-paid visit free only up to charged hours (60m of 90m held → £20 of £40) with wording; lock records split lines once | PASS (6) |
| Related suites (billing, timebank, visit plans, settings, specials) | 73 suites / 645 tests PASS |
| Local run 26/10–01/11 (start day set to 26/10 for the test): TIMEBANK_HOURS lines per short visit at its own day/time, funder name, "not booked" hours at the weekday rate; service users with no funding contract → exception lines £0 | PASS |
| Approve + lock → ServiceUserTimebankCharge CHARGED rows (Arthur 4h 30m £121.75, Doreen 9h £241.50, Edie 6h 51m £243.58, Peggy 6h £161.00); exception lines not recorded | PASS |
| Second run, same week → only the 4 uncharged exception lines again; charged weeks not repeated | PASS |
| Admin SU timebank (Edie): week 26/10 "Not paid · INV-1032"; card "Paid 0 · Not paid 6h 51m · Not invoiced yet 0" | PASS |
| Admin SU invoices → INV-1032 → View detail: 13 "Timebank hours" rows | PASS |
| Not tested end to end | PDF/email of the invoice (the rest: see §7) |

Local test data left: locked run (INV-1032 etc., week 26/10) with timebank charges, an open second run for the same week,
`chargeTimebankFrom` = 2026-10-26 in local settings. DB backup: db-backups/careadmin-before-su-timebank-invoice-20261105.dump.
Live: the first invoice run after deploy sets the start day to that day, so no past bank is charged.

## 7. End-to-end test, the parts unit-tested before (5 Nov 2026, local, Edie Marsh)

`useTimebank` set Yes for the test (back to No after).

| Check | Result |
|---|---|
| Extra visit preview, week at 795m of 960m, 200m visit on Sat 07/11: day 12:45 → 5m from the timebank; waking night 21:05 and sleeping night 21:05 → no timebank, `needsApproval` | PASS (T4) |
| Real extra visit 07/11 12:35–16:25 (230m) → 35m reserved from the bank; completed + approved for invoice (£138) → open run INV-1031 (02/11–08/11) recalculated: VISIT_CHARGE £138 + TIMEBANK_USED −£21.00 "Used 35m of the timebank hours already paid (INV-1032) · no charge" (35/230 of £138) | PASS (T3, P2) |
| Week 26/10 was charged 6h 51m £243.58 on locked INV-1032; its 30/10 Morning 45m visit then completed + approved → bank 366m → INV-1031 recalculated: TIMEBANK_HOURS −45m −£26.67 "Credit — timebank hours for the week of 26/10/2026 went down by 45m" (at the charged rate) | PASS (T5) |
| Admin: Edie → Invoices → INV-1031 → View detail shows the "Timebank hours" credit row and the "Paid from timebank" row; Dom Rules shows the new toggle | PASS |

Notes: the credit uses the rate the week was charged at (£243.58 / 411m), so it can differ a little from the price of the
visit delivered later (that visit is billed at its own rate). Minus amounts show as "£-26.67" (the existing money format).
Test data left: Edie's extra visit 07/11 (completed, approved), her 30/10 Morning visit completed + approved, open run INV-1031
recalculated with these lines.

## 8. Scenario tests (5 Nov 2026, local) — guide `tester-guides/over-care-late-cancel-timebank-invoice.html`

| # | Run how | Result |
|---|---|---|
| D1 | Locked run INV-1032 (week 26/10) | PASS — one line per missed visit at its own day/time rate, e.g. Doreen Fri £49.00 / Sat £54.00 / Sun £58.00 for 2h (double-up = per carer time), funder name added |
| D2 | — | Not run live (no finished, charged week has a no-charge cancellation yet); wording is the static label "cancelled by the service user (no cancellation charge)" |
| D3 | Edie's chargeable cancellations (B1/B6) | PASS — counted as Chargeable cancellation, not in the bank; billed only as Late cancellation lines |
| D4 | INV-1032 Edie | PASS — "week of 26/10/2026: 6m of weekly hours not booked on the rota" £3.20 at the weekday rate |
| D5 | Second run INV-1039, same week | PASS — only the 4 £0 "No active funding contract" exception lines; charged weeks not repeated |
| D6 | Margaret / Arthur week 26/10 visits completed after the lock → INV-1031 recalculated | PASS — credits at the charged rate: Margaret −6h −£161.00, Arthur −4h 30m −£121.75 (Croydon Council), Edie −45m −£26.67. Margaret's next invoice is −£161.00 on its own (her visits are not approved for invoice yet) |
| D7 | — | Not run (could not make a charged week's bank go up through normal screens) |
| D8 | Earlier today §7 | PASS (TIMEBANK_USED −£21.00). Retry today on Doreen not possible: a visit with no carer gets PAY_CARD_MISSING and the evaluation puts it back to PENDING_REVIEW even after a manager override (existing reconciliation rule, not this feature). Seen too: when a cancel brings the week within its hours, the ledger returns the hours ("Not needed: the week is within its weekly hours"), so the visit is billed normally |
| D9 | Unit | PASS (bank-paid visit free only up to charged hours) |
| D10 | Doreen extra-visit preview 06/11 21:15 | PASS — NONE: 60m from the bank; SLEEPING_NIGHT / WAKING_NIGHT: nothing from the bank, needs approval |
| D11 | Payments: Doreen £241.50 in full, Edie £100 of £243.58 | PASS — Doreen "Paid · INV-1035", card "Paid 9h"; Edie "Not paid · INV-1032" (part paid); George "Not invoiced yet 30m" |
| D12 | Setting No → recalculate → On again | PASS — no timebank lines while off. **Bug found + fixed**: after turning it on again the start day became today and already-charged week 26/10 lost its credits; charged weeks are now always credited while on (unit tests +2; live: 3 credits −£309.42 kept after off/on) |
| D13 | Live + unit | Start day set on saving On (05/11) and by the first run (unit); funder name on lines; £0 exception line for no funding contract. Multi-funder % split: unit only |

Open for the user (not changed): credits for a charged week while the setting is Off; the Paid / Not paid / Not invoiced yet split leaves out bank hours from before the start day (George: bank 5h, split shows 30m).
Tests: invoice-timebank spec 8, related suites 83 / 694 PASS, `tsc` clean.
Test data left: payments SCENARIO-D11-DOREEN (£241.50) and SCENARIO-D11-EDIE (£100) on run INV-1032; Doreen's 05/11 07:30 extra visit (15m from the bank, completed 5m, pending review); open run INV-1031 recalculated; start dates restored to 26/10; Use timebank = Yes.

## 9. Decisions 5 Nov (user: "ok fix karo")

1. **Setting Off still credits charged weeks.** Off charges nothing new, but a week already charged gets its credit when its timebank hours go down, and care paid from charged hours keeps its "Paid from timebank" line, so nothing is paid twice. Only service users with charged weeks are looked at while Off; the start date is not set while Off. Settings hint: "No: timebank hours are not on the invoice. Hours already charged are still credited if a charged week later has fewer, and are free when care is paid from them." Tests: spec 10 (2 new); live: Off → INV-1031 keeps the 3 credits (−£309.42); INV-1039 (second run for 26/10) has no timebank lines while Off (only Edie's normal visit charge), 4 exception lines again when On.
2. **"Before charging started".** On the SU timebank page a finished week from before the start day shows "Before charging started", and the In timebank card adds "· before charging started Xh (never invoiced)", so the split adds up to the bank. Live: George "Paid 0 · Not paid 0 · Not invoiced yet 30m · before charging started 4h 30m (never invoiced)".
