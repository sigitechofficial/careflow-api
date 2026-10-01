/** Rich-text editor values ("<p>Done</p>") → plain text for notification bodies. */
function plainText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Office/submitter alert after an initial assessment is submitted. */
export function buildInitialAssessmentSubmittedNotification(input: {
  managerReviewRequired: boolean;
  /** Preferred / short name for the title, e.g. "Harry". */
  serviceUserShortName?: string | null;
  /** Full name for the message, e.g. "Harry Max". */
  serviceUserFullName?: string | null;
}): { title: string; message: string } {
  const short = input.serviceUserShortName?.trim() || null;
  const full = input.serviceUserFullName?.trim() || 'a service user';
  const titleBase = input.managerReviewRequired
    ? 'Initial assessment needs manager review'
    : 'Initial assessment submitted';
  return {
    title: short ? `${titleBase} — ${short}` : titleBase,
    message: input.managerReviewRequired
      ? `Initial assessment for ${full} was submitted and requires manager review.`
      : `Initial assessment for ${full} was submitted successfully.`,
  };
}

/** Alert to the submitter once a manager has reviewed (or archived) their assessment. */
export function buildInitialAssessmentReviewedNotification(input: {
  status: 'REVIEWED' | 'ARCHIVED' | string;
  approvedForCareStart?: boolean | null;
  careStartConditions?: string | null;
  reviewNotes?: string | null;
  reviewerName: string;
  /** Already in the org date format, e.g. "28/09/2026". */
  reviewedOnLabel?: string | null;
  serviceUserShortName?: string | null;
  serviceUserFullName?: string | null;
}): { title: string; message: string } {
  const short = input.serviceUserShortName?.trim() || null;
  const full = input.serviceUserFullName?.trim() || 'a service user';
  const on = input.reviewedOnLabel ? ` on ${input.reviewedOnLabel}` : '';
  const archived = input.status === 'ARCHIVED';
  const approved = !archived && input.approvedForCareStart === true;

  const titleBase = archived
    ? 'Initial assessment archived'
    : approved
      ? 'Initial assessment approved'
      : 'Initial assessment reviewed';

  let lead: string;
  if (archived) {
    lead = `${input.reviewerName} archived the initial assessment for ${full}${on}.`;
  } else if (approved) {
    lead = `${input.reviewerName} reviewed the initial assessment for ${full}${on} and approved care start.`;
  } else if (input.approvedForCareStart === false) {
    lead = `${input.reviewerName} reviewed the initial assessment for ${full}${on}. Care start not approved yet.`;
  } else {
    lead = `${input.reviewerName} reviewed the initial assessment for ${full}${on}.`;
  }

  const conditions = !archived ? plainText(input.careStartConditions) : '';
  const notes = plainText(input.reviewNotes);
  const message = [
    lead,
    conditions ? `Conditions: ${sentence(conditions)}` : '',
    notes ? `Notes: ${sentence(notes)}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return { title: short ? `${titleBase} — ${short}` : titleBase, message };
}
