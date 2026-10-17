# 07 — Financial Architecture

**Updated:** 2026-10-13 (Gate B2: section 00 is new; section 0 is the Gate B sprint; sections 1 to 9 are unchanged except where these say otherwise)

How pay moves through CareFlow, which record is the authority at each step, and where each control sits. Sections marked *(target)* describe later phases and are not built.

---

## 00. Added in Gate B2

### 00.1 An earning that cannot be worked out is a line, not a gap

A pay run line with `sourceType = HELD_EARNING` carries amount 0.00, no claim, and the reason in `exceptionMessage`. `sourceRef` says what is held: `HELD:ACTIVITY:<id>`, `HELD:PAY_ITEM:<id>`, `HELD:VISIT:<reconciliationId>`, `HELD:CARD:<employeeId>`, `HELD:GUARANTEE:<employee>:<week>`, `HELD:HOLIDAY:<employee>`, `HELD:WEEK:<kind>:<employee>:<week or period>`. Because it holds no claim, the earning stays payable: recalculating retries it, and a later run can pay it. Two kinds stop the run being locked, because locking would lose them: `CARD:` (overtime and rolled-up holiday that could not be worked out at all) and `WEEK:` (a week or period that another open run is settling).

### 00.2 Earnings of a week or a period have one identity across runs

Three earnings belong to a span of time, not to a run: the overtime premium of a week, the guaranteed-hours top-up of a week, the minimum wage top-up of a pay reference period. Each is settled the same way:

1. Read the whole span from its sources (every pay-approved visit of the week; this run's pay and hours with those recorded by locked runs for the period).
2. Work out what the span is due in total.
3. Subtract what locked runs already paid for it.
4. Pay the difference on a line whose claim is `<KIND>:<employee>:<first day of the span>:<n>`, where n is one more than the number of settlements already made.

`PayrollRunLine.claimKey` is unique, so two runs cannot both make the nth settlement. Recalculating gives the same line. A visit approved late, or a correction, changes the total due and the next run that touches the span pays or takes back the difference. If another open run already holds a settlement of the span, this run holds its own with a reason and cannot be locked until the other is.

### 00.3 Salary in UK gross

```
pay agreements of the employee (not drafts)
        |  the one with the latest start on or before each day
        v
period split into parts  ->  one SALARY line per part   claim SALARY:<employee>:<period>[:<part>]
        |
visit pay run lines and approved visits of the employee
        |  what does the agreement in force on the day of the work say the salary pays for?
        v
ALL_VISIT_WORK      -> amount 0.00, unpaidAmount = value, unpaidReason COVERED_BY_SALARY, claim kept (settled)
CONTRACTED_HOURS    -> the first contracted hours of the week covered, the rest paid (visits in worked order, across runs)
NO_VISIT_WORK       -> paid in full
not recorded        -> amount 0.00, unpaidReason SALARY_COVERAGE_NOT_DECIDED, no claim (held; a later run pays or covers it)
```

Never touched by cover: reimbursements, and lines that come from an approved pay item. A period already paid whose salary an approved agreement has since changed gets one `SALARY_ADJUSTMENT` line (claim `SALARY_ADJ:<employee>:<period>:<n>`) in the next run that includes the employee; the trigger is `termsChangedAt` on the agreement being later than the close of that period's run, so agreements nobody has changed never produce one.

Putting pay terms into effect is a second person's act (`payroll.pay_agreements.approve`). An agreement in effect is not edited; it is ended, and a new one is added. Agreements are therefore a history that can be read back for any past day.

### 00.4 Travel time

`TravelTimeInterval` is time before a visit, with a category, an evidence level and a status. The pay run's order of precedence for a visit: approved intervals; travel minutes entered on the visit; the estimate from the gap since the previous visit in the same run. Travel between service users and required waiting are working time; a rest break and an ordinary commute are not; a training journey, a journey to a cancelled visit and "other" are paid only when the approver says so. Intervals never create or change a mileage line.

### 00.5 Visits that do not go ahead as planned

`VisitDisruptionPayRule` is the employer's policy (none exists until entered and approved). `VisitDisruptionPayDecision` is one event for one carer: the rule in force proposes an amount, or the status is "needs a decision"; a second person approves; an amount becomes a pay item (`DISRUPTION_PAY`, line type `CANCELLATION`) and is claimed and paid like any other. A cancelled visit with a carer allocated and no decision is listed until it has one.

### 00.6 Minimum wage

The pay reference period of a worker is the period of their UK payroll schedule that contains the day worked; with none, the run's own dates, recorded as such. `NmwPeriodAssessment` holds, per run, worker and period: the category and age at the period start, the rate, this run's pay and minutes, the period's position, and the top-up. What counts: visit, travel, waiting and training lines as pay and hours; bonuses and adjustments as pay; nothing else.

### 00.7 Holiday

`EmployeeLeaveTerms` (approved, effective-dated) and `EmployeeLeaveEntry` (what was taken, adjusted, carried over, paid on leaving). Entitlement is worked out when asked, from the terms and the hours worked, and is not stored. The only link to pay so far is that rolled-up holiday pay on a card is held for an employee whose terms do not allow it.

---

## 0. Added in the Gate B sprint

### 0.1 Attendance evidence (replaces the storage described in section 6)

```
carer app completion ─┐
late clock-out ───────┼─► one locked merge per (visit, carer) ─► VisitAttendanceVerification (version n)
office time entry ────┘        │                                 └► VisitAttendanceVerificationEntry (append-only)
                               └─ repeated delivery recognised by event id; nothing applied twice
```

The rules of section 6 are unchanged; what changed is where the evidence lives and that every writer goes through the same merge under a row lock. Evidence written before this sprint is still read from the visit.

### 0.2 A calculation that cannot be completed

| Cause | Result |
|---|---|
| A set-up gap the pay card resolver can name (no employment record, two cards, funding history unclear) | The row is held with `PAY_CARD_MISSING` and the reason; the client charge is still priced |
| Anything else | `PayEvaluationFailure`: kind and category, a safe message, no error text; shown, retryable, dismissable with a reason; closed by the next success |

### 0.3 Approval follows evidence

An approval stores its source (`AUTO_VERIFIED`, `MANAGER_APPROVED`, `MANAGER_OVERRIDE`) and the evidence it was given on (start, finish, review state). When the evidence changes: automatic → withdrawn and re-given if clean; a person's → back to review with the reason; settled → flagged `EVIDENCE_CHANGED`, never edited in place (corrections, section 5).

### 0.4 Which pay card

```
1. funder override for the funder on the day of the visit   (funding as at the visit day, PC-10)
2. the carer's own card for that day                        (dated history)
3. matching, most specific level first:
   individual > role > branch > employment type > worker type > organisation default
```

At each step, if more than one card applies and nothing ranks them, **no card is chosen** and a `PayCardConflictException` names them (PC-32). All dates are local days (PC-19). A resolved card is pinned on the reconciliation when it is approved, so later changes to cards do not re-price approved or paid visits.

### 0.5 Calendar and premium policy

```
BankHoliday rows  (nation | ORGANISATION, date, isSubstitute, substituteForDate, source)
        │
        ▼  holiday-calendar.store: loadPayCalendar(nation, period)      ← one reader for carer pay
        │      + OrganisationGeneralSettings.holidayPremiumBasis (BOTH | ACTUAL_DAY | STATUTORY_DAY)
        ▼
  { bank holiday days, organisation special days, fixed-date rule }  ─► pricing functions
        │
        ▼
  the pay card decides what is paid: a day earns more only where the card has a rate for it
```

The calendar is a fact; the basis is the organisation's policy; the amount is the card's. Client charges do not use the basis.

### 0.6 Mileage

```
MileageRate (from date, vehicle)      organisation rates │ HMRC approved amounts (verified by a person, or empty)
        │
visit miles ─► visit pay run line: miles, amount, taxFree / taxable or NOT_VERIFIED
        │         year-to-date = miles by journey date in the tax year (other approved / locked runs + this run)
        ▼
UK payroll gross:  reimbursed part ─► expense (outside taxable pay)      taxable part ─► MILEAGE_TAXABLE (inside gross)
        ▼
UkPayrollRunEmployee: netPay  +  reimbursementPayable  =  total payable
        ▼
EmployeePayoutLine: amount = net pay + reimbursement (each tracked, each paid once)
```

Reimbursements are never wages: they are not in `grossPay` of the visit pay run, not in taxable pay (except the part above the approved amount), and are added to the payment once.

---

## 1. Flow

```
EMPLOYMENT            PAY CARDS                 ATTENDANCE
employment record     card → version → rules    visit, allocation (one per carer)
pay agreement         carer card history        attendance events (append-only)
                      funder override           time trust record (per carer)
        │                    │                          │
        └────────────────────┴───────────┬──────────────┘
                                         ▼
                         VISIT RECONCILIATION  (one row per visit × carer)
                         approved pay window · payable minutes · amount
                         card + version used · exceptions · approval
                         pay side and charge side decided separately
                                         │
             ┌───────────────────────────┼─────────────────────────┐
             ▼                           ▼                         ▼
      VISIT PAY RUN               PAY ITEMS                 UK PAYROLL RUN
      lines with claim keys       bonus, holiday, sick,     gross inputs with claim keys:
      calculate → approve → lock  training, on-call,        locked visit-pay lines,
             │                    corrections, reversals    salary, deductions,
             │                    (approved → next run)     provisional visits
             └──────────────► locked lines ───────────────────────►│
                                                             PAYE · NI → net → close
                                                             (cancel releases the claims)
                                                                   │
                                              ┌────────────────────┼───────────────┐
                                              ▼                    ▼               ▼
                                         PAYSLIP            HMRC FPS / EPS    PAYOUT BATCH
                                                                              draft → approved →
                                                                              payment recorded manually
```

Every arrow that moves money writes an audit entry.

---

## 2. Records and their role

| Area | Record | Role |
|---|---|---|
| Employment | `EmployeeEmployment`, `EmployeePayAgreement`, `EmployeePayrollProfile` | Who is paid, on what basis, with which tax details |
| Pay cards | `PayCard`, `PayCardVersion`, `PayCardRule`, `EmployeePayCardAssignment`, `EmployeeFunderPayAssignment` | The rate that applies to a carer on a date |
| Attendance | `ScheduledVisit`, `JobAllocation`, `VisitAttendanceEvent`, time trust record in job metadata | What happened. Events are never edited; a correction is a new event |
| Earnings (visits) | `VisitReconciliation`, `FinanceException` | **The authority for what a visit earned one carer**: approved, priced, with the card version used |
| Earnings (other) | `EmployeePayItem` | Non-visit pay, and the correction ledger |
| Visit pay | `PayrollRun`, `PayrollRunLine` | Gross pay lines for a period. Once locked, **the authority for what was put through payroll** |
| Payroll | `UkPayrollRun`, `UkPayrollRunEmployee`, `UkPayrollInputLine`, year-to-date ledgers | Gross to net |
| HMRC | `PayrollHmrcSubmission` | FPS / EPS attempts |
| Payments | `EmployeePayoutBatch`, `EmployeePayoutLine` | Net pay to be paid, and the record that someone says it was |
| Access | `Role`, `Permission`, `UserRole`, `UserLocation` | Who may do what, and for which branches |
| Audit | `AuditLog` | Who decided what, when |

---

## 3. One entitlement, one original payment (claims)

| Source | Identity | Enforced by |
|---|---|---|
| Visit earning | reconciliation (visit × carer) + earning component | `PayrollRunLine.claimKey` unique index |
| Pay item | pay item id | same index, plus `includedInPayrollRunId` when locked |
| Training / on-call activity | activity id | same index |
| Locked visit-pay line into UK payroll | line id | `UkPayrollInputLine.claimKey` = `LINE:<id>`, unique index |
| Salary for a pay period | employee + period | `UkPayrollInputLine.claimKey` = `SALARY:<employee>:<period>` |
| Salary deduction for a pay period | deduction + period | `UkPayrollInputLine.claimKey` = `DEDUCTION:<id>:<period>` |
| Approved visit paid directly by a UK run | reconciliation | conditional claim at close (`paidByUkPayrollRunId`) |

```
   source ──claim──► run A (open)     recalculate / discard / cancel ──► claim released
                        │                                                     │
                        │ lock / close                                        ▼
                        ▼                                           run B may claim it
              claim is permanent                                    (once; unique index)
              (history; triggers)
```

Claims are written in the same transaction as the lines they belong to. A calculation that loses a race for a source re-selects and retries; it never writes a second claim. Periods may overlap: an off-cycle or supplementary run simply finds less to claim.

Additional money for the same work is always a **different** record: a premium line derived inside a run, or an approved correction item with its own claim.

---

## 4. Cancelling a UK payroll run

```
 UK run (open) ──cancel(reason)──► CANCELLED
      │   refused when a payout batch for it is draft, approved or paid, or a live FPS exists
      ▼
 its input lines: claimKey → NULL, releasedAt = now      (lines kept as the snapshot of the run)
      ▼
 replacement run ──calculate gross──► collects each released source exactly once
```

- Cancelling and closing are conditional updates on the run status, so a run cannot be closed and cancelled at the same time.
- A closed run is not cancelled; it is reopened (separate power) or corrected by a later run.
- A reactivated cancelled run starts again from "employees enrolled": its old figures are not trusted, and it collects only what no other run holds by then.
- The audit entry carries the reason and the number of claims released.

---

## 5. Settled pay is history; corrections

A visit is **settled** when it is in a locked visit pay run or was a provisional input of a closed UK run.

| Layer | What it does |
|---|---|
| Service | Refuses pay-side edits, rejection, pay-side overrun decisions, manual amounts and repricing of a settled visit |
| Database | Triggers refuse changes to the pay snapshot, to lines of locked runs and to locked runs, from any code path |
| Screen | The pay and mileage editors of a settled visit are disabled and point to pay corrections |
| Snapshot | The reconciliation keeps the approved window, minutes, amount, card and version, approver and time; the locked line keeps the amount paid |

```
 settled visit (£14.00)
      │  office states the corrected total (£21.00) and a reason
      ▼
 correction item  +£7.00   PENDING APPROVAL      one pending correction per visit
      │  approved by a different user
      ▼
 APPROVED FOR PAYROLL ──next visit pay run calculates──► INCLUDED IN PAYROLL ──lock──► SETTLED
                                                                                        │
                                                       reversal (once): −£7.00, approved by a
                                                       different user, paid in the next run ──► REVERSED
```

The correction holds the original line, the amount settled so far and the corrected total; the difference is worked out against everything already settled, so asking for the same total twice pays nothing more. The original visit record and the original line are never changed.

**Pay and charge are separate.** Settled pay does not block the charge side: the overrun of a paid visit can still be decided for the client charge ("charge only"), and the billable window and amount can be corrected. None of that touches the pay snapshot. A charge already on an approved invoice is protected by the invoice rules.

---

## 6. Attendance and time trust

Kept per carer on the job (`employeeApp.attendanceTimesByEmployee[employeeId]`), so on a double-up each carer is judged on their own evidence.

| Time | Kept as |
|---|---|
| Device-reported start / finish | Evidence in the carer's trust record |
| Server-received completion time | Same record |
| Server-recorded check-in | Allocation actual start |
| Office-recorded time | Trust record (`office`), with who, when and why; attendance event |
| Recorded attendance | Allocation / visit actual times, and events |
| Approved payable interval | Reconciliation pay window |

Order of trust — start: office-verified → server check-in → carer-reported (flagged). Finish: office-verified → carer-reported within 15 minutes of the server receiving it (otherwise flagged) → server time. A time in the future is refused.

```
 completion from the app ──► trusted times resolved ──► allocation actual times
        │                            │
        │                            └─ needs review? ─► UNVERIFIED_TIMES on that carer's row
        ▼                                                 (priced, held for a person; other carers unaffected)
 evidence kept as sent                                    office verifies ─► flag cleared, row repriced
```

The same rules apply to all three completion paths: the lead carer, a support carer finishing before the lead, and a support carer clocking out after the lead has closed the visit (found and fixed in this sprint).

Office corrections: on a visit still in progress the time is recorded and used when the visit completes; on a completed visit the times are updated and unpaid pay is repriced; on a settled visit a pending pay correction is raised.

---

## 7. Authorisation and scope

| Action | Permission | Maker / checker |
|---|---|---|
| Prepare a visit pay run, enter pay items, record corrections | `billing.payroll_runs.manage` | — |
| Approve / lock a visit pay run | `billing.payroll_runs.approve` | Not the run's creator |
| Approve bonus, adjustment, correction, reversal | `billing.payroll_runs.manage` | Not the person who entered it |
| Prepare a UK payroll run, cancel an open run | `payroll.runs.manage` | — |
| Close a UK payroll run | `payroll.runs.close` | Not the run's creator |
| Reopen a closed UK run | `payroll.runs.reopen` | Refused once a payout is approved or a live FPS exists |
| Approve a payout batch | `billing.employee_payouts.approve` | Not the batch's creator |
| Record the payment | `billing.employee_payouts.settle` | Needs payment reference and date |
| Bulk delete / reset | `billing.financial_reset` | Environment must allow it |

The six approval powers and `audit_logs.delete` are never implied by Super Admin. Scheduled jobs hold no powers: the payout job can only propose a draft.

**Scope (who sees whose pay).** One company per deployment; branches are locations.

| Endpoint kind | Rule (`PayrollScopeGuard`) |
|---|---|
| Whole-organisation records: pay runs, UK runs, payout batches, pay items, payroll settings | Needs organisation-wide pay access: a company-wide role (Super Admin, Admin, Master Staff Allocation) or the permission `payroll.scope.organisation` |
| One employee's pay (earnings, profile, pay agreement, payslip, pay card history) | The employee must be in a branch the user is assigned to; otherwise "not found" |
| Lists by branch (salaries, reconciliations, payslips, payroll employees) | A branch the user is assigned to must be named |
| Pay audit entries | Hidden from users without organisation-wide pay access |
| Carer accounts | Their own pay only |

Organisation-wide pay access travels with the pay jobs on the responsibilities screen ("Approve pay and record payments", "Create payroll", "Carer pay & payouts"). There is no legal-employer dimension in the data model (decision D-07).

The responsibilities screen shows, from the roles actually assigned, which users hold each pay power, and warns when nobody can approve, close or settle, or when the only approver is also the only preparer.

---

## 8. Earning status and payment state

One projection of where a visit's pay has reached is used by the office earnings screens and the carer app (`earning-status.util`).

```
 RECORDED ─► RECONCILED ─► APPROVED ─► IN DRAFT PAY RUN ─► IN LOCKED PAY RUN ─► IN UK PAYROLL (not closed)
 (awaiting     (priced,     (ready for                                               │
  review)       awaiting     payroll)                                                 ▼
                approval)                                              PAYROLL PROCESSED  (UK run closed)
                                                                                      │
 REJECTED                                                PAYMENT PREPARED ─► PAYMENT APPROVED ─► PAYMENT RECORDED
                                                         (draft batch)       (approved batch)    (batch marked paid)
```

Phases: Earned → Payroll processed → Payment prepared → Payment recorded. A visit in a cancelled UK run falls back to where it was. A correction shows beside the stage as "awaiting approval" or as the adjustment applied.

Payment states of a payout batch (`payment-state.util`):

| State | Reached today? | Evidence |
|---|---|---|
| Draft | Yes | Batch created by a person or proposed by the monthly job |
| Approved | Yes | A second user approved it |
| Manually recorded payment | Yes | A person typed a reference and date (`settlementSource = MANUAL_ENTRY`) |
| Cancelled | Yes | A person cancelled a draft or approved batch |
| Prepared, Submitted, Acknowledged, Rejected, Failed, Returned | No | Need a payment file and a bank or provider interface |
| Confirmed settlement | No | Needs a bank statement or provider report matched by the system (`BANK_CONFIRMED`) |

The states that cannot be evidenced are defined, so a later bank connection adds transitions without renaming anything, but no screen or endpoint can set them. "Payment recorded" never means "confirmed by a bank".

---

## 9. Not built yet *(target)*

| Area | Target |
|---|---|
| Pay cards | Published versions of every calculation input, with review before publication |
| Earnings | Cancellation and no-access pay, travel as recorded activity, expenses, guaranteed hours, leave accrual |
| Compliance | Minimum wage on the pay reference period for every worker type; contractual wage floors |
| Payroll | PAYE refunds, per-year statutory catalogue, loans, pensions, deductions framework, year end |
| HMRC | Schema validation, final outcomes, corrections |
| Payments | Bank file or provider, submitted / failed / returned states, statement reconciliation |
| Access | Legal-employer scoping; encryption of bank details and NI numbers |
