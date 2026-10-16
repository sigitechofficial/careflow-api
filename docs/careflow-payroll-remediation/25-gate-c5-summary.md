# 25 — Gate C5: Scottish Flat-Rate Codes and Welsh Allowance Rate Routing

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c5` (backend only, on `gate-c4`) · Synthetic data only. No push, deployment, HMRC submission or payment. No migration or new model. Closed payroll history is untouched. Focused tests only: this is not a claim of production compliance.

## Implementation completed (existing engine)

**Scottish flat-rate codes.** GOV.UK *What your tax code means*: SBR, SD0, SD1, SD2 and SD3 tax all pay at the Scottish basic, intermediate, higher, advanced and top rate.

- **The rate is the tax year's own.** `scottishFlatRatePercent` takes it from the matching band of `scottishIncomeTaxBands`. For 2026–27 that is 20%, 21%, 42%, 45% and 48% (GOV.UK *Rates and thresholds for employers 2026 to 2027*).
- **No allowance:** free pay is 0.
- **Existing rounding:** taxable pay is rounded down to the pound, then tax down to the penny.
- **The recorded basis is used:** cumulative unless Week 1 / Month 1 is recorded. Cumulative keeps refunds. The 50% limit, net pay and YTD posting work as before.
- **Refused:**
  - in a year without Scottish bands (no England rates are used);
  - malformed codes such as `SD4`, `SD` and `SBRX`.

**Welsh C allowance codes.** Codes such as C1257L (and C0T) now use `welshIncomeTaxBands(taxYearStart)` instead of the England rate set.

- The allowance calculation is unchanged: Tables A, cumulative, Week 1 / Month 1, refunds and the 50% limit.
- 2026–27 gives the same figures as before.
- In a year without verified Welsh bands the calculation is blocked. Before C5 it used England's rates in that case.

## Files changed

- `src/payroll/payroll-statutory.util.ts` and its spec
- `test/payroll-int/paye-cumulative.int-spec.ts`

The service already passed both band sets in C4.

**Commit:** backend `c9982c1` (this report in the next commit).

## Tests (run once each)

| Check | Result |
|---|---|
| Unit `payroll-statutory.util.spec`: 3 new C5 checks plus C1–C4 | 29 passed, 0 failed |
| Integration `paye-cumulative`: 1 new C5 scenario plus C1–C4 | 7 passed, 0 failed |
| Backend type-check | Clean |

**The three unit checks:**
1. **Rate mapping:** £1,000 → £200, £210, £420, £450 and £480; England D0 is £400.
2. **Flat rate on the recorded basis:**
   - SD3 cumulative: £2,400 due, £500 deducted under the limit, £1,900 held back.
   - SD1: £320 refunded.
   - Week 1 / Month 1: earlier tax is not looked at.
   - Refusals.
3. **C1257L on the Welsh bands:**
   - £390.20, and £1,028.46 across the 40% band (HMRC Tables C).
   - A synthetic Welsh rate changes only the C code.
   - Refund and Week 1 / Month 1 behave as before.
   - Refused with no Welsh bands.

**The integration scenario:**
- C1257L in April: £190.20, net pay £1,733.64.
- Corrected to SD1 before closing: £840.00, net pay £1,083.84.
- May, cumulative: £840.00.
- The ledger ends at £4,000 gross and £1,680 tax. Nothing is doubled.

Only existing tests that expected the now-supported codes to be refused were changed: they now use `SD4`.

## Remaining PAYE gaps

- **Welsh CBR, CD0, CD1 and CNT** still use England's rates.
- **England BR, D0 and D1 (and CBR/CD0/CD1)** are always applied on Week 1 / Month 1. The Scottish flat-rate codes follow the recorded basis.
- **England `D2`,** which is not an HMRC code, is still read as D1. It should be refused.
- **S0T and SNT** are refused.
- **Scottish and Welsh bands** exist for 2026–27 only.
- **Not yet built:** starter checklist and P45 codes, a year-end report of uncollected tax, strike refunds, and a check of the code against HMRC's latest notice.

## Recommended Gate C6: National Insurance

The NI step today works on each period alone, with `round2` rounding.

- **Check the 2026–27 Class 1 figures against GOV.UK:** each category's employee and employer rates, and the LEL, PT, ST, UEL, UST, AUST, FUST and IZUST thresholds. Refuse any category the engine does not model rather than defaulting to A.
- **HMRC exact percentage method:** rounding as HMRC specifies, and LEL-to-PT earnings recorded for RTI.
- **Directors:** the annual earnings period, cumulative.
- **Multiple and irregular periods:** week 53, and payments covering more than one period.
- **Employer NI totals per run.** Employment Allowance only if the client confirms eligibility.
