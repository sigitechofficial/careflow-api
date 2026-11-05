# Late cancellation — billing (payment) part — plan

Date: 4 Nov 2026. Status: **built + end-to-end tested locally 4 Nov (uncommitted)**. Decisions: rule % (default 100), charge card rate for planned time, `billing.invoice_runs.manage` changes the decision, funded care only after finance sets Charge, run covering the visit date. Follows docs/SU_LATE_CANCELLATION_TIMEBANK_PLAN.md (timebank part, built).

## Verified today

- Invoice runs bill only VisitReconciliation rows with status APPROVED_FOR_INVOICE / APPROVED_FOR_BOTH (`invoice-runs.service.ts` L57-60, `calculate()` L2057-2365). Cancelled visits are never billed. Nothing in `src/billing` reads `ScheduledJobCancellation.chargeDecision`.
- The run does not price lines itself. It uses the reconciliation's stored `billableAmount`, which is priced in `VisitReconciliationsService.evaluateInternal()` with `chargeCardsService.resolveForServiceUser()` and `calculateBillableAmount()` (`visit-reconciliation.util.ts` L1117). That function covers day types, bank holidays and fixed slots.
- `InvoiceRunLine.visitReconciliationId` is **required**. The unique key is `[invoiceRunId, visitReconciliationId, serviceUserFundingId, lineType]`. `InvoiceRunLineType` = VISIT_CHARGE, ADJUSTMENT. ADJUSTMENT is never written.
- Double billing is blocked by `VisitReconciliation.includedInInvoiceRunId`, set in `lock()` (L2419-2461).
- The funding split is done by `buildFundingSplits()` / `splitAmount()` (`billing-run.util.ts`), and by per-funder charge cards when there are 2+ funders with a percent.
- Admin screens:
  - Invoice run detail lists service-user invoices but not their lines.
  - Lines are shown in Service user › Invoices › invoice › "Visits" table and in the run CSV/XLSX export.
  - Service user › Activity › Cancelled already shows "Billing" (charge decision).
- `chargeDecision` is written only when cancelling (`scheduled-jobs-housekeeping.service.ts`). There is no way to change it afterwards.

## Approach (backend)

**Recommended: a cancellation becomes its own invoice line.** It should not become a fake visit reconciliation, because reconciliations also feed carer pay, the timebank, ECM and the hours reports.

1. Schema (one hand-written, backward-compatible migration):
   - `InvoiceRunLine.visitReconciliationId` becomes nullable.
   - Add `InvoiceRunLine.scheduledJobCancellationId` (nullable FK).
   - Add enum value `LATE_CANCELLATION`.
   - Add a unique key on `[invoiceRunId, scheduledJobCancellationId, serviceUserFundingId]`.
   - On `ScheduledJobCancellation`, add `includedInInvoiceRunId` (lock) and `chargeAmount` / `chargeMinutes` / `chargePercent` / `chargeCardId`. These are a price snapshot taken when it is priced.
   - Existing rows are untouched.
2. Pricing: when a cancellation is saved with Charge (or later changed to Charge), price it with the same `resolveForServiceUser()` + `calculateBillableAmount()` for the planned start, planned minutes and day type, then × charge %. Store it on the cancellation. Re-price only while it is not locked.
3. Invoice run `calculate()`: also pick charged cancellations that are not reinstated and have the timebank marker, with `includedInInvoiceRunId` null and a visit date inside the period (earlier ones as "Late charge"). Apply the same cadence filter and the same funder split. Write `LATE_CANCELLATION` lines with the description "Late cancellation — {visit} · {notice}h notice · {percent}%".
4. `lock()`: also set `ScheduledJobCancellation.includedInInvoiceRunId`. Unlock / void clears it the same way it does for reconciliations.
5. Change billing decision: new endpoint `PATCH scheduled-jobs-housekeeping/jobs/:id/cancellation/billing`.
   - Requires a note and is written to the audit log.
   - Refused once the charge sits on a locked invoice.
   - Re-prices on Charge.
   - The timebank needs no change, because it reads the decision live.
6. Funded care (PENDING_REVIEW): never invoiced until finance changes it to Charge (step 5).

## UI (mockups shown in chat, 4 Nov)

- Service user › Invoices › invoice › Visits: new "Late cancellation" row with tag, planned time, "Cancelled · Xh notice · %", amount. Same line in the run CSV/XLSX export.
- Service user › Activity › Cancelled: "Billing" shows charge %, notice and invoice status (Not invoiced yet / On INV-x). New "Change billing decision" button (finance / managers; hidden when locked).
- New "Change billing decision" dialog: decision, required note, current suggestion shown.
- Invoice run detail: no layout change; totals include the new lines.

## Decisions needed

1. Amount: always 100% of the visit, or the % from the Job Cancellation rule (default 100%)?
2. Rate: the charge card rate for that visit's day/time and planned length (same as a delivered visit)?
3. Who may change the billing decision (which permission)?
4. Funded care: invoice only after finance changes it to Charge?
5. Which run: the run covering the visit date (earlier ones carried as "Late charge", like visits)?

Not verified: the invoice PDF / email template (if any) and how it lists lines.

## Build notes (4 Nov)

Changes from the plan:
- **Pricing happens in the invoice run, not at cancel time.** `addLateCancellationLines()` in `invoice-runs.service.ts` uses `ChargeCardsService.resolveForServiceUser()` and `calculateBillableAmount()` through `invoice-late-cancellation.util.ts`. The run line stores the amount, and lock freezes it. As a result, the separate `chargeAmount` / `chargeCardId` columns were not needed.
- `ScheduledJobCancellation.chargePercent` is saved when a visit is cancelled with Charge (rule %, else 100).
- A double-up is billed once per carer, the same way delivered visits are billed per carer.
- Changing the billing decision also updates the visit plan's cancelled date (VisitPlanSlotException, type SKIP), so both records match.

Migration: `20261122090000_su_late_cancellation_billing` (local DB backup `db-backups/careadmin-before-late-cancel-billing-20261104-1729.dump`). There is no drift on the changed tables.

End-to-end test (local, Edie Marsh, self-funded, week 2–8 Nov):

| # | Step | Result |
|---|---|---|
| 1 | New weekly invoice run 02/11–08/11 | 4 LATE_CANCELLATION lines: £16.50 (30m), £24.38 (45m), £24.38 (45m), £80.00 (2h 30m), each "· Xh notice · 100% (Private / Self-Funded)" — PASS |
| 2 | Service user › Invoices › INV-1030 › Visits | 4 rows tagged "Late cancellation", "Cancelled · Xh notice · 100%", amount — PASS |
| 3 | Activity › Cancelled | Billing "Charged · 100% · 22.1h notice", Invoice "On INV-1030 (being prepared)", button shown — PASS |
| 4 | Change billing decision → Do not charge (05/11 08:00) | Empty note blocked; saved; card shows No charge; timebank moves it back to short — PASS |
| 5 | Recalculate run | Line removed; net £161.76 → £137.38 — PASS |
| 6 | Approve + Lock | Run LOCKED; 3 charged cancellations get includedInInvoiceRunId; cards show "On INV-1030 (locked)", no button — PASS |
| 7 | API change on a locked charge | 400 "on a locked invoice … can no longer be changed" — PASS |
| 8 | Second run for the same week | 0 lines (no double billing) — PASS |

Local data left: INV-1012 (locked, 2–8 Nov, 19 service users' visits locked) and a second draft run for the same week (`2a970b3f…`, empty).

Not tested: an invoice PDF/email, multi-funder percent splits, a service user with no charge card (the code path writes an exception line), and a cancellation dated before the run period ("Late charge" prefix).

## Fix 5 Nov: reinstate blocked when the charge is on a locked invoice

Found in review: `reinstateJob` had no invoice check, so a visit whose late cancellation charge was on a locked invoice
could be reinstated, delivered and billed again on the next run (charged twice). Now the API refuses:
"Can't reinstate: the late cancellation charge is on locked invoice INV-…. Add an extra visit for that day instead, or
raise a credit with finance." The rota reinstate dialog shows it inline and disables the button.

Tested locally: PATCH reinstate on 2 visits with charges on locked INV-1030 → refused, both still CANCELLED; rota board →
right-click → Reinstate visit → message shown, button disabled; housekeeping tests 5 suites / 17 pass.
Not changed: a charge on a run still open (not locked) — reinstate is allowed; the run drops it when recalculated (same as
changing the billing decision).

## Scenario tests (5 Nov 2026, local) — guide `tester-guides/over-care-late-cancel-timebank-invoice.html`

| # | Run how | Result |
|---|---|---|
| B1 | Edie (self-funded) Midday 05/11 12:00, rota cancel, Client request, 4.7h notice | PASS — suggestion CHARGE 100% ("4.7 hours notice (under 24 hours) — charge 100% of the visit fee."), saved CHARGE + rule snapshot; timebank Chargeable cancellation +30m, not short |
| B2 | Edie Morning 07/11, 48.7h notice | PASS — NO_CHARGE suggested; 45m short (goes to the bank). Time-critical visit needs the welfare check ticked |
| B3 | Hospital admission, 4.7h | PASS — NO_CHARGE ("Hospital admission — no charge under the cancellation policy.") |
| B4 | Provider unable to staff | PASS — rules not applied (cancelled by AGENCY); the dialog's reason default is No charge |
| B5 | Arthur (LA funded), 5.2h | PASS — PENDING_REVIEW ("… commissioned — finance to confirm against the contract.") |
| B6 | Edie Afternoon 05/11 via Visit plan → Cancel visits, 9.2h | PASS — preview CHARGE 100%, saved CHARGE 100%, chargeable |
| B7 | Open run INV-1031 recalculated; then Change billing decision → No charge | PASS — 2 "Late cancellation … · Xh notice · 100% (Private / Self-Funded)" lines £16.50; empty note refused ("Add a note explaining the change"); after the change + recalculate the line is gone and 30m is short again |
| B8 | Change decision on a charge locked on INV-1030 | PASS — 400 "The charge is on a locked invoice (INV-1030) and can no longer be changed" |
| C1 | Reinstate a visit whose charge is on locked INV-1030 | PASS — refused with the message; visit stays CANCELLED |
| C2 | Reinstate the B1 visit (charge only on the open run) | PASS — reinstated (ALLOCATED); recalculate drops the line |

Test data left: Edie's 05/11 Afternoon cancelled (now No charge), 07/11 Morning cancelled (No charge), 05/11 Midday reinstated.
