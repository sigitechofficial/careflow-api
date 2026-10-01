/** Inputs for the office alert raised when an incident review flags safeguarding / escalation. */
export type IncidentReviewFlagNotificationInput = {
  safeguardingConcern: boolean;
  escalationRequired: boolean;
  referenceNumber: string;
  categoryLabel?: string | null;
  /** IncidentSeverity enum value, e.g. "HIGH". */
  severity?: string | null;
  /** Already formatted in org date format + timezone, e.g. "28/09/2026 at 14:00". */
  occurredAtLabel?: string | null;
  /** Short name for the title (service user preferred name / employee name). */
  personShortName?: string | null;
  /** Full name for the message body. */
  personFullName?: string | null;
  reviewerName?: string | null;
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/**
 * Title: `Safeguarding concern — Harry`
 * Message: `INC-2026-0042 · Fall (High) on 28/09/2026 at 14:00 — Harry Max. Flagged during review by Sarah Khan. Escalation also required.`
 */
export function buildIncidentReviewFlagNotification(input: IncidentReviewFlagNotificationInput): {
  title: string;
  message: string;
} {
  const flag = input.safeguardingConcern ? 'Safeguarding concern' : 'Escalation required';
  const who = input.personShortName?.trim() || input.referenceNumber;
  const title = `${flag} — ${who}`;

  const what = [
    input.categoryLabel?.trim() || 'Incident',
    input.severity ? ` (${titleCase(input.severity)})` : '',
    input.occurredAtLabel ? ` on ${input.occurredAtLabel}` : '',
    input.personFullName?.trim() ? ` — ${input.personFullName.trim()}` : '',
  ].join('');
  const reviewer = input.reviewerName?.trim();
  const message = [
    `${input.referenceNumber} · ${what}.`,
    reviewer ? `Flagged during review by ${reviewer}.` : 'Flagged during review.',
    input.safeguardingConcern && input.escalationRequired ? 'Escalation also required.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return { title, message };
}
