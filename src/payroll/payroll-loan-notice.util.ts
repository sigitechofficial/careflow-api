/**
 * Gate C13: HMRC student and postgraduate loan start/stop notices. SL1 starts a student loan plan,
 * SL2 stops it; PGL1 starts the postgraduate loan, PGL2 stops it. A notice applies from its
 * effective payday (the first payday on which the employer could operate it), never earlier.
 */
export type LoanNoticeType = 'SL1' | 'SL2' | 'PGL1' | 'PGL2';

export const LOAN_NOTICE_TYPES: LoanNoticeType[] = ['SL1', 'SL2', 'PGL1', 'PGL2'];

export type LoanNoticeRow = {
  id: string;
  noticeType: string;
  studentLoanPlan: string | null;
  hmrcReference: string | null;
  effectivePayday: Date;
};

export type ApplicableLoanNotice =
  | { kind: 'NONE' }
  | { kind: 'ON'; plan: string | null; notice: LoanNoticeRow }
  | { kind: 'OFF'; notice: LoanNoticeRow }
  | { kind: 'CONFLICT'; reason: string };

/**
 * The notice of one family (student or postgraduate) in force on a payment date: the latest whose
 * effective payday is on or before that date. Two notices with the same effective payday that say
 * different things cannot be resolved here and are reported as a conflict.
 */
export function applicableLoanNotice(
  notices: LoanNoticeRow[],
  family: 'STUDENT' | 'POSTGRADUATE',
  paidOn: Date,
): ApplicableLoanNotice {
  const [start, stop] = family === 'STUDENT' ? ['SL1', 'SL2'] : ['PGL1', 'PGL2'];
  const inForce = notices.filter(
    (n) => (n.noticeType === start || n.noticeType === stop) && n.effectivePayday.getTime() <= paidOn.getTime(),
  );
  if (!inForce.length) return { kind: 'NONE' };
  const latest = Math.max(...inForce.map((n) => n.effectivePayday.getTime()));
  const sameDay = inForce.filter((n) => n.effectivePayday.getTime() === latest);
  const instructions = new Set(sameDay.map((n) => `${n.noticeType}|${n.studentLoanPlan ?? ''}`));
  if (instructions.size > 1) {
    return {
      kind: 'CONFLICT',
      reason: `conflicting ${family === 'STUDENT' ? 'student' : 'postgraduate'} loan notices from the same payday (${[...instructions]
        .map((i) => i.replace('|', ' ').trim())
        .join(', ')})`,
    };
  }
  const notice = sameDay[0];
  return notice.noticeType === start
    ? { kind: 'ON', plan: notice.studentLoanPlan, notice }
    : { kind: 'OFF', notice };
}
