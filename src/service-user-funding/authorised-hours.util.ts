import { FundingStatus, Prisma } from '@prisma/client';

/** Funding lines that are still live (not ended, rejected or deleted). */
export const LIVE_FUNDING_LINE_WHERE = {
  deletedAt: null,
  status: { notIn: [FundingStatus.ENDED, FundingStatus.REJECTED] },
} satisfies Prisma.ServiceUserFundingWhereInput;

/**
 * Weekly hours the funders have agreed to pay for, across every live funding line (a council 10h line and a
 * family 2h top-up line make 12h). Null when no line has authorised hours.
 */
export function totalAuthorisedWeeklyHours(
  lines: Array<{ authorisedWeeklyHours: number | null }> | null | undefined,
): number | null {
  const hours = (lines ?? [])
    .map((l) => l.authorisedWeeklyHours)
    .filter((h): h is number => typeof h === 'number' && Number.isFinite(h) && h >= 0);
  if (!hours.length) return null;
  return Math.round(hours.reduce((a, b) => a + b, 0) * 100) / 100;
}

/** Planned weekly hours above what funders agreed to pay for (unfunded care). Null when nothing to compare. */
export function unfundedWeeklyHours(planned: number | null, authorised: number | null): number | null {
  if (planned == null || authorised == null) return null;
  const over = Math.round((planned - authorised) * 100) / 100;
  return over > 0 ? over : null;
}
