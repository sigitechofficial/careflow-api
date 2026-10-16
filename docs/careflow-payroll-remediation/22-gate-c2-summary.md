# 22 — Gate C2: K Tax Codes and the 50% PAYE Regulatory Limit

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c2` (backend only, on `gate-c1`) · Synthetic data only. No push, deployment, HMRC submission or payment. No migration. Not a claim of full statutory compliance.

## What was implemented (in the existing engine, `payroll-statutory.util.ts`)

**K codes (England/NI).** HMRC Pay Adjustment Tables A give a K code's "additional pay", worked out like free pay and added to pay instead of taken off it. This is applied on both the cumulative and the Week 1 / Month 1 basis, with the existing rounding (taxable pay to date down to the pound, tax down to the penny). Refused, not guessed: Welsh `CK`, Scottish `SK`/`S`, a bare `K` and `K0`.

**Tables A for codes over 500.** As HMRC prints them: the code is split into units of 500, the remainder comes from the table and each unit adds £416.67 a month (£96.16 a week). Code 1257 is therefore £214.92 + 2 × £416.67 = **£1,048.26** a month, not the £1,048.25 used in C1 (a 1p a month correction). It changed no C1 tax figure; only the inputs of two HMRC table checks moved by a penny.

**50% regulatory limit.** HMRC: "Tax deducted on any one day cannot exceed 50% of the gross pay for that period", for all codes since 6 April 2015 (PAYE11050).

- The limit applies to PAYE only, on that period's gross pay. NI and refunds are not limited.
- The result now keeps the tax due this period and the tax not deducted separately (`taxDueThisPeriod`, `taxNotDeductedOverLimit`). The employee's statutory explanation on the run states the amount held back.
- **Cumulative:** the shortfall stays in tax due to date and is collected on a later pay day as the limit allows. **Week 1 / Month 1:** nothing is carried.
- The YTD ledger holds the tax actually deducted, posted once per closed run.

## Changed files

- `src/payroll/payroll-statutory.util.ts` and its spec
- `test/payroll-int/paye-cumulative.int-spec.ts`

## Commit

Backend `2d7a3d6` (this report in the next commit).

## Tests (run once)

| Check | Result |
|---|---|
| Unit spec: 3 new C2 checks (K additional pay; the limit for a K and a non-K code, NI and refunds not limited; cumulative catch-up and Week 1 / Month 1) plus the C1 checks updated | 19 passed |
| Integration `paye-cumulative`: new C2 check (K1500 on £400 a month → £200 deducted, net £200, ledger £200 then £400, nothing doubled on recalculation) plus the C1 checks | 4 passed |
| Backend type-check | Clean |

**Expected values come from HMRC as printed:**
- Tables A Month 1: 154 → £129.09, 257 → £214.92, 475 → £396.59, 500 → £417.42, and £416.67 per unit of 500.
- The Taxable Pay Tables' 20% on whole pounds.
- HMRC example 3 (431L, week 11: tax due £223.20 on £203 pay) now also shows the limit: £101.50 deducted, £121.70 held back.

No other suites were run (sprint rule).

## Remaining PAYE features

- Scottish codes (S, SK) and Welsh K codes (CK)
- BR, D0 and D1 on a cumulative basis
- Uncollected tax at year end: shown per period, but there is no year-end report
- Starter checklist / P45 emergency codes
- Week 53 for cumulative codes is moved to a Week 1 basis only
- Strike refund rules

## Next Gate C3 recommendation

**C3: Scottish income tax.** Load the S-code rate set (bands and rates for 2026–27 from GOV.UK), apply it to S and SK codes through the same engine, and add HMRC's Scottish examples from the Taxable Pay Tables as checks. Welsh CK can come with it, as it only reuses the K logic with the Welsh (currently equal) rates.
