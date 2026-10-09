/**
 * Outcome & close → Staff actions: what was decided for a staff member after the incident.
 * A FINE is a salary deduction, which is only lawful when the contract (or the staff member's
 * prior written consent) allows it — Employment Rights Act 1996 s13 — so it must be confirmed.
 */
export const STAFF_ACTION_TYPES = [
  'NO_ACTION',
  'INFORMAL_DISCUSSION',
  'VERBAL_WARNING',
  'WRITTEN_WARNING',
  'FINAL_WRITTEN_WARNING',
  'FINE',
  'DISMISSAL',
  'HR_PROCESS',
] as const;
export type StaffActionType = (typeof STAFF_ACTION_TYPES)[number];

export const STAFF_ACTION_TYPE_LABELS: Record<StaffActionType, string> = {
  NO_ACTION: 'No action',
  INFORMAL_DISCUSSION: 'Informal discussion',
  VERBAL_WARNING: 'Verbal warning',
  WRITTEN_WARNING: 'Written warning',
  FINAL_WRITTEN_WARNING: 'Final written warning',
  FINE: 'Fine',
  DISMISSAL: 'Dismissal',
  HR_PROCESS: 'Referred to HR process',
};

export function staffActionLabel(type: string): string {
  return STAFF_ACTION_TYPE_LABELS[type as StaffActionType] ?? type;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type StaffActionFineInput = {
  actionType: string;
  fineAmount?: number | null;
  fineSalaryMonth?: string | null;
  deductionAllowedConfirmed?: boolean | null;
};

/**
 * What a staff action still needs. A fine needs an amount, a salary month that is not already
 * past (`currentMonth` = YYYY-MM in the organisation's time zone) and the contract confirmation.
 */
export function staffActionProblems(input: StaffActionFineInput, currentMonth: string): string[] {
  if (input.actionType !== 'FINE') return [];
  const problems: string[] = [];
  const amount = Number(input.fineAmount);
  if (!Number.isFinite(amount) || amount <= 0) problems.push('a fine amount above £0');
  else if (amount > 100000) problems.push('a fine amount of £100,000 or less');
  const month = input.fineSalaryMonth?.trim() ?? '';
  if (!MONTH.test(month)) problems.push('the salary month the fine comes out of');
  else if (month < currentMonth) problems.push('a salary month that is not already past');
  if (input.deductionAllowedConfirmed !== true) {
    problems.push('confirmation that the contract or written consent allows the deduction');
  }
  return problems;
}

/** "£25.00 from October 2026 salary" style summary for timelines. */
export function fineSummary(amount: number, salaryMonth: string): string {
  const [y, m] = salaryMonth.split('-').map(Number);
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `£${amount.toFixed(2)} from ${monthName} salary`;
}
