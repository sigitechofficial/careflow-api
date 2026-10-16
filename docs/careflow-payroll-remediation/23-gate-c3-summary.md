# 23 — Gate C3: Scottish PAYE 2026–27 (Standard S Tax Codes)

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c3` (backend only, on `gate-c2`) · Synthetic data only. No push, deployment, HMRC submission or payment. No migration. Not a claim of full statutory compliance.

## Implemented changes (existing engine, no new one)

- **Scottish bands, 2026–27 only.** `scottishIncomeTaxBands(taxYearStart)` returns the GOV.UK bands of taxable pay only for the year starting 6 April 2026:

  | Rate | Up to (annual) |
  |---|---|
  | 19% | £3,967 |
  | 20% | £16,956 |
  | 21% | £31,092 |
  | 42% | £62,430 |
  | 45% | £125,140 |
  | 48% | above |

  It returns nothing for any other year, so 2025–26 figures are not assumed.
- **Selection.** The run picks the Scottish bands only for an S code. The bands to date are in proportion to the periods so far and are not rounded, as for England. The rest is unchanged:
  - Tables A free pay;
  - taxable pay rounded down to the pound;
  - tax rounded down to the penny.
- **Unchanged for S codes:** cumulative PAYE, Week 1 / Month 1 (including week 53), refunds, the 50% regulatory limit, net pay and YTD posting once per closed run.
- **Never England bands.** The UK run refuses an unsupported Scottish code before calculating, naming the reason. The engine itself throws on one, so England rates cannot be used by mistake.
- **England, Northern Ireland and Wales (C1/C2):** unchanged. The existing checks still pass.

## Files and commit

- `src/payroll/payroll-statutory.util.ts` and its spec
- `src/payroll/payroll-runs.service.ts`: passes the tax year's Scottish bands
- `test/payroll-int/paye-cumulative.int-spec.ts`

Commit: backend `1106084` (this report in the next commit).

## Tests (run once)

| Check | Result |
|---|---|
| Unit: 3 new C3 checks (HMRC examples 7 and 8; band limits, example 9 and refusals; W1/M1 and the limit) plus the C1/C2 checks | 22 passed |
| Integration `paye-cumulative`: new S1257L check through the UK run (April £392.27, May £392.48, net pay, ledger £784.75, nothing doubled) plus the C1/C2 checks | 5 passed |
| Backend type-check | Clean |

All expected values are as printed in HMRC's *Taxable Pay Tables Manual Method* for 2026–27 (Scottish pages 12–25):
- Example 7: S431L, week 18, Tables A £1,495.08, taxable £116, tax £22.04.
- Example 8: month 4, taxable £4,133 → £813.37.
- Example 9: month 4, taxable £49,214 → £19,500.83 (top rate).
- Tables C limits at month 1: £62.89, £279.29, £526.67, £1,623.72 and £3,975.44.
- Month 2 column 6: £558.58.

## Scottish codes

- **Supported (2026–27 only):** S followed by a number and L, M, N or T, for example S1257L, S431L, S1383M, S1131N and S1257T.
- **Refused:**
  - `SK…` (Scottish K);
  - `SBR` and `SD0` to `SD3` (flat rate);
  - `S0T` and `SNT`;
  - malformed codes such as `S1257` and `S12A57`;
  - any S code in a tax year without recorded Scottish bands.

## Compliance blockers (still open)

- SK codes, Scottish flat-rate codes, S0T and SNT.
- Scottish bands exist only for 2026–27. Each new year needs its own figures before an S code can be taxed.
- Whether an employee is a Scottish taxpayer is taken from the code HMRC issues. There is no check of residence.
- Still to do from C2: BR, D0 and D1 cumulatively, a year-end report of uncollected tax, starter checklist and P45 codes, and strike refunds.
- No student loans, pensions, statutory payments or RTI.

## Next sprint

**C4: Welsh CK and Scottish SK codes.** These are K codes on the Welsh and Scottish bands and reuse the C2 limit logic. After that, SBR and SD0–SD3 on the Scottish rates.
