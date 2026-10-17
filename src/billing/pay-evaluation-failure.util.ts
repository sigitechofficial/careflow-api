/**
 * Pay calculation failures (R-17).
 *
 * When the pay of a visit cannot be worked out, the reason must reach a person. An expected
 * set-up gap (no employment record, no usable pay card) is a business failure: the office can
 * fix the data and retry. Anything else is a technical failure: it is logged for monitoring,
 * shown to the office in neutral words, and can be retried.
 *
 * Nothing here turns a failure into "paid £0". The visit stays unpriced and visibly so.
 */
import { HttpException } from '@nestjs/common';

export type PayEvaluationFailureKind = 'BUSINESS' | 'TECHNICAL';

export type PayEvaluationFailureCategory =
  | 'EMPLOYMENT_RECORD_MISSING'
  | 'PAY_CARD_UNRESOLVED'
  | 'INVALID_TIMES'
  | 'LOCKED_HISTORY'
  | 'RECORD_MISSING'
  | 'BUSINESS_RULE'
  | 'DATABASE'
  | 'UNEXPECTED';

export type ClassifiedEvaluationFailure = {
  kind: PayEvaluationFailureKind;
  category: PayEvaluationFailureCategory;
  /** Safe to show to office staff: no stack trace, query text or personal data. */
  message: string;
  /** Whether running the same calculation again can succeed (after a data fix, or as it is). */
  retryable: boolean;
  /** For logs and support: error class and code only. */
  detail: { errorName: string; errorCode: string | null };
};

export const TECHNICAL_FAILURE_MESSAGE =
  'The pay calculation stopped with an unexpected error. It can be retried. If it fails again, give this reference to support.';

const errorName = (err: unknown) =>
  err instanceof Error ? err.constructor?.name || err.name : typeof err;
const errorCode = (err: unknown) => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
};

export function classifyEvaluationFailure(
  err: unknown,
): ClassifiedEvaluationFailure {
  const detail = { errorName: errorName(err), errorCode: errorCode(err) };
  const text = err instanceof Error ? err.message : String(err);

  // The database refused a change to settled pay: by design, never a retry.
  if (/LOCKED_PAYROLL_HISTORY/.test(text)) {
    return {
      kind: 'BUSINESS',
      category: 'LOCKED_HISTORY',
      message:
        'The pay of this visit is settled in payroll and cannot be recalculated. Record a pay correction instead.',
      retryable: false,
      detail,
    };
  }

  if (err instanceof HttpException) {
    const status = err.getStatus();
    if (status >= 400 && status < 500) {
      const category: PayEvaluationFailureCategory = /employment record/i.test(
        text,
      )
        ? 'EMPLOYMENT_RECORD_MISSING'
        : /pay card/i.test(text)
          ? 'PAY_CARD_UNRESOLVED'
          : /start|finish|time|duration/i.test(text)
            ? 'INVALID_TIMES'
            : status === 404
              ? 'RECORD_MISSING'
              : 'BUSINESS_RULE';
      // Messages of 4xx errors in this codebase are written for the user.
      return {
        kind: 'BUSINESS',
        category,
        message: text,
        retryable: true,
        detail,
      };
    }
  }

  // Prisma errors: the message contains query text and values, so it is never shown or stored.
  const isDatabase =
    /^Prisma/.test(detail.errorName) || /^P\d{4}$/.test(detail.errorCode ?? '');
  return {
    kind: 'TECHNICAL',
    category: isDatabase ? 'DATABASE' : 'UNEXPECTED',
    message: TECHNICAL_FAILURE_MESSAGE,
    retryable: true,
    detail,
  };
}

/** ATTENDANCE_CORRECTION: an office-verified time was recorded but carer pay was not recalculated. */
export type PayEvaluationOperation = 'EVALUATE' | 'ENSURE_VISIT' | 'ENSURE_JOB' | 'ATTENDANCE_CORRECTION';

/** One open failure per subject: a later failure of the same thing updates it. */
export function payEvaluationSubjectKey(
  operation: PayEvaluationOperation,
  id: string,
): string {
  const prefix =
    operation === 'EVALUATE'
      ? 'RECON'
      : operation === 'ENSURE_VISIT'
        ? 'VISIT'
        : operation === 'ATTENDANCE_CORRECTION'
          ? 'ATTENDANCE'
          : 'JOB';
  return `${prefix}:${id}`;
}
