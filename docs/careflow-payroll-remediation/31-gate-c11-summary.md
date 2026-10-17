# 31 — Gate C11: Student and Postgraduate Loan Deductions

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c11` (backend only, on `gate-c10`) · Synthetic data only. No FPS, UI, push or deployment. PAYE and NI formulas are unchanged. Focused tests only: not a claim of production compliance.

## Loan deductions implemented (existing gross-to-net engine)

- **Rates and thresholds.** Student loan Plan 1, 2, 4 or 5 is deducted at 9%, and the postgraduate loan at 6%. Both apply to earnings over the GOV.UK 2026–27 monthly thresholds:

  | Loan | Monthly threshold |
  |---|---|
  | Plan 1 | £2,241.66 |
  | Plan 2 | £2,448.75 |
  | Plan 4 | £2,816.25 |
  | Plan 5 | £2,083.33 |
  | Postgraduate loan | £1,750.00 |

- **Rounding:** each deduction is rounded down to the whole pound.
- **Earnings:** the earnings period's NI-able pay, the same pay employer NI is worked on, never PAYE taxable pay.
- **Basis:** non-cumulative, each period on its own. Nothing is carried, and nothing is deducted in arrears.
- **Plans:** one student plan plus an optional postgraduate loan, kept separate. The plan comes only from the recorded profile settings (`studentLoanPlan1/2/4/5`, `postgraduateLoan`, kept in sync with `deductionElections`); no plan is assumed.
- **Effect on pay:** both loans reduce net pay only. PAYE, employee NI and employer NI are unchanged, and the explanation shows each loan calculation.
- **Supplementary run in the same month:** the deduction is worked out on the period's total pay, less what the closed earlier payment deducted, so the threshold applies once.
- **Recording:**
  - **Run row:** `studentLoanPlanApplied` (1/2/4/5/NONE), `studentLoanDeduction`, `postgraduateLoanApplied` and `postgraduateLoanDeduction`.
  - **YTD contribution:** `studentLoan` and `postgraduateLoan`.
  - **Ledger:** `studentLoanYtd` and `postgraduateLoanYtd`.

  A draft recalculation overwrites the run row, closing posts once (unique contribution per run), reactivating a run reverses the posting, and closed runs are not recalculated.
- **Refused, with the reason (never skipped silently):**
  - more than one plan recorded;
  - an active loan on a non-monthly schedule, or in a tax year without thresholds;
  - a director on the annual earnings period;
  - a loan change since an earlier payment in the same earnings period;
  - an earlier payment in that period calculated before C11.

## Supported plans and periods

Plans 1, 2, 4 and 5, plus the postgraduate loan, on **monthly** pay in **2026–27** only. Weekly, fortnightly and four-weekly pay, and other years, are refused for anyone with a loan.

## Files changed

- `prisma/schema.prisma` and the new migration
- `src/payroll/payroll-statutory.util.ts` and its spec
- `src/payroll/payroll-runs.service.ts`
- `src/payroll/payroll-ytd.util.ts`
- New `test/payroll-int/student-loans.int-spec.ts`

## Migration

`20261024100000_student_loans`: additive, eight columns.
- The amount columns default to 0, which is what earlier runs actually deducted. The plan and postgraduate flags stay null on earlier rows, marking them as calculated before C11. Nothing is backfilled.
- Applied once on the disposable rehearsal database: 61 of 61 checks passed.
- Not applied to the dev database, and neither are C7 or C10.

## Commit

Backend `96ebe5f` (this report in the next commit).

## Tests

| Check | Result |
|---|---|
| Unit: 2 new C11 checks plus the existing statutory checks | 37 passed, 0 failed |
| New `student-loans` integration spec: 2 checks | 2 passed, 0 failed |
| Affected `paye-cumulative` and `ni-rti-data` integration specs | 13 passed, 0 failed |
| Backend type-check | Clean |

**The four new checks:**
1. **The plans on £3,000:** Plan 1 £68, Plan 2 £49, Plan 4 £16, Plan 5 £82, plus the rounding boundaries.
2. **Plan 2 plus postgraduate loan:** £49 + £75 = £124. Net pay is £2,329.64, and PAYE and NI are unchanged.
3. **Through the UK run (two closed months):** YTD £98 / £150, posted once; the closed run is unchanged.
4. **Supplementary and refusals:**
   - A supplementary £1,000 deducts £90 / £60, and net pay is £570.
   - A loan change, two plans, and weekly pay are all refused.

One integration expectation was wrong in the first run: May's net pay had used April's tax. It was corrected to the cumulative PAYE figure (£390.40, net £2,329.44); the code was right.

## Remaining blockers

- **No effective dates or HMRC notices** (SL1/SL2, PGL1/PGL2, starter checklist answers) are stored. A loan is deducted for every period calculated while its flag is set.
- **"No loan" cannot be told from "never asked"** on the profile. Confirm each employee's loan status before real runs.
- **Weekly, fortnightly and four-weekly pay**, directors, and multiple plans (HMRC: use the lowest threshold until an SL1 arrives) are refused, not calculated.
- **Not yet done:** payslip and FPS output of the loan figures, and the end-of-employment rules.
- **Migrations C7, C10 and C11** must be applied deliberately to the dev database.

## Recommended next feature

**C12: weekly, fortnightly and four-weekly loan thresholds, plus SL1/SL2 and PGL1/PGL2 notice dates** on the profile, so that deductions start and stop by notice.
