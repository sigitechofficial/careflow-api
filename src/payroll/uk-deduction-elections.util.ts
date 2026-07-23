/**
 * Backend-safe allow-list of configurable UK deduction catalogue codes (2026/27).
 * Must stay aligned with care-admin uk-payroll-2026-27.catalog.ts CONFIGURED items.
 */
export const UK_CONFIGURABLE_DEDUCTION_CODES = [
  'SL_PLAN_1',
  'SL_PLAN_2',
  'SL_PLAN_4',
  'SL_PLAN_5',
  'POSTGRAD_LOAN',
  'PENSION_EMPLOYEE',
  'CMS_DEO',
  'DEA_DWP',
  'AEO_CIVIL',
  'AEO_COUNCIL_TAX',
  'AEO_FINES_MAINT',
  'SCOT_EA',
  'SCOT_CMA',
  'SCOT_CAO',
  'NI_AEO',
  'OTHER_STATUTORY_ORDER',
  'AVC_PENSION',
  'SS_PENSION',
  'SS_CYCLE',
  'SS_EV',
  'HOLIDAY_PURCHASE',
  'CHILDCARE_VOUCHERS',
  'PAYROLL_GIVING',
  'TRADE_UNION',
  'PROF_BODY',
  'PRIVATE_MEDICAL',
  'LIFE_INSURANCE',
  'CAR_FUEL_CONTRIB',
  'PARKING',
  'MEALS',
  'ACCOMMODATION',
  'UNIFORM',
  'SEASON_TICKET',
  'SALARY_ADVANCE',
  'OVERPAYMENT_RECOVERY',
  'SHARE_PLAN',
  'WORKPLACE_SAVINGS',
  'BENEFIT_PLAN',
  'EMPLOYEE_REQUESTED',
  'CONTRACTUAL',
  'STRIKE',
] as const;

export type UkConfigurableDeductionCode = (typeof UK_CONFIGURABLE_DEDUCTION_CODES)[number];

const ALLOWED = new Set<string>(UK_CONFIGURABLE_DEDUCTION_CODES);

export function sanitizeDeductionElections(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const code = raw.trim().toUpperCase();
    if (ALLOWED.has(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

export function loanFlagsFromElections(codes: string[]) {
  const set = new Set(codes);
  return {
    studentLoanPlan1: set.has('SL_PLAN_1'),
    studentLoanPlan2: set.has('SL_PLAN_2'),
    studentLoanPlan4: set.has('SL_PLAN_4'),
    studentLoanPlan5: set.has('SL_PLAN_5'),
    postgraduateLoan: set.has('POSTGRAD_LOAN'),
    pensionOptedIn:
      set.has('PENSION_EMPLOYEE') || set.has('AVC_PENSION') || set.has('SS_PENSION'),
  };
}

export function electionsFromLegacyFlags(flags: {
  studentLoanPlan1?: boolean;
  studentLoanPlan2?: boolean;
  studentLoanPlan4?: boolean;
  studentLoanPlan5?: boolean;
  postgraduateLoan?: boolean;
  pensionOptedIn?: boolean;
  deductionElections?: unknown;
}): string[] {
  const fromJson = sanitizeDeductionElections(flags.deductionElections);
  if (fromJson.length) return fromJson;
  const codes: string[] = [];
  if (flags.studentLoanPlan1) codes.push('SL_PLAN_1');
  if (flags.studentLoanPlan2) codes.push('SL_PLAN_2');
  if (flags.studentLoanPlan4) codes.push('SL_PLAN_4');
  if (flags.studentLoanPlan5) codes.push('SL_PLAN_5');
  if (flags.postgraduateLoan) codes.push('POSTGRAD_LOAN');
  if (flags.pensionOptedIn) codes.push('PENSION_EMPLOYEE');
  return codes;
}
