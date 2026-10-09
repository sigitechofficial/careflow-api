# Careflow — Wage Types & Paycard Enhancement: Phase 1 Analysis

Date: 2026-10-09 · Based on `careflow-api` (main + local uncommitted pay card versioning/history work) and `careflow-admin`.
Detailed evidence: the finance audit package `careflow-finance-payroll-audit-2026-10-09` (docs 03, 04, 05, 09, 11).

## 1. What already exists (reuse, do not duplicate)

| Area | Existing implementation | Files |
|---|---|---|
| Carer / employee | `Employee` + `EmployeeEmployment` (role, branch, contract type, grade, agency/bank flags, guaranteed hours, `defaultPayCardId`) | `prisma/schema.prisma`, `src/employee-employment/` |
| Paycard | `PayCard` (assignment level, stacking policy, holiday pay method, mileage settings, status, effective dates, **version**) + `PayCardRule` (day type, time band, rate type, amount, multiplier, additional £, % uplift, enhancement method, minimum minutes, priority, applies-to flags, **version**) | `src/billing/billing-cards.service.ts`, `pay-cards.controller.ts` |
| Rate history | `PayCardVersion` (new): editing rates of an active card creates a version; older visits keep older rates | `src/billing/pay-card-version.util.ts` |
| Assignment | Hierarchy: employee+funder override → carer's own dated card (`EmployeePayCardAssignment`, new) → INDIVIDUAL → ROLE → BRANCH → EMPLOYMENT_TYPE → WORKER_TYPE → ORGANISATION_DEFAULT | `pay-card-assignment.util.ts`, `employee-pay-card-assignment.util.ts` |
| Calculation engine | `calculateBandedPay`: splits visits at local midnight and rule boundaries (org timezone), per-segment day type (weekday/Sat/Sun/BH/Christmas…), stacking PRIORITY / HIGHEST / STACK, enhancement methods (absolute, +£/hr, %, multiplier, fixed shift allowance) | `src/billing/pay-time-band.util.ts`, `visit-reconciliation.util.ts` |
| Visit pay record | `VisitReconciliation` (one per visit × carer — double-ups priced independently), approved pay window/minutes, payable amount, pricing snapshot, pay card + version | `visit-reconciliations.service.ts` |
| Earnings ledger | Billing `PayrollRun` → `PayrollRunLine` (types incl. VISIT_PAY, TRAVEL_TIME, MILEAGE, NMW_TOP_UP, SLEEP_IN, WAKING_NIGHT, OVERTIME, ON_CALL_STANDBY, NON_VISIT_ACTIVITY, HOLIDAY_PAY, ALLOWANCE, EXPENSE, ADJUSTMENT) + `PayComponent` audit row per line (rate, multiplier, taxable/pensionable/NMW flags, explanation) | `src/billing/payroll-runs.service.ts` |
| Statutory payroll | UK run (PAYE/NI, YTD, FPS/EPS, payslips); salary via `EmployeePayAgreement` (SALARIED/HYBRID, annual salary) | `src/payroll/` |
| Travel / mileage | Inter-visit gap detection (travel/waiting), TRAVEL_TIME/WAITING_TIME/MILEAGE rules, manual miles on reconciliation, HMRC 10,000-mile split | `pay-inter-visit-travel.util.ts`, `pay-mileage.util.ts` |
| NMW | Hard-coded rate table, top-up per billing run | `pay-compliance.util.ts` |
| Bank holidays | `BankHoliday` table (date, name, **region**), seeded 2026 only, region not used | `lookups` schema |
| Leave / absence | `EmployeeHoliday`, `EmployeeAbsenceRecord` — no pay effect | `src/employee-holidays/`, `src/employee-absences/` |
| Training / NCA | `EmployeeNonCoreActivity` (includeInPayroll flag unused) | `src/employee-non-core-activities/` |
| Permissions | `billing.pay_cards.read/manage`, `billing.visit_reconciliations.*`, `billing.payroll_runs.*`, `payroll.*` | `prisma/seed.ts` |
| UI | Paycard list + full-page create/edit with rules editor (hourly bands, fixed visit lengths, sleeping night, waking night, travel & expenses), rate history, employee pay card tab with promotion page | `care-admin/src/features/billing/` |

## 2. Wage type gap analysis

| # | Wage type | Status today | Gap |
|---|---|---|---|
| 1 | Basic hourly | **Exists** (HOURLY rules, banded) | — |
| 2 | Fixed salary | Partial (UK payroll agreement) | UI cannot enter annual salary; visit pay always added on top |
| 3 | Per visit | Partial (fixed 15/30/45/60-min slot rules) | PER_VISIT_FEE unreachable; no eligibility config |
| 4 | Weekend | **Exists** (SATURDAY/SUNDAY rules) | UTC day on non-banded paths |
| 5 | Bank holiday | Partial (BANK_HOLIDAY rules) | Calendar 2026 only, no admin, region ignored |
| 6 | Night | **Exists** (time bands across midnight) | No named night window setting |
| 7 | Overtime | Missing (helper only, OVERTIME line type unused) | Threshold + calculation + no double counting |
| 8 | Travel time | Partial | Auto suggestion stored as manual; no scheduled/verified/approved split |
| 9 | Mileage | Partial | Claimed/verified/approved split missing; **never paid out** |
| 10 | Sleep-in | Partial (flat) | Awake-and-working periods not tracked |
| 11 | Waking night | **Exists** | — |
| 12 | Live-in | Missing (helper only) | Policy + working/rest record |
| 13 | On-call | Missing (helper only) | Standby vs call-out record |
| 14 | Training | Missing | NCA not fed to pay; pay lines require a visit |
| 15 | Holiday pay | Missing | Needs client policy (method, accrual) |
| 16 | Sick pay | Missing | Needs client policy (SSP/contractual) |
| 17 | Bonus | Missing | Non-visit line + approval |
| 18 | Manual adjustment | Partial (per-visit payable override) | ADJUSTMENT lines with reason/approval/lock checks |

Calculation methods requested vs existing: HOURLY_RATE = ABSOLUTE_HOURLY; RATE_MULTIPLIER = MULTIPLIER; FIXED_PER_SHIFT = FIXED_SHIFT_ALLOWANCE / SLEEP_IN; FIXED_PER_VISIT = FIXED; PER_MILE = MILEAGE. Missing: FIXED_PER_DAY, FIXED_PER_WEEK, FIXED_PER_MONTH, ANNUAL_SALARY (exists only in UK payroll), FIXED_AMOUNT, STATUTORY_CALCULATION.

Conflict resolution requested vs existing: default no stacking = **PRIORITY** (existing default, most specific rule wins); Highest Applicable Rate = **HIGHEST** (has a comparison bug); Contractual stacking = **STACK**. Not configurable from the UI today.

## 3. Constraints that shape the design

- Money is currently JS float + round-to-2dp in the engine; new code should use Prisma `Decimal`.
- Pay lines (`PayrollRunLine`) require a visit reconciliation → non-visit earnings (training, bonus, adjustment, on-call, holiday, sick) need a nullable source.
- Visit reconciliations are never set to LOCKED (audit finding ATT-008) → "historical integrity" needs the lock fix first.
- Holiday pay, sick pay, live-in and NMW treatment of sleep-ins need client/payroll-specialist decisions (audit doc 15).
- Bank holiday calendar must become maintainable per nation (England & Wales, Scotland, Northern Ireland).

## 4. Proposed delivery (incremental, no change to existing pay results unless configured)

**Tranche 1 — foundations (safe, no behaviour change)**
1. Wage Type catalogue (system codes, editable names, unit, allowed methods, active flag); optional wage type on pay card rules; existing rules shown under their mapped wage type without data changes.
2. Paycard screen sections (General / Standard / Enhanced / Travel & Mileage / Specialist / History / Preview) inside the existing page; conflict policy selector (default = current PRIORITY) and enhancement method per rule; fix HIGHEST.
3. Bank holiday calendar admin per nation (+ optional GOV.UK import) and bank holiday region on the paycard.
4. Pay Preview: sample visit → segment-by-segment calculation, no records written.
5. Audit log for paycard and rule changes.

**Tranche 2 — payroll integration**
Non-visit pay lines (nullable source) → manual adjustments and bonus (reason, approver, locked-period guard); overtime; training pay from approved non-core activity; on-call; mileage payout; sleep-in awake time; reconciliation locking; idempotency keys.

**Tranche 3 — policy-dependent statutory items**
Holiday pay, sick pay (SSP/contractual), live-in, date-effective NMW/statutory rate tables and NMW per pay reference period.

## 5. Tranche 1 — implemented (2026-10-09, uncommitted)

- **Wage type catalogue** — `billing.WageType` (18 system types, protected codes; name/description/active editable, audited). `GET /billing/wage-types`, `PATCH /billing/wage-types/:code`. Billing → *Wage types* tab. Existing rules are classified to a wage type at read time (`wage-types.util.ts` / `wage-type-classify.util.ts`); no rule data was changed.
- **Conflict policy** — pay card form *Pay rules & conflicts*: Most specific (PRIORITY, default and unchanged), Highest applicable (HIGHEST, base-rate bug fixed), Contractual stacking (STACK). No existing card used HIGHEST/STACK, so no results changed.
- **Rate method per hourly rule** (pay cards only) — £/hr, base + £/hr, base × multiplier, base + %. Method fields kept in step; save blocked for multipliers > 10 or uplifts > 300%.
- **Bank holiday calendars** — `PayCard.bankHolidayRegion` (null/UK = England & Wales, SCOTLAND, NORTHERN_IRELAND). Pricing filters holidays by region (charges and scheduling keep `UK`). Billing → *Bank holidays* tab: add, switch off/on, *Import from GOV.UK* (dates from 1 Jan of the current year only; idempotent; audited). `GET/POST /billing/bank-holidays`, `PATCH /billing/bank-holidays/:id`, `POST /billing/bank-holidays/import-gov-uk`.
- **Pay preview** — `POST /billing/pay-cards/preview` + *Pay preview* section: same `calculatePayableAmount` path as live pricing, unsaved form rules, segments, bank holidays, warnings. Writes nothing.
- **Audit** — pay card create/update/rates-versioned/delete, employee pay card change, wage type update, bank holiday create/update/import.
- **Migration** — `20261009170000_wage_types_and_bank_holiday_region` (additive: one nullable column, one table, seed rows).

Deferred to Tranche 2/3: overtime, training, on-call, live-in, bonus, manual adjustment lines, mileage payout, sleep-in awake time, holiday and sick pay, earnings locking/idempotency, Decimal arithmetic in the existing engine.

## 6. "Not automatic yet" wage types — implemented (2026-10-09, uncommitted)

- **Pay card rates (versioned like other rules):** new rate types `OVERTIME` (multiplier / +£ per hour / overtime £/hr, weekly threshold in `minimumMinutes`), `ON_CALL` (£ per period), `TRAINING` (£/hr), `LIVE_IN_DAILY`, `LIVE_IN_WEEKLY`. Rules editor → *Additional pay*. Ignored by visit pricing.
- **Pay items** (`billing.EmployeePayItem`, Billing → *Pay items*): bonus, manual adjustment (±), holiday pay (52-week average suggested; link to holiday booking), sick pay (rate from policy; link to sickness absence), on-call, live-in, training. Reason required; approval required; bonus and manual adjustment need a different approver. Approved items are paid by the next visit pay run whose period end is on/after the item date (backdated items sweep in) and are frozen when that run is locked.
- **Visit pay run** (`PayrollRunLine.visitReconciliationId` now nullable; `sourceType`, `sourceRef`, `employeePayItemId` added): adds pay item lines; training / on-call lines from non-core activity marked *include in payroll* (only when the card has a TRAINING / ON_CALL rate); weekly overtime premium (only when the card has an OVERTIME rate; premium only); rolled-up 12.07% holiday pay (only when the card's holiday pay method is ROLLED_UP_12_07). Locked runs refuse items/activities already paid elsewhere. UK payroll picks the lines up as other pay (negative = deduction); holiday and sick pay excluded from minimum-wage pay; training hours counted as working time.
- **API:** `GET/POST /billing/pay-items`, `GET /billing/pay-items/suggest-rate`, `POST /billing/pay-items/:id/approve|reject|cancel`.
- **Migrations:** `20261009190000_pay_items_and_additional_rates`, `20261009191000_payroll_line_types_sick_bonus_live_in` (additive).
- **Not included:** statutory SSP / SMP calculation (rates entered from policy), holiday entitlement / accrual balances, live-in working-time records, overtime on pay-period basis, payslip wording for the new lines.
