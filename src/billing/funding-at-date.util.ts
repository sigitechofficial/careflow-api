/**
 * PC-10: which funder was paying for a client's care on the day of a visit.
 *
 * A carer can have a different pay card for work funded by a particular funder. The funder used
 * to be read from the client's funding as it is today, so a visit worked before a change of
 * funder was priced on the new funder's override when it was evaluated or re-evaluated later.
 *
 * Only the carer's pay uses this. The client charge and invoicing keep their own rules.
 */

export type FundingLineForPay = {
  id: string;
  funderId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  isPrimary: boolean;
  isActive: boolean;
  splitPriority: number;
  createdAt: Date;
};

export type PayFunderBasis =
  /** A funding line with a start or end date covers the day. */
  | 'DATED'
  /** An undated funding line that already existed on the day and is still active. */
  | 'IN_PLACE'
  /** The records show no funder for the day. */
  | 'NONE'
  /** The records cannot say: a line may or may not have applied on the day. */
  | 'UNCLEAR';

export type PayFunderAtDate = {
  funderId: string | null;
  basis: PayFunderBasis;
  /** For UNCLEAR: the funders that may have been funding on the day. */
  uncertainFunderIds: string[];
};

/**
 * @param lines the client's funding lines that are not deleted
 * @param currentFundingId the line marked as the client's current funding, if any
 * @param dayKey the local day of the visit (YYYY-MM-DD)
 * @param dayOf local day of an instant, in the organisation's timezone
 */
export function payFunderOn(
  lines: FundingLineForPay[],
  currentFundingId: string | null,
  dayKey: string,
  dayOf: (instant: Date) => string,
): PayFunderAtDate {
  const withFunder = lines.filter((line) => !!line.funderId);
  const covering: FundingLineForPay[] = [];
  const uncertain: FundingLineForPay[] = [];

  for (const line of withFunder) {
    const startKey = line.startDate ? dayOf(line.startDate) : null;
    const endKey = line.endDate ? dayOf(line.endDate) : null;
    if (startKey && startKey > dayKey) continue; // starts after the visit
    if (endKey && endKey < dayKey) continue; // ended before the visit
    if (startKey) {
      // Dated from on or before the day. An inactive line with no end date stopped on a day
      // nobody recorded.
      if (!line.isActive && !endKey) uncertain.push(line);
      else covering.push(line);
      continue;
    }
    // No start date: the record itself is the only evidence of when it began.
    const existedOnDay = dayOf(line.createdAt) <= dayKey;
    if (existedOnDay && (line.isActive || endKey)) covering.push(line);
    else uncertain.push(line);
  }

  if (covering.length) {
    // One funder per visit for pay, as before: the line marked current, then the primary line,
    // then the split order.
    const [first] = [...covering].sort(
      (a, b) =>
        Number(b.id === currentFundingId) - Number(a.id === currentFundingId) ||
        Number(b.isPrimary) - Number(a.isPrimary) ||
        a.splitPriority - b.splitPriority,
    );
    return {
      funderId: first.funderId,
      basis: first.startDate || first.endDate ? 'DATED' : 'IN_PLACE',
      uncertainFunderIds: [],
    };
  }
  if (uncertain.length) {
    return {
      funderId: null,
      basis: 'UNCLEAR',
      uncertainFunderIds: [...new Set(uncertain.map((line) => line.funderId!))],
    };
  }
  return { funderId: null, basis: 'NONE', uncertainFunderIds: [] };
}
