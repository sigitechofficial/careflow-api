import { SetMetadata } from '@nestjs/common';

/**
 * Independent survey reviewers (SUR-CQC-001 independent quality review, SUR-CQC-002 paper returns)
 * sign in with an ordinary user account whose ONLY role is this one: no permissions of its own, no
 * branch, no employee record. A manager grants it one survey at a time (SurveyReviewerGrant); while a
 * grant is live the account holds SURVEY_REVIEW_PERMISSION and nothing else. Temporary Inspector
 * logins are never used for this (they can open care records).
 * Keep the name in step with prisma/seed.ts and migration 20261215130000_survey_reviewer_user_accounts.
 */
export const INDEPENDENT_REVIEWER_ROLE = 'Independent reviewer';

/** Held only while the account has a live grant (UsersService.getAuthContext). */
export const SURVEY_REVIEW_PERMISSION = 'surveys.review.record';

/** A reviewer account: its only role is Independent reviewer. Any other role makes it a staff account. */
export const isReviewerOnly = (roles: readonly string[] | null | undefined): boolean =>
  Boolean(roles?.length) && roles!.every((r) => r === INDEPENDENT_REVIEWER_ROLE);

export const REVIEWER_ALLOWED_KEY = 'independentReviewerAllowed';
/**
 * A route a reviewer-only account may call (its account, signing out, "Surveys to record"). Every
 * other signed-in route refuses it (JwtAuthGuard), whatever permissions the route asks for.
 */
export const AllowIndependentReviewer = () => SetMetadata(REVIEWER_ALLOWED_KEY, true);
