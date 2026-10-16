# 36 — Gate C16: Workplace Pension Contributions (Relief at Source)

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c16` (backend only, on `gate-c15`) · Synthetic scheme and rates only. They are not Allfor Care's scheme, whose provider, rules and basis must be confirmed before real payroll. No push or deployment.

**Implemented (existing engine)**
- **Calculation:** defined contribution on qualifying earnings, using the TPR 2026–27 monthly limits (£520 to £4,189), with relief at source. Four figures are kept separately:

  | Figure | On £3,000 |
  |---|---|
  | Gross employee contribution | £124.00 |
  | Taken from net pay (80%) | £99.20 |
  | Provider tax relief (20%) | £24.80 |
  | Employer contribution | £74.40 |

- **What it touches:** only net pay. PAYE, NI and student loans are unchanged, and the employer contribution is a separate liability.
- **Enrolment record:** contributions come only from a recorded enrolment on the payroll profile (audited profile API): status `ENROLLED`/`NOT_ENROLLED`, enrolment date, scheme and policy references, basis `QUALIFYING_EARNINGS`, `RAS`, and the rates. Nobody is auto-enrolled. A confirmed `NOT_ENROLLED` deducts nothing and is not an eligibility assessment.
- **Pensionable pay:** visit wages, salary, paid travel time and minimum-wage top-up. Expenses are never included; other or unknown pay is refused.
- **Payroll records:** the run row keeps the pension figures; the YTD contribution and the ledger keep employee gross, employee net and employer to date. Draft recalculation overwrites, closing posts once, reversal undoes it, closed runs are unchanged, and a supplementary payment applies the limits once.
- **Refused:**
  - status not recorded (for everyone: the harness records a synthetic `NOT_ENROLLED`);
  - incomplete details;
  - `NET_PAY`;
  - another basis;
  - rates under 8% in total, or under 3% from the employer;
  - non-monthly pay or another year;
  - a status change within the pay reference period.

**Files:**
- `prisma/schema.prisma` and the migration
- `payroll-statutory.util.ts`, `payroll-runs.service.ts`, `payroll-ytd.util.ts`
- profile DTO, service and mapper; `test/payroll-int/harness.ts`
- new `src/payroll/payroll-pension.spec.ts` and `test/payroll-int/pension.int-spec.ts`

**Migration:** `20261027100000_workplace_pension` adds 20 columns. Rehearsed (61 of 61), not on the dev database.

**Commit:** backend `4347ef6`.

**Tests**
- Pension unit spec: 2 passed. Statutory unit spec: still passes (41 together).
- Pension integration spec: 2 passed.
- Directly affected statutory integration specs: 22 passed.
- Type-check clean.

**Unsupported:** auto-enrolment assessment, opt-in/opt-out and refunds; net pay arrangement and salary sacrifice; non-monthly pay; other bases (pensionable pay, total earnings); provider export and payment; payslip and FPS display; a screen for these fields.

**Next:** C17, a pension fields screen on the payroll profile (status, scheme, rates, policy reference), so enrolment can be recorded before any run, which is now required.
