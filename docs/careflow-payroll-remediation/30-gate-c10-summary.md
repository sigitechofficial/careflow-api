# 30 — Gate C10: National Insurance Data Stored for Future RTI

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c10` (backend only, on `gate-c9`) · Synthetic data only. No FPS/EPS, no HMRC contact, no push or deployment. PAYE, NI rates and formulas, wages, net pay, category selection, locking and approval are unchanged.

## Fields persisted

**UK payroll run row (`UkPayrollRunEmployee`): the period snapshot.**

- **Existing, unchanged:** `niCategoryApplied`, `employeeNi`, `employerNi`, `directorNicMethodApplied` (C7: `AN` marks a director on the annual method; null otherwise).
- **New:** `niableEarnings`, `niEarningsAtLel`, `niEarningsLelToPt`, `niEarningsPtToUel` (Decimal 12,2).
- **NI-able earnings are this payment's gross,** never PAYE taxable pay.
- **The band figures are this payment's share of its earnings period's bands:** the bands on the period total so far, less those of the earlier payments. That means:
  - a supplementary run in the same period never counts LEL or PT twice;
  - a director's later payment adds only its share of the cumulative annual or pro rata bands (C7 rules).

  Draft recalculation overwrites them; closed rows are not recalculated.

**YTD (`EmployeePayrollYtdContribution`, the existing per-run, idempotent and reversible record of the ledger).**

- **Closing now also copies onto each contribution:**
  - the NI category;
  - the director method;
  - NI-able earnings;
  - the three band figures.

  Employee and employer NI were already stored.
- **YTD per category comes from `niYtdByCategory(employeeId, taxYearId)`.** It sums the contributions that are not reversed, per NI category and method, and gives NI-able earnings, the three bands, and employee and employer NI to date.
- **A category change keeps the earlier category's figures,** and a director's period is kept apart from earlier ordinary pay.
- **Closing posts once:** the existing unique contribution per run applies. Reactivating a run reverses the contribution as before.
- **Refused, rather than stored misleadingly:** a supplementary payment under a different category from the earlier payment in its earnings period. A director category change was already refused in C7.

## Files changed

- `prisma/schema.prisma` and the new migration
- `src/payroll/payroll-statutory.util.ts`: band shares in the result, from the existing calculation
- `src/payroll/payroll-runs.service.ts`: persistence and close posting
- `src/payroll/payroll-ytd.util.ts`: contribution columns and `niYtdByCategory`
- New `test/payroll-int/ni-rti-data.int-spec.ts`

## Migration

`20261023100000_ni_rti_data`: additive, ten nullable columns (four on the run row, six on the contribution). Nothing is backfilled.
- Applied once on the disposable rehearsal database: 61 of 61 checks passed, including the schema match.
- Not applied to the dev database, and neither is C7's `20261022100000_director_nic`.

## Commit

Backend `ad5ddb5` (this report in the next commit).

## Tests

| Check | Result |
|---|---|
| New `ni-rti-data` integration spec: 4 checks | 4 passed, 0 failed |
| Existing `paye-cumulative` integration spec (C1–C7 NI and PAYE) | 9 passed, 0 failed |
| Existing `payroll-statutory.util.spec` (engine changed) | 35 passed, 0 failed |
| Backend type-check | Clean |

**The four checks:**
1. **Category A, £3,000:** £3,000 / £559 / £489 / £1,952, NI £156.16 / £387.45. These survive recalculation, are copied once on close, and stay unchanged when the run is closed.
2. **Two closed months:** YTD category A £6,000 / £1,118 / £978 / £3,904, NI £312.32 / £774.90, from 2 contributions.
3. **Supplementary £1,000:** bands £0 / £0 / £1,000. YTD £4,000 / £559 / £489 / £2,952.
4. **Category A then M:** two category rows. A supplementary payment under A after M is refused.

## Historical-data and RTI blockers

- **Legacy records.** Runs closed before this migration have null NI figures: no values were guessed. `niYtdByCategory` lists them as `runsWithoutNiData`, or find them with `niableEarnings IS NULL`. A 2026–27 FPS needs those runs reconstructed first.
- **Director appointed mid-year.** The ordinary and director (AN) figures are kept as separate rows of the same letter. How they combine on one FPS letter is not decided (CA44 para 50 allows two payroll records). Confirm before building the FPS.
- **No API or screen** exposes the NI YTD yet, and the existing FPS utilities are not connected to these fields.
- **Migrations C7 and C10 must be applied deliberately** to the dev database (`prisma migrate deploy`).
- The client was regenerated, but the engine file was locked again by a running process. The client code is updated; the engine is unchanged.

## Next feature recommendation

**C11: connect the FPS data builder (no submission)** to the run row and `niYtdByCategory`, with:
- the period and YTD values per letter;
- the director indicator;
- a blocking check for runs without NI data.

Before that, decide the mid-year director reporting rule.
