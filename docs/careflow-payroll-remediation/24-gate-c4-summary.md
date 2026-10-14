# 24 — Gate C4: Scottish SK and Welsh CK Tax Codes

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c4` (backend only, on `gate-c3`) · Synthetic data only. No push, deployment, HMRC submission or payment. No migration. Not a claim of full statutory compliance.

## Implemented features (existing engine, no duplicate K logic)

- **SK codes.** Additional pay comes from Pay Adjustment Tables A through the existing C2 calculation. It is added to pay, then taxed on the C3 Scottish bands for 2026–27.
- **CK codes.** The same additional pay, taxed on the new `welshIncomeTaxBands(taxYearStart)`. For 2026–27 these are the GOV.UK Welsh bands (20% to £37,700, 40% to £125,140, 45% above, page updated 1 September 2026). That year they equal England's, but they are recorded per year: no Welsh bands are assumed for any other year.
- **Both code families:**
  - cumulative and Week 1 / Month 1 (including week 53);
  - refunds on a cumulative code;
  - the 50% regulatory limit, with tax held back still due on a cumulative code;
  - net pay and YTD posting once per closed run, as before.
- **Refused, before any tax is calculated:**
  - malformed codes such as `SK`, `SK0`, `SK012`, `SK475L`, `CK`, `CK0` and `CKX`;
  - an SK or CK code in a tax year without verified Scottish or Welsh bands.

  The UK run names the reason, and the engine also throws, so England bands are never used instead. The tax jurisdiction comes only from the recorded HMRC code, never from an address.

## Files changed

- `src/payroll/payroll-statutory.util.ts` and its spec
- `src/payroll/payroll-runs.service.ts`: passes the tax year's Welsh bands
- `test/payroll-int/paye-cumulative.int-spec.ts`

**Backend commit:** `e501b99` (this report in the next commit).

## Focused tests (run once)

| Check | Result |
|---|---|
| Unit `payroll-statutory.util.spec`: 4 new C4 checks plus the C1–C3 checks | 26 passed, 0 failed |
| Integration `paye-cumulative`: new C4 check plus the C1–C3 checks | 6 passed, 0 failed |
| Backend type-check | Clean |

**The four unit checks:**
1. SK475 cumulative: month 1 £485.72, month 2 £485.93, refund −£148.02.
2. CK475 cumulative: £479.20 and £479.40, plus a 40% band crossing of £1,028.46.
3. Week 1 / Month 1 and the 50% limit: SK1500 and CK1500 on £400 are held to £200.00.
4. Malformed codes and years without verified bands are refused.

**The integration check:** CK475 then SK475 through a UK run.
- April: £479.20, recalculated as £485.72 after the code is corrected.
- May: £485.93.
- Net pay is correct, the ledger ends at £971.65, and nothing is doubled.

**Where the expected values come from (HMRC, as printed):**
- Tables A Month 1: 475 → £396.59; 1500 → £1,250.76.
- Scottish Tables C 2026–27: month 1 column 6 £279.29; month 2 column 6 £558.58; plus 21% from Tables D2.
- England/Wales Tables C: month 1 £628.46 at £3,142.

## Supported tax codes

- **England / Northern Ireland:** allowance codes, K codes, BR, D0, D1, 0T and NT.
- **Wales:** C allowance codes and CK codes (2026–27).
- **Scotland:** S allowance codes and SK codes (2026–27).

## Remaining PAYE gaps

- Scottish flat-rate codes (SBR, SD0–SD3), S0T and SNT are refused.
- BR, D0 and D1 are applied non-cumulatively only.
- **Welsh C allowance codes** (for example C1257L) still use the England rate set, as before C4. They should move to `welshIncomeTaxBands` too.
- Scottish and Welsh bands exist for 2026–27 only.
- Starter checklist and P45 codes, a year-end report of uncollected tax, and strike refunds.

## Recommended next feature

**C5: Scottish flat-rate codes (SBR, SD0–SD3) and Welsh C allowance codes on the Welsh bands.** Both are small changes to the same engine and close the remaining nation-code gaps.
