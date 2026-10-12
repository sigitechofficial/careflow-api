# 09 — End-to-End Validation

**Run:** 2026-10-12, local machine, payroll test database (`<dev database>_payroll_test` on localhost) · backend `c53dd9a`, frontend `01da8a2`

Everything here uses synthetic employees, service users, visits and payments. No real employee, no HMRC submission, no bank payment. The tests check database rows and API responses, not only helper functions.

---

## 1. The synthetic month

`test/payroll-int/e2e-gate-a.int-spec.ts` builds one dataset and walks it through November 2026 in thirteen ordered steps over HTTP. **Result: 13 of 13 passed.**

```bash
npx jest --config test/jest-payroll-int.json test/payroll-int/e2e-gate-a.int-spec.ts
```

| Required in the dataset | In the test |
|---|---|
| At least two carers | Ann (branch A), Ben (branch B) |
| One salaried worker | Sam, pay agreement £36,525 a year |
| Two branches | TEST Branch A, TEST Branch B |
| At least two payroll users with separate responsibilities | Preparer, second preparer, approver (holds only the approval powers), branch A manager, a Super Admin without approval powers |
| Several service users | One per visit (five) |
| Normal and double-up visits | 3 Nov normal; 4 Nov double-up (Ann lead, Ben support) |
| A corrected visit | The 3 Nov visit, £14.00 → £21.00 |
| A cancelled UK payroll run | November run 1, cancelled with a reason |
| A supplementary payroll run | A second visit pay run over November, and a third UK run in the same pay period |
| A mileage claim | 6.2 miles on the 3 Nov visit |
| An overnight visit | 5 Nov 22:00 to 6 Nov 06:00 |
| A pay-card rate change | £14.00 → £15.00 an hour from 16 Nov, as a new card version |

### What happened, with the figures the test asserts

| Step | Actions | Result |
|---|---|---|
| 1 | Ann checks in 09:01 and completes 10:00 in the carer app | One reconciliation row, approved, 60 minutes, £14.00 |
| 2 | Double-up. Ann completes at 10:00. Ben's completion arrives at 10:40 claiming he left at 10:00 | Ann approved. Ben priced and **held** (`UNVERIFIED_TIMES`); his claim kept as evidence. Office confirms 10:00 → Ben released, £14.00. Ann unaffected |
| 3 | Overnight visit, 8 hours | 480 minutes, £112.00 |
| 4 | Mileage 6.2 miles saved on the first visit | Stored on the visit |
| 5 | Visit pay run 1–7 Nov: calculate, recalculate, approve, recalculate, lock | Lines: Ann £14.00, £14.00, £112.00; Ben £14.00; mileage £3.41. Recalculation: same number of lines, no claim key twice. Preparer's approval → 403. Recalculating after approval withdraws it: lock → 400 until approved again. A second run over the same dates → no lines |
| 6 | UK run for November: gross, cancel, replacement, close | Gross inputs £3,157.41 (visit pay £154.00 + mileage £3.41 + salary £3,000.00). After cancel: no claim left on the cancelled run, its lines kept. Replacement collects £3,157.41, each claim once. Creator's close → 403; approver's → 201; cancel of a closed run → 400 |
| 7 | Monthly payout job (clock at 4 Dec), approve, record payment | One DRAFT batch, nobody credited. Preparer's approval → 403. Record without approval → 400; without evidence → 400; with reference and date → `MANUALLY_RECORDED`, `settlementConfirmed: false`. Ann's first visit now reads "Payment recorded" |
| 8 | Pay card changed to £15.00 from 16 Nov; Ben works 17 Nov | New visit £15.00; the paid visit still £14.00 |
| 9 | Correct the paid visit to £21.00; supplementary runs | Direct edit → 400. Correction +£7.00: own approval → 403, second user → 201. Supplementary visit pay run: exactly two lines, £15.00 and £7.00. Original visit still £14.00 in its original run. History: original £14.00, corrected £21.00, difference £7.00, "Settled". Supplementary UK run: inputs £7.00 and £15.00 only; salary not taken again |
| 10 | Reverse the correction | −£7.00, second reversal → 400, own approval → 403. Next run: one line, −£7.00. History back to £14.00; correction "Reversed". Reversing the reversal → 400 |
| 11 | Correct the client charge of the paid visit to £30.00 | Charge £30.00; pay amount, minutes and run unchanged |
| 12 | Access | No token → 401. Branch A manager: Ann → 200, Ben → 404, pay runs and UK runs → 403. Ben's app: own salary 200, Ann's earnings 403. Super Admin without the role: approve → 403 |
| 13 | The month adds up | Five visit rows, each with exactly one original line in locked runs. Locked totals: Ann £143.41, Ben £29.00. No duplicate claim key in either claim table. Statuses: first visit "Payment recorded", correction adjusted to £0.00; the 17 Nov visit "In UK payroll (not closed)" |

Stand-in used: after gross calculation the test marks the run as statutorily calculated and sets net pay equal to gross, instead of running tax and NI. Statutory payroll is outside Gate A.

---

## 2. Required scenarios

| ID | Scenario | Required outcome | Where it is tested | Result |
|---|---|---|---|---|
| E2E-01 | Normal visit → approved earning | Correct amount, no duplication | `e2e-gate-a` step 1; `carer-app-attendance` "normal visit" | Pass |
| E2E-02 | Visit in two pay runs | One original earning | `duplicate-claims` (10); `e2e-gate-a` step 5 | Pass |
| E2E-03 | Cancel UK run → replacement run | Eligible unpaid earnings recovered once | `uk-cancellation` (12); `e2e-gate-a` step 6; `earning-status` | Pass |
| E2E-04 | Correct paid visit | Adjustment, not history rewrite | `pay-corrections` (9); `e2e-gate-a` step 9; browser | Pass |
| E2E-05 | Double-up, one unverified carer | Independent worker pay review | `carer-app-attendance` (two orders of completion, three carers); `e2e-gate-a` step 2 | Pass |
| E2E-06 | Office corrects attendance | Correct pending or adjusted pay | `attendance` (5); `carer-app-attendance` R-04 (3); `e2e-gate-a` step 2 | Pass |
| E2E-07 | Carer sends altered time | Evidenced exception and verification | `carer-app-attendance` (earlier start, future finish, offline upload, late-reported finish); `e2e-gate-a` step 2 | Pass, after the fix to the support-after-lead path |
| E2E-08 | Unauthorised payroll API request | Access denied | `http-payroll-api` (45 route cases); `e2e-gate-a` step 12 | Pass |
| E2E-09 | Branch A reads Branch B payroll | Access denied without explicit authorisation | `http-payroll-api` R-05 (8); `e2e-gate-a` step 12 | Pass |
| E2E-10 | Run creator attempts approval | Rejected | `controls`; `http-payroll-api`; `e2e-gate-a` steps 5, 6, 7, 9 | Pass |
| E2E-11 | Scheduled payout job runs | Draft only | `payouts`; `e2e-gate-a` step 7 | Pass |
| E2E-12 | Payment marked paid without evidence | Rejected or correctly labelled unconfirmed | `payouts`; `payment-state.util.spec`; `e2e-gate-a` step 7 | Pass: rejected without evidence; with evidence labelled manually recorded |
| E2E-13 | Paid visit charge corrected | Pay history remains unchanged | `pay-charge-separation` (5); `e2e-gate-a` step 11 | Pass |
| E2E-14 | Custom all-day rate | Correct midnight pricing | `pay-time-band.all-day.spec` (14); `rate-regressions` (6); `pay-card-api` | Pass |
| E2E-15 | Minimum-wage top-up | Exactly one relevant top-up | `minimum-wage` (2); `minimum-wage-flow` (4) | Pass, after the export hours fix |
| E2E-16 | Open payroll run recalculated | No duplicate claims or stale approvals | `duplicate-claims`; `controls`; `e2e-gate-a` step 5 | Pass |
| E2E-17 | Payroll run cancelled during concurrent work | No stranded or duplicated earnings | `uk-cancellation` (concurrent cancel / close; concurrent collection; failed transaction) | Pass, in one process |
| E2E-18 | Correction reversed | Correct one-time compensating adjustment | `pay-corrections`; `e2e-gate-a` step 10 | Pass |

---

## 3. Defects the end-to-end work found

| Defect | Scenario | Fix |
|---|---|---|
| A support carer clocking out after the lead had closed the visit: the finish time was taken from the app as sent (a future time was accepted) and the row stayed approved | E2E-05 / E2E-07 | Same trust rules as the other two completion paths; the row is repriced and reviewed again (`60e5aa0`) |
| The pay run export counted a visit's hours again for each top-up or mileage line | E2E-15 | Only the visit pay line carries visit time (`205b066`) |
| A visit in a cancelled UK run still showed as "In UK payroll" | E2E-03 | Cancelled runs are ignored by the status and the totals (`1085a80`) |
| Mileage and manual pay looked editable on a settled visit | E2E-04 (browser) | Disabled with a pointer to pay corrections |

---

## 4. Browser run

The development database holds the developer's own data and no settled visit, so the financial screens were exercised on a second instance of the application connected to the payroll test database, after the synthetic month had filled it.

```bash
node scripts/payroll-test-server.mjs
```

```bash
node scripts/payroll-test-preview.mjs
```

(Backend on port 3101, frontend on port 5174. Both refuse anything but a local database / local API.) Two synthetic office users with generated passwords were created in the test database for the run; they are removed by the next test reset.

| # | Screen and action | Observed |
|---|---|---|
| 1 | Sign in as synthetic user 1 | Signed in; the sign-in page states "API mode: http://localhost:3101" |
| 2 | Employee (Ben) → Earnings | "Settled in payroll £29.00 — 2 visits in a locked pay run or closed UK payroll run". 17 Nov visit: "In UK payroll (not closed)". 4 Nov visit: "Payment recorded". "Pay corrections" link on both |
| 3 | Pay corrections on the 4 Nov visit | Original (settled) £14.00 → Corrected £14.00 → Difference £0.00; "settled in a locked visit pay run and is not edited" |
| 4 | Enter 21 and a reason | Preview: "£7.00 more will be paid in the next visit pay run, after approval." |
| 5 | Record correction | Toast "Pay correction of £7.00 recorded…". Card: £14.00 → £21.00 → +£7.00; "Pending approval · entered by Olivia Office"; **Approve disabled**: "You entered this. Another user must approve it."; no form while pending |
| 6 | Sign in as synthetic user 2 → Billing → Visit reconciliation → Details of the same visit | The same card inside the reconciliation dialog; Approve enabled |
| 7 | Approve | Toast "Pay item approved…". "Approved for payroll · entered by Olivia Office · approved by Peter Payroll"; the form is available again |
| 8 | Same dialog, pay and mileage | Mileage: "Paid — mileage can no longer be edited here. Use a pay correction for a difference." Manual pay: locked. Client charge: still editable |
| 9 | Billing → Employee payouts → All history | "PAYMENT RECORDED £3,154.00 — Recorded manually — not confirmed by a bank"; batch row "Paid · Payment recorded manually" |
| 10 | Settings → Roles & permissions → Responsibilities (development system, read only) | "Pay authorisation — who can do it today": two users can prepare; **nobody** can approve pay runs, close UK payroll, approve payouts or record payments (four warnings). "Approve pay and record payments" row: Payroll Approver ticked; Admin and Super Admin shown as choices, not ticked |

Row 10 is the real state of the development system and is decision D-01. Nothing was changed there.

**Not done in a browser:** approving and locking a pay run; cancelling and closing a UK payroll run; approving a payout and recording the payment; reversing a correction; the pay card create → publish walk-through; anything as a branch-limited user; anything in the mobile app. Each of these is covered over HTTP (sections 1 and 2), except the mobile app, which is not covered at all.

---

## 5. Limits of this validation

1. One process, one database, synthetic data, small volumes.
2. The carer app's requests are imitated from its DTOs. The app itself was not available.
3. Tax, NI, payslips and HMRC are replaced by a stand-in or not touched.
4. Browser steps were driven by the same assistant that wrote the code. They show the screens work; they are not user acceptance.
5. The scenario dates sit in GMT; clock-change behaviour is covered by the rate tests, not by the month.
