# 07 — Financial Architecture

How pay moves through CareFlow after Phase 0, and where each control sits. Sections marked *(target)* describe later phases and are not built.

---

## 1. Flow

```
EMPLOYMENT            PAY CARDS                 ATTENDANCE
employment record     card → version → rules    visit, allocation (one per carer)
pay agreement         carer card history        attendance events (append-only)
                      funder override           time trust record (server vs device)
        │                    │                          │
        └────────────────────┴───────────┬──────────────┘
                                         ▼
                         VISIT RECONCILIATION  (one row per visit × carer)
                         approved pay window · payable minutes · amount
                         card + version used · exceptions · approval
                                         │
             ┌───────────────────────────┼─────────────────────────┐
             ▼                           ▼                         ▼
      VISIT PAY RUN               PAY ITEMS                 UK PAYROLL RUN
      lines with claim keys       bonus, holiday, sick,     gross inputs:
      calculate → approve → lock  training, on-call,        locked visit-pay lines,
             │                    corrections, reversals    salary, provisional visits
             │                    (approved → next run)            │
             └──────────────► locked lines ───────────────────────►│
                                                             PAYE · NI → net → close
                                                                   │
                                              ┌────────────────────┼───────────────┐
                                              ▼                    ▼               ▼
                                         PAYSLIP            HMRC FPS / EPS    PAYOUT BATCH
                                                                              draft → approved → paid
                                                                              (evidence required)
```

Every arrow that moves money writes an audit entry.

---

## 2. Records and their role

| Area | Record | Role |
|---|---|---|
| Employment | `EmployeeEmployment`, `EmployeePayAgreement`, `EmployeePayrollProfile` | Who is paid, on what basis, with which tax details |
| Pay cards | `PayCard`, `PayCardVersion`, `PayCardRule`, `EmployeePayCardAssignment`, `EmployeeFunderPayAssignment` | The rate that applies to a carer on a date |
| Attendance | `ScheduledVisit`, `JobAllocation`, `VisitAttendanceEvent` | What happened. Events are never edited; a correction is a new event |
| Earnings (visits) | `VisitReconciliation`, `FinanceException` | The approved, priced result of a visit for one carer |
| Earnings (other) | `EmployeePayItem` | Non-visit pay, and the correction ledger |
| Visit pay | `PayrollRun`, `PayrollRunLine` | Gross pay lines for a period |
| Payroll | `UkPayrollRun`, `UkPayrollRunEmployee`, `UkPayrollInputLine`, year-to-date ledgers | Gross to net |
| HMRC | `PayrollHmrcSubmission` | FPS / EPS attempts |
| Payments | `EmployeePayoutBatch`, `EmployeePayoutLine` | Net pay to be paid, and proof it was |
| Audit | `AuditLog` | Who decided what, when |

---

## 3. One entitlement, one original payment

| Source | Identity | Enforced by |
|---|---|---|
| Visit earning | reconciliation (visit × carer) + earning component | `PayrollRunLine.claimKey` unique index |
| Pay item | pay item id | same index, plus `includedInPayrollRunId` when locked |
| Training / on-call activity | activity id | same index |
| Locked visit-pay line into UK payroll | line id | `UkPayrollInputLine.sourcePayrollRunLineId` unique index |
| Approved visit paid directly by a UK run | reconciliation | conditional claim at close (`paidByUkPayrollRunId`) |

Claims are written in the same transaction as the lines they belong to. A run that is recalculated or discarded releases its claims. Periods may overlap: an off-cycle or supplementary run simply finds less to claim.

Additional money for the same work is always a **different** record: a premium line derived inside a run, or an approved correction item with its own claim.

---

## 4. Settled pay is history

A visit is **settled** when it is in a locked visit pay run or was a provisional input of a closed UK run.

| Layer | What it does |
|---|---|
| Service | Refuses pay-side edits, rejection, overrun decisions, manual amounts and repricing of a settled visit |
| Database | Triggers refuse changes to the pay snapshot, to lines of locked runs and to locked runs, from any code path |
| Snapshot | The reconciliation keeps the approved window, minutes, amount, card and version, approver and time; the locked line keeps the amount paid |

**Corrections** state what the visit should have paid in total. The system works out the difference against everything settled so far and records it as an adjustment (`EmployeePayItem`, source `VISIT_CORRECTION`) holding the original line, the original amount and the corrected amount. A second person approves it; the next visit pay run pays or recovers it. A paid item can be reversed once by an equal and opposite item.

Source attendance can still be corrected as a fact. An office correction on a completed visit updates the recorded times; unpaid draft pay is repriced, and settled pay gets a pending correction.

---

## 5. Attendance time trust

| Time | Kept as |
|---|---|
| Device-reported start / finish | Evidence on the job (`employeeApp.attendanceTimes.evidence`) |
| Server-received completion time | Same record |
| Server-recorded check-in | Allocation / visit actual start |
| Recorded attendance | Allocation / visit actual times, and events |
| Approved payable interval | Reconciliation pay window |

The server check-in is the start whenever there is one. A reported time the server cannot corroborate still becomes the record (offline visits sync late) and raises `UNVERIFIED_TIMES`, which holds the visit for a person to approve. Office verification clears it.

---

## 6. Authorisation

| Action | Permission | Maker / checker |
|---|---|---|
| Prepare a visit pay run, enter pay items, record corrections | `billing.payroll_runs.manage` | — |
| Approve / lock a visit pay run | `billing.payroll_runs.approve` | Not the run's creator |
| Approve bonus, adjustment, correction, reversal | `billing.payroll_runs.manage` | Not the person who entered it |
| Close a UK payroll run | `payroll.runs.close` | Not the run's creator |
| Reopen a closed UK run | `payroll.runs.reopen` | Refused once a payout is approved or a live FPS exists |
| Approve a payout batch | `billing.employee_payouts.approve` | Not the batch's creator |
| Record the bank payment | `billing.employee_payouts.settle` | Needs payment reference and date |
| Bulk delete / reset | `billing.financial_reset` | Environment must allow it |

The six approval powers and `audit_logs.delete` are never implied by Super Admin. Scheduled jobs hold no powers: the payout job can only propose a draft.

---

## 7. Not built yet *(target)*

| Area | Target |
|---|---|
| Pay cards | Published versions of every calculation input, with review before publication |
| Earnings | Cancellation and no-access pay, travel as recorded activity, expenses, guaranteed hours, leave accrual |
| Compliance | Minimum wage on the pay reference period for every worker type; contractual wage floors |
| Payroll | PAYE refunds, per-year statutory catalogue, loans, pensions, deductions framework, year end |
| HMRC | Schema validation, final outcomes, corrections |
| Payments | Bank file or provider, submitted / failed / returned states, reconciliation |
| Access | Branch and legal-employer scoping; encryption of bank details and NI numbers |
