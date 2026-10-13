# 16 — Sprint B4C Summary: Annual Hours Settings and Audit Integrity

**Date:** 2026-10-13 · **Branch (both repositories):** `payroll-remediation/sprint-b4c`, on `sprint-b4b` · Nothing pushed, deployed, sent to HMRC or paid. All test data and multipliers are synthetic.

## 1. Task 1 — Annual hours configuration screen: DONE

**Payroll → Employer PAYE** has a new section, *Salaried hours annualisation*. It uses the B4B API unchanged.

- Shows each method: factor (contracted weekly hours × N weeks), effective date, status (Draft / Approved / Withdrawn), who entered it and when, who approved it and when, the policy reference, and for a withdrawn one the reason.
- **Enter** a proposed method (weeks, effective date, policy reference): `payroll.settings.manage`.
- **Approve** and **Withdraw** (with a reason): `payroll.pay_agreements.approve`. The user who entered a method sees an explanation instead of the Approve button, and the API refuses a self-approval (403).
- Earlier methods stay listed. A warning shows when no approved method applies today, and says that nothing is assumed in its place.
- No annual-hours field exists anywhere; weekly hours remain the contract's only figure.

**UK payroll run → Minimum wage compliance → Details** now shows, for salaried staff, the figures the run stored: contracted weekly hours, the method, basic hours of the year, calculation year, hours counted before the period and to date, excess hours, and the result (top-up or exception). Nothing is calculated in the browser. Without an approved method it still shows `POLICY_REVIEW_REQUIRED`, with the weekly hours and "None approved".

Backend additions were two read-only fields: names on the method list, and the contract's weekly hours on the assessment.

## 2. Task 2 — Atomic audit for two financial paths: DONE

| Path | Mutations now in one transaction with their audit entry |
|---|---|
| A. Visit wage approval decisions | Approve; reject; approve overrun; reject overrun; charge-only overrun decision on a settled visit. The repricing the decision triggers is inside the same transaction |
| B. Employee payroll profile | Create and update (tax code, NI category, loans, pension, bank details) |

If the audit entry cannot be written, the change is rolled back and the caller gets the controlled error from B4B (401 for a user who no longer exists, otherwise 500). The API stays up, no entry is skipped, and a retry leaves one entry. Permission checks and settled-pay rules are unchanged.

One behaviour follows from this: if repricing fails during an approval, the approval is now rolled back too. Before, the approval stayed with amounts that had not been recalculated.

## 3. Changed files

**Backend:** `src/payroll/payroll-settings.service.ts`, `src/payroll/payroll-runs.service.ts`, `src/billing/visit-reconciliations.service.ts`, `src/payroll/payroll-employees.service.ts`; tests `test/payroll-int/salaried-annual-hours.int-spec.ts`, new `test/payroll-int/audit-atomic-decisions.int-spec.ts`.

**Frontend:** new `src/features/payroll/components/SalariedHoursAnnualisationSection.tsx` (+ test); `NmwComplianceSection.tsx` (+ test); `pages/PayrollEmployerSettingsPage.tsx`, `types/payroll.types.ts`, `api/payroll.api.ts`, `hooks/usePayroll.ts`.

## 4. Commits (local, not pushed)

| Repository | Commit | What |
|---|---|---|
| Backend | `ed4b212` | Names on the method list; weekly hours on the assessment; effective-date test |
| Backend | `bb5f273` | Task 2: visit pay decisions and payroll profile saved with their audit entry |
| Backend | this commit | This report |
| Frontend | `fb5ce7d` | Task 1: annualisation section and annual position |

## 5. Tests

| Run | Result |
|---|---|
| Payroll integration suite, once at the end | **44 suites, 448 tests: all passed** |
| Backend unit (billing, payroll, guards, role-responsibilities, audit-logs, notifications) | 64 suites, 497 passed |
| Frontend `src/features/billing` and `src/features/payroll` | 14 files, 92 passed (13 new) |
| Type-check, backend and frontend | Clean |

- **Task 1, API:** propose; invalid values refused; self-approval refused; second-person approval; withdraw; no approved method; the method in force at the start of the pay period is used (not a draft, a withdrawn or a later-dated one). The existing salaried minimum wage tests pass unchanged.
- **Task 1, screen (9 + 4 tests):** warning with no method; entry form rules; list fields; own entry cannot be approved; approval and a refused approval; in-force banner; withdraw with reason; previous methods; read-only without the powers; annual position within the basic hours, exceeded with top-up, and with no method.
- **Task 2 (9 tests):** successful approval, rejection and profile change with their entries; audit failure rolls back approval, rejection, overrun decision, profile update and profile creation; deleted user refused (401) at sign-in and at write time; no permission (403); one entry after a retry; the next request works. Seven of the nine fail against the previous code.

**Browser check** (test instance on the payroll test database, synthetic fixture, never the development database): as the preparer, the section showed the synthetic fixture as in use, the form stayed disabled until complete, and entering 52.14 weeks created a Draft with no Approve button for its author. As the approver, Approve made it Approved with both names and dates, Withdraw needed a reason and showed it afterwards. On the December run, Details showed the annual position for a topped-up employee (30h a week, × 52, 1,560h, calendar-year boundaries, £152.30 added) and "not assessed" for one with no contracted hours. The login file was deleted and both servers stopped.

## 6. Migration

None. No schema change, so no rehearsal was run.

## 7. Annualisation policy configuration status

**Not configured.** No method exists in any real database. Until Allfor Care's multiplier, its written basis and its start date are entered by one authorised user and approved by another, salaried staff are reported as `POLICY_REVIEW_REQUIRED`. The screen to do this now exists. Test rows are marked synthetic and cannot be created through the screen or the API.

## 8. Remaining audit-after-mutation paths (backlog, not done here)

| Id | Path | Where |
|---|---|---|
| B4C-01 | Pay agreements: create, approve, update | `payroll-employees.service.ts` |
| B4C-02 | Visit edits that change pay: time edit, manual amount, attendance correction, approval withdrawn, recalculated amounts | `visit-reconciliations.service.ts` |
| B4C-03 | Pay evaluation failure retried or dismissed | `visit-reconciliations.service.ts` |
| B4C-04 | Payroll settings: employer settings, tax years, schedules, periods, tax codes, statutory rates | `payroll-settings.service.ts` |
| B4C-05 | Leave terms and leave entries | `leave.service.ts` |
| B4C-06 | Disruption pay rules: create, approve, retire | `visit-disruptions.service.ts` |
| B4C-07 | HMRC FPS and EPS submission records (an external send cannot be rolled back; needs its own design) | `payroll-hmrc-*.service.ts` |

In all of these a failed audit write now returns a controlled error and does not stop the API, but the change is not undone. Services outside billing and payroll were not surveyed.

## 9. Recommended next small sprint

**B4D — finish audit atomicity for pay:** B4C-01 and B4C-02, the two remaining paths that change what a person is paid, using the same pattern and the same tests. B4C-04 to B4C-06 can follow as one mechanical sprint. Paid-absence hours in the year (doc 15, gap 2) stay blocked on the client's answer about how leave hours are recorded.
