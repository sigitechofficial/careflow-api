# 21 — Gate C1: PAYE Cumulative Tax and Refunds

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c1` (backend only, on `sprint-b4g`) · No push, deployment, HMRC submission or payment. Synthetic data only. No migration.

## 1. PAYE functionality implemented

The existing engine (`payroll-statutory.util.ts`, used by the UK run's tax and NI step) was corrected; no second engine.

**Defects found and fixed in the existing engine:**

| Was | Now (HMRC method) |
|---|---|
| Refunds were never made: tax this period was clamped at zero | Tax due to date less tax already deducted. A negative result is a refund, which raises net pay and reduces the YTD ledger at close |
| Free pay = code × 10 / periods (1257L: £1,047.50 a month) | Pay Adjustment Tables A: (code × 10 + 9) / periods, rounded up to the penny, × period number (1257L: £1,048.25 a month) |
| Taxable pay and tax rounded to the nearest penny | Taxable pay to date rounded **down** to the pound; tax due rounded **down** to the penny |
| 45% from taxable pay of £112,570 | Bands of taxable pay: basic to £37,700, higher to £125,140, then 45% |
| A missing or unrecognised code was taxed as 1257L | Blocking error naming the reason; no tax is calculated |

**Week 1 / Month 1.** The period 1 figures are applied to the period's pay alone, so there is never a refund. A weekly week 53 (fortnightly week 54, four-weekly week 56) is also taxed on that basis.

**Tax year.** A period whose payment date lies outside the run's tax year is refused. Built-in rates are used only for 2026–27 (and the identical frozen 2025–26 figures); any other year without its own recorded rate set is refused rather than given 2026–27 rates.

**Supported codes:** England/Northern Ireland and Welsh C codes (same rates), BR, D0, D1, 0T and NT, as before. **Refused:** no code, Scottish S codes, K codes (the 50% regulatory limit is not implemented).

**Recalculation and history.** Recalculation overwrites the run's own figures and posts nothing; the YTD ledger is posted once per run at close (unique contribution per run). Closed runs cannot be recalculated. A supplementary run reads the ledger of closed runs, as before.

## 2. Files changed

- `src/payroll/payroll-statutory.util.ts` and its spec
- `src/payroll/payroll-runs.service.ts` (code, tax-year and rate checks; week 53)
- New `test/payroll-int/paye-cumulative.int-spec.ts`
- `test/payroll-int/harness.ts` (`giveTaxCode`)
- `mileage-corrections`, `mileage-settlement` and the browser fixture: they now record a synthetic 1257L instead of relying on the old default

## 3. Commit

Backend `f572e56` (this report in the next commit).

## 4. Tests

| Run | Result |
|---|---|
| `payroll-statutory.util.spec` (7 existing, 2 of them corrected to HMRC figures; 9 new) | 16 passed |
| New `paye-cumulative` integration (cumulative and refund with net pay, YTD and closed history; Week 1 / Month 1; refusals) | 3 passed |
| Directly affected: `src/payroll` unit specs; `mileage-corrections`, `mileage-settlement`, `http-payroll-api`, `payouts` | 22 suites, 115 passed; 5 suites, 96 passed |
| Backend type-check | Clean |

**HMRC figures reproduced exactly:**
- Example 1 (431L month 4: £1,439.68, £392.00).
- Example 3 (431L week 11: £913.66, £223.20).
- Tables C tax due to date: £628.46 (month 1), £817.82 (week 1), £5,606.66 and £17,547.30 (month 4 examples).

The two corrected existing tests had encoded the old free pay (£390.50 → HMRC £390.20).

## 5. HMRC guidance used

- GOV.UK *Rates and thresholds for employers 2026 to 2027* (updated 1 September 2026): allowance £12,570; basic £37,700; higher to £125,140; Class 1 thresholds.
- HMRC *Taxable Pay Tables Manual Method* (use from 6 April 2025; bands unchanged for 2026–27): rounding rules, worked examples, Tables C limits and the 50% maximum deduction note.
- PAYE Manual PAYE11090: cumulative versus Week 1 / Month 1, and refunds on the cumulative basis.

## 6. Remaining PAYE scenarios

- Scottish codes (S prefix): refused.
- K codes and the 50% regulatory limit: refused.
- BR, D0 and D1 are still applied non-cumulatively.
- Starter checklist and P45 handling, which decide an emergency code: not done.
- Week 53 of an employee on a cumulative code is moved to a Week 1 basis for that payment only; check the employee's following-year code.
- Refunds are not restricted for employees on strike (not modelled).

## 7. Next Gate C2 recommendation

**C2: K codes and the regulatory limit**, then Scottish rates (an S-code rate set and bands). Both are refused today, so they are the next codes that real staff could carry. Student loans and the starter checklist after that.
