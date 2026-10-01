import type { PrismaClient } from '@prisma/client';
import { findCarerVisibleIa } from './employee-app-ia-source.util';

/**
 * CPR / DNACPR status for carers. The office-maintained legal document record is the master;
 * an Initial Assessment answer is only ever a *report* that prompts a check — it never becomes a
 * "do not resuscitate" instruction on its own, and an unknown status is never shown as "For CPR".
 *
 * Every non-verified label contains "DNACPR" so older app builds (which colour the chip amber
 * only when the label mentions DNACPR) never render an unverified state green.
 */

export type CprStatusId =
  | 'dnacpr_verified'
  | 'no_dnacpr_confirmed'
  | 'dnacpr_reported_unverified'
  | 'dnacpr_status_conflict'
  | 'cpr_status_not_recorded';

export type CprStatusTone = 'danger' | 'warning' | 'neutral';

export type CprLegalRecord = {
  dnacprInPlace: boolean;
  dnacprStatusConfirmation: 'UNKNOWN' | 'IN_PLACE' | 'NOT_IN_PLACE' | string;
  dnacprPhysicalLocation?: string | null;
};

/** What the latest carer-visible IA says (§13.6, or the End of Life DNR answer). */
export type CprIaReport = {
  reportsInPlace: boolean;
  pendingReview: boolean;
};

export type CprStatus = {
  id: CprStatusId;
  label: string;
  tone: CprStatusTone;
  /** One line telling the carer what to do. */
  actionLine: string;
  /** Form location — only when the office record holds one. */
  location: string | null;
  /** True only for an office-confirmed DNACPR / ReSPECT in place. */
  verified: boolean;
};

type OfficeState = 'in_place' | 'none' | 'recorded_unconfirmed' | 'unknown' | 'inconsistent';

function officeState(legal: CprLegalRecord | null | undefined): OfficeState {
  if (!legal) return 'unknown';
  const confirmation = legal.dnacprStatusConfirmation;
  if (confirmation === 'IN_PLACE') return legal.dnacprInPlace ? 'in_place' : 'inconsistent';
  if (confirmation === 'NOT_IN_PLACE') return legal.dnacprInPlace ? 'inconsistent' : 'none';
  return legal.dnacprInPlace ? 'recorded_unconfirmed' : 'unknown';
}

const CHECK_WITH_OFFICE = 'Check the current document / contact the office.';

export function resolveCprStatus(
  legal: CprLegalRecord | null | undefined,
  ia: CprIaReport | null | undefined,
): CprStatus {
  const location = legal?.dnacprPhysicalLocation?.trim() || null;
  const office = officeState(legal);
  const iaSaysYes = ia?.reportsInPlace === true;
  const iaSaysNo = ia != null && ia.reportsInPlace === false;

  const conflict = (): CprStatus => ({
    id: 'dnacpr_status_conflict',
    label: 'DNACPR / ReSPECT status conflicting',
    tone: 'warning',
    actionLine: `Records disagree about DNACPR / ReSPECT. ${CHECK_WITH_OFFICE}`,
    location,
    verified: false,
  });

  if (office === 'inconsistent') return conflict();

  if (office === 'in_place') {
    if (iaSaysNo) return conflict();
    return {
      id: 'dnacpr_verified',
      label: 'DNACPR / ReSPECT in place',
      tone: 'danger',
      actionLine: 'Verified by the office. Follow the DNACPR / ReSPECT form recommendations.',
      location,
      verified: true,
    };
  }

  if (office === 'none') {
    if (iaSaysYes) return conflict();
    return {
      id: 'no_dnacpr_confirmed',
      label: 'No DNACPR / ReSPECT in place (office confirmed)',
      tone: 'neutral',
      actionLine: 'The office has confirmed there is no DNACPR / ReSPECT form in place.',
      location: null,
      verified: false,
    };
  }

  if (office === 'recorded_unconfirmed') {
    if (iaSaysNo) return conflict();
    return {
      id: 'dnacpr_reported_unverified',
      label: 'DNACPR / ReSPECT reported — document not verified',
      tone: 'warning',
      actionLine: `DNACPR / ReSPECT recorded but not yet verified. ${CHECK_WITH_OFFICE}`,
      location,
      verified: false,
    };
  }

  if (iaSaysYes) {
    return {
      id: 'dnacpr_reported_unverified',
      label: 'DNACPR / ReSPECT reported — document not verified',
      tone: 'warning',
      actionLine: `Reported in the initial assessment${
        ia?.pendingReview ? ' (pending manager review)' : ''
      }, not verified. ${CHECK_WITH_OFFICE}`,
      location: null,
      verified: false,
    };
  }

  return {
    id: 'cpr_status_not_recorded',
    label: 'CPR / DNACPR status not recorded',
    tone: 'warning',
    actionLine: 'CPR status not recorded — confirm with the office.',
    location: null,
    verified: false,
  };
}

// ── IA report loader ─────────────────────────────────────────────────────────

/** §13.6 question: matched by fieldKey first, then by its stable text (older templates). */
export const IA_DNACPR_FIELD_KEY = 'dnacprRespectInPlace';
const IA_DNACPR_TEXT_PREFIX = 'dnacpr or respect in place';

type IaAnswerRow = {
  checked: boolean | null;
  booleanValue: boolean | null;
  question: { questionText: string; metadata: unknown };
};

function isDnacprQuestion(question: IaAnswerRow['question']): boolean {
  const meta = (question.metadata ?? {}) as { fieldKey?: unknown };
  if (meta.fieldKey === IA_DNACPR_FIELD_KEY) return true;
  return question.questionText.trim().toLowerCase().startsWith(IA_DNACPR_TEXT_PREFIX);
}

/** Reads the §13.6 answer, falling back to the End of Life "DNR in place" answer. */
export function cprReportFromIa(
  answers: IaAnswerRow[],
  metadata: unknown,
): boolean | null {
  const row = answers.find((a) => isDnacprQuestion(a.question));
  const value = row ? (row.booleanValue ?? row.checked) : null;
  if (value === true || value === false) return value;
  const eol = (metadata as { endOfLifeAssessment?: { dnrInPlaceAnswer?: unknown } } | null)
    ?.endOfLifeAssessment;
  const dnr = eol?.dnrInPlaceAnswer;
  return dnr === true || dnr === false ? dnr : null;
}

/** Latest carer-visible IA (reviewed, else submitted) → what it reports about DNACPR / ReSPECT. */
export async function loadCprIaReport(
  prisma: Pick<PrismaClient, 'initialAssessmentSubmission'>,
  serviceUserId: string,
): Promise<CprIaReport | null> {
  const found = await findCarerVisibleIa(prisma, serviceUserId, {
    metadata: true,
    answers: {
      where: {
        question: {
          OR: [
            { questionText: { startsWith: 'DNACPR or ReSPECT in place', mode: 'insensitive' } },
            { metadata: { path: ['fieldKey'], equals: IA_DNACPR_FIELD_KEY } },
          ],
        },
      },
      select: {
        checked: true,
        booleanValue: true,
        question: { select: { questionText: true, metadata: true } },
      },
    },
  });
  if (!found) return null;
  const reportsInPlace = cprReportFromIa(found.submission.answers, found.submission.metadata);
  if (reportsInPlace == null) return null;
  return { reportsInPlace, pendingReview: found.pendingReview };
}
