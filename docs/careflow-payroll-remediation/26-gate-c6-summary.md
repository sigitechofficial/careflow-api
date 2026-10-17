# 26 — Gate C6: Class 1 National Insurance (Employee and Employer)

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c6` (backend only, on `gate-c5`) · Synthetic data only. No push, deployment, HMRC submission or payment. No migration. PAYE is unchanged. Focused tests only: this is not a claim of production compliance.

## NI functionality implemented (existing engine, `payroll-statutory.util.ts`)

- **Employee (primary) and employer (secondary) NI are worked out separately.** HMRC's exact-percentage rounding is applied to each: nearest penny, with "amounts of £0.005 or less" disregarded (CWG2, NIM11002). Previously the engine rounded half a penny up.
- **Thresholds come from the tax year's own rate set.** Weekly figures are used for weekly periods, ×2 for fortnightly, ×4 for four-weekly, and monthly figures for monthly periods. For 2026–27, from GOV.UK:

  | Threshold | Weekly | Monthly |
  |---|---|---|
  | LEL | £129 | £559 |
  | PT | £242 | £1,048 |
  | ST | £96 | £417 |
  | UEL, and AUST / UST / VUST | £967 | £4,189 |

  Rates: employee 8% between PT and UEL and 2% above; employer 15%.
- **Built-in rates are now used for 2026–27 only.** Before C6 they were also used for 2025–26, whose NI figures are not identical (its LEL differs). Any other year needs its own recorded rate set, or the calculation is refused.
- **NI-able earnings** are the period's gross pay before the tax allowance. Expense reimbursements are not included, and PAYE taxable pay is not used.
- **Data recorded for each employee row:**
  - the NI category applied;
  - employee NI and employer NI, stored separately;
  - net pay = gross − tax − employee NI (employer NI never reduces pay).

  The run stores the employee NI, employer NI and net pay totals. The explanation also records the NI-able earnings and the RTI bands (at LEL, LEL–PT, PT–UEL); there are no separate columns for these.
- **Recalculation** overwrites the run's own figures; nothing is added twice. A closed run cannot be recalculated.
- **Supplementary run in the same earnings period.** NI is worked out again on the total of the period's payments (CWG2), less what the closed runs of that period already paid.
- **Fail closed.** A missing NI category, or any category other than A, C, H, M or V, is refused with the reason. It is never treated as A.

## Categories supported

| Category | Employee NI | Employer NI |
|---|---|---|
| A | Standard rates | 15% above the ST |
| C | None (over State Pension age) | 15% above the ST |
| H, M, V | Standard rates | 0% up to the upper secondary threshold, 15% above |

**Refused:** B, F, I, J, L, S, Z, X and any other letter, or no category.

## Files changed

- `src/payroll/payroll-statutory.util.ts` and its spec
- `src/payroll/payroll-runs.service.ts`: category refusal, period total for a supplementary run, built-in rates for 2026–27 only
- `test/payroll-int/paye-cumulative.int-spec.ts`
- `test/payroll-int/harness.ts`: `giveTaxCode` now also records a synthetic category A

## Commits

Backend `0ca989e` (NI) and `0390fce` (built-in rates for 2026–27 only). This report is in the next commit.

## Focused tests

| Check | Result |
|---|---|
| Unit `payroll-statutory.util.spec`: 3 new NI checks (A; C; H/M/V with refusals) plus the existing checks | 32 passed, 0 failed |
| Integration `paye-cumulative`: new C6 check; unsupported-category assertions (B, none) added to the existing refusal test | 8 passed, 0 failed |
| Backend type-check | Clean |

The integration spec and the type-check ran a second time after the small rate-year fix.

**Category A unit check:**
- £3,000 a month: employee NI £156.16, employer NI £387.45, net pay £2,453.64.
- £5,000 a month: £267.50 / £687.45.
- £500 a week: £20.64 / £60.60.
- £1,000.10 a month: employer £87.46 (the £0.005 is disregarded).

**H/M/V unit check:**
- £3,000 a month: employer NI £0.
- £5,000 a month: employer NI £121.65.
- £1,000 a week: £58.66 / £4.95.

**Integration check:**
- A on £3,000: £156.16 / £387.45, net pay £2,453.64. Run totals are unchanged on recalculation.
- Category M recorded: employer NI £0.
- After closing, a supplementary £1,000 in the same period: tax £200, employee NI £80, employer NI £150, net pay £720. The closed run is untouched.

No existing NI expectation had to change.

## Known NI limitations

- **Directors:** no director status is recorded, so a director would be treated by the ordinary period rules. This blocks paying directors until C7.
- **Upper secondary thresholds:** AUST, UST and VUST are taken as the rate set's UEL. That is correct for 2026–27, but there is no separate field.
- **Not calculated:** categories B, J, Z, the zone categories (F, I, L, S) and X; Employment Allowance (no confirmed eligibility).
- **NI-able earnings are the run's gross.** Salary sacrifice, benefits and non-NI-able payments are not modelled, and the deductions netted into the gross were not reviewed.
- **Earnings periods:** a supplementary run is combined only with closed runs of the same pay period. Runs on another schedule, and aggregation across jobs, are not handled.

## Next Gate C7 recommendation

**C7: director NI and NI data for RTI.**
1. Record director status and the date of appointment (a small migration), and refuse to run a director on ordinary periodic rules.
2. Implement the annual earnings period (cumulative, with pro-rata thresholds in the year of appointment).
3. Store the LEL, LEL–PT and PT–UEL bands and the YTD NI per category on the run row and the ledger, ready for the FPS.
