import { EnquiryStage } from '@prisma/client';

/** Open pipeline stages shown as board columns before a decision. */
export const OPEN_STAGES: EnquiryStage[] = [
  EnquiryStage.NEW,
  EnquiryStage.CONTACTED,
  EnquiryStage.ASSESSMENT,
  EnquiryStage.OFFER,
];

/**
 * Whether the `move` endpoint may set `next` from `current`.
 * Any open stage, WON or LOST is allowed, and a decided enquiry (WON/LOST) can
 * be reopened to an open stage. (LOST additionally requires a reason — enforced
 * in the service.)
 */
export function canMove(current: EnquiryStage, next: EnquiryStage): boolean {
  if (next === current) return false;
  return (
    next === EnquiryStage.WON ||
    next === EnquiryStage.LOST ||
    OPEN_STAGES.includes(next)
  );
}
