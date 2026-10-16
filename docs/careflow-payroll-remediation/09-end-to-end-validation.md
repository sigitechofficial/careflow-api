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

---

## 6. Gate B sprint — browser run of the remaining financial flows (R-11)

**Run:** 2026-10-12, embedded browser, the application's second instance on the payroll test database (API port 3101, frontend port 5174), filled by `npm run payroll-test-browser-seed`. Three synthetic office users: Olivia (prepares; administrator role, no approval power), Peter (approves; holds the approval powers on a separate role), Mia (branch manager, Branch A only). Every result below was then read back from the test database.

| # | Flow | What was done in the browser | Result on screen | Confirmed in the database |
|---|---|---|---|---|
| 1 | Approve and lock a visit pay run | As Peter: Visit pay runs → "Week ending 11 Oct 2026" (prepared by Olivia, Ready for review) → Approve → Lock. Details opened | Status Approved, then Locked; actions reduced to Export. Details show the mileage as its own section: "Mileage: 6.20 mi × £0.55/mile = £3.41"; gross pay £56.00 does not include it | Run `LOCKED`, created by Olivia, approved by Peter; `expenseTotal` 3.41 beside `grossPay` 56 |
| 2 | Close a UK payroll run | As Peter: UK Payroll → the run (created by Olivia, tax and NI calculated) → Close run | Status CLOSED; "Reactivate run" needs a power Peter does not hold; FPS preview appears | Run `CLOSED`, closed by Peter |
| 3 | Record a manual payment | As Olivia: "Create payout from this run" → draft batch (£56.00, two employees). As Peter: open the batch → Approve → Record bank payment (reference, date paid, where the evidence is held) | "Payment recorded manually … Ref BACS-TEST-R11-BROWSER · paid 12/10/2026 · **Not confirmed by a bank**"; both lines PAID | Batch created by Olivia, approved and paid by Peter, lines 42.00 and 14.00 |
| 4 | Reverse an approved correction | As Peter: Pay items → Approved → the correction of visit VIS-GEN-20260929-0001 (+£7.00, entered by Olivia, approved by Peter) → Cancel | The item leaves the approved list. Before that, the visit's "Pay corrections" card showed original £28.00, corrected £35.00, difference +£7.00, who entered and who approved | Pay item `CANCELLED` |
| 5 | Create, save and reload a custom pay card | As Olivia: New pay card → name, code, dates, notes → Add rate → period "Custom…", label, 18:30 to 21:45, £17.50 an hour → Create. Opened again for editing | Saved and returned to the list. On reload: period "Custom…", "R-11 twilight", 18:30, 21:45, 17.5. **The form warned before saving** that carers without their own card would match this card and the existing default (PC-32) | Card `DRAFT` with one rule: WEEKDAY, HOURLY, 17.5, 18:30–21:45 |
| 6 | Wages as a branch-limited user | As Mia: UK payroll runs; Visit reconciliation; Salary | UK payroll runs: "This screen covers every branch …" instead of an error. Visit reconciliation: 4 visits, all Ann's (Branch A); Ben's are not listed. Salary: one employee, Ann, £42.00 "recorded as paid (not bank-confirmed)"; Ben absent | With Mia's own session: own branch 200; the other branch 404; organisation lists 403; Ben's earnings 404; Ann's 200 |

Observations (none affects money; listed in the backlog):

- Cancelling an approved pay item uses the browser's own confirmation box and asks for no reason (R-23). The embedded browser dismisses such boxes, so for flow 4 the box was accepted by script; the application code was not changed.
- A payout batch created from the UK run page gives no confirmation there, and is filed under its week ("2026-W40") while the payouts list opens on the current month; a second attempt answered "already exists" (R-24).
- In the embedded browser, when its pane was not being drawn, the payout dialog stayed at its opening position with its lower buttons below the window. The payment form was submitted from the keyboard. This looked like an effect of the pane not animating, not of the application; it should be looked at once in an ordinary browser.

## 7. Gate B sprint — the synthetic workflow from visit to payment

Carried out automatically in `mileage-settlement.int-spec` (first test) through the real controllers, with the application's own tax and NI calculation:

| Step | Check |
|---|---|
| Two carers work the same visits through the carer app: 8 hours and 3 hours at £14.00. One records 6.2 miles | Both rows approved automatically on clean evidence |
| Visit pay run for the week, approved and locked by a second user | Visit pay £154.00 each. One mileage line: 6.2 miles, £3.41, "tax treatment not verified". Run gross £308.00; mileage is in the expense total, not in gross |
| UK payroll run: gross → tax and NI → closed by a second user | Both carers: gross £154.00 and identical taxable pay, tax, NI and net. The carer with mileage: expenses £3.41, reimbursement payable £3.41 |
| Payout batch | Her line: net pay and £3.41 shown apart, amount = net + 3.41. The other carer: net only. The difference between the two lines is £3.41 |
| A second batch for the same run | Refused while the first is open; after payment, nothing is outstanding |
| Approve (second user) and record the payment with reference, date and evidence | Recorded as manually entered, not as confirmed |
| Reconciliation list | Recorded 3.41 = payable 3.41 = in batches 3.41 = recorded as paid 3.41; outstanding 0 |

The other eight tests of that suite cover: a cancelled batch; a rate above a verified approved amount (the £1.00 above it is inside taxable pay, £4.50 outside); the year-to-date total; a change of rate; corrections before and after the lock; a deleted run; miles with no rate; the rates API.

## 8. Limits of the Gate B validation

- Synthetic people, visits, rates and funders only. No real employee, bank or HMRC data.
- The statutory tables behind the tax and NI figures were not validated; only how reimbursements relate to the calculation.
- The mobile app was not observed.
- Browser flows were carried out by hand once; they are not automated.

---

## 9. Gate B2 — one synthetic period for employment wages

Test: `test/payroll-int/e2e-gate-b2.int-spec.ts` (10 steps, run in order on shared data, through the real controllers, guards and database). Every person, rate, agreement and rule is synthetic.

**Set-up.** Pay card £14.00 an hour; overtime at time and a half above 10 hours a week; travel time £12.00 an hour. Hana: hourly. Gus: hourly with an approved agreement guaranteeing 14 hours, shortfall paid. Sal: approved salary agreement, £2,000.00 a month, covering all visit work. Lou: paid £12.00 an hour. Cal: a visit that found nobody home.

| V | Validation of the brief | What the test does | Asserted result |
|---|---|---|---|
| V-01 | Hourly carer paid correctly | Hana works 6 h, 3 h and 3 h | Visit pay £168.00; nothing else as base wages |
| V-02 | Salaried employee not double-paid | Sal works a 2 h visit (£28.00) and is in the UK run | Salary £2,000.00; the visit comes in at £0.00, £28.00 recorded as covered; gross £2,000.00 |
| V-03 | Guarantee top-up | Gus works 10 of 14 h; the following week nothing is scheduled | Top-up £56.00, then £196.00; each week totals £196.00 |
| V-04 | Overtime across pay runs | 12 h in the week; identity checked. (A week divided between two runs: `overtime-weeks`, 7 tests) | 2 h × £7.00 = £14.00, claim `OVERTIME:<Hana>:2026-11-02:1` |
| V-05 | Travel pay and mileage separate | Two visits 40 minutes apart, 10 miles on the second | Travel line: 40 minutes, no miles. Mileage line: 10 miles, no minutes |
| V-06 | Cancelled visit follows policy | An approved synthetic rule "nobody home: paid in full"; event recorded by one user, approved by another | Cancellation pay £14.00, claimed by its pay item |
| V-07 | Holiday pay by worker category | Leave terms: Gus regular hours, Hana irregular hours on rolled-up pay, Lou none | Gus 78.4 h a year and a 52-week rate of £14.00; Hana accrues 1 h on 12 h worked, paid rolled-up; Lou: nothing worked out |
| V-08 | Minimum wage on the correct reference period | Lou: 10 h at £12.00 | Top-up £7.10, claim `NMW:<Lou>:<period start>:1` |
| V-09 | Missing pay rules are visible exceptions | A training activity on a card with no training rate | A held line naming the activity and the reason; the visit pay beside it is paid |
| V-10 | Incomplete calendars are visible holds | A visit on Easter Monday 2027 with no calendar entry, on a card with a bank holiday rate | A held line: "Carer pay is held: 2027-03-29 is normally Easter Monday…" |
| V-11 | Corrected earnings enter a later run once | A correction of +£7.00 to a locked visit, approved by a second user | One adjustment line of £7.00 in the next run; none in the one after |
| V-12 | Locked history unchanged | The locked week's lines are compared, field by field, before and after everything else | Identical |
| V-13 | UK cancellation does not strand earnings | The UK run is cancelled and replaced | The replacement collects the same amounts for every person |
| V-14 | Approved expenses included once | Mileage in UK gross; then a supplementary run | In expenses, not in gross; one live expense claim; the supplementary run finds nothing |
| V-15 | Source earnings reconcile to pay-run lines | Every approved visit and pay item against the run's lines; every locked line against UK gross | One line per source with that source's claim and amount; no line without a claim; the run total equals its lines; every locked line appears once in UK gross |

UK gross for the month, as asserted: Hana £222.00 (168 + 8 + 14 + 25 + 7), Gus £392.00, Sal £2,000.00, Lou £127.10, Cal £14.00.

## 10. Gate B2 — browser run

Run on 2026-10-13 against the synthetic test instance (API on port 3101, test database only; front end on port 5174) filled by `test/payroll-int/browser-fixture.seed.ts`, as two synthetic users: Olivia (prepares) and Peter (approves). The fixture gained two visits of one carer 40 minutes apart, a cancelled visit with a carer allocated, and the agreement approval power for the approver. Each result was read back from the page and confirmed in the test database. The generated login file was deleted afterwards.

| # | Flow | What was seen |
|---|---|---|
| B2-1 | Enter a salary agreement, then approve it as a second person | Olivia: "Save for approval" is disabled until salary, part-period method and cover are chosen; saved as a draft with "Not in effect: a second person must approve it"; no approve button for her. Peter: "Approve agreement" → Active, "entered by Olivia Office · approved by Peter Payroll" |
| B2-2 | A cancelled visit | Pay items page lists "Synthetic cancelled call … cancelled with 60 min notice (client request) · no pay decision". Record for pay → "Needs a decision — No approved rule covers this event". Olivia sets £7.00 with a reason → "Awaiting approval"; her own approval leaves it awaiting. Peter approves → the panel empties and the pay item "Cancelled / disrupted visit £7.00, Approved" is listed |
| B2-3 | Travel time before a visit | The card says the pay run uses "Travel minutes entered on the visit: 40 min, not classified". Olivia records a rest break 12:00–12:40 (stored as 11:00–11:40 UTC: organisation time is converted correctly); her own approval leaves it awaiting. Peter approves → "Decided by approved intervals: 0 min travel, 0 min waiting, 40 min not paid" |
| B2-4 | Salary in the UK run | "Calculate gross" on the fixture's run after the agreement took effect on 1 October: salary £1,142.86 (4 of 7 days of £2,000.00); the visits worked on 29 and 30 September, before the salary, still paid (£42.00); gross £1,184.86 |
| B2-5 | Payroll profile | The apprenticeship start date field and the note about the pay reference period are on the employee dialog |

Found by this run and fixed: the travel card described minutes entered on the visit as a zero estimate (V-40).

## 11. Limits of the Gate B2 validation

- Synthetic people, visits, rates, agreements and rules only.
- Tax and NI are a stand-in in the end-to-end test; in the browser run the application's own calculation ran but its tables were not validated here.
- The embedded browser pane does not draw, so the pages were driven through their own controls by script and read back as text; no screenshot was taken.
- Holiday has no screens, so it was validated through the API only.
- Salary cover was seen in the browser as a salary part beside visits worked before the salary began; the "covered, not paid again" marker itself is proved by `salary-gross` and the end-to-end test, not by the browser run.
- The mobile app was not observed.
