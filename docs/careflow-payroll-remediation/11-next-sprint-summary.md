# 11 — Gate B Sprint Summary

**Sprint:** Gate A hardening, Gate B pay card correctness, mileage settlement · **Date:** 2026-10-12
**Branches (local only, nothing pushed or deployed):** `payroll-remediation/gate-b` in both repositories, on top of `gate-a`

| Repository | Gate A head | Head of this sprint |
|---|---|---|
| careflow-api (`careadmin-backend`) | `035e482` | `9315a95` + the reports commit |
| careflow-admin (`care-admin`) | `01da8a2` | `b36a61f` |

Detail is in the other reports: status by item (01), change log and set-up steps (02), test results (03), database changes (04), decisions (05), backlog (06), architecture (07), readiness (08), end-to-end and browser validation (09), evidence table (10).

---

## 1. Completed work

| Sprint | ID | In one sentence |
|---|---|---|
| A | R-16 | Each carer's attendance evidence has its own row and history, changed under a lock, so two people writing at once cannot overwrite each other |
| A | R-17 | A pay calculation that fails is held with its reason or recorded as a failure a person can see, retry and dismiss; it is never just logged |
| A | R-18 | An approval records what it was based on; when the evidence changes it is re-checked, sent back to review, or (if paid) flagged |
| A | R-13 | A branch-limited user gets pay screens that work for their branches and an explanation for the organisation-wide ones |
| A | R-11 | The remaining financial flows were carried out in a browser as three synthetic users |
| B | PC-19 | The day a rate belongs to is the organisation's local day in every pricing path |
| B | PC-32 | When two cards match a carer at the same level, none is used and the cards are named; the last edit no longer decides |
| B | PC-10 | A carer's funder pay card follows the funder on the day of the visit |
| B | PC-22, PC-23, PC-24 | One holiday calendar for carer pay (three nations, substitute days, organisation days, completeness check), with the weekend-holiday policy as a setting whose default is unchanged |
| C | TR-09 | Mileage rates are recorded per period; the year-to-date total is miles by journey date per tax year, so thresholds are crossed at the right mile |
| C | TR-13 | Mileage carries its tax treatment, reaches the employee's payment once, and is shown apart from wages |
| D | — | Migration rehearsal extended (45 checks); browser fixture; these reports |

Not built, as instructed: recruitment, invoicing redesign, pensions, student loans, RTI redesign, P45 / P60, a holiday entitlement engine, guaranteed hours, salary redesign, payment providers, a legal-employer model.

---

## 2. Important defects discovered

| # | Defect | Money effect before | State |
|---|---|---|---|
| 1 | Concurrent attendance writes overwrote each other (1 of 8 records survived) | A carer's times could be lost, so pay could rest on the wrong evidence or be held for the wrong carer | Fixed |
| 2 | A failed pay calculation left the visit unpriced with no trace a person would see | Unpaid visit nobody knew about | Fixed |
| 3 | Fixed fees, sleep-in allowances and travel rates used the UTC day | Wrong rate for visits between 00:00 and 00:59 in summer time (for example £8 instead of £10) | Fixed |
| 4 | Two cards at one level: the most recently edited card was used silently | A carer could be paid on a card nobody chose; editing an unrelated field on a card could change people's pay | Fixed: held and reported instead |
| 5 | The funder for a funder pay card was the client's funder today | Old visits re-priced on the wrong card after a change of funder | Fixed for carer pay |
| 6 | The pay run left out training, on-call, overtime and rolled-up holiday pay when the card could not be resolved, saying nothing | Silent underpayment | A card conflict now puts an exception line on the run. Other resolver errors there are still swallowed (R-22) |
| 7 | Two changes of a carer's card at once, or two funder overrides at once, both took effect | Two cards in force on the same days | Fixed with a lock; reproduced before the fix |
| 8 | A bank holiday rate would have applied to any "special" day | An organisation day would have been paid the bank holiday rate by itself | Fixed before the feature reached a card |
| 9 | Mileage year-to-date was pounds divided by a rate, from earlier periods only; 1 to 5 April fell in the wrong tax year | Threshold crossed inside a run missed; wrong year's total at the start of April | Fixed |
| 10 | Mileage never reached a payout | The carer was not paid their mileage by this system | Fixed from now on; earlier runs listed for the office (D-20) |
| 11 | Mileage was always treated as outside taxable pay, whatever the rate | If the rate is above HMRC's approved amount, the part above went untaxed | Structure fixed; **still open in effect** until the approved amounts are recorded (D-15) |

Found and deliberately not changed: a card's bank holiday rate for travel, mileage or waiting is never used (D-19); a card's Easter rate is never used (D-16).

---

## 3. Improvements made

- **Evidence:** attendance evidence has a history; approvals say who or what gave them and on what.
- **Visibility:** failed calculations, conflicting cards, calendar gaps and unpaid historic expenses each have a list a person can open.
- **Configuration instead of code:** mileage rates, HMRC approved amounts and the weekend-holiday basis are data, changed by a named person with a reason, and audited.
- **Separation:** the calendar says which days are holidays; the card says what is paid; the organisation's policy says which day counts. Reimbursements are kept apart from wages from the pay line to the payslip.
- **Access:** branch-limited users no longer meet errors on pay screens.
- **Tooling:** the migration rehearsal covers all 13 migrations; a fixture prepares the test database for browser checks.

---

## 4. Tests added

| Kind | Before the sprint | After | New in this sprint |
|---|---|---|---|
| Integration and HTTP (`test:payroll-int`) | 19 suites, 193 tests | 26 suites, 264 tests | `attendance-concurrency` 11, `pay-evaluation-failures` 7, `approval-evidence` 10, `pay-card-conflicts` 15, `funding-history` 6, `holiday-calendar` 11, `mileage-settlement` 9, and 2 added to existing suites |
| Unit, `src/billing` and `src/payroll` | — | 48 suites, 349 tests | `local-day.pc19` 15, `pay-card-conflict.pc32` 13, `funding-at-date.pc10` 8, `holiday-calendar.pc22` 20, `mileage.tr09` 15, `pay-evaluation-failure` 6, `approval-evidence` 9, payslip +3, time-trust 18 → 20 |
| Frontend | 1,268 tests | 1,293 tests | 25: failed calculations card 5, pay scope 4, card conflicts 7, bank holidays 6, payable breakdown 3 |
| Migration rehearsal | 28 checks | 45 checks | 17 |
| Browser | 4 areas | 10 | 6 flows (doc 09 section 6) |

All of the above pass. Outside the programme, 18 backend unit tests and 16 frontend tests fail; the same ones fail on the Gate A commits (doc 03, section 0.4).

---

## 5. Remaining financial risks

| Risk | What would close it |
|---|---|
| The tax treatment of every mileage payment is "not verified": on the development database 4 rate rows exist and none has verified approved amounts | Finance records HMRC's approved amounts per tax year (D-15) |
| Mileage in UK runs calculated before this sprint was never paid by this system | A decision and manual settlement (D-20); the list exists |
| After upgrade, carers between two cards are held instead of paid on the last-edited card. On the development database today: 15 active cards, 23 active carers, 20 without a card of their own, **none held** | Review the conflicts list on a copy of real data before go-live (D-17, R-20) |
| A mileage mistake found after the lock can only be corrected as wages | R-21, D-21 |
| The holiday calendar is only as good as its rows. On the development database: England & Wales 2026 complete (8 dates); **2027 empty; Scotland and Northern Ireland empty** | Run the GOV.UK import and resolve the gaps the status lists; this was not done on the development database because it is the user's data |
| A pay run for a year with missing holiday dates is not stopped | R-27 |
| A card's bank holiday rate for travel, mileage or waiting is not used | D-19 |
| Other resolver errors in the pay run's non-visit lines are still swallowed | R-22 |
| The statutory tables behind tax and NI are not validated | Gate C |
| The mobile app was not observed | The app or a test build |
| Everything was written and tested by one author with the same assistant | Independent review |

---

## 6. Remaining policy decisions

None of these was answered in code. Where a default was unavoidable it is the behaviour that existed before.

| ID | Decision | Default in place |
|---|---|---|
| D-03 | May a UK run pay visits that never went through a visit pay run? | Allowed and made safe (unchanged) |
| D-05 | How far may a reported time differ from the server's before review? | 15 minutes (unchanged) |
| D-07 | More than one legal employer? | No such model; not invented |
| D-13 | Which day is paid when a holiday falls on a weekend? | Both, as before; now a setting |
| D-15 | The organisation's mileage rates and HMRC's approved amounts | The rates already in use; approved amounts empty |
| D-16 | Which days are Easter; which days are the organisation's own | None |
| D-17 | Is "hold until the office chooses" right for two cards at one level? | Hold |
| D-18 | Must every funding line be dated? | Held only when it matters |
| D-19 (Q17) | Bank holiday rate for travel, mileage, waiting | Not used, as before |
| D-20 | Mileage of earlier runs | Not paid automatically |
| D-21 | How a mileage correction after payment is settled | Pay correction only |

Earlier decisions still open: D-01, D-02, D-04, D-06, D-08 to D-12, D-14 (doc 05).

---

## 7. The final quality checklist

| # | Check | Result |
|---|---|---|
| 1 | Attendance evidence is safe under concurrency | **Met** on the server (11 concurrency tests, one process, one database). The mobile app was not observed |
| 2 | No wage calculation error is silently swallowed | **Met for visit pay.** **Not fully met for the pay run's non-visit lines:** a card conflict is reported there; other resolver errors are still swallowed (R-22) |
| 3 | Automatic approval is invalidated when evidence requires review | **Met** (10 tests) |
| 4 | Branch-restricted staff have usable and secure pay screens | **Met for branches** (HTTP tests, component tests, browser). **Blocked for legal employers:** D-07 |
| 5 | Wage calculations use the correct UK local date | **Met** (15 unit tests, 8 of which failed before; integration cases) |
| 6 | Conflicting pay cards cannot silently select the wrong rate | **Met** (13 unit, 15 integration). Consequence to accept: D-17 |
| 7 | Historical visits use historical funding context | **Met for carer pay.** The client charge still uses current funding (out of scope, R-28) |
| 8 | Holiday calendars are complete and accurate for the configured jurisdiction | **Not met as a statement about data.** The check exists and reports gaps; the import reads the official GOV.UK dataset. On the development database England & Wales 2026 is complete, 2027 is empty, Scotland and Northern Ireland are empty. The dates themselves were not compared with GOV.UK in this sprint (the import was tested with a stand-in for the download) |
| 9 | Existing pay card amounts are not silently changed | **Met.** No migration touches a pay card or a rule; the rehearsal confirms no row was removed. Two behaviours change which existing rule applies, both intended and documented: the local day (PC-19) and holding on a conflict (PC-32) |
| 10 | Approved mileage reaches the payment calculation | **Met** (£3.41 on the payout line beside net pay; once) |
| 11 | Mileage tax treatment remains separate from ordinary gross wages | **Met in structure** (tax-free part outside gross, part above the approved amount on its own taxable line). **Blocked in effect by D-15:** no approved amounts are recorded, so every line is "not verified" |
| 12 | Locked earnings are never silently rewritten | **Met** (triggers; rehearsal; mileage lines of locked runs are read, not back-filled; frozen approvals) |
| 13 | Payroll cancellation does not strand or duplicate earnings | **Met** (12 earlier tests still pass; plus a deleted pay run and a cancelled payout batch for mileage) |
| 14 | Pay and client-charge calculations are regression-tested | **Met** (pay and charge asserted side by side in `rate-regressions` and `holiday-calendar`; charge band specs) |
| 15 | Required frontend workflows have automated and/or documented browser test results | **Met** (component tests; six documented browser flows). There are no automated browser tests |
| 16 | The test suite reports actual outcomes rather than assumed success | **Met.** Figures are from runs on the stated commits; failures outside the programme are listed and were compared with Gate A; tests that failed first are named |
| 17 | Existing data migrations are safe and reversible through a documented recovery procedure | **Met on synthetic history** (45 of 45; recovery in doc 04 sections 0 and 8). **Not rehearsed on a copy of real data** (R-20) |

---

## 8. Readiness for the following phase

**Gate A:** evidence is complete except for the mobile app check, which development cannot do. It can be submitted for independent review and client acceptance testing. It is not signed off, and writing more code does not sign it off.

**Gate B:** pay card correctness (PC-19, PC-32, PC-10, PC-22 to PC-24) and mileage settlement (TR-09, TR-13) pass in the test environment. Three of them only take full effect once the client acts: the holiday basis (D-13), the mileage rates and approved amounts (D-15), and the review of conflicting cards (D-17). The rest of Gate B has not started.

**Recommended next sprint** (doc 06 section 7), each item behind its decision:

1. Salary configuration, proration and salary-covered visits (Q22)
2. Guaranteed hours and contractual top-ups (Q23)
3. Overtime across payroll runs (Q29)
4. Travel time against waiting, break and commute (Q32, D-19)
5. Cancellation and no-access compensation (Q13)
6. Holiday entitlement and holiday pay (Q35)
7. Apprentice eligibility and the pay reference period for the minimum wage (Q37 to Q39)
8. Employment wage policies: the rate dimensions that are contractual (Q17)

Without the decisions, only the small items can be done: R-22 to R-27 and an explicit all-day choice in the pay card editor.

**Before any of this is used with real data:** the pre-migration reports on a copy of real data, reviewed by finance (R-20); the set-up steps in doc 02; the operational controls in doc 08 section 8.
