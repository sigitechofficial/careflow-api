# 02 — Change Log

Newest first. Audit IDs in brackets. Database detail is in `04-database-changes.md`.

---

## Gate B2 — employment wages, salary calculations and compliance foundations (2026-10-13)

Branch `payroll-remediation/gate-b2` in both repositories, on top of `gate-b`. Five migrations (doc 04, numbers 14 to 18), all additive. Nothing pushed or deployed. Summary: `12-gate-b-employment-wages-summary.md`.

### Behaviour changes people will notice

| Area | Before | Now |
|---|---|---|
| Training, on-call, overtime, rolled-up holiday that cannot be worked out | Left out of the pay run | A line on the run with the reason; the run lists what needs attention |
| A bank holiday with no calendar entry | Paid as an ordinary day | Carer pay held, with the day named and what to do |
| UK payroll run, per employee | Net pay and a reimbursement figure | Taxable wages, reimbursement within the approved amount, taxable excess, not verified, net wages, total payable |
| Mileage wrong after the run is locked | Corrected as wages (taxed) | Corrected as mileage, with a second approver |
| Pay agreements | Basis and date only; a salary could not be entered | Salary per year, month or week; contracted hours; how a part period is paid; what the salary pays for; guaranteed hours; history; end an agreement on a date |
| Putting a salary into effect | One person | A second person approves. **Give `payroll.pay_agreements.approve` to the people who approve agreements** |
| Salaried employee with visits | Salary plus every visit wage | The work the salary pays for is shown at £0.00 with its value, and not paid again |
| Salary for a starter, leaver or mid-period change | A whole period | Parts, each at its own salary |
| Salary changed after the run closed | No route | One adjustment line in the next run |
| Overtime in a week split between two pay runs | Each run on its own: usually nothing | Counted once, over the whole week |
| Guaranteed hours | Recorded, never paid | A top-up, only under an approved agreement that says the shortfall is paid |
| Time between visits | Paid as travel by its length | Still estimated by default, and the line says "estimated … not verified"; the office can record what the time was, and a second person approves |
| A cancelled visit | Nothing | Listed on the pay items page until someone records what is paid for it |
| Rolled-up holiday pay on a card | Everyone on the card | Held for an employee whose leave terms record regular hours; a note on the line where no terms are recorded |
| Minimum wage top-up | Per pay run | Per pay reference period (the UK payroll schedule period); a top-up for a low week can be reduced by later pay in the same period |
| Apprentices and minimum wage | Apprentice rate for everyone on an apprentice contract | Apprentice rate only under 19 or in the first year; **record the apprenticeship start date on the payroll profile** |

### Backend

- **Held earnings** (R-22, R-27): `HELD_EARNING` lines; `listHeldEarnings`; calendar pre-checks in pricing and in the pay run; `expectedBankHolidays`.
- **Mileage** (D-20, D-21): `mileage-ledger.store.ts`; system pay item `MILEAGE_CORRECTION`; `releaseHistoricReimbursement`; `payBreakdown` on the UK run.
- **Salary** (WM-02/03/09): `payroll/salary.util.ts` (timeline, proration, cover); `collectGross` rewritten for salary parts, cover and adjustments; `approveAgreement`; `unpaidAmount` / `unpaidReason` on UK input lines.
- **Weeks and periods** (WM-18, WM-07, Q37–Q39): one identity per employee and week or period (`OVERTIME:`, `GUARANTEE:`, `NMW:` claims) in `payroll-claim.util.ts`; whole-week and whole-period aggregation in `billing/payroll-runs.service.ts`; `nmw-period.util.ts`; `NmwPeriodAssessment`.
- **Travel and disruptions** (TR-01/04/05/06, Q13): `travel-intervals.*`, `visit-disruptions.*`; system pay item `DISRUPTION_PAY` (line type `CANCELLATION`).
- **Holiday** (Q35): `payroll/leave.*`.
- **Permissions**: `payroll.pay_agreements.approve` added to the powers an administrator role never implies, to the seeded role "Payroll Approver", and as its own responsibility `approve-pay-agreements`.
- **Audit actions** added for every new write: agreement approved; travel interval recorded / approved / rejected; disruption rule created / approved / retired; disruption recorded / decided / approved / rejected; leave terms created / approved; leave entry recorded; mileage correction recorded; historic reimbursement released.

### Frontend

- Pay run dialog: what needs attention (held earnings); line names for guaranteed hours and cancelled visits.
- Visit dialog: mileage correction card (settled visits); travel and waiting time card.
- Payroll employee dialog: pay agreements panel (replaces the two-field box); apprenticeship start date.
- UK run page: visit work paid by the salary; visit wages held for a salary decision.
- Pay items page: visits that did not go ahead as planned.

### New API routes

| Route | Permission |
|---|---|
| `GET /billing/payroll-runs/held-earnings` | `billing.payroll_runs.read` |
| `POST /billing/pay-items/mileage-corrections`, `GET …/mileage-corrections/:visitReconciliationId` | `billing.payroll_runs.manage` / `.read` |
| `POST /billing/employee-payouts/reimbursements/:runEmployeeId/release` | `billing.employee_payouts.approve` |
| `POST /payroll/pay-agreements/:agreementId/approve` | `payroll.pay_agreements.approve` |
| `GET /billing/travel-intervals/visit/:visitReconciliationId`; `POST /billing/travel-intervals`; `POST …/:id/approve`, `…/:id/reject` | `billing.visit_reconciliations.read` / `.manage` |
| `GET, POST /billing/visit-disruptions/rules`; `POST …/rules/:id/approve`, `…/retire` | `billing.payroll_runs.read` / `billing.pay_cards.manage` |
| `GET, POST /billing/visit-disruptions`; `GET …/undecided-cancellations`; `POST …/:id/decide`, `…/approve`, `…/reject` | `billing.payroll_runs.read` / `.manage` |
| `GET /payroll/employees/:id/leave`, `GET, POST …/leave-terms`, `POST …/leave-entries`; `POST /payroll/leave-terms/:id/approve` | `payroll.employees.read` / `.manage`; `payroll.pay_agreements.approve` |

### Set-up steps after upgrade

1. Apply migrations 14 to 18 (doc 04 section 00).
2. Run `node scripts/payroll-approval-permissions.mjs` (adds `payroll.pay_agreements.approve`; assigns it to nobody).
3. Give that power to the people who approve salary agreements and leave terms. They must not be the people who enter them.
4. Before entering any real agreement, rule or leave terms: obtain the client decisions in doc 05 section 2b.
5. Record apprenticeship start dates for apprentices of 19 or over, or they are checked against the rate for their age.
6. Make sure each paid employee has a UK payroll schedule with periods: those periods are the minimum wage reference periods.

---

## Gate B sprint — Gate A hardening, pay card correctness, mileage settlement (2026-10-12)

Branch `payroll-remediation/gate-b` in both repositories, on top of `gate-a`. Six migrations (doc 04, numbers 8 to 13), all additive. Nothing pushed or deployed.

### Behaviour changes people will notice

| Area | Before | Now |
|---|---|---|
| Double-up visits | Two carers finishing at the same moment could lose one carer's attendance evidence | Each carer has their own record; nothing is overwritten |
| A pay calculation that fails | Logged on the server; the visit simply had no pay | Shown on the reconciliation screen with a reason where one can be given; retry or dismiss with a reason |
| A carer with no employment record | Visit unpriced, no explanation | Visit held with "Carer pay cannot be priced: …"; the client charge is still priced |
| Approval after the evidence changes | Could stay in place | An automatic approval is re-checked; a person's approval goes back to review with the reason; paid visits are flagged, not changed |
| Branch-limited users | Organisation-wide pay screens were offered and showed errors | Hidden from the menu; opened by address they explain why they are not available |
| A visit just after midnight in summer | Fixed fee, sleep-in and travel rates of the previous day | The rate of the local day |
| Two pay cards for the same carers | The most recently edited card was used, silently | No card is used. The visit is held with both cards named until one is ended or the carer is given their own card. **Review the conflicts list before go-live** |
| Pay card form | No warning about overlapping cards | Warns, before saving, which cards overlap and which carers would be held. Saving is not refused |
| Carer paid differently for one funder | The client's funder today decided | The funder on the day of the visit decides; held for review where the funding records cannot say |
| Bank holidays screen | A list of dates | Also: which days are substitute days and for which date, which nation and year has gaps, the organisation's own special days, and the choice of which day is paid when a holiday falls on a weekend (default unchanged) |
| Mileage rates | Fixed in the code | Recorded per period; changed by a person with a reason; audited |
| Mileage across the 10,000-mile threshold | Could be missed inside one pay run | Split at the right mile, by journey date, per tax year from 6 April |
| Mileage in the carer's payment | Not included by this system | Paid once with net pay, shown apart from wages on the payout, the UK run and the payslip |
| Mileage and tax | Always outside taxable pay | Marked "tax treatment not verified" until HMRC's approved amounts are recorded; then any part above them is taxed as pay |

### Backend

| Commit | Audit | Change |
|---|---|---|
| `7f1fa95` | R-16 / VW-02 | Per-carer attendance verification rows with history; all writers go through one locked merge |
| `c5991ba` | R-17 / VW-03 | `PayEvaluationFailure`; resolver set-up gaps become held rows with the reason; list, retry, dismiss |
| `fa9b5b6` | R-18 / VW-04 | Approval source and approved evidence; outcomes keep / adopt / withdraw / require review / flag settled |
| `542a3ca` | R-13 / SI-10 | Exception queue by branch; tests of branch lists and organisation-only routes |
| `c769cf0` | PC-19 | Local-day classification in every pricing path |
| `ee5c6ff` | PC-32 | No card chosen on a same-level tie; `PayCardConflictException`; conflicts list and form check; locks on card changes and funder overrides; exception line in pay runs |
| `ffb1d66` | PC-10 | Funder as at the visit day for carer pay; held when the records cannot say and it matters |
| `43997d6` | PC-22, PC-23, PC-24 | Holiday calendar util and store; substitute days; organisation special days; completeness status; `holidayPremiumBasis` |
| `02597b8` | TR-09, TR-13 | `MileageRate`; miles and tax treatment on lines; taxable excess into UK gross; `reimbursementPayable`; payouts carry reimbursement once; reconciliation list; payslip |
| `0119fa4` | — | Migration rehearsal extended to the six new migrations (45 checks) |
| `9315a95` | R-11 | Browser fixture for the test database |

### Frontend

| Commit | Audit | Change |
|---|---|---|
| `cdf4b54` | R-17 | Failed pay calculations card on the reconciliation screen |
| `330d0ef` | R-18 | Who or what approved, and "evidence changed since" on the reconciliation dialog |
| `383f49f` | R-13 | Menu and ten pages adapt to a branch-limited user; exception queue takes the branch |
| `7d8c41c` | PC-32 | Conflicts banner on the pay cards list; warning in the pay card form; warning on the carer's pay card tab |
| `0bb7f02` | PC-22 to PC-24 | Bank holidays screen: status, substitute days, organisation days, weekend-holiday policy |
| `b36a61f` | TR-13 | Net pay and mileage shown apart, with the amount payable, on payout batches and UK runs |

### New API routes

| Route | Permission | Purpose |
|---|---|---|
| `GET billing/visit-reconciliations/evaluation-failures` | reconciliations read, branch | Pay calculations that failed |
| `POST …/evaluation-failures/:id/retry`, `…/dismiss` | reconciliations manage | Run again; dismiss with a reason |
| `GET billing/pay-cards/conflicts` | pay cards read, branch | Carers whose card cannot be decided today |
| `POST billing/pay-cards/conflict-check` | pay cards read, branch | Check a card as entered; nothing is saved |
| `GET billing/bank-holidays/status` | pay cards read | Calendar completeness and the weekend-holiday basis |
| `PATCH billing/bank-holidays/premium-basis` | pay cards manage | Change the basis, with a reason |
| `GET`, `POST billing/mileage-rates`, `PATCH …/:id/approved-amounts` | pay cards read / manage | Rates per period; HMRC approved amounts with their source |
| `GET billing/employee-payouts/reimbursements` | payouts read, organisation | Expenses per UK run employee: recorded, payable, in batches, outstanding |

### Set-up steps after upgrade

1. Apply migrations 8 to 13 in order (doc 04). All are additive; 13 is data only and can be run twice.
2. Open `GET billing/pay-cards/conflicts` (or the pay cards screen). Every carer listed will have visit pay held until one of the named cards is ended or the carer is given a card of their own (D-17).
3. Open the bank holidays screen. Import from GOV.UK for the current year onwards and resolve the gaps it lists; decide the weekend-holiday basis (D-13). Leaving it alone keeps what was paid before.
4. Have finance confirm the organisation's mileage rates and record HMRC's approved amounts for each tax year in use (`billing/mileage-rates`, D-15). Until then mileage is paid as before and reported as "tax treatment not verified".
5. Review `GET billing/employee-payouts/reimbursements`: expenses of UK runs calculated before the upgrade were never part of a payout from this system (D-20).

---

## Gate A sprint — recovery, attendance, access, corrections screen, statuses (2026-10-12)

Branch `payroll-remediation/gate-a` in both repositories. Two migrations (doc 04, numbers 6 and 7). Nothing pushed or deployed.

### Behaviour changes people will notice

| Area | Before | Now |
|---|---|---|
| UK payroll, cancel [R-08, PR-05] | A cancelled run kept hold of the pay lines it had collected; no other run could take them, so the earnings were stranded | Cancelling releases them and asks for a reason. The lines stay as a snapshot of the cancelled run. A replacement run collects each earning once. Cancelling is refused while a payout batch or a live FPS exists for the run |
| UK payroll, salary [R-08] | Two runs for one pay period could each take the same salary or deduction | One run per period holds it |
| Carer app, double-up [R-03, VW-02] | A time flag raised by one carer held every carer of the visit | Each carer is reviewed on their own evidence |
| Carer app, support carer [R-02, VW-02] | A support carer's finish time was used as sent, including when clocking out after the lead had closed the visit (future times included) | Same rules as the lead carer on all three completion paths; a late-reported finish is kept as evidence and held for the office |
| Office attendance correction [R-04, VW-15] | On a visit still in progress it wrote an event only | The time is recorded and becomes that carer's start or finish when the visit completes |
| Pay screens by branch [R-05, SI-10] | Anyone with a pay permission saw every branch | Pay runs, UK runs, payouts, pay items and settings need organisation-wide pay access. A branch user sees pay only for employees of their branches. Pay audit entries are hidden from branch users |
| Paid visit, client charge [R-07, VW-06] | Once pay was settled the overrun could not be decided at all | The charge side can still be decided ("charge only") and corrected; pay is untouched |
| Earnings status [R-06] | "Paid" for a visit in any run; "Bank paid" for a batch marked paid; a visit in a cancelled UK run still showed "In UK payroll" | One status from the server on every screen and in the carer app: in draft pay run, in locked pay run, in UK payroll (not closed), payroll processed, payment prepared / approved / recorded. A cancelled run holds nothing |
| Earnings totals [R-06] | Visits settled directly by a closed UK run were in neither "paid" nor "remaining" | Counted as settled |
| Pay corrections [R-01, VW-22] | API only | "Pay corrections" on the visit reconciliation dialog and on the employee Earnings and Salary tabs: original → corrected → difference, record, approve or reject by a second user, reverse once, history with status |
| Paid visit dialog | Mileage and manual pay could be typed, then refused on save | Disabled once pay is settled, with a pointer to pay corrections |
| Roles screen [R-12, SI-15] | Admin roles shown as always holding the approval job, and not choosable | "Pay authorisation — who can do it today": users behind each power, a warning when nobody can approve, close or settle, or when the only approver is the only preparer. Admin roles are a choice for the approval job |
| Roles screen, pay jobs [R-05, R-12] | — | "Approve pay", "Create payroll" and "Carer pay & payouts" now carry organisation-wide pay access with them |
| Payouts [R-09, PR-20] | "Bank paid" | "Payment recorded manually — not confirmed by a bank". The API reports `paymentState`, `settlementSource`, `settlementConfirmed` |
| Pay run export [found by EL-09 test] | A carer's total hours counted the visit again for every top-up or mileage line attached to it (1 hour shown as 2) | Only the visit pay line carries visit time. Amounts were already right |

**Effect on existing figures.** No stored amount changes. Earnings stranded by a UK run cancelled before the upgrade become collectable again after migration 6. Run exports produced from now on show lower "total hours" where a carer had top-up or mileage lines.

### Setup after deploying this sprint

1. Apply migrations 6 and 7 (doc 04, section 7).
2. Run `node scripts/payroll-approval-permissions.mjs` again: it adds the permission `payroll.scope.organisation` and gives it to the Payroll Approver role.
3. On Settings → Roles & permissions → Responsibilities, tick the roles that prepare pay ("Create payroll", "Carer pay & payouts") again, so they receive organisation-wide pay access. Until then a non-admin role with those jobs shows as "part of the job" and gets "organisation-wide pay access is needed" on pay runs.
4. Assign the approval job to at least one person who does not prepare pay (decision D-01). The screen warns until this is done.

### Backend (`careadmin-backend`)

| Commit | Content |
|---|---|
| `748aedd` | R-08: claim keys on UK payroll input lines; cancel releases; salary and deduction claims per period; conditional close / cancel; reactivate starts from enrolment. Migration 6 |
| `2de38d7` | R-02, R-03, R-04: per-carer time trust record; support-carer completion uses the trust rules; office times on open visits; HTTP test harness (`test/payroll-int/http-harness.ts`) |
| `0d9d9c0` | R-05, R-10: `PayrollScopeGuard` and `@PayrollScope` on eight controllers; pay audit entries hidden from branch users; permission `payroll.scope.organisation`; `http-payroll-api.int-spec` |
| `d4cd104` | R-07: charge-only overrun decision and charge corrections on settled visits |
| `1085a80` | R-06: `earning-status.util`; earnings and salary queries; cancelled runs excluded; UK-settled visits in settled totals |
| `3a2691d` | R-01: correction history with display status, names, reversal state, `canRecordCorrection`; `paySettled` on earnings rows |
| `5ea70f2` | R-12: `financial-authority.util`, `GET /role-responsibilities/financial-authority`, `adminRoleOptions`; job `scope` keys so saving one pay job does not strip access from another |
| `8e058db` | R-09: `payment-state.util`; `settlementSource`. Migration 7 |
| `205b066` | PC-21, PC-02, EL-09 regression specs; export hours fix |
| `cf15563` | `scripts/payroll-migration-rehearsal.mjs` |
| `60e5aa0` | `e2e-gate-a.int-spec`; support carer clocking out after the lead (`refreshAfterLateClockOut`) |
| `d2c0a31`, `18c8291`, `c53dd9a` | `paySettled` on reconciliation detail; `scripts/payroll-test-server.mjs`; test fixes |

New API surface: `GET /role-responsibilities/financial-authority`; `POST /payroll/runs/:id/cancel` accepts `{ reason }`; `POST /billing/visit-reconciliations/:id/overrun/approve` accepts `applyTo: 'CHARGE'` on a settled visit; `GET /billing/pay-items/visit-corrections/:id` returns `visit`, `originalAmount`, `netAmount`, `differenceAmount`, `canRecordCorrection` and per-item `displayStatus`, `canReverse`, names; earnings rows carry `earningStage`, `earningStageLabel`, `earningPhase`, `correctionState`, `correctionAdjustmentValue`, `paySettled`; payout batches carry `paymentState`, `paymentStateLabel`, `settlementSource`, `settlementConfirmed`. Existing fields are unchanged (`paymentState` on earnings rows keeps its values for the carer app).

Responses that changed for some users: pay endpoints now return 403 ("organisation-wide pay access is needed") or 404 (employee outside the user's branches) where they used to return data.

### Frontend (`care-admin`)

| Commit | Content |
|---|---|
| `6226ebc` | UK run: cancel asks for a reason |
| `df7c20f` | Earnings and Salary tabs use the server's earning stage (`features/employees/lib/earning-stage.ts`) |
| `8930ce0` | `VisitPayCorrectionsCard` and dialog; hooks and API calls for corrections and reversals |
| `6f7d49f` | `FinancialAuthorityCard`; admin-role choice for the approval job |
| `1d27924` | Payout wording |
| `4130cf8`, `01da8a2` | PC-02 component test; settled visit not editable in place; `scripts/payroll-test-preview.mjs` |

### Tooling

- `npm run payroll-migration-rehearsal` (backend): migrations on a synthetic historical database.
- `node scripts/payroll-test-server.mjs` (backend) and `node scripts/payroll-test-preview.mjs` (frontend): the application on ports 3101 / 5174 against the payroll test database, for browser checks with synthetic data. Two entries were added to the workspace `.claude/launch.json` for them.

---

## Phases 1.1, 1.3 and 4.1 — fixes that needed no policy decision (2026-10-12)

Branch `payroll-remediation/phase-1`. No database change.

| Area | Before | Now |
|---|---|---|
| Time bands [PC-21] | A band ending 23:59 stopped one minute before midnight. A Sunday visit running past midnight came back "rate missing"; the last minute of a bank holiday was paid at another rate | An end of 23:59 (or no end) is the end of the day. Applies wherever the shared matcher is used: banded pay and the single-rule paths in visit reconciliation, which also select charge rules |
| Pay card screen [PC-02] | A rule set to "Custom…" could not be saved, and a card that already held a custom-period rule could not be saved either | Saves |
| Visit pay run total [EL-09] | Gross pay included the minimum wage top-up twice | Gross pay equals the sum of the run's lines |

**Effect on existing figures.** Visits already priced keep their stored amounts. A visit priced from now on that crosses 23:59 on a band ending 23:59 is paid for that minute at the band's rate. Run totals calculated from now on are lower by exactly the top-up where one applies; locked runs are not recalculated.

Files: `billing/pay-time-band.util.ts` (+`pay-time-band.all-day.spec.ts`), `billing/payroll-runs.service.ts`, `test/payroll-int/minimum-wage.int-spec.ts`; frontend `BillingCardRulesEditor.tsx`.

---

## Phase 0 — financial safety (2026-10-12)

### Behaviour changes people will notice

| Area | Before | Now |
|---|---|---|
| Visit pay runs | Two runs could hold and pay the same visit | A visit, pay item or activity sits in one run. The second run leaves it out and says how many were held |
| Visit pay runs | Approve and lock by anyone with `billing.payroll_runs.manage`, including the creator | Approve and lock need `billing.payroll_runs.approve`; the approver must not be the creator |
| Visit pay runs | No way to remove a draft run | Discard (unlocked runs only) |
| Visit pay runs | An approved run could not be recalculated | It can; that withdraws the approval |
| Locked visits | Could be repriced, re-approved, edited or deleted | Pay cannot change. Use a pay correction |
| UK payroll | Close by anyone with `payroll.runs.manage` | Close needs `payroll.runs.close`, by a different user from the creator. Reopening a closed run needs `payroll.runs.reopen` |
| UK payroll | A visit paid provisionally could be collected again | Closing claims the visit; nothing can pay it again |
| Payouts | Created from a run that was only tax-calculated | Closed runs only |
| Payouts | Monthly job approved and marked batches paid | Job proposes a DRAFT batch. A person approves; another step records the bank payment |
| Payouts | "Mark paid" was one click | Needs payment reference and payment date |
| Carer app | Start and end sent by the app were used as given | Server check-in is the start. A reported time the server cannot corroborate holds the visit for approval |
| Office attendance correction | Wrote an event only | On a completed visit it updates the times and pay follows |
| Delete-all / purge / reset | Available with ordinary manage permissions | Off unless the server is non-production with `ALLOW_FINANCIAL_TEST_RESET=true`, and the user holds `billing.financial_reset` |
| Super Admin | Passed every permission | Does not pass the six financial powers or `audit_logs.delete` unless a role lists them |
| Manual payable amount | Allowed with `employees.update` | Needs `billing.visit_reconciliations.manage` |

### Setup needed after deploying Phase 0

1. Apply the five migrations (doc 04).
2. Run `node scripts/payroll-approval-permissions.mjs` (or the seed on a new database). It adds the permissions and an unassigned **Payroll Approver** role.
3. Give that role (or the "Approve pay and record payments" responsibility) to the people who approve pay. They must be different people from those who prepare runs.
4. Leave `ALLOW_FINANCIAL_TEST_RESET` unset in production.

Until step 3 is done nobody can approve or lock a pay run, close a UK run, approve a payout or record a payment. That is intended.

### Backend (`careadmin-backend`)

**New files**
- `src/billing/payroll-claim.util.ts` (+spec) — claim keys.
- `src/billing/pay-settlement.util.ts` (+spec) — "pay settled", snapshot fields, correction difference.
- `src/billing/financial-controls.util.ts` — maker / checker, reset environment check.
- `src/common/guards/explicit-grant-permissions.ts`, `payroll-approver-role.ts`, `permissions.guard.spec.ts`.
- `src/visit-attendance/visit-time-trust.util.ts` (+spec) — attendance time trust.
- `scripts/payroll-test-db.mjs`, `scripts/payroll-approval-permissions.mjs`.
- `test/jest-payroll-int.json`, `test/payroll-int/*` — harness and nine integration suites.

**Changed**
- `billing/payroll-runs.service.ts`, `.controller.ts` — claims, atomic calculate, lock checks, discard, maker / checker, audit [SI-01, SI-02, SI-03, SI-08, SI-07, SI-15].
- `payroll/payroll-runs.service.ts`, `.controller.ts` — provisional visit claims, close / reopen controls, reset gate [PR-05, PR-13, SI-06, SI-15].
- `billing/visit-reconciliations.service.ts`, `.controller.ts` — settled-pay guards, removed-carer handling, attendance correction, unverified-time exception, pricing extracted to `priceCarerPay`, audit [VW-23, SI-05, VW-11, VW-15, VW-02, SI-07, VW-25].
- `billing/pay-items.service.ts`, `.controller.ts`, `dto/pay-items.dto.ts` — visit corrections, reversal, history [VW-22, PR-22].
- `billing/employee-payouts.service.ts`, `.controller.ts`, `dto`, `employee-payout-auto.job.ts` — draft-only job, settlement evidence, maker / checker, audit [SI-09, PR-18, PR-20].
- `billing/invoice-runs.service.ts`, `.controller.ts`, `payroll/payroll-settings.service.ts`, `.controller.ts`, `audit-logs/audit-logs.service.ts` — reset gate [SI-06].
- `ecm/ecm-manual-attendance.service.ts`, `ecm.module.ts` — carries office corrections into pay [VW-15].
- `employee-app/employee-app-visits.service.ts` — trusted completion times [VW-02].
- `common/guards/permissions.guard.ts` — explicit-grant permissions [SI-15].
- `role-responsibilities/*` — "Approve pay and record payments" responsibility.
- `audit-logs/enums/audit-action.enum.ts` — 19 new actions.
- `prisma/schema.prisma`, `prisma/seed.ts`, `package.json`.

**New API**
| Method | Path | Permission |
|---|---|---|
| DELETE | `/billing/payroll-runs/:id` | `billing.payroll_runs.manage` |
| POST | `/billing/pay-items/visit-corrections` | `billing.payroll_runs.manage` |
| GET | `/billing/pay-items/visit-corrections/:visitReconciliationId` | `billing.payroll_runs.read` |
| POST | `/billing/pay-items/:id/reverse` | `billing.payroll_runs.manage` |

**Changed API contracts**
| Path | Change |
|---|---|
| `POST /billing/employee-payouts/:id/mark-paid` | Body required: `paymentReference`, `settledOn`, optional `settlementEvidence`. Permission `billing.employee_payouts.settle` |
| `POST /billing/employee-payouts/:id/approve` | Permission `billing.employee_payouts.approve` |
| `POST /billing/payroll-runs/:id/approve`, `/lock` | Permission `billing.payroll_runs.approve` |
| `POST /billing/payroll-runs/:id/calculate` | Response adds `heldByOtherRuns`; allowed from APPROVED |
| `POST /payroll/runs/:id/close` | Permission `payroll.runs.close` |
| `POST /payroll/runs/:id/reactivate` | Closed runs need `payroll.runs.reopen` |
| `POST /billing/visit-reconciliations/:id/payable-amount` | No longer accepts `employees.update` |
| Delete-all / purge / reset routes | Permission `billing.financial_reset`; refused unless the environment allows |
| `POST /ecm/visits/:jobId/manual-attendance` | Response adds `pay` (what happened to carer pay) |

### Frontend (`care-admin`)
- `EmployeePayoutBatchDetailDialog.tsx` — "Record bank payment" form; separate approve / settle powers.
- `BillingPayrollRunsPanel.tsx` — recalculate, approve, lock, discard with messages; held-visits warning.
- `UkPayrollRunDetailPage.tsx` — close / reopen powers.
- `auth/store.ts`, `roles.ts`, `types.ts` — explicit-grant permissions.
- `employee-payouts.api.ts`, `payroll-runs.api.ts`, `usePayrollRuns.ts`, page wording.

### Compatibility
- All schema changes are additive. Existing rows are not deleted or rewritten except the two backfills in doc 04.
- Old carer-app builds keep working: reported times are still accepted, now with review rules.
- Existing pay cards, rates and pricing results are unchanged.
