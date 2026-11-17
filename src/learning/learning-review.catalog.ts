/**
 * Reasons and actions for overdue / late / not completed training (16 Nov 2026).
 * Sources and the "(suggested)" items are listed in docs/LEARNING_OVERDUE_ACTIONS_PLAN.md.
 * Kept in code so the lists can change without a migration; records store the code.
 */
export type ReviewOption = { code: string; label: string; group?: string; formal?: boolean };

/** One wording for the office and the carer app (user, 16 Nov 2026). */
export const LEARNING_REVIEW_REASONS: ReviewOption[] = [
  { code: 'NO_TIME', label: 'Not enough time / too much work' },
  { code: 'NO_PROTECTED_TIME', label: 'Not given time for training' },
  { code: 'TECH_ACCESS', label: 'Phone, app or internet problem' },
  { code: 'DIGITAL_SKILLS', label: 'Needs help using the app' },
  { code: 'HEALTH', label: 'Unwell or health condition' },
  { code: 'LEAVE', label: 'On leave or away' },
  { code: 'PERSONAL', label: 'Personal or family reasons' },
  { code: 'NOT_AWARE', label: 'Did not know about the course' },
  { code: 'LEARNING_SUPPORT', label: 'Needs help with reading, language or learning' },
  { code: 'NO_REASON', label: 'No reason given' },
  { code: 'OTHER', label: 'Other' },
];

export const LEARNING_REVIEW_ACTIONS: ReviewOption[] = [
  { code: 'INFORMAL_CONVERSATION', label: 'Informal conversation (recorded)', group: 'Support' },
  { code: 'EXTRA_SUPPORT', label: 'Protected time / extra support / help with the app', group: 'Support' },
  { code: 'SUPERVISION', label: 'Supervision 1:1 booked', group: 'Support' },
  { code: 'REASSIGN', label: 'Re-assign the course with a new due date', group: 'Support' },
  { code: 'PIP', label: 'Performance improvement plan', group: 'Support' },
  { code: 'RESTRICT_DUTIES', label: 'Restrict duties until trained', group: 'Safety' },
  { code: 'DISCIPLINARY_MEETING', label: 'Invite to disciplinary / capability meeting', group: 'Formal', formal: true },
  { code: 'FIRST_WRITTEN_WARNING', label: 'First written warning', group: 'Formal', formal: true },
  { code: 'FINAL_WRITTEN_WARNING', label: 'Final written warning', group: 'Formal', formal: true },
  { code: 'DISMISSAL', label: 'Dismissal (last resort)', group: 'Formal', formal: true },
  { code: 'NO_FURTHER_ACTION', label: 'No further action' },
];

export const REVIEW_REASON_CODES = LEARNING_REVIEW_REASONS.map((r) => r.code);
export const REVIEW_ACTION_CODES = LEARNING_REVIEW_ACTIONS.map((a) => a.code);

/**
 * Lock overdue courses (no lessons / new quizzes)? Built 16 Nov 2026, then switched OFF the same
 * day by the user: for now overdue only shows a warning and the carer can finish (marked late).
 */
export const LOCK_OVERDUE_COURSES = false;

export const LOCKED_MESSAGE =
  'This course is overdue and locked. Please speak to the office.';

/**
 * Reasons a carer can give in the app for an overdue course: the same list and wording as the
 * office, without "No reason given" (office-only). 16 Nov 2026.
 */
export const CARER_LATE_REASONS: ReviewOption[] = LEARNING_REVIEW_REASONS.filter(
  (r) => r.code !== 'NO_REASON',
);
export const CARER_LATE_REASON_CODES = CARER_LATE_REASONS.map((r) => r.code);

/** Overdue course: the carer must say why before going on (user decision, 16 Nov 2026). */
export const LATE_REASON_REQUIRED_MESSAGE =
  'This course is overdue. Tell the office why before you carry on.';

/** Warning on an overdue course while it stays open (16 Nov 2026). */
export const OVERDUE_MESSAGE =
  'This course is overdue. Please finish it as soon as you can. It will be recorded as completed late.';
