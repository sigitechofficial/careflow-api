# 02 — Change Log

Newest first. Audit IDs in brackets. Database detail is in `04-database-changes.md`.

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
