/** Investigation set-up: levels, involvement answers, statuses and change descriptions. */

import {
  INVESTIGATION_RECORDS_REVIEWED_LABELS,
  type InvestigationRecordReviewed,
} from './incident-review.constants';
import type { ContributingFactorDetails } from './incident-factor-details.util';

export const INVESTIGATION_LEVELS = ['STANDARD', 'ENHANCED', 'COMPREHENSIVE'] as const;
export type InvestigationLevel = (typeof INVESTIGATION_LEVELS)[number];

export const INVESTIGATION_LEVEL_LABELS: Record<InvestigationLevel, string> = {
  STANDARD: 'Standard',
  ENHANCED: 'Enhanced',
  COMPREHENSIVE: 'Comprehensive',
};

export const INVESTIGATOR_INVOLVEMENT = ['NO', 'YES', 'NOT_KNOWN'] as const;
export type InvestigatorInvolvement = (typeof INVESTIGATOR_INVOLVEMENT)[number];

/** COMPLETED is only set by completing the investigation, never chosen directly. */
export const INVESTIGATION_STATUSES = ['IN_PROGRESS', 'PAUSED', 'COMPLETED'] as const;
export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number];

/** Day key (YYYY-MM-DD) → "6 Oct 2026". */
export function formatDayKey(day: string | null | undefined): string {
  if (!day) return '—';
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return day;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    m - 1
  ];
  return `${d} ${month} ${y}`;
}

/** A @db.Date value (UTC midnight) → YYYY-MM-DD. */
export function dateOnlyKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
}

export type InvestigationSetupState = {
  investigationLevel: string | null;
  leadInvestigatorEmployeeId: string | null;
  targetDate: string | null;
};

/**
 * Timeline/audit lines for set-up changes that matter (lead, level, target date).
 * Nothing is returned when a value is unchanged, so re-saving adds no noise.
 */
export function describeSetupChanges(
  before: InvestigationSetupState | null,
  after: InvestigationSetupState,
  names: Record<string, string>,
): string[] {
  const lines: string[] = [];
  const name = (id: string | null) => (id ? (names[id] ?? 'Unknown staff member') : '—');
  const level = (v: string | null) =>
    v ? (INVESTIGATION_LEVEL_LABELS[v as InvestigationLevel] ?? v) : '—';

  const prevLead = before?.leadInvestigatorEmployeeId ?? null;
  if (after.leadInvestigatorEmployeeId !== prevLead) {
    if (!after.leadInvestigatorEmployeeId) lines.push(`Lead investigator removed (was ${name(prevLead)})`);
    else if (!prevLead) lines.push(`Lead investigator assigned: ${name(after.leadInvestigatorEmployeeId)}`);
    else lines.push(`Lead investigator changed: ${name(prevLead)} → ${name(after.leadInvestigatorEmployeeId)}`);
  }

  const prevLevel = before?.investigationLevel ?? null;
  if (after.investigationLevel !== prevLevel) {
    if (!prevLevel) lines.push(`Investigation level set: ${level(after.investigationLevel)}`);
    else lines.push(`Investigation level changed: ${level(prevLevel)} → ${level(after.investigationLevel)}`);
  }

  const prevDate = before?.targetDate ?? null;
  if (after.targetDate !== prevDate) {
    if (!after.targetDate) lines.push(`Target completion date removed (was ${formatDayKey(prevDate)})`);
    else if (!prevDate) lines.push(`Target completion date set: ${formatDayKey(after.targetDate)}`);
    else
      lines.push(
        `Target completion date changed: ${formatDayKey(prevDate)} → ${formatDayKey(after.targetDate)}`,
      );
  }
  return lines;
}

/** Set-up answers still needed before the investigation can be completed. */
export function missingSetupForCompletion(s: {
  investigationLevel: string | null;
  leadInvestigatorEmployeeId: string | null;
  targetDate: string | null;
  termsOfReference: string | null;
  investigatorInvolved: string | null;
  investigatorInvolvedReason: string | null;
}): string[] {
  return [
    !s.investigationLevel && 'investigation level',
    !s.leadInvestigatorEmployeeId && 'lead investigator',
    !s.investigatorInvolved && 'whether the lead investigator was involved',
    s.investigatorInvolved === 'YES' &&
      !s.investigatorInvolvedReason?.trim() &&
      'why the involved investigator is still appropriate',
    !s.targetDate && 'target completion date',
    !s.termsOfReference?.trim() && 'terms of reference',
  ].filter((v): v is string => Boolean(v));
}

/** Old/new values kept with a set-up or evidence change in the audit log. */
export function setupAuditValues(inv: {
  investigationLevel: string | null;
  leadInvestigatorEmployeeId: string | null;
  investigatorInvolved: string | null;
  investigatorInvolvedReason: string | null;
  targetDate: Date | string | null;
  termsOfReference: string | null;
  investigationStatus: string;
  recordsReviewed?: string[];
  recordsReviewedDetails?: unknown;
  evidenceNotes?: string | null;
  outstandingEvidence?: string | null;
}) {
  return {
    recordsReviewed: inv.recordsReviewed ?? [],
    recordsReviewedDetails: inv.recordsReviewedDetails ?? null,
    evidenceNotes: inv.evidenceNotes ?? null,
    outstandingEvidence: inv.outstandingEvidence ?? null,
    investigationLevel: inv.investigationLevel,
    leadInvestigatorEmployeeId: inv.leadInvestigatorEmployeeId,
    investigatorInvolved: inv.investigatorInvolved,
    investigatorInvolvedReason: inv.investigatorInvolvedReason,
    targetDate: dateOnlyKey(inv.targetDate),
    termsOfReference: inv.termsOfReference,
    investigationStatus: inv.investigationStatus,
  };
}

export type InvestigationEvidenceState = {
  recordsReviewed: string[];
  recordsReviewedDetails: ContributingFactorDetails | null;
  evidenceNotes: string | null;
  outstandingEvidence: string | null;
};

/**
 * Timeline/audit lines for evidence changes: record kinds ticked/unticked, records linked/unlinked,
 * notes changed. Nothing is returned when nothing changed.
 */
export function describeEvidenceChanges(
  before: InvestigationEvidenceState | null,
  after: InvestigationEvidenceState,
): string[] {
  const lines: string[] = [];
  const label = (code: string) =>
    INVESTIGATION_RECORDS_REVIEWED_LABELS[code as InvestigationRecordReviewed] ?? code;
  const prevKinds = before?.recordsReviewed ?? [];
  const prevDetails = before?.recordsReviewedDetails ?? {};
  const nextDetails = after.recordsReviewedDetails ?? {};

  for (const code of after.recordsReviewed) {
    const prevItems = prevDetails[code]?.items ?? [];
    const nextItems = nextDetails[code]?.items ?? [];
    const added = nextItems.filter((i) => !prevItems.some((p) => p.id === i.id));
    const removed = prevItems.filter((p) => !nextItems.some((i) => i.id === p.id));
    if (!prevKinds.includes(code) && !added.length) {
      lines.push(`Records reviewed: ${label(code)}`);
    }
    for (const i of added) lines.push(`Records reviewed: ${label(code)} linked — ${i.label}`);
    for (const i of removed) lines.push(`Records reviewed: ${label(code)} unlinked — ${i.label}`);
    if (
      prevKinds.includes(code) &&
      (prevDetails[code]?.note ?? '') !== (nextDetails[code]?.note ?? '')
    ) {
      lines.push(`Records reviewed: ${label(code)} note updated`);
    }
  }
  for (const code of prevKinds) {
    if (!after.recordsReviewed.includes(code)) lines.push(`Records reviewed: ${label(code)} removed`);
  }

  const noteLine = (name: string, prev: string | null | undefined, next: string | null) => {
    if ((prev ?? null) === next) return;
    if (!prev) lines.push(`${name} added`);
    else if (!next) lines.push(`${name} cleared`);
    else lines.push(`${name} updated`);
  };
  noteLine('Evidence notes', before?.evidenceNotes, after.evidenceNotes);
  noteLine('Outstanding evidence', before?.outstandingEvidence, after.outstandingEvidence);
  return lines;
}
