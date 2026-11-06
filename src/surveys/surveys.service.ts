import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import {
  NotificationModule,
  NotificationSeverity,
  NotificationType,
  Prisma,
  SurveyRecipientStatus,
  type Survey,
  type SurveyQuestion,
  SurveyQuestionType,
  SurveyRecurrence,
  SurveyRespondentRelation,
  SurveyResponseChannel,
  SurveyStatus,
  SurveyTargetKind,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { FcmPushService } from '../notifications/fcm-push.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IDENTITY_ROLE, type OrgScope } from '../common/org-scope/org-scope.types';
import { OrgScopeService, andWhereFragment } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  dayKeyInTimeZone,
  startOfOperationalDayUtc,
} from '../common/utils/operational-day.util';
import { formatUkDateLabel } from '../common/utils/uk-date-label.util';
import { SurveyLinkGuard, linkLimitFor } from './survey-link-guard';
import { SurveyRemindersService } from './survey-reminders.service';
import { SurveyContactRuleService, type HeldPerson } from './survey-contact-rule.service';
import {
  freeFromDay,
  isShortRepeat,
  libraryRepeatReason,
  librarySentWith,
  readSampling,
  storedRepeatReason,
} from './survey-contact-rule.util';
import { staffAnswerPlaces, type StaffAnswerPlaces } from './survey-staff-answer-places';
import { staffAnswerWhere } from './survey-contact-messages.util';
import { eventPeriodFor, readEventTrigger } from './survey-event-triggers.util';
import { SurveyUnsubscribeService } from './survey-unsubscribe.service';
import {
  CARE_ENDED_STATUS,
  CHOSEN_EXCLUDED_SERVICE_USER_STATUSES,
  ELIGIBLE_EMPLOYEE_WHERE,
  LAPSABLE_STATUSES,
  FORMER_REASON_MAX,
  FORMER_REASON_MIN,
  chosenServiceUsersWhere,
  forLeavers,
  formerPeopleNeedNoReason,
  formerServiceUsersWhere,
  formerStaffWhere,
  organisationDomains,
  personalEmail,
  SURVEY_EXCLUDED_SERVICE_USER_STATUSES,
  ineligibleRecipientIds,
  notWithStatus,
} from './survey-eligibility.util';
import { sharedLinkBurstNote, sharedLinkBursts } from './survey-shared-link-bursts';
import { introsForQuestions, sectionIntrosForCopy, sectionIntrosOf, splitSections } from './survey-sections.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CqcSurveyEvidenceService } from '../cqc-evidence/cqc-survey-evidence.service';
import { findOverallQuestion, questionResult } from '../cqc-evidence/cqc-survey-metrics.util';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { surveyVisibleInScope } from './survey-scope.util';
import {
  WHO_ARE_YOU_KEY,
  WHO_ARE_YOU_TEXT,
  audienceGroupLabel,
  audienceGroupsFor,
  whoAreYouOptions,
  WHO_ARE_YOU_OTHER,
  WHO_ARE_YOU_PREFER_NOT,
} from '../../prisma/seed-lib/survey-audience-groups';
import {
  RESPONSES_RESTRICTED,
  RESULTS_RESTRICTED,
  surveyAccessFor,
  thresholdNote,
  type SurveyAccess,
} from './survey-access';
import { SurveyAlertsService } from './survey-alerts.service';
import {
  EQUALITY_DETAIL_THRESHOLD,
  lookupCodesFor,
  lookupForQuestion,
  lookupGroupOf,
  lookupOptionGroups,
  lookupSummary,
  withLookupOptions,
  type LookupEntry,
} from './survey-lookup-options';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';
import { DuplicateSurveyDto } from './dto/duplicate-survey.dto';
import {
  CreateSurveyQuestionDto,
  UpdateSurveyQuestionDto,
} from './dto/survey-question.dto';
import { SendSurveyDto } from './dto/send-survey.dto';
import { ListSurveysQueryDto } from './dto/list-surveys-query.dto';
import { ReopenSurveyDto } from './dto/reopen-survey.dto';
import {
  SubmitSurveyResponseDto,
  SurveyAnswerItemDto,
} from './dto/submit-survey-response.dto';
import {
  addOperationalDays,
  formatSurveyDateTime,
  nextSurveyDistributeAt,
  recurrenceLabel,
  surveyPeriodKey,
  surveyPeriodLabel,
} from './survey-recurrence.util';
import {
  RecordSurveyResponseDto,
  STAFF_RECORDED_CHANNELS,
  UpdateRecordedSurveyResponseDto,
} from './dto/record-survey-response.dto';
import {
  CHOICE_QUESTION_TYPES,
  DEFAULT_LIKERT_OPTIONS,
  NO_COMMENT_QUESTION_TYPES,
  answerLabelsFor,
  assertSurveyLogic,
  cleanRespondentText,
  currentAnswerLabels,
  isCommentShown,
  isQuestionShown,
  keptNotCountedConfig,
  newQuestionKey,
  normaliseQuestionLogic,
  normaliseQuestionSettings,
  ratingRange,
  readCommentConfig,
  readExclusiveOptions,
  readNotCountedOptions,
  readOtherOption,
  readShowIf,
  type LogicQuestion,
} from './survey-question-config.util';
import {
  completenessTotals,
  type CompletenessAnswer,
  type CompletenessQuestion,
} from './survey-completeness.util';
import {
  MIN_ANONYMOUS_GROUP_SIZE,
  UNKNOWN_GROUP_KEY,
  buildSurveyBreakdown,
  type SurveyBreakdown,
} from './survey-breakdown.util';
import {
  ANSWERED_WITHOUT_NAME,
  ANSWER_WITHOUT_NAME_NOTE,
  CONTACT_ME_ON_ANONYMOUS_REFUSED,
  NOT_ANSWERED_WITHOUT_NAME,
  QUESTION_REMOVAL_REFUSED,
  isAnsweredWithoutName,
  isContactRequestQuestion,
  questionsNotAskedWhenUnlinked,
  offersAnswerWithoutName,
  storedAllowAnonymousResponses,
  withoutNameAnswersHeldBack,
  withoutNameHeldBackNote,
  withoutNameShare,
  withoutNameWrittenVisibility,
} from './survey-respondent-anonymity.util';
import { libraryAnonymousVariant, variantDescription, type LibraryAnonymousVariant } from './survey-library-variant.util';
import {
  MANAGER_TOKEN_MESSAGE,
  MANAGER_TOKEN_QUESTION_SELECT,
  MANAGER_TOKEN_RULE_SELECT,
  surveyNamesManager,
} from './survey-manager-copies.util';
import {
  CQC_RECAPTURE_MARK,
  CLEARED_CLAIM,
  claimRecipient,
  claimableWhere,
  completeClaimed,
  errorKind,
  flushPendingResponses,
  holdUnlinkedResponse,
  releaseClaim,
  submitClaimExpiry,
  pendingResponseCount,
  pendingResponseGroups,
  pendingSharedLinkCount,
  toPendingAnswers,
} from './survey-pending-responses';
import {
  auditUnlinkedAnswerDays,
  countUnlinkedAnswerSafely,
  unlinkedDaySummary,
  type UnlinkedAnswerSource,
  type UnlinkedDayRow,
} from './survey-unlinked-answer-days';
import { usersWithResultsAccess } from './survey-office-recipients';
import { managerCopyTeamProblemFor } from './survey-manager-copy-team';

/** Why some responses are counted but not yet in the answers; null when none. */
export function responsesBeingAddedNote(waiting: number): string | null {
  if (waiting <= 0) return null;
  return `${waiting} ${waiting === 1 ? 'response is' : 'responses are'} counted but not yet in the answers: answers not linked to anyone are added in batches (or when the survey closes), so they cannot be matched to who has just answered.`;
}

/**
 * Recipient totals by status: everyone it was sent to, not opened yet (PENDING / SENT), opened but
 * not finished (STARTED: CareFlow does not save a half-answered survey) and completed.
 */
export function recipientStatusCounts(
  groups: ReadonlyArray<{ status: string; _count: { _all: number } }>,
  opts: { anonymous?: boolean } = {},
) {
  const n = (status: string) =>
    groups.filter((g) => g.status === status).reduce((sum, g) => sum + g._count._all, 0);
  // Anonymous surveys: lapsed invitations are never shown apart (a change in that count, with the
  // other counts, could show who answered); they stay among those who have not started.
  return {
    total: groups.reduce((sum, g) => sum + g._count._all, 0),
    notStarted: n('PENDING') + n('SENT') + (opts.anonymous ? n('LAPSED') : 0),
    opened: n('STARTED'),
    completed: n('COMPLETED'),
    /** Named surveys: no longer able to be sent it (died, care ended, left…). Null on anonymous surveys. */
    lapsed: opts.anonymous ? null : n('LAPSED'),
  };
}

/** The personal link page and app lists once an invitation has lapsed. */
export const CLOSED_FOR_YOU_REASON = 'This survey is closed for you. Thank you.';

/** "How people answered": what each channel is called in the results. */
const CHANNEL_GROUP_LABELS: Record<SurveyResponseChannel, string> = {
  ONLINE: 'Survey link',
  PORTAL: 'Portal',
  TELEPHONE: 'Phone',
  IN_PERSON: 'Visit',
  PAPER: 'Paper',
};

/** "How people answered" on service-user surveys: who answered. */
const RESPONDENT_GROUP_LABELS: Record<SurveyRespondentRelation, string> = {
  SELF: 'The person themselves',
  FAMILY_MEMBER: 'A family member',
  REPRESENTATIVE: 'A representative',
  STAFF: 'Staff on their behalf',
};
const NOT_RECORDED_LABEL = 'Not recorded';
/** Named survey: answers given online without a name, one group (never split by channel). */
const WITHOUT_NAME_GROUP_KEY = 'without-name';

/** Why the survey job closed a survey (audit description and the survey page's wording). */
export const CLOSED_AT_END_DATE_REASON = 'Reached its end date';
/** Surveys closed per run at most (the rest are closed on the next run, a minute later). */
const AUTO_CLOSE_BATCH = 200;

const isStaffRecordedChannel = (channel: SurveyResponseChannel) =>
  (STAFF_RECORDED_CHANNELS as readonly string[]).includes(channel);

/** A schedule within this window of "now" is treated as "send now". */
const SEND_NOW_WINDOW_MS = 15_000;

/**
 * An anonymous survey needs at least this many people to send to (or record for): with fewer,
 * the results — or who has not answered — would point to individuals.
 */
export const MIN_ANONYMOUS_RECIPIENTS = MIN_ANONYMOUS_GROUP_SIZE;

/** A closed survey nobody answered drops off the carer app / portal list after this many days. */
export const UNANSWERED_CLOSED_LIST_DAYS = 30;

/**
 * 409 codes on submitting answers (error body `code`). ALREADY_COMPLETED: the answer is not needed
 * (drop it). ANSWER_IN_PROGRESS: another submit for this person is being kept, or one that failed
 * left a claim that lapses within half an hour: keep the answer and try again later.
 */
export const SURVEY_ALREADY_COMPLETED = 'SURVEY_ALREADY_COMPLETED';
export const SURVEY_ANSWER_IN_PROGRESS = 'SURVEY_ANSWER_IN_PROGRESS';

/**
 * Unexpected run errors (e.g. a database blip) are retried every minute this many times, then
 * with a growing delay (capped at an hour). The scheduler is told once, after
 * SURVEY_RETRY_NOTIFY_AFTER failures in a row.
 */
export const SURVEY_RETRY_FREE_ATTEMPTS = 3;
export const SURVEY_RETRY_NOTIFY_AFTER = 5;
const SURVEY_RETRY_BASE_DELAY_MS = 5 * 60_000;
const SURVEY_RETRY_MAX_DELAY_MS = 60 * 60_000;

export function surveyRetryDelayMs(failures: number): number {
  if (failures <= SURVEY_RETRY_FREE_ATTEMPTS) return 0;
  const steps = failures - SURVEY_RETRY_FREE_ATTEMPTS - 1;
  return Math.min(SURVEY_RETRY_BASE_DELAY_MS * 2 ** steps, SURVEY_RETRY_MAX_DELAY_MS);
}

const DAY_MS = 86_400_000;

type Db = Prisma.TransactionClient | PrismaService;

/** Who a send goes to. Empty lists mean "everyone" (within the sender's branches). */
export type SurveyAudience = {
  locationIds: string[];
  roleIds: string[];
  employeeIds: string[];
  /** Chosen people we support (service-user surveys); empty = everyone in locationIds. */
  serviceUserIds: string[];
};

/** Whether a survey can be answered now, and if not why (the link page shows a page for each). */
type Availability = {
  canSubmit: boolean;
  kind: 'COMPLETED' | 'NOT_PUBLISHED' | 'NOT_OPEN' | 'ENDED' | 'NO_OPEN_PERIOD' | 'CLOSED_FOR_YOU' | null;
  reason: string | null;
};

/** Said on a staff or service-user survey's shared link. */
export const SHARED_LINK_NOTE =
  "You are answering through a shared link. Your answers are not linked to your name, so we cannot reply to you about them. If you need us to contact you, please speak to the office.";

/** The survey a shared link opens (see findShareSurvey). */
type ShareSurvey = Survey & {
  /** A branch link: its id and branch (the answers carry the branch). */
  shareLink?: { id: string; locationId: string | null };
  /** A repeating survey's link with no period open right now. */
  noOpenPeriod?: { nextOpensAt: Date | null };
  /** The link's survey (the repeating one, for a period) asks for one answer per device. */
  linkOncePerDevice?: boolean;
};

/** Said on a shared link that allows one answer per device. */
export const ONCE_PER_DEVICE_NOTE =
  'So that each person answers once, this device remembers that it has been used to answer this survey. Nothing about you is kept, and this is never sent with your answers.';

type CreatedRecipient = {
  token: string;
  employeeId: string | null;
  serviceUserId: string | null;
};

type ResolvedTargets = {
  ids: string[];
  skippedNoPortal: number;
  /**
   * Chosen people we support without an enabled portal account who are still recipients (named
   * surveys only): staff phone, visit or post and use Record response. Empty otherwise.
   */
  noPortalIds: string[];
  /** Branches of the people targeted; null when someone has no branch (company-only data). */
  branchIds: string[] | null;
  emptyMessage: string;
};

/** Recipients this send created who have no portal account (chosen people on a named survey). */
function createdWithoutPortal(created: CreatedRecipient[], noPortalIds: string[]): string[] {
  if (!noPortalIds.length) return [];
  const without = new Set(noPortalIds);
  return created
    .map((r) => r.serviceUserId)
    .filter((id): id is string => Boolean(id) && without.has(id as string));
}

/** A scheduled run that cannot go out; reported to the person who scheduled it. */
export class SurveyDistributionError extends Error {
  constructor(
    readonly code: 'NO_QUESTIONS' | 'NO_RECIPIENTS' | 'TOO_FEW_RECIPIENTS' | 'ENDED' | 'MANAGER_TEAM_TOO_SMALL',
    message: string,
  ) {
    super(message);
  }
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** A unique-key clash (two writers creating the same row). */
const isUniqueClash = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const toIso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** Who it's for, checked against the audience type: a known group, and OTHER with the group in words. */
function audienceGroupInput(kind: string, code: string | null | undefined, other: string | null | undefined) {
  if (!code) return { audienceGroup: null, audienceGroupOther: null };
  if (!audienceGroupsFor(kind).some((g) => g.code === code)) {
    throw new BadRequestException(`Choose who this survey is for from the list for ${kind === 'EMPLOYEE' ? 'staff' : kind === 'SERVICE_USER' ? 'people we support' : 'the public'}.`);
  }
  if (code === 'OTHER' && !other?.trim()) throw new BadRequestException('Say who the survey is for.');
  return { audienceGroup: code, audienceGroupOther: code === 'OTHER' ? other!.trim().slice(0, 80) : null };
}

/**
 * A question whose options come from a CareFlow list: which list, and its entries in use in their
 * groups (for a searchable, grouped choice). `options` still lists the names, so a form that does not
 * know lists (an older carer app) shows a plain list and answers by name.
 */
function lookupFormPayload(q: { optionsFrom?: string | null; lookupEntries?: LookupEntry[] }) {
  if (!q.optionsFrom) return {};
  return { optionsFrom: q.optionsFrom, optionGroups: q.lookupEntries ? lookupOptionGroups(q.lookupEntries) : [] };
}

/** Anonymous surveys show written answers (Other text, comments) only from this many responses. */
export const MIN_ANONYMOUS_WRITTEN_ANSWERS = MIN_ANONYMOUS_GROUP_SIZE;
/** Written answers listed under each question in the results (the newest first). */
export const WRITTEN_ANSWERS_SHOWN = 50;

/** What a short / long text answer shows while it is held back. */
export const WITHHELD_TEXT_DISPLAY = 'Written answer — shown once the survey has closed';

type WrittenField = 'textValue' | 'otherText' | 'comment';

/** Held-back written answers in the audit log's before / after answers. */
const WITHHELD_AUDIT_TEXT = '(written answer held back)';
/** A CareFlow-list (equality) answer linked to no one, in the audit trail. */
const EQUALITY_AUDIT_TEXT = '(equality answer not kept in the audit trail)';

/**
 * Correcting a staff-recorded response while its written answers are held back: staff could not see
 * them, so each one they left empty keeps its saved text — a short / long text answer, the Other
 * text (kept only if Other is still chosen) and the comment (kept only if the comment box still
 * applies). Text they typed replaces it; a choice answer they cleared goes with its written parts.
 */
export function keepWithheldWrittenAnswers<
  T extends { answers: SurveyAnswerItemDto[] },
>(
  dto: T,
  saved: Array<{ questionId: string; textValue: string | null; otherText: string | null; comment: string | null }>,
): T {
  const answers = dto.answers.map((a) => ({ ...a }));
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  for (const old of saved) {
    const given = byQuestion.get(old.questionId);
    if (!given) {
      if (old.textValue?.trim()) {
        const restored = { questionId: old.questionId, textValue: old.textValue } as SurveyAnswerItemDto;
        answers.push(restored);
        byQuestion.set(old.questionId, restored);
      }
      continue;
    }
    if (!given.textValue?.trim() && old.textValue?.trim()) given.textValue = old.textValue;
    if (!given.otherText?.trim() && old.otherText?.trim()) given.otherText = old.otherText;
    if (!given.comment?.trim() && old.comment?.trim()) given.comment = old.comment;
  }
  return { ...dto, answers };
}

/**
 * Editing a recorded response linked to no one: its CareFlow-list (equality) answers were shown
 * only as their group, or "Not shown" (a rare group could point at someone), so staff never saw the
 * stored answer. An answer that comes back bare (no choice) or unchanged (the group labels or the
 * "Not shown" words the list showed) keeps the stored answer; only a new choice replaces it, and no
 * answer at all clears it. The words shown in its place are never saved as an answer.
 */
export function keepLookupAnswersLinkedToNoOne<T extends { answers: SurveyAnswerItemDto[] }>(
  dto: T,
  saved: Array<{ questionId: string; selectedOptions: unknown; question: { optionsFrom: string | null } }>,
  shownAs: (stored: string[]) => string[],
): T {
  const answers = dto.answers.map((a) => ({ ...a }));
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  for (const old of saved) {
    if (!old.question.optionsFrom || !Array.isArray(old.selectedOptions)) continue;
    const stored = (old.selectedOptions as unknown[]).filter((v): v is string => typeof v === 'string');
    const given = byQuestion.get(old.questionId);
    if (!given || !stored.length) continue;
    const chosen = given.selectedOptions ?? [];
    const shown = shownAs(stored);
    const unchanged =
      !chosen.length ||
      chosen.some((v) => v.startsWith('Not shown (')) ||
      (chosen.length === shown.length && chosen.every((v) => shown.includes(v)));
    if (unchanged) given.selectedOptions = stored;
  }
  return { ...dto, answers };
}

/** The written parts of an answer that hold text (what is held back while written answers are hidden). */
export function withheldWrittenFields(a: {
  textValue: string | null;
  otherText: string | null;
  comment: string | null;
}): WrittenField[] {
  const out: WrittenField[] = [];
  if (a.textValue?.trim()) out.push('textValue');
  if (a.otherText?.trim()) out.push('otherText');
  if (a.comment?.trim()) out.push('comment');
  return out;
}

/** A "clearing" answer dropped from a submitted MULTI_SELECT answer (kept in the response audit). */
export type ExclusiveOptionAdjustment = { questionId: string; dropped: string[]; kept: string[] };

/**
 * A MULTI_SELECT answer that combines a clearing option ("None of these") with other choices (older
 * carer apps cannot stop it): the specific choices are kept and the clearing options dropped. Two
 * clearing options and nothing else keep the first one given.
 */
export function resolveExclusiveChoices(
  selected: string[],
  exclusive: string[],
): { selected: string[]; dropped: string[] } {
  if (selected.length < 2 || !exclusive.length) return { selected, dropped: [] };
  const isExclusive = (o: string) => exclusive.includes(o);
  const chosenExclusive = selected.filter(isExclusive);
  if (!chosenExclusive.length) return { selected, dropped: [] };
  const specific = selected.filter((o) => !isExclusive(o));
  if (specific.length) return { selected: specific, dropped: chosenExclusive };
  const [first, ...rest] = chosenExclusive;
  return { selected: [first!], dropped: rest };
}

/** Response audit metadata for clearing answers that were dropped (nothing when none were). */
export function exclusiveAdjustmentsMeta(adjustments: ExclusiveOptionAdjustment[]) {
  return adjustments.length ? { exclusiveOptionsDropped: adjustments } : {};
}

/**
 * A response's audit metadata for dropped clearing answers. An answer linked to no one keeps only
 * that something was adjusted: the entry carries the exact time, so the choices kept (or how many
 * questions were answered) could be matched to the stored answers and, by time, to the person.
 */
export function responseAuditAdjustments(adjustments: ExclusiveOptionAdjustment[], unlinked: boolean) {
  if (!unlinked) return exclusiveAdjustmentsMeta(adjustments);
  return adjustments.length ? { exclusiveOptionsAdjusted: true } : {};
}

/** The order respondents see questions in: position, then when added (positions can repeat). */
const QUESTION_ORDER: Prisma.SurveyQuestionOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];

/** Json column value for a create / update (null → SQL NULL). */
const jsonOrNull = (value: unknown) =>
  value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

/**
 * A question's key, Other choice, comment box and show-if rule for a copy of it. Keys are copied
 * as they are, so "Show only if" rules (which point at keys) keep pointing at the same questions;
 * a question without a key (none should be left) gets a new one.
 */
export function copiedQuestionLogic(
  q: {
    key: string | null;
    otherOption: Prisma.JsonValue;
    exclusiveOptions: Prisma.JsonValue;
    commentConfig: Prisma.JsonValue;
    showIf: Prisma.JsonValue;
  },
  takenKeys: Set<string>,
) {
  const key = q.key ?? newQuestionKey(takenKeys, () => randomUUID());
  takenKeys.add(key);
  return {
    key,
    otherOption: jsonOrNull(q.otherOption),
    exclusiveOptions: jsonOrNull(q.exclusiveOptions),
    commentConfig: jsonOrNull(q.commentConfig),
    showIf: jsonOrNull(q.showIf),
  };
}

/**
 * A ready-made survey (an adopted template, or a survey started from one or copied from such a
 * survey): its introduction and privacy notice tell people whether answers are anonymous, so that
 * cannot be changed.
 */
export function anonymityLocked(survey: {
  libraryReference: string | null;
  librarySourceId: string | null;
}): boolean {
  return Boolean(survey.librarySourceId || survey.libraryReference);
}

/** Turning "answer without my name" off once people were offered it, or against a ready-made promise. */
const anonymousChoiceFixedMessage = (reason: 'library' | 'sent', reference?: string | null) =>
  reason === 'library'
    ? `This survey comes from the ready-made survey${reference ? ` ${reference}` : ''}, whose privacy notice tells people they can answer without their name, so that choice cannot be turned off.`
    : 'People have already been offered the choice to answer without their name, so it cannot be turned off now. Duplicate the survey to start again.';

const anonymityLockedMessage = (isAnonymous: boolean) =>
  `This survey comes from a ready-made survey that is ${isAnonymous ? 'anonymous' : 'named'}: its introduction and privacy notice tell people how their answers are kept, so that cannot be changed.`;

/**
 * Anonymous surveys: written answers (Other text, comments, short and long text answers) are shown
 * only for a closed survey — or a repeating survey's closed periods — and only once at least
 * MIN_ANONYMOUS_WRITTEN_ANSWERS responses are in them. While answers are still arriving, a new
 * comment appearing could be matched to whoever just answered.
 */
export type WrittenAnswerVisibility = {
  /** Every written answer is shown (named surveys, or an anonymous survey past both rules). */
  all: boolean;
  /** Survey ids whose written answers are shown (the survey itself and / or closed periods). */
  surveyIds: Set<string>;
  /** Shown to explain what is held back; null when nothing is. */
  note: string | null;
};

export function writtenAnswerVisibility(
  survey: { id: string; isAnonymous: boolean; status: SurveyStatus },
  periods: Array<{ id: string; status: SurveyStatus }>,
  responsesBySurvey: ReadonlyMap<string, number>,
): WrittenAnswerVisibility {
  const ids = [survey.id, ...periods.map((p) => p.id)];
  if (!survey.isAnonymous) return { all: true, surveyIds: new Set(ids), note: null };
  const isSeries = periods.length > 0;
  const closed = isSeries
    ? periods.filter((p) => p.status === SurveyStatus.CLOSED).map((p) => p.id)
    : survey.status === SurveyStatus.CLOSED
      ? [survey.id]
      : [];
  const closedResponses = closed.reduce((sum, id) => sum + (responsesBySurvey.get(id) ?? 0), 0);
  const rule = `Written answers on an anonymous survey are shown once the ${isSeries ? 'period' : 'survey'} has closed and at least ${MIN_ANONYMOUS_WRITTEN_ANSWERS} people have answered, so they cannot be traced to anyone.`;
  if (!closed.length || closedResponses < MIN_ANONYMOUS_WRITTEN_ANSWERS) {
    return { all: false, surveyIds: new Set(), note: rule };
  }
  if (closed.length < periods.length) {
    return { all: false, surveyIds: new Set(closed), note: `Closed periods only. ${rule}` };
  }
  return { all: true, surveyIds: new Set(closed), note: null };
}

const tooFewAnonymousMessage = (count: number) =>
  `Anonymous surveys need at least ${MIN_ANONYMOUS_RECIPIENTS} people so nobody can be identified from the answers — this audience has ${count}. Choose more people or branches, or make the survey named.`;

/**
 * The branch a person is counted under for a sender. Like OrgScopeService, someone is in scope
 * through their main branch, their base or a floor branch — so the branch recorded on the survey
 * is the first of those within `preferred` (the sender's branches). That keeps a survey sent to
 * someone who only works at the sender's branch visible to the sender.
 */
export function branchWithin(
  employment: {
    locationId: string | null;
    baseLocationId?: string | null;
    floorLocations?: Array<{ locationId: string }>;
  } | null | undefined,
  preferred: string[] | null,
): string | null {
  if (!employment) return null;
  if (preferred && preferred.length) {
    const allowed = new Set(preferred);
    const candidates = [
      employment.locationId,
      employment.baseLocationId ?? null,
      ...(employment.floorLocations ?? []).map((f) => f.locationId),
    ];
    const inScope = candidates.find((id): id is string => Boolean(id) && allowed.has(id as string));
    if (inScope) return inScope;
  }
  return employment.locationId ?? null;
}

/** Closed (or past its end) longer than the list window and never answered → not listed any more. */
export function isStaleUnansweredSurvey(
  survey: { status: SurveyStatus; closesAt: Date | null; updatedAt: Date },
  completed: boolean,
  now: Date,
): boolean {
  if (completed) return false;
  let endedAt: Date | null = null;
  if (survey.closesAt && survey.closesAt.getTime() <= now.getTime()) endedAt = survey.closesAt;
  else if (survey.status === SurveyStatus.CLOSED) endedAt = survey.updatedAt;
  if (!endedAt) return false;
  return now.getTime() - endedAt.getTime() > UNANSWERED_CLOSED_LIST_DAYS * DAY_MS;
}

@Injectable()
export class SurveysService {
  private readonly logger = new Logger(SurveysService.name);
  /**
   * Unexpected run errors per survey (in this process): consecutive failures, when the next try
   * is allowed and whether the scheduler has been told. Cleared on success or a handled failure.
   */
  private readonly retryState = new Map<
    string,
    { failures: number; nextAttemptAt: number; notified: boolean }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly push: FcmPushService,
    private readonly notifications: NotificationsService,
    private readonly orgScope: OrgScopeService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    /** CQC evidence: a closed survey's results are kept as evidence (Quality → CQC evidence). */
    @Optional() private readonly cqcEvidence?: CqcSurveyEvidenceService,
    /** Alert rules: answers → tasks for a role, and the follow-up list. */
    @Optional() private readonly alerts?: SurveyAlertsService,
    /** Spam protection on shared links (survey-link-guard.ts). */
    @Optional() private readonly linkGuard?: SurveyLinkGuard,
    /** Reminders, contact plans, text invitations and opt-outs (survey-reminders.service.ts). */
    @Optional() private readonly reminders?: SurveyRemindersService,
    /** The 4-week contact rule and sampling (survey-contact-rule.service.ts). */
    @Optional() private readonly contactRule?: SurveyContactRuleService,
    /** "Unsubscribe from all surveys" links for former people (survey-unsubscribe.service.ts). */
    @Optional() private readonly unsubscribe?: SurveyUnsubscribeService,
  ) {}

  /** Check a saved named response against the alert rules. Never fails or delays the caller. */
  private checkAlerts(responseId: string, recheck = false) {
    if (!this.alerts) return;
    void (recheck ? this.alerts.recheckResponse(responseId) : this.alerts.checkResponse(responseId)).catch((e: unknown) =>
      this.logger.warn(`Survey alerts: response not checked yet, the survey job will retry (${errorKind(e)})`),
    );
  }

  // ─── Scope ────────────────────────────────────────────────────────────────

  private scopeOf(actor: RequestUser): OrgScope {
    return this.orgScope.fromRequestUser(actor);
  }

  /**
   * Branch-restricted users see a survey only when every branch it is for is one of theirs —
   * a survey spanning other branches holds other branches' people and answers. Templates with
   * no branch are shared starting points (no people, no answers) and visible to everyone.
   */
  private surveyVisible(
    scope: OrgScope,
    survey: { locationIds: string[]; isTemplate: boolean },
  ): boolean {
    return surveyVisibleInScope(scope, survey);
  }

  /** Branches a branch-restricted user may target: their own; "everyone" means all of theirs. */
  private locationIdsWithinScope(scope: OrgScope, requested: string[]): string[] {
    const ids = unique(requested);
    if (scope.locationIds === null) return ids;
    if (ids.length === 0) {
      if (scope.locationIds.length === 0) {
        throw new BadRequestException('You have no branches assigned, so you cannot target anyone.');
      }
      return [...scope.locationIds];
    }
    const allowed = new Set(scope.locationIds);
    if (ids.some((id) => !allowed.has(id))) {
      throw new BadRequestException('You can only choose your own branches.');
    }
    return ids;
  }

  private async requireSurvey(actor: RequestUser, id: string): Promise<Survey> {
    // Ready-made (catalogue) surveys belong to the survey library, never to the organisation's surveys.
    const row = await this.prisma.survey.findFirst({ where: { id, deletedAt: null, isCatalogue: false } });
    if (!row || !this.surveyVisible(this.scopeOf(actor), row)) {
      throw new NotFoundException('Survey not found');
    }
    return row;
  }

  /**
   * A company template (no branch) is shared by every branch: branch-restricted users can view it
   * and "Use" it, but not change, delete or save over it.
   */
  private isReadOnlyFor(scope: OrgScope, survey: { locationIds: string[]; isTemplate: boolean }) {
    return scope.locationIds !== null && survey.isTemplate && survey.locationIds.length === 0;
  }

  /** requireSurvey + the survey may be changed by this user. */
  private async requireEditableSurvey(actor: RequestUser, id: string): Promise<Survey> {
    const row = await this.requireSurvey(actor, id);
    if (this.isReadOnlyFor(this.scopeOf(actor), row)) {
      throw new ForbiddenException(
        'This is a shared company template, so only someone with access to all branches can change it. Use the template to start your own survey.',
      );
    }
    return row;
  }

  private async timeZone(): Promise<string> {
    try {
      return (await this.orgSettings.getOperationalTimezone()) || DEFAULT_OPERATIONAL_TIMEZONE;
    } catch {
      return DEFAULT_OPERATIONAL_TIMEZONE;
    }
  }

  /** Anonymous answers keep only the day they were given, so timing cannot single anyone out. */
  private async anonymousTimestamp(now: Date): Promise<Date> {
    const tz = await this.timeZone();
    return startOfOperationalDayUtc(dayKeyInTimeZone(now, tz), tz);
  }

  /**
   * A survey from a ready-made survey whose privacy notice tells people they can answer without
   * their name online (the catalogue survey allows it): the choice cannot be turned off.
   */
  /**
   * The anonymous version of the ready-made survey a named template was adopted from (its own
   * details, else the current ready-made survey's), with the organisation's name filled in; null when
   * there is none. Only adopted templates offer it: a survey started from one keeps its version.
   */
  private async libraryVariantOf(source: Survey): Promise<LibraryAnonymousVariant | null> {
    if (!source.isTemplate || !source.librarySourceId || source.isAnonymous) return null;
    const own = libraryAnonymousVariant(source.libraryMeta);
    if (own) return own;
    const catalogue = await this.prisma.survey.findFirst({
      where: { id: source.librarySourceId, isCatalogue: true, deletedAt: null },
      select: { libraryMeta: true },
    });
    const variant = libraryAnonymousVariant(catalogue?.libraryMeta);
    if (!variant) return null;
    const profile = await this.prisma.companyProfile.findFirst({ select: { companyName: true } });
    const name = profile?.companyName?.trim() || 'the organisation';
    const fill = (text: string) => text.split('{{organisation}}').join(name);
    return {
      ...variant,
      introduction: fill(variant.introduction),
      privacyNotice: fill(variant.privacyNotice),
      ...(variant.closingMessage ? { closingMessage: fill(variant.closingMessage) } : {}),
    };
  }

  private async libraryPromisesAnswerWithoutName(survey: {
    libraryReference: string | null;
    librarySourceId: string | null;
  }): Promise<boolean> {
    if (!anonymityLocked(survey)) return false;
    const catalogue = await this.prisma.survey.findFirst({
      where: survey.librarySourceId
        ? { id: survey.librarySourceId, isCatalogue: true }
        : { libraryReference: survey.libraryReference, isCatalogue: true, deletedAt: null },
      select: { isAnonymous: true, allowAnonymousResponses: true },
    });
    return Boolean(catalogue && storedAllowAnonymousResponses(catalogue.isAnonymous, catalogue.allowAnonymousResponses));
  }

  // ─── Guards ───────────────────────────────────────────────────────────────

  private assertNotTemplate(survey: { isTemplate: boolean }, action: string) {
    if (survey.isTemplate) {
      throw new BadRequestException(
        `This is a template — templates are never ${action}. Use the template to start a new survey.`,
      );
    }
  }

  /** A survey's questions with what the survey-wide "Show only if" checks need. */
  private async logicQuestions(surveyId: string) {
    const rows = await this.prisma.surveyQuestion.findMany({
      where: { surveyId, deletedAt: null },
      select: {
        id: true,
        key: true,
        questionText: true,
        questionType: true,
        options: true,
        config: true,
        otherOption: true,
        showIf: true,
        sortOrder: true,
        createdAt: true,
      },
    });
    return rows ?? [];
  }

  /** Questions in the order respondents see them (position, then when added). */
  private inSurveyOrder<Q extends LogicQuestion & { id: string; sortOrder: number; createdAt?: Date | null }>(
    questions: Q[],
  ): Q[] {
    return [...questions].sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
        a.id.localeCompare(b.id),
    );
  }

  /**
   * A question's Other choice, comment box and show-if rule as clients read them. showIf also
   * carries the id of the question it points at (null when that question is not on the survey).
   */
  private questionLogicPayload(
    q: {
      key?: string | null;
      otherOption?: Prisma.JsonValue;
      exclusiveOptions?: Prisma.JsonValue;
      commentConfig?: Prisma.JsonValue;
      showIf?: Prisma.JsonValue;
    },
    idByKey?: ReadonlyMap<string, string>,
  ) {
    const showIf = readShowIf(q.showIf);
    return {
      key: q.key ?? null,
      otherOption: readOtherOption(q.otherOption),
      /** MULTI_SELECT: choosing one of these clears the other ticks (and ticking another clears it). */
      exclusiveOptions: readExclusiveOptions(q.exclusiveOptions),
      commentConfig: readCommentConfig(q.commentConfig),
      showIf: showIf
        ? { ...showIf, ...(idByKey ? { questionId: idByKey.get(showIf.questionKey) ?? null } : {}) }
        : null,
    };
  }

  private async questionCount(surveyId: string) {
    return this.prisma.surveyQuestion.count({ where: { surveyId, deletedAt: null } });
  }

  private async cloneCount(surveyId: string) {
    return this.prisma.survey.count({ where: { clonedFromId: surveyId, deletedAt: null } });
  }

  /** Responses to one survey, including answers still waiting to be written (pending store). */
  private async responseCount(surveyId: string) {
    const [written, waiting] = await Promise.all([
      this.prisma.surveyResponse.count({ where: { surveyId } }),
      pendingResponseCount(this.prisma, surveyId),
    ]);
    return written + (waiting ?? 0);
  }

  /** Answers given without a name to one survey, including ones still waiting to be written. */
  private async withoutNameCount(surveyId: string) {
    const [written, waiting] = await Promise.all([
      this.prisma.surveyResponse.count({ where: { surveyId, ...ANSWERED_WITHOUT_NAME } }),
      this.prisma.surveyPendingResponse.count({ where: { surveyId, ...ANSWERED_WITHOUT_NAME } }),
    ]);
    return written + (waiting ?? 0);
  }

  private async activity(surveyId: string) {
    const [recipients, responses, clones] = await Promise.all([
      this.prisma.surveyRecipient.count({ where: { surveyId } }),
      this.responseCount(surveyId),
      this.cloneCount(surveyId),
    ]);
    return {
      recipients,
      responses,
      clones,
      /** Sent or answered (itself or through period copies). */
      any: recipients > 0 || responses > 0 || clones > 0,
    };
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  private serializeSurvey(r: Survey) {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      /** Shown to people after they submit (the closing screen). */
      closingMessage: r.closingMessage ?? null,
      targetKind: r.targetKind,
      status: r.status,
      isAnonymous: r.isAnonymous,
      /** Named surveys: each person may choose to answer without their name. Always false when anonymous. */
      allowAnonymousResponses: storedAllowAnonymousResponses(r.isAnonymous, r.allowAnonymousResponses),
      opensAt: toIso(r.opensAt),
      closesAt: toIso(r.closesAt),
      publishedAt: toIso(r.publishedAt),
      distributeAt: toIso(r.distributeAt),
      distributedAt: toIso(r.distributedAt),
      distributionFailedAt: toIso(r.distributionFailedAt),
      distributionError: r.distributionError ?? null,
      recurrence: r.recurrence ?? null,
      recurrenceAnchorAt: toIso(r.recurrenceAnchorAt),
      /** Sent when something happens in the care records (the event's code), into a copy each month. */
      eventTrigger: readEventTrigger(r.eventTrigger)?.event ?? null,
      periodOpenDays: r.periodOpenDays ?? null,
      periodKey: r.periodKey ?? null,
      clonedFromId: r.clonedFromId ?? null,
      /** Who it's for (e.g. "Families and representatives"); SEVERAL asks "Who are you?". */
      audienceGroup: r.audienceGroup ?? null,
      audienceGroupOther: r.audienceGroupOther ?? null,
      audienceGroupLabel: audienceGroupLabel(r.targetKind, r.audienceGroup, r.audienceGroupOther),
      locationIds: r.locationIds,
      roleIds: r.roleIds,
      audienceEmployeeIds: r.audienceEmployeeIds,
      audienceServiceUserIds: r.audienceServiceUserIds ?? [],
      isTemplate: r.isTemplate,
      /** Adopted from Surveys → Ready-made surveys (the library reference and revision). */
      libraryReference: r.libraryReference ?? null,
      libraryRevision: r.libraryRevision ?? null,
      librarySourceId: r.librarySourceId ?? null,
      /** The template this survey was started from (kept on duplicates). */
      createdFromTemplateId: r.createdFromTemplateId ?? null,
      /** Ready-made origin: anonymity follows the ready-made survey and cannot be changed. */
      anonymityLocked: anonymityLocked(r),
      /** Staff and service-user surveys: also answerable through one shared link (public: always). */
      sharedLinkEnabled: r.targetKind === SurveyTargetKind.PUBLIC ? true : r.sharedLinkEnabled,
      /** Shared link: one answer per device (a marker kept only on the device). */
      sharedLinkOncePerDevice: r.sharedLinkOncePerDevice ?? false,
      // The shared link: public surveys, and staff / service-user surveys with it turned on.
      shareToken:
        !r.isTemplate && !r.isCatalogue && (r.targetKind === SurveyTargetKind.PUBLIC || r.sharedLinkEnabled)
          ? r.shareToken
          : null,
      createdById: r.createdById ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async list(actor: RequestUser, query: ListSurveysQueryDto) {
    const scope = this.scopeOf(actor);
    const where: Prisma.SurveyWhereInput = { deletedAt: null, isCatalogue: false };
    if (query.status) where.status = query.status;
    if (query.targetKind) where.targetKind = query.targetKind;
    if (query.audienceGroup) where.audienceGroup = query.audienceGroup;
    if (query.isTemplate !== undefined) where.isTemplate = query.isTemplate === 'true';
    if (scope.locationIds !== null) {
      andWhereFragment(where, {
        OR: [
          ...(scope.locationIds.length ? [{ locationIds: { hasSome: scope.locationIds } }] : []),
          { isTemplate: true, locationIds: { isEmpty: true } },
        ],
      });
    }

    const rows = (
      await this.prisma.survey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              questions: { where: { deletedAt: null } },
              recipients: true,
              responses: true,
              clones: { where: { deletedAt: null } },
            },
          },
        },
      })
    ).filter((r) => this.surveyVisible(scope, r));

    const surveyIds = rows.map((r) => r.id);
    const completedBySurvey =
      surveyIds.length === 0
        ? []
        : await this.prisma.surveyRecipient.groupBy({
            by: ['surveyId'],
            where: { surveyId: { in: surveyIds }, status: 'COMPLETED' },
            _count: { _all: true },
          });
    const completedMap = new Map(
      completedBySurvey.map((row) => [row.surveyId, row._count._all] as const),
    );
    // Responses include answers still waiting to be written (counted, never shown).
    const waitingMap = new Map<string, number>();
    for (const g of await pendingResponseGroups(this.prisma, surveyIds)) {
      waitingMap.set(g.surveyId, (waitingMap.get(g.surveyId) ?? 0) + g._count._all);
    }
    const creatorMap = await this.loadUserNameMap(
      rows.map((r) => r.createdById).filter((id): id is string => Boolean(id)),
    );
    const endDateClosed = await this.closedAtEndDate(rows);
    const countsShown = new Map<string, boolean>();
    for (const r of rows) {
      countsShown.set(r.id, await this.countsVisible(actor, r, r._count.responses + (waitingMap.get(r.id) ?? 0)));
    }

    return {
      message: 'Surveys',
      data: rows.map((r) => {
        const recipients = r._count.recipients;
        const completed = completedMap.get(r.id) ?? 0;
        const shown = countsShown.get(r.id) === true;
        return {
          ...this.serializeSurvey(r),
          questionCount: r._count.questions,
          recipientCount: recipients,
          // Per-survey access: answer counts only for those who may see the results (see countsVisible).
          countsRestricted: !shown,
          completedCount: shown ? completed : null,
          responseCount: shown ? r._count.responses + (waitingMap.get(r.id) ?? 0) : null,
          periodCount: r._count.clones,
          responseRate: shown ? (recipients > 0 ? Math.round((completed / recipients) * 100) : 0) : null,
          createdByName: r.createdById ? (creatorMap.get(r.createdById) ?? null) : null,
          readOnly: this.isReadOnlyFor(scope, r),
          /** Closed by the survey job when its end date passed (not by someone). */
          closedAtEndDate: endDateClosed.has(r.id),
        };
      }),
    };
  }

  /**
   * Whether a viewer may see how many answered (response and completion counts, rates): only those
   * who may see the survey's results (per-survey access). Everyone else sees that the counts are
   * restricted — on a survey such as "Feedback on your manager" even a count tells the person rated
   * how many answered. The results page applies the reporting threshold to the figures themselves.
   */
  async countsVisible(actor: RequestUser, survey: Survey, _responses?: number): Promise<boolean> {
    if (!survey.accessPolicy && !survey.libraryReference && !survey.clonedFromId) return true;
    return (await surveyAccessFor(this.prisma, actor, survey)).results;
  }

  async getById(actor: RequestUser, id: string) {
    const row = await this.requireSurvey(actor, id);
    const readOnly = this.isReadOnlyFor(this.scopeOf(actor), row);
    // Options from a CareFlow list are filled in from it (entries in use), so the editor, Preview and
    // Record response show what people are asked.
    const questions = await withLookupOptions(
      this.prisma,
      await this.prisma.surveyQuestion.findMany({
        where: { surveyId: id, deletedAt: null },
        orderBy: QUESTION_ORDER,
      }),
    );
    // Named survey: per-question counts leave out answers given without a name while too few people
    // answered that way (whether they answered a "Show only if" question would show how they answered).
    const withoutNameCount = row.isAnonymous ? 0 : await this.withoutNameCount(id);
    const holdWithoutName = withoutNameAnswersHeldBack(
      row.isAnonymous,
      withoutNameCount,
      row.status === SurveyStatus.CLOSED,
    );
    const [recipientCount, responseCount, periodCount, answerGroups, userMap, source] =
      await Promise.all([
        this.prisma.surveyRecipient.count({ where: { surveyId: id } }),
        this.responseCount(id),
        this.cloneCount(id),
        questions.length
          ? this.prisma.surveyAnswer.groupBy({
              by: ['questionId'],
              where: {
                questionId: { in: questions.map((q) => q.id) },
                ...(holdWithoutName ? { response: NOT_ANSWERED_WITHOUT_NAME } : {}),
              },
              _count: { _all: true },
            })
          : Promise.resolve([] as Array<{ questionId: string; _count: { _all: number } }>),
        this.loadUserNameMap(
          [row.createdById, row.scheduledById].filter((v): v is string => Boolean(v)),
        ),
        row.clonedFromId
          ? this.prisma.survey.findFirst({
              where: { id: row.clonedFromId },
              select: { id: true, title: true },
            })
          : Promise.resolve(null),
      ]);
    const answersByQuestion = new Map(answerGroups.map((g) => [g.questionId, g._count._all]));
    const idByKey = new Map(questions.filter((q) => q.key).map((q) => [q.key!, q.id]));
    const endDateClosed = await this.closedAtEndDate([row]);
    const viewer = await surveyAccessFor(this.prisma, actor, row);
    // A question's answer count is a result (for a question asked only after a particular answer it
    // is the count of that answer): only for those who may see the results, and only once the
    // reporting threshold is met. Everyone else learns only whether it has answers (edit locks).
    const showAnswerCounts = viewer.results && !(viewer.threshold > 0 && responseCount < viewer.threshold);

    return {
      message: 'Survey',
      data: {
        /** What the viewer may see of the answers (per-survey access; see survey-access.ts). */
        viewerAccess: {
          results: viewer.results,
          responses: viewer.responses,
          configure: viewer.configure,
          restricted: viewer.policy.results.restricted || viewer.policy.responses.restricted,
          reportingThreshold: viewer.threshold,
        },
        ...this.serializeSurvey(row),
        createdByName: row.createdById ? (userMap.get(row.createdById) ?? null) : null,
        scheduledByName: row.scheduledById ? (userMap.get(row.scheduledById) ?? null) : null,
        clonedFromTitle: source?.title ?? null,
        /** Closed by the survey job when its end date passed (not by someone). */
        closedAtEndDate: endDateClosed.has(row.id),
        /** Shared company template seen by a branch-restricted user: view and "Use" only. */
        readOnly,
        recipientCount,
        // Per-survey access: answer counts only for those who may see them (see countsVisible).
        responseCount: (await this.countsVisible(actor, row, responseCount)) ? responseCount : null,
        countsRestricted: !(await this.countsVisible(actor, row, responseCount)),
        periodCount,
        /** Once anyone has answered, questions keep their wording, type and options. */
        questionsLocked: responseCount > 0,
        /** Anonymity, audience type and branches cannot change once sent or answered. */
        settingsLocked: recipientCount > 0 || responseCount > 0 || periodCount > 0,
        /**
         * Why "Let people choose to answer without their name" cannot be turned off: the ready-made
         * survey promises it, or people have been offered it (sent or answered). null = it can.
         */
        anonymousChoiceFixed: !storedAllowAnonymousResponses(row.isAnonymous, row.allowAnonymousResponses)
          ? null
          : (await this.libraryPromisesAnswerWithoutName(row))
            ? ('library' as const)
            : recipientCount > 0 || responseCount > 0 || periodCount > 0
              ? ('sent' as const)
              : null,
        questions: questions.map((q) => ({
          id: q.id,
          questionText: q.questionText,
          helpText: q.helpText,
          questionType: q.questionType,
          options: q.options,
          config: q.config,
          isRequired: q.isRequired,
          sortOrder: q.sortOrder,
          sectionTitle: q.sectionTitle ?? null,
          /** Not asked of someone answering without their name (preview shows this). */
          contactRequest: isContactRequestQuestion(q),
          ...lookupFormPayload(q),
          ...this.questionLogicPayload(q, idByKey),
          // Per question only with the answer counts: whether a question asked only after a particular
          // answer has answers tells someone (e.g. the manager a copy rates) that someone gave it.
          hasAnswers: showAnswerCounts ? (answersByQuestion.get(q.id) ?? 0) > 0 : responseCount > 0,
          ...(showAnswerCounts ? { answerCount: answersByQuestion.get(q.id) ?? 0 } : {}),
        })),
        /** Section introductions people see: { [sectionTitle]: text } (ready-made ones included). */
        sectionIntros: sectionIntrosOf(row),
        /** Section titles used on questions that are not next to each other (the heading shows twice). */
        splitSections: splitSections([...questions].sort((a, b) => a.sortOrder - b.sortOrder)),
      },
    };
  }

  // ─── Create / copy / update ───────────────────────────────────────────────

  async create(actor: RequestUser, dto: CreateSurveyDto, meta?: RequestAuditMeta) {
    const scope = this.scopeOf(actor);
    const targetKind = dto.targetKind ?? SurveyTargetKind.EMPLOYEE;
    const group = audienceGroupInput(targetKind, dto.audienceGroup, dto.audienceGroupOther);
    const created = await this.prisma.survey.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        closingMessage: dto.closingMessage?.trim() || null,
        targetKind,
        audienceGroup: group.audienceGroup,
        audienceGroupOther: group.audienceGroupOther,
        isAnonymous: dto.isAnonymous ?? false,
        allowAnonymousResponses: storedAllowAnonymousResponses(dto.isAnonymous ?? false, dto.allowAnonymousResponses),
        opensAt: dto.opensAt ? new Date(dto.opensAt) : null,
        closesAt: dto.closesAt ? new Date(dto.closesAt) : null,
        locationIds: this.locationIdsWithinScope(scope, dto.locationIds ?? []),
        roleIds: targetKind === SurveyTargetKind.EMPLOYEE ? unique(dto.roleIds ?? []) : [],
        isTemplate: dto.isTemplate ?? false,
        createdById: actor.id,
        updatedById: actor.id,
      },
    });

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_CREATED,
      recordType: 'Survey',
      recordId: created.id,
      newValues: auditSnapshot(created),
      ...meta,
    });
    if (created.audienceGroup === 'SEVERAL') await this.ensureWhoAreYou(created);

    return { message: created.isTemplate ? 'Template created' : 'Survey created', data: this.serializeSurvey(created) };
  }

  /**
   * Several groups: the standard "Who are you?" question first, so Results can be split by it. Added
   * once (by key) while nobody has answered; an existing one (e.g. from a ready-made survey) is kept.
   */
  private async ensureWhoAreYou(survey: Survey) {
    const has = await this.prisma.surveyQuestion.findFirst({ where: { surveyId: survey.id, key: WHO_ARE_YOU_KEY, deletedAt: null } });
    if (has || (await this.responseCount(survey.id)) > 0) return;
    const first = await this.prisma.surveyQuestion.aggregate({ where: { surveyId: survey.id, deletedAt: null }, _min: { sortOrder: true } });
    await this.prisma.surveyQuestion.create({
      data: {
        surveyId: survey.id,
        key: WHO_ARE_YOU_KEY,
        questionText: WHO_ARE_YOU_TEXT,
        helpText: 'So we can see what each group thinks.',
        questionType: SurveyQuestionType.SINGLE_SELECT,
        options: whoAreYouOptions(survey.targetKind),
        // Not in the question's own percentages either; counted in the overall figures only.
        config: { notCountedOptions: [WHO_ARE_YOU_PREFER_NOT] },
        otherOption: { label: WHO_ARE_YOU_OTHER, textPrompt: 'Please tell us who you are', textRequired: false },
        isRequired: true,
        sortOrder: (first._min.sortOrder ?? 0) - 1,
      },
    });
  }

  /** Copy a survey's settings and questions into a new draft (never its schedule or answers). */
  private async copySurvey(
    actor: RequestUser,
    source: Survey,
    opts: {
      title: string;
      targetKind: SurveyTargetKind;
      isAnonymous: boolean;
      /** Named surveys: people may choose to answer without their name (dropped when anonymous). */
      allowAnonymousResponses: boolean;
      locationIds: string[];
      roleIds: string[];
      isTemplate: boolean;
      /** Dates for the new survey only — a source's own dates are never copied. */
      opensAt?: Date | null;
      closesAt?: Date | null;
      /**
       * The anonymous version of a named ready-made survey: its own introduction and privacy notice,
       * without the questions it leaves out (contact-me and questions needing a name).
       */
      anonymousVariant?: LibraryAnonymousVariant;
    },
    meta: RequestAuditMeta | undefined,
    metadata: Record<string, unknown>,
  ) {
    const allQuestions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId: source.id, deletedAt: null },
      orderBy: QUESTION_ORDER,
    });
    const leaveOut = new Set(opts.anonymousVariant?.leaveOut ?? []);
    const questions = (allQuestions ?? []).filter((q) => !(q.key && leaveOut.has(q.key)));
    if (opts.anonymousVariant) {
      // Never an anonymous survey asking to contact someone, whatever the template says.
      const contactMe = questions.find((q) => q.questionType === SurveyQuestionType.YES_NO && isContactRequestQuestion(q));
      if (contactMe) {
        throw new BadRequestException(
          `This template asks "${contactMe.questionText.trim()}", which the anonymous version cannot ask. Bring the template up to the latest ready-made version first.`,
        );
      }
    }
    const takenKeys = new Set(questions.map((q) => q.key).filter((k): k is string => Boolean(k)));

    const created = await this.prisma.survey.create({
      data: {
        title: opts.title.slice(0, 200),
        description: opts.anonymousVariant ? variantDescription(opts.anonymousVariant) : source.description,
        // The anonymous version only ever has its own (the named one may promise a reply).
        closingMessage: opts.anonymousVariant ? (opts.anonymousVariant.closingMessage ?? null) : (source.closingMessage ?? null),
        targetKind: opts.targetKind,
        isAnonymous: opts.isAnonymous,
        allowAnonymousResponses: storedAllowAnonymousResponses(opts.isAnonymous, opts.allowAnonymousResponses),
        // Where it came from: the template itself, or (a copy of a copy) its source's template. The
        // ready-made reference and revision stay with it; librarySourceId marks the adopted template only.
        createdFromTemplateId: source.isTemplate ? source.id : (source.createdFromTemplateId ?? null),
        libraryReference: source.libraryReference ?? null,
        libraryRevision: source.libraryReference ? (source.libraryRevision ?? null) : null,
        locationIds: opts.locationIds,
        roleIds: opts.targetKind === SurveyTargetKind.EMPLOYEE ? opts.roleIds : [],
        isTemplate: opts.isTemplate,
        // Who it's for and section introductions go with the questions (the group only while the
        // audience type is the same).
        ...(opts.targetKind === source.targetKind
          ? { audienceGroup: source.audienceGroup ?? null, audienceGroupOther: source.audienceGroupOther ?? null }
          : {}),
        sectionIntros: sectionIntrosForCopy(source),
        // Who may see the answers goes with it (a ready-made default stays a default).
        accessPolicy: source.accessPolicy ?? Prisma.JsonNull,
        reportingThreshold: source.reportingThreshold ?? null,
        ...(opts.opensAt ? { opensAt: opts.opensAt } : {}),
        ...(opts.closesAt ? { closesAt: opts.closesAt } : {}),
        status: SurveyStatus.DRAFT,
        createdById: actor.id,
        updatedById: actor.id,
        questions: {
          create: questions.map((q) => ({
            questionText: q.questionText,
            helpText: q.helpText,
            questionType: q.questionType,
            options: q.options === null ? Prisma.JsonNull : q.options,
            optionsFrom: q.optionsFrom ?? null,
            config: q.config === null ? Prisma.JsonNull : q.config,
            isRequired: q.isRequired,
            sortOrder: q.sortOrder,
            sectionTitle: q.sectionTitle,
            isActive: q.isActive,
            ...copiedQuestionLogic(q, takenKeys),
          })),
        },
      },
    });

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_CREATED,
      recordType: 'Survey',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: { ...metadata, questionCount: questions.length },
      ...meta,
    });
    // Alert rules go with the questions (contact-me follow-ups never onto an anonymous survey).
    if (this.alerts) {
      await this.alerts.copyRules(source.id, created.id, { anonymous: created.isAnonymous }).catch((e: unknown) =>
        this.logger.warn(`Survey ${created.id}: alert rules not copied (${errorKind(e)})`),
      );
    }
    return created;
  }

  /**
   * Duplicate a survey, or start a new survey from a template ("Use template"), with all its
   * questions as a new DRAFT. Audience (branches, job titles) can be set for the new survey.
   */
  async duplicate(
    actor: RequestUser,
    id: string,
    overrides?: DuplicateSurveyDto,
    meta?: RequestAuditMeta,
  ) {
    const scope = this.scopeOf(actor);
    const source = await this.requireSurvey(actor, id);
    const targetKind = overrides?.targetKind ?? source.targetKind;
    // A template's questions are written for its audience, and a ready-made survey's introduction
    // and privacy notice tell people whether answers are anonymous: "Use" cannot change either.
    if (source.isTemplate && targetKind !== source.targetKind) {
      throw new BadRequestException(
        'A survey started from a template is for the same people as the template — its questions are written for them.',
      );
    }
    // A named ready-made template with an anonymous version: the anonymous version is chosen here,
    // and is then fixed like any ready-made survey's anonymity.
    const variant = overrides?.isAnonymous === true && !source.isAnonymous ? await this.libraryVariantOf(source) : null;
    if (
      anonymityLocked(source) &&
      overrides?.isAnonymous !== undefined &&
      overrides.isAnonymous !== source.isAnonymous &&
      !variant
    ) {
      throw new BadRequestException(anonymityLockedMessage(source.isAnonymous));
    }
    const opensAt = overrides?.opensAt ? new Date(overrides.opensAt) : null;
    const closesAt = overrides?.closesAt ? new Date(overrides.closesAt) : null;
    if (opensAt && closesAt && closesAt <= opensAt) {
      throw new BadRequestException('The end must be after the start.');
    }
    const isAnonymous = overrides?.isAnonymous ?? source.isAnonymous;
    if (isAnonymous && !source.isAnonymous && !variant) await this.assertNoContactMeQuestion(source.id);
    // "Let people choose to answer without their name": the source's setting unless chosen here; a
    // ready-made survey whose privacy notice promises it keeps it on.
    let allowAnonymousResponses = overrides?.allowAnonymousResponses ?? source.allowAnonymousResponses;
    if (!isAnonymous && (await this.libraryPromisesAnswerWithoutName(source))) {
      if (overrides?.allowAnonymousResponses === false) {
        throw new BadRequestException(anonymousChoiceFixedMessage('library', source.libraryReference));
      }
      allowAnonymousResponses = true;
    }
    const created = await this.copySurvey(
      actor,
      source,
      {
        title: overrides?.title?.trim() || (source.isTemplate ? source.title : `${source.title} (Copy)`),
        targetKind,
        isAnonymous,
        allowAnonymousResponses,
        locationIds: this.locationIdsWithinScope(scope, overrides?.locationIds ?? source.locationIds),
        roleIds: unique(overrides?.roleIds ?? source.roleIds),
        isTemplate: false,
        opensAt,
        closesAt,
        ...(variant ? { anonymousVariant: variant } : {}),
      },
      meta,
      { duplicatedFromId: id, fromTemplate: source.isTemplate, ...(variant ? { libraryVariant: 'ANONYMOUS' } : {}) },
    );
    // Who it's for, when chosen in New survey (else the source's, when the audience type is the same).
    let result = created;
    if (overrides?.audienceGroup !== undefined || overrides?.audienceGroupOther !== undefined) {
      const group = audienceGroupInput(created.targetKind, overrides.audienceGroup ?? created.audienceGroup, overrides.audienceGroupOther ?? created.audienceGroupOther);
      result = await this.prisma.survey.update({ where: { id: created.id }, data: group });
      if (result.audienceGroup === 'SEVERAL') await this.ensureWhoAreYou(result);
    }
    return {
      message: source.isTemplate ? 'Survey created from template' : 'Survey duplicated',
      data: this.serializeSurvey(result),
    };
  }

  /**
   * "Save as template". A draft that was never sent, answered or scheduled becomes the template;
   * anything live (sent, answered, scheduled, repeating, a period copy) stays where it is and a
   * clean template copy is made instead.
   */
  async saveAsTemplate(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    const source = await this.requireSurvey(actor, id);
    if (source.isTemplate) throw new BadRequestException('This survey is already a template.');
    const activity = await this.activity(id);
    const canMove =
      !activity.any &&
      source.status === SurveyStatus.DRAFT &&
      !source.clonedFromId &&
      !source.distributeAt &&
      !source.recurrence;

    if (canMove) {
      const updated = await this.prisma.survey.update({
        where: { id },
        data: { isTemplate: true, updatedById: actor.id },
      });
      await this.audit.logAudit({
        userId: actor.id,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_UPDATED,
        recordType: 'Survey',
        recordId: id,
        oldValues: auditSnapshot(source),
        newValues: auditSnapshot(updated),
        metadata: { savedAsTemplate: 'moved' },
        ...meta,
      });
      return {
        message: 'Saved as template',
        data: { mode: 'moved' as const, survey: this.serializeSurvey(updated) },
      };
    }

    const copy = await this.copySurvey(
      actor,
      source,
      {
        title: source.title,
        targetKind: source.targetKind,
        isAnonymous: source.isAnonymous,
        allowAnonymousResponses: source.allowAnonymousResponses,
        locationIds: source.locationIds,
        roleIds: source.roleIds,
        isTemplate: true,
      },
      meta,
      { savedAsTemplateFromId: id },
    );
    return {
      message: 'Template copy saved — the original survey is unchanged',
      data: { mode: 'copied' as const, survey: this.serializeSurvey(copy) },
    };
  }

  async update(actor: RequestUser, id: string, dto: UpdateSurveyDto, meta?: RequestAuditMeta) {
    const scope = this.scopeOf(actor);
    const existing = await this.requireEditableSurvey(actor, id);
    const activity = await this.activity(id);
    const locked = (field: string) =>
      new BadRequestException(
        `${field} cannot be changed after the survey has been sent or answered. Duplicate it to start again.`,
      );

    if (dto.isAnonymous !== undefined && dto.isAnonymous !== existing.isAnonymous) {
      if (anonymityLocked(existing)) throw new BadRequestException(anonymityLockedMessage(existing.isAnonymous));
      if (activity.any) throw locked('Anonymity');
      if (dto.isAnonymous) await this.assertNoContactMeQuestion(existing.id);
    }
    if (dto.targetKind !== undefined && dto.targetKind !== existing.targetKind && activity.any) {
      throw locked('Who the survey is for');
    }
    const willBeAnonymous = dto.isAnonymous ?? existing.isAnonymous;
    const allowBefore = storedAllowAnonymousResponses(existing.isAnonymous, existing.allowAnonymousResponses);
    const allowAfter = storedAllowAnonymousResponses(
      willBeAnonymous,
      dto.allowAnonymousResponses ?? existing.allowAnonymousResponses,
    );
    // Turning the choice off (on a survey that stays named): never once people were offered it, nor
    // when the ready-made survey's privacy notice promises it. Turning it on is always allowed.
    if (allowBefore && !allowAfter && !willBeAnonymous) {
      if (await this.libraryPromisesAnswerWithoutName(existing)) {
        throw new BadRequestException(anonymousChoiceFixedMessage('library', existing.libraryReference));
      }
      if (activity.any) throw new BadRequestException(anonymousChoiceFixedMessage('sent'));
    }
    let locationIds: string[] | undefined;
    if (dto.locationIds !== undefined) {
      locationIds = this.locationIdsWithinScope(scope, dto.locationIds);
      const same =
        locationIds.length === existing.locationIds.length &&
        locationIds.every((l) => existing.locationIds.includes(l));
      if (!same && activity.any) throw locked('Branches');
    }

    const becomingTemplate = dto.isTemplate === true && !existing.isTemplate;
    if (becomingTemplate) {
      if (activity.any || existing.status !== SurveyStatus.DRAFT || existing.clonedFromId) {
        throw new BadRequestException(
          'This survey has been sent or answered. Use "Save as template" to make a template copy instead.',
        );
      }
    }
    const targetKind = dto.targetKind ?? existing.targetKind;
    const willBeTemplate = dto.isTemplate ?? existing.isTemplate;
    // Who it's for: kept unless changed; a group that does not fit a new audience type is cleared.
    const group =
      dto.audienceGroup !== undefined || dto.audienceGroupOther !== undefined
        ? audienceGroupInput(targetKind, dto.audienceGroup !== undefined ? dto.audienceGroup : existing.audienceGroup, dto.audienceGroupOther !== undefined ? dto.audienceGroupOther : existing.audienceGroupOther)
        : targetKind !== existing.targetKind
          ? { audienceGroup: null, audienceGroupOther: null }
          : null;
    // Several groups needs "Who are you?" on every answer: once anyone has answered it cannot be added
    // (ensureWhoAreYou would skip it), so the survey would claim groups its answers do not have.
    if (group?.audienceGroup === 'SEVERAL' && existing.audienceGroup !== 'SEVERAL' && (await this.responseCount(id)) > 0) {
      throw new BadRequestException(
        'People have already answered this survey, so it cannot change to Several groups: the "Who are you?" question would be missing from their answers.',
      );
    }

    const updated = await this.prisma.survey.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        // Only what people see after submitting: can change at any time, like the description.
        closingMessage: dto.closingMessage === undefined ? undefined : dto.closingMessage?.trim() || null,
        targetKind: dto.targetKind,
        ...(group ?? {}),
        isAnonymous: dto.isAnonymous,
        allowAnonymousResponses:
          dto.allowAnonymousResponses === undefined && dto.isAnonymous === undefined ? undefined : allowAfter,
        opensAt: dto.opensAt === undefined ? undefined : dto.opensAt ? new Date(dto.opensAt) : null,
        closesAt:
          dto.closesAt === undefined ? undefined : dto.closesAt ? new Date(dto.closesAt) : null,
        locationIds,
        roleIds:
          targetKind !== SurveyTargetKind.EMPLOYEE
            ? []
            : dto.roleIds === undefined
              ? undefined
              : unique(dto.roleIds),
        isTemplate: dto.isTemplate,
        // librarySourceId marks the organisation's adopted template only: a template moved back to
        // surveys keeps its ready-made reference (and fixed anonymity) but is no longer the adopted copy.
        ...(dto.isTemplate === false && existing.isTemplate && existing.librarySourceId
          ? { librarySourceId: null }
          : {}),
        periodOpenDays: dto.periodOpenDays,
        // Templates are never scheduled.
        ...(willBeTemplate
          ? {
              distributeAt: null,
              recurrence: null,
              recurrenceAnchorAt: null,
              scheduledById: null,
              audienceEmployeeIds: [],
              audienceServiceUserIds: [],
            }
          : {}),
        updatedById: actor.id,
      },
    });

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_UPDATED,
      recordType: 'Survey',
      recordId: id,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });

    if (updated.audienceGroup === 'SEVERAL' && existing.audienceGroup !== 'SEVERAL') await this.ensureWhoAreYou(updated);
    return { message: 'Survey updated', data: this.serializeSurvey(updated) };
  }

  async remove(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    const existing = await this.requireEditableSurvey(actor, id);
    await this.prisma.survey.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.id, updatedById: actor.id },
    });

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_DELETED,
      recordType: 'Survey',
      recordId: id,
      oldValues: auditSnapshot(existing),
      ...meta,
    });

    return { message: 'Survey deleted', data: { id } };
  }

  // ─── Status actions ───────────────────────────────────────────────────────

  private async setStatus(
    actor: RequestUser,
    existing: Survey,
    data: Prisma.SurveyUpdateInput,
    metadata: Record<string, unknown>,
    meta?: RequestAuditMeta,
  ) {
    const updated = await this.prisma.survey.update({
      where: { id: existing.id },
      data: { ...data, updatedById: actor.id },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_UPDATED,
      recordType: 'Survey',
      recordId: existing.id,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      metadata,
      ...meta,
    });
    return updated;
  }

  /**
   * A survey that still says {{manager}} is the starting point for copies about each manager
   * (SurveyManagerCopiesService), never sent itself: people would read "{{manager}}".
   */
  private async assertNoManagerToken(survey: Pick<Survey, 'id' | 'title' | 'description' | 'closingMessage' | 'sectionIntros'>) {
    // Anywhere: details, section introductions, questions, answers, section titles, alert rules.
    const [questions, rules] = await Promise.all([
      this.prisma.surveyQuestion.findMany({ where: { surveyId: survey.id, deletedAt: null }, select: MANAGER_TOKEN_QUESTION_SELECT }),
      this.prisma.surveyAlertRule?.findMany({ where: { surveyId: survey.id }, select: MANAGER_TOKEN_RULE_SELECT }) ?? [],
    ]);
    if (surveyNamesManager(survey, questions ?? [], rules ?? [])) throw new BadRequestException(MANAGER_TOKEN_MESSAGE);
    // A copy made for each manager whose team has shrunk since: its answers could point at someone.
    const teamProblem = await managerCopyTeamProblemFor(this.prisma, survey.id);
    if (teamProblem) throw new BadRequestException(teamProblem);
  }

  private async assertAnswerable(survey: Survey) {
    if ((await this.questionCount(survey.id)) === 0) {
      throw new BadRequestException('Add at least one question first');
    }
    await this.assertNoManagerToken(survey);
    if (!survey.clonedFromId && (survey.recurrence || (await this.cloneCount(survey.id)) > 0)) {
      throw new BadRequestException(
        'This survey repeats on a schedule — each period opens automatically. Open a period instead.',
      );
    }
  }

  /**
   * How many people an anonymous survey could hear from when opened without sending: everyone in
   * its audience (service users with or without a portal — answers can be recorded by phone),
   * and never fewer than the people it was already sent to.
   */
  private async anonymousAudienceSize(scope: OrgScope, survey: Survey): Promise<number> {
    const audience: SurveyAudience = {
      locationIds: this.locationIdsWithinScope(scope, survey.locationIds),
      roleIds: survey.targetKind === SurveyTargetKind.EMPLOYEE ? survey.roleIds : [],
      employeeIds:
        survey.targetKind === SurveyTargetKind.EMPLOYEE ? survey.audienceEmployeeIds : [],
      serviceUserIds:
        survey.targetKind === SurveyTargetKind.SERVICE_USER ? (survey.audienceServiceUserIds ?? []) : [],
    };
    const [targets, alreadySent] = await Promise.all([
      this.resolveTargets(this.prisma, survey.targetKind, audience, scope.locationIds),
      this.prisma.surveyRecipient.count({ where: { surveyId: survey.id } }),
    ]);
    return Math.max(targets.ids.length + targets.skippedNoPortal, alreadySent);
  }

  /** People an anonymous survey will have gone to after this send (earlier recipients included). */
  private async anonymousReach(survey: Survey, targetIds: string[], existingRecipients: number) {
    if (existingRecipients === 0 || targetIds.length === 0) return targetIds.length;
    const overlap = await this.prisma.surveyRecipient.count({
      where:
        survey.targetKind === SurveyTargetKind.SERVICE_USER
          ? { surveyId: survey.id, serviceUserId: { in: targetIds } }
          : { surveyId: survey.id, employeeId: { in: targetIds } },
    });
    return existingRecipients + targetIds.length - overlap;
  }

  /**
   * Opening (or reopening) a survey whose end date has passed is refused: the survey job would close
   * it again within a minute. A new end date (in the future, after it opens) or none can be given
   * with the request. Returns the end-date change to save with the opening ({} = keep it).
   */
  private async endDateForOpening(
    existing: { closesAt: Date | null; opensAt: Date | null; status?: SurveyStatus },
    dto: ReopenSurveyDto,
    now: Date = new Date(),
  ): Promise<{ closesAt?: Date | null }> {
    if (dto.closesAt === null) return { closesAt: null };
    if (dto.closesAt !== undefined) {
      const closesAt = new Date(dto.closesAt);
      if (closesAt.getTime() <= now.getTime()) {
        throw new BadRequestException('The new end date must be in the future.');
      }
      if (existing.opensAt && closesAt.getTime() <= existing.opensAt.getTime()) {
        throw new BadRequestException('The end date must be after the survey opens.');
      }
      return { closesAt };
    }
    if (existing.closesAt && existing.closesAt.getTime() <= now.getTime()) {
      const ends = formatSurveyDateTime(existing.closesAt, await this.timeZone());
      throw new BadRequestException(
        existing.status === SurveyStatus.DRAFT
          ? `This survey's end date (${ends}) has passed, so it would close straight away. Choose a new end date, or remove it, to open it.`
          : `This survey's end date (${ends}) has passed, so it would close again straight away. Choose a new end date, or remove it, to reopen it.`,
      );
    }
    return {};
  }

  /** Publish a PUBLIC survey so its shareable link accepts answers. */
  async publish(actor: RequestUser, id: string, meta?: RequestAuditMeta, dto: ReopenSurveyDto = {}) {
    const existing = await this.requireSurvey(actor, id);
    this.assertNotTemplate(existing, 'published');
    if (existing.targetKind !== SurveyTargetKind.PUBLIC) {
      throw new BadRequestException(
        'Only public surveys have a shareable link. Send this survey, or use Open for responses to record answers.',
      );
    }
    const endDate = await this.endDateForOpening(existing, dto);
    await this.assertAnswerable(existing);

    const updated = await this.setStatus(
      actor,
      existing,
      { status: SurveyStatus.ACTIVE, publishedAt: existing.publishedAt ?? new Date(), ...endDate },
      { publishedForShare: true, ...(existing.status === SurveyStatus.CLOSED ? { reopened: true } : {}) },
      meta,
    );
    return {
      message: 'Survey published',
      data: {
        id: updated.id,
        status: updated.status,
        publishedAt: toIso(updated.publishedAt),
        shareToken: updated.shareToken,
      },
    };
  }

  /**
   * Open a staff or service-user survey for responses without sending it — so office staff can
   * record answers taken by phone, on a visit or on paper (most service users have no portal).
   * Also reopens a closed survey.
   */
  async openForResponses(actor: RequestUser, id: string, meta?: RequestAuditMeta, dto: ReopenSurveyDto = {}) {
    const existing = await this.requireSurvey(actor, id);
    this.assertNotTemplate(existing, 'opened for responses');
    if (existing.targetKind === SurveyTargetKind.PUBLIC) {
      throw new BadRequestException('Public surveys are opened by publishing their shareable link.');
    }
    if (existing.status === SurveyStatus.ACTIVE) {
      throw new BadRequestException('This survey is already open for responses.');
    }
    const endDate = await this.endDateForOpening(existing, dto);
    await this.assertAnswerable(existing);
    if (existing.isAnonymous) {
      const people = await this.anonymousAudienceSize(this.scopeOf(actor), existing);
      if (people < MIN_ANONYMOUS_RECIPIENTS) {
        throw new BadRequestException(tooFewAnonymousMessage(people));
      }
    }
    const updated = await this.setStatus(
      actor,
      existing,
      { status: SurveyStatus.ACTIVE, publishedAt: existing.publishedAt ?? new Date(), ...endDate },
      { openedForResponses: true, reopened: existing.status === SurveyStatus.CLOSED },
      meta,
    );
    return { message: 'Survey open for responses', data: this.serializeSurvey(updated) };
  }

  /**
   * A repeating survey stops (closed, or its schedule cancelled). A period that was "open until
   * the next period starts" has no next period any more, so it ends when that next period would
   * have started — or now, if that time has passed. Without this it would stay open for ever.
   */
  private async endOpenEndedPeriods(source: Survey, now: Date) {
    if (source.clonedFromId) return;
    const endAt =
      source.recurrence && source.distributeAt && source.distributeAt.getTime() > now.getTime()
        ? source.distributeAt
        : now;
    await this.prisma.survey.updateMany({
      where: {
        clonedFromId: source.id,
        deletedAt: null,
        status: SurveyStatus.ACTIVE,
        closesAt: null,
      },
      data: { closesAt: endAt },
    });
  }

  /** Close: no new answers; any schedule or repeat is cancelled. */
  async close(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    const existing = await this.requireSurvey(actor, id);
    this.assertNotTemplate(existing, 'closed');
    if (existing.status === SurveyStatus.CLOSED) {
      throw new BadRequestException('This survey is already closed.');
    }
    await this.endOpenEndedPeriods(existing, new Date());
    const updated = await this.setStatus(
      actor,
      existing,
      {
        status: SurveyStatus.CLOSED,
        distributeAt: null,
        recurrence: null,
        recurrenceAnchorAt: null,
        scheduledById: null,
      },
      { closed: true },
      meta,
    );
    // Answers not linked to anyone still waiting are written now, so the closed results (and the CQC
    // evidence below) include them. Never fails the close: the survey job and the CQC capture write
    // them too.
    await this.flushPendingResponses({ surveyIds: [updated.id], force: true }).catch((err: unknown) =>
      this.logger.warn(
        `Survey ${updated.id}: waiting answers not written on close (the survey job will): ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    // Keep the results as CQC evidence (never blocks or fails the close).
    void this.cqcEvidence?.onSurveyClosed(updated.id, actor.id);
    return { message: 'Survey closed', data: this.serializeSurvey(updated) };
  }

  async cancelSchedule(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    const existing = await this.requireSurvey(actor, id);
    await this.endOpenEndedPeriods(existing, new Date());
    const updated = await this.setStatus(
      actor,
      existing,
      {
        distributeAt: null,
        recurrence: null,
        recurrenceAnchorAt: null,
        scheduledById: null,
        distributionFailedAt: null,
        distributionError: null,
      },
      { scheduleCancelled: true },
      meta,
    );
    return { message: 'Scheduled distribution cancelled', data: this.serializeSurvey(updated) };
  }

  // ─── Questions ────────────────────────────────────────────────────────────

  /** Making a survey (or a copy of one) anonymous: refused while it asks the contact-me question. */
  private async assertNoContactMeQuestion(surveyId: string) {
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId, deletedAt: null, questionType: SurveyQuestionType.YES_NO },
      select: { questionType: true, questionText: true },
    });
    const contactMe = (questions ?? []).find((q) => isContactRequestQuestion(q));
    if (contactMe) {
      throw new BadRequestException(
        `An anonymous survey cannot ask "${contactMe.questionText.trim()}" — its answers are linked to no one, so nobody could be contacted. Remove that question first, or keep the survey named.`,
      );
    }
  }

  async addQuestion(
    actor: RequestUser,
    surveyId: string,
    dto: CreateSurveyQuestionDto,
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.requireEditableSurvey(actor, surveyId);
    if (survey.isAnonymous && isContactRequestQuestion({ questionType: dto.questionType, questionText: dto.questionText ?? '' })) {
      throw new BadRequestException(CONTACT_ME_ON_ANONYMOUS_REFUSED);
    }
    // Options from a CareFlow list: the other settings are checked against its entries in use; the
    // question itself keeps no options (they always come from the list).
    const lookup = await lookupForQuestion(this.prisma, { optionsFrom: dto.optionsFrom, questionType: dto.questionType, options: dto.options });
    const settings = normaliseQuestionSettings(
      dto.questionType,
      lookup ? lookup.names : dto.options,
      dto.config,
      dto.questionText,
    );
    const logic = normaliseQuestionLogic(
      dto.questionType,
      settings.options,
      settings.config,
      {
        otherOption: dto.otherOption,
        exclusiveOptions: dto.exclusiveOptions,
        commentConfig: dto.commentConfig,
        showIf: dto.showIf,
      },
      dto.questionText,
    );
    const others = await this.logicQuestions(surveyId);
    const key = newQuestionKey(
      new Set(others.map((q) => q.key).filter((k): k is string => Boolean(k))),
      () => randomUUID(),
    );
    // "Add question here" (a section): straight after that question; the ones after it move down one.
    let sortOrder = dto.sortOrder ?? 0;
    const moves: Array<{ id: string; to: number }> = [];
    if (dto.afterQuestionId) {
      const ordered = this.inSurveyOrder(others);
      const at = ordered.findIndex((q) => q.id === dto.afterQuestionId);
      if (at < 0) throw new NotFoundException('Question not found');
      sortOrder = at + 1;
      ordered.forEach((q, i) => {
        const to = i < sortOrder ? i : i + 1;
        if (q.sortOrder !== to) moves.push({ id: q.id, to });
        q.sortOrder = to;
      });
    }
    const draft = {
      id: '',
      key,
      questionText: dto.questionText.trim(),
      questionType: dto.questionType,
      options: settings.options,
      config: settings.config,
      otherOption: logic.otherOption,
      showIf: logic.showIf,
      sortOrder,
      createdAt: new Date(),
    };
    assertSurveyLogic(this.inSurveyOrder([...others, draft]));
    if (moves.length) {
      await this.prisma.$transaction(async (tx) => {
        for (const m of moves) await tx.surveyQuestion.update({ where: { id: m.id }, data: { sortOrder: m.to } });
      });
    }

    const created = await this.prisma.surveyQuestion.create({
      data: {
        surveyId,
        key,
        questionText: dto.questionText.trim(),
        helpText: dto.helpText?.trim() || null,
        questionType: dto.questionType,
        options: lookup ? Prisma.JsonNull : (settings.options ?? Prisma.JsonNull),
        optionsFrom: lookup?.key ?? null,
        config: settings.config ?? Prisma.JsonNull,
        otherOption: jsonOrNull(logic.otherOption),
        exclusiveOptions: jsonOrNull(logic.exclusiveOptions),
        commentConfig: jsonOrNull(logic.commentConfig),
        showIf: jsonOrNull(logic.showIf),
        isRequired: dto.isRequired ?? false,
        sortOrder,
        sectionTitle: dto.sectionTitle?.trim() || null,
      },
    });

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_QUESTION_CREATED,
      recordType: 'SurveyQuestion',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: { surveyId },
      ...meta,
    });

    return { message: 'Question added', data: created };
  }

  /**
   * Edit a question. Once anyone has answered the survey, only the help text (and position) can
   * change — rewording, retyping or changing options would misrepresent the answers given.
   */
  async updateQuestion(
    actor: RequestUser,
    surveyId: string,
    questionId: string,
    dto: UpdateSurveyQuestionDto,
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.requireEditableSurvey(actor, surveyId);
    const existing = await this.prisma.surveyQuestion.findFirst({
      where: { id: questionId, surveyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Question not found');

    const questionType = dto.questionType ?? existing.questionType;
    const questionText = dto.questionText?.trim() ?? existing.questionText;
    // Reworded into a contact-me question on an anonymous survey (one saved before this rule can
    // still have its help text and comment box changed).
    if (
      survey.isAnonymous &&
      isContactRequestQuestion({ questionType, questionText }) &&
      !isContactRequestQuestion(existing)
    ) {
      throw new BadRequestException(CONTACT_ME_ON_ANONYMOUS_REFUSED);
    }
    const typeChanged = questionType !== existing.questionType;
    const optionsFrom =
      dto.optionsFrom !== undefined
        ? dto.optionsFrom
        : dto.options?.length || !CHOICE_QUESTION_TYPES.includes(questionType)
          ? null
          : existing.optionsFrom;
    const lookup = await lookupForQuestion(this.prisma, {
      optionsFrom,
      questionType,
      options: dto.options !== undefined ? dto.options : null,
    });
    const options = lookup
      ? lookup.names
      : dto.options !== undefined
        ? dto.options
        : typeChanged || existing.optionsFrom
          ? null
          : existing.options;
    const settings = normaliseQuestionSettings(
      questionType,
      options,
      dto.config !== undefined
        ? dto.config
        : typeChanged
          ? null
          : questionType === SurveyQuestionType.RATING
            ? existing.config
            : // Answers marked not counted that are no longer on the question are dropped.
              keptNotCountedConfig(existing.config, questionType, options),
      questionText,
    );
    // Settings left out keep their saved value, unless the new type cannot have them.
    const kept = <T>(given: T | undefined, saved: unknown, applies: boolean) =>
      given !== undefined ? given : applies ? (saved ?? null) : null;
    const savedComment = readCommentConfig(existing.commentConfig);
    const logic = normaliseQuestionLogic(
      questionType,
      settings.options,
      settings.config,
      {
        otherOption: kept(dto.otherOption, existing.otherOption, CHOICE_QUESTION_TYPES.includes(questionType)),
        exclusiveOptions: kept(
          dto.exclusiveOptions,
          // Options that are no longer on the question stop clearing the others.
          readExclusiveOptions(existing.exclusiveOptions).filter((o) => (settings.options ?? []).includes(o)),
          questionType === SurveyQuestionType.MULTI_SELECT,
        ),
        // A changed type has different answers: the comment box stays, offered after any answer.
        commentConfig: kept(
          dto.commentConfig,
          typeChanged && savedComment ? { prompt: savedComment.prompt } : existing.commentConfig,
          !NO_COMMENT_QUESTION_TYPES.includes(questionType),
        ),
        showIf: kept(dto.showIf, existing.showIf, true),
      },
      questionText,
    );

    const answered = (await this.responseCount(surveyId)) > 0;
    const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (answered) {
      const changesAnswers =
        questionText !== existing.questionText ||
        typeChanged ||
        (lookup?.key ?? null) !== (existing.optionsFrom ?? null) ||
        (!lookup && !sameJson(settings.options, existing.options)) ||
        // A score's range changes the answers; "Not counted in percentages" only changes how the
        // percentages are worked out, so it can change once people have answered.
        (questionType === SurveyQuestionType.RATING && !sameJson(settings.config, existing.config)) ||
        !sameJson(logic.otherOption, readOtherOption(existing.otherOption)) ||
        !sameJson(logic.exclusiveOptions ?? [], readExclusiveOptions(existing.exclusiveOptions)) ||
        !sameJson(logic.showIf, readShowIf(existing.showIf)) ||
        (dto.isRequired !== undefined && dto.isRequired !== existing.isRequired);
      if (changesAnswers) {
        throw new BadRequestException(
          'People have already answered this survey, so this question can no longer be reworded or changed — only its help text and comment box. Add a new question instead.',
        );
      }
    }

    // Survey-wide: show-if rules still point at earlier, always-asked questions with these answers.
    const others = (await this.logicQuestions(surveyId)).filter((q) => q.id !== questionId);
    const key =
      existing.key ??
      newQuestionKey(new Set(others.map((q) => q.key).filter((k): k is string => Boolean(k))), () => randomUUID());
    assertSurveyLogic(
      this.inSurveyOrder([
        ...others,
        {
          id: questionId,
          key,
          questionText,
          questionType,
          options: settings.options,
          config: settings.config,
          otherOption: logic.otherOption,
          showIf: logic.showIf,
          sortOrder: dto.sortOrder ?? existing.sortOrder,
          createdAt: existing.createdAt,
        },
      ]),
    );

    const updated = await this.prisma.surveyQuestion.update({
      where: { id: questionId },
      data: {
        key,
        questionText,
        helpText: dto.helpText === undefined ? undefined : dto.helpText?.trim() || null,
        questionType,
        options: lookup ? Prisma.JsonNull : (settings.options ?? Prisma.JsonNull),
        optionsFrom: lookup?.key ?? null,
        config: settings.config ?? Prisma.JsonNull,
        otherOption: jsonOrNull(logic.otherOption),
        exclusiveOptions: jsonOrNull(logic.exclusiveOptions),
        commentConfig: jsonOrNull(logic.commentConfig),
        showIf: jsonOrNull(logic.showIf),
        isRequired: dto.isRequired,
        sortOrder: dto.sortOrder,
        sectionTitle: dto.sectionTitle === undefined ? undefined : dto.sectionTitle?.trim() || null,
      },
    });

    const notCountedBefore = readNotCountedOptions(existing.config);
    const notCountedAfter = readNotCountedOptions(settings.config);
    const notCountedChanged = !typeChanged && !sameJson(notCountedBefore, notCountedAfter);
    const recaptured = notCountedChanged ? await this.applyNotCountedChange(surveyId, questionId, questionType, settings.config) : [];

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_QUESTION_UPDATED,
      recordType: 'SurveyQuestion',
      recordId: questionId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      metadata: {
        surveyId,
        ...(notCountedChanged
          ? { notCountedInPercentages: { from: notCountedBefore, to: notCountedAfter }, answered, cqcRecapture: recaptured }
          : {}),
      },
      ...meta,
    });

    return { message: 'Question updated', data: updated };
  }

  /**
   * "Not counted in percentages" changed: a repeating survey's periods follow it (their copies of the
   * question, where they still offer those answers), and results already kept as CQC evidence for
   * the survey or those periods are marked to be captured again, so the evidence, the bars, top-two
   * and headline agree. Returns the survey ids marked.
   */
  private async applyNotCountedChange(
    surveyId: string,
    questionId: string,
    questionType: SurveyQuestionType,
    config: unknown,
  ): Promise<string[]> {
    const copies = (
      (await this.prisma.surveyQuestion.findMany({
        where: { sourceQuestionId: questionId, deletedAt: null, survey: { clonedFromId: surveyId, deletedAt: null } },
        select: { id: true, surveyId: true, questionType: true, options: true },
      })) ?? []
    ).filter((c) => c.questionType === questionType);
    for (const c of copies) {
      const kept = keptNotCountedConfig(config, c.questionType, c.options);
      await this.prisma.surveyQuestion.update({ where: { id: c.id }, data: { config: kept ?? Prisma.JsonNull } });
    }
    const ids = unique([surveyId, ...copies.map((c) => c.surveyId)]);
    const marked = await this.prisma.cqcSurveyCapture.findMany({ where: { surveyId: { in: ids } }, select: { surveyId: true } });
    if (marked?.length) {
      await this.prisma.cqcSurveyCapture.updateMany({
        where: { surveyId: { in: marked.map((m) => m.surveyId) } },
        data: { surveyUpdatedAt: CQC_RECAPTURE_MARK },
      });
    }
    return (marked ?? []).map((m) => m.surveyId);
  }

  /**
   * Save the order respondents see (0, 1, 2 …) for questions now in `ordered`. Only positions that
   * change are written. Positions can change once people have answered (answers stay with their
   * question), as they can through Edit question.
   */
  private async saveQuestionOrder(ordered: Array<{ id: string; sortOrder: number }>) {
    const changes = ordered
      .map((q, i) => ({ id: q.id, from: q.sortOrder, to: i }))
      .filter((c) => c.from !== c.to);
    if (!changes.length) return;
    await this.prisma.$transaction(async (tx) => {
      for (const c of changes) {
        await tx.surveyQuestion.update({ where: { id: c.id }, data: { sortOrder: c.to } });
      }
    });
  }

  /**
   * Move a question one place up or down. "Show only if" rules decide whether it can: a question
   * cannot move above the question it depends on, and a question others depend on cannot move below
   * them.
   */
  async moveQuestion(
    actor: RequestUser,
    surveyId: string,
    questionId: string,
    direction: 'up' | 'down',
    meta?: RequestAuditMeta,
  ) {
    await this.requireEditableSurvey(actor, surveyId);
    const ordered = this.inSurveyOrder(await this.logicQuestions(surveyId));
    const from = ordered.findIndex((q) => q.id === questionId);
    if (from < 0) throw new NotFoundException('Question not found');
    const to = direction === 'up' ? from - 1 : from + 1;
    if (to < 0 || to >= ordered.length) {
      throw new BadRequestException(
        direction === 'up' ? 'This is already the first question.' : 'This is already the last question.',
      );
    }
    const moving = ordered[from]!;
    const other = ordered[to]!;
    const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 80)}…` : text);
    // The two swap places: refused when one is asked only after an answer to the other.
    const [earlier, later] = direction === 'up' ? [other, moving] : [moving, other];
    if (earlier.key && readShowIf(later.showIf)?.questionKey === earlier.key) {
      throw new BadRequestException(
        direction === 'up'
          ? `This question is asked only after an answer to "${clip(earlier.questionText)}", so it cannot move above it.`
          : `"${clip(later.questionText)}" is asked only after an answer to this question, so this question cannot move below it.`,
      );
    }
    const next = [...ordered];
    next[from] = other;
    next[to] = moving;
    assertSurveyLogic(next);
    await this.saveQuestionOrder(next);

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_QUESTION_UPDATED,
      recordType: 'SurveyQuestion',
      recordId: questionId,
      oldValues: { position: from + 1 },
      newValues: { position: to + 1 },
      metadata: { surveyId, moved: direction },
      ...meta,
    });
    return { message: 'Question moved', data: { id: questionId, position: to + 1 } };
  }

  /**
   * Copy a question straight after it, with a new key — so no "Show only if" rule points at the copy.
   * The copy keeps its own rule (the question it depends on is still earlier). Not once the survey
   * has answers: questions are then fixed, so the copy could never be reworded.
   */
  async copyQuestion(actor: RequestUser, surveyId: string, questionId: string, meta?: RequestAuditMeta) {
    const survey = await this.requireEditableSurvey(actor, surveyId);
    const source = await this.prisma.surveyQuestion.findFirst({
      where: { id: questionId, surveyId, deletedAt: null },
    });
    if (!source) throw new NotFoundException('Question not found');
    if (survey.isAnonymous && isContactRequestQuestion(source)) {
      throw new BadRequestException(CONTACT_ME_ON_ANONYMOUS_REFUSED);
    }
    // Once people have answered, questions can no longer be reworded, so a copy could never become a
    // different question — it would only ask the same thing twice.
    if ((await this.responseCount(surveyId)) > 0) {
      throw new BadRequestException(
        'People have already answered this survey, so a copy could not be reworded — it would ask the same question twice. Add a new question instead.',
      );
    }
    const ordered = this.inSurveyOrder(await this.logicQuestions(surveyId));
    const key = newQuestionKey(
      new Set(ordered.map((q) => q.key).filter((k): k is string => Boolean(k))),
      () => randomUUID(),
    );
    const at = ordered.findIndex((q) => q.id === questionId);

    const created = await this.prisma.surveyQuestion.create({
      data: {
        surveyId,
        key,
        questionText: source.questionText,
        helpText: source.helpText,
        questionType: source.questionType,
        options: jsonOrNull(source.options),
        optionsFrom: source.optionsFrom ?? null,
        config: jsonOrNull(source.config),
        otherOption: jsonOrNull(source.otherOption),
        exclusiveOptions: jsonOrNull(source.exclusiveOptions),
        commentConfig: jsonOrNull(source.commentConfig),
        showIf: jsonOrNull(source.showIf),
        isRequired: source.isRequired,
        isActive: source.isActive,
        sortOrder: source.sortOrder,
        sectionTitle: source.sectionTitle,
      },
    });
    const next = [...ordered];
    // The copy is written at the source's position; renumbering puts it straight after it.
    next.splice(at + 1, 0, { ...created, sortOrder: -1 });
    await this.saveQuestionOrder(next);

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_QUESTION_CREATED,
      recordType: 'SurveyQuestion',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: { surveyId, copiedFrom: questionId },
      ...meta,
    });
    return { message: 'Question copied', data: { ...created, sortOrder: at + 1 } };
  }

  async removeQuestion(
    actor: RequestUser,
    surveyId: string,
    questionId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.requireEditableSurvey(actor, surveyId);
    const existing = await this.prisma.surveyQuestion.findFirst({
      where: { id: questionId, surveyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Question not found');
    // Survey-wide, not "does this question have answers": some answers (given without a name, or
    // still waiting to be written) are held back from the counts, and a refusal that depended on
    // them would reveal that they exist.
    if ((await this.responseCount(surveyId)) > 0) {
      throw new BadRequestException(QUESTION_REMOVAL_REFUSED);
    }
    if (existing.key) {
      const dependent = (await this.logicQuestions(surveyId)).find(
        (q) => q.id !== questionId && readShowIf(q.showIf)?.questionKey === existing.key,
      );
      if (dependent) {
        throw new BadRequestException(
          `"${dependent.questionText}" is asked only if this question is answered a certain way. Change its "Show only if" first.`,
        );
      }
    }

    await this.prisma.surveyQuestion.update({
      where: { id: questionId },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_QUESTION_DELETED,
      recordType: 'SurveyQuestion',
      recordId: questionId,
      oldValues: auditSnapshot(existing),
      metadata: { surveyId },
      ...meta,
    });

    return { message: 'Question removed', data: { id: questionId } };
  }

  // ─── Sending ──────────────────────────────────────────────────────────────

  /** The audience for a send, from the dialog or the survey's saved audience, within scope. */
  private async resolveAudience(
    scope: OrgScope,
    survey: Survey,
    dto: SendSurveyDto,
  ): Promise<SurveyAudience> {
    const forEmployees = survey.targetKind === SurveyTargetKind.EMPLOYEE;
    const locationIds = this.locationIdsWithinScope(scope, dto.locationIds ?? survey.locationIds);
    const roleIds = forEmployees ? unique(dto.roleIds ?? survey.roleIds) : [];
    const employeeIds = forEmployees ? unique(dto.employeeIds ?? survey.audienceEmployeeIds) : [];
    const serviceUserIds =
      survey.targetKind === SurveyTargetKind.SERVICE_USER
        ? unique(dto.serviceUserIds ?? survey.audienceServiceUserIds ?? [])
        : [];
    if (serviceUserIds.length) {
      const inScope = this.orgScope.serviceUserScopeWhere(scope);
      const chosen: Prisma.ServiceUserWhereInput = { id: { in: serviceUserIds }, deletedAt: null };
      const [found, current] = await Promise.all([
        this.prisma.serviceUser.count({ where: { AND: [chosen, ...(inScope ? [inScope] : [])] } }),
        this.prisma.serviceUser.count({
          where: {
            AND: [
              chosen,
              chosenServiceUsersWhere(new Date(), (await this.formerContext(survey)).noReason),
            ],
          },
        }),
      ]);
      if (found !== serviceUserIds.length) {
        throw new BadRequestException('Some of the chosen people are not in your branches.');
      }
      if (current !== serviceUserIds.length) {
        throw new BadRequestException(
          'Some of the chosen people cannot be sent surveys (they have died, are inactive, their care has not started, or it ended more than 3 months ago). Remove them and try again.',
        );
      }
    }
    if (employeeIds.length && scope.locationIds !== null) {
      const inScope = this.orgScope.employeeEmploymentScopeWhere(scope);
      const count = await this.prisma.employee.count({
        where: { AND: [{ id: { in: employeeIds }, deletedAt: null }, ...(inScope ? [inScope] : [])] },
      });
      if (count !== employeeIds.length) {
        throw new BadRequestException('Some of the chosen employees are not in your branches.');
      }
    }
    return { locationIds, roleIds, employeeIds, serviceUserIds };
  }

  /**
   * People a send reaches. Employees: active staff; service users: those with an enabled portal,
   * or — when people are chosen by name on a named survey (`withoutPortal`) — everyone chosen, so
   * those without a portal appear in the recording list. `preferredBranches` (the sender's
   * branches, or the survey's own for a background run) decides which of a person's branches is
   * recorded — see branchWithin.
   */
  private async resolveTargets(
    db: Db,
    targetKind: SurveyTargetKind,
    audience: SurveyAudience,
    preferredBranches: string[] | null = null,
    /** repeating: a repeating survey's period, which never goes to anyone whose care has ended. */
    /** formerStaff: chosen staff may include people who left within the window. */
    /** careEndedSurvey: chosen people whose care ended may be included at any time (else within the window). */
    opts: { withoutPortal?: boolean; repeating?: boolean; formerStaff?: boolean; careEndedSurvey?: boolean } = {},
  ): Promise<ResolvedTargets> {
    if (targetKind === SurveyTargetKind.SERVICE_USER) {
      const suWhere: Prisma.ServiceUserWhereInput = {
        deletedAt: null,
        ...notWithStatus(SURVEY_EXCLUDED_SERVICE_USER_STATUSES),
      };
      if (audience.serviceUserIds.length) {
        const chosenWhere: Prisma.ServiceUserWhereInput = opts.repeating
          ? { deletedAt: null, ...notWithStatus(SURVEY_EXCLUDED_SERVICE_USER_STATUSES) }
          : { deletedAt: null, ...chosenServiceUsersWhere(new Date(), Boolean(opts.careEndedSurvey)) };
        return this.resolveChosenServiceUsers(db, chosenWhere, audience.serviceUserIds, preferredBranches, opts);
      }
      if (audience.locationIds.length) suWhere.locationId = { in: audience.locationIds };
      const [eligible, inScope] = await Promise.all([
        db.serviceUser.findMany({
          // Portal sign-in also needs the person's record to be active (assertLoginable).
          where: { ...suWhere, isActive: true, portalAccount: { is: { isEnabled: true, deletedAt: null } } },
          select: { id: true, locationId: true },
        }),
        db.serviceUser.count({ where: suWhere }),
      ]);
      return {
        ids: eligible.map((s) => s.id),
        skippedNoPortal: inScope - eligible.length,
        noPortalIds: [],
        branchIds: eligible.some((s) => !s.locationId)
          ? null
          : unique(eligible.map((s) => s.locationId as string)),
        emptyMessage:
          'No service users with portal access to send this survey to. Use Open for responses to record answers by phone or on visits instead.',
      };
    }

    const empWhere: Prisma.EmployeeWhereInput = { ...ELIGIBLE_EMPLOYEE_WHERE };
    if (audience.employeeIds.length) {
      empWhere.id = { in: audience.employeeIds };
      if (opts.formerStaff) {
        // Leavers' surveys: someone who left in the last 3 months may still be chosen by name.
        delete empWhere.isActive;
        empWhere.OR = [{ isActive: true }, formerStaffWhere(new Date())];
      }
    } else {
      const employmentWhere: Prisma.EmployeeEmploymentWhereInput = {};
      if (audience.locationIds.length) employmentWhere.locationId = { in: audience.locationIds };
      // roleIds holds Job Title ids.
      if (audience.roleIds.length) employmentWhere.jobTitleId = { in: audience.roleIds };
      if (Object.keys(employmentWhere).length > 0) empWhere.employment = employmentWhere;
    }
    const employees = await db.employee.findMany({
      where: empWhere,
      select: {
        id: true,
        employment: {
          select: {
            locationId: true,
            baseLocationId: true,
            floorLocations: { select: { locationId: true } },
          },
        },
      },
    });
    const branches = employees.map((e) => branchWithin(e.employment, preferredBranches));
    return {
      ids: employees.map((e) => e.id),
      skippedNoPortal: 0,
      noPortalIds: [],
      branchIds: branches.some((b) => !b) ? null : unique(branches as string[]),
      emptyMessage: 'No active employees match this audience.',
    };
  }

  /**
   * Chosen people we support who are still receiving care (a scheduled or repeating run drops
   * anyone discharged since). With a portal they get it in the portal; without one they are added
   * only on named surveys (`withoutPortal`) — an anonymous survey keeps portal recipients only.
   * Each counts under their own branch, or a branch they are assigned to within the sender's.
   */
  private async resolveChosenServiceUsers(
    db: Db,
    suWhere: Prisma.ServiceUserWhereInput,
    serviceUserIds: string[],
    preferredBranches: string[] | null,
    opts: { withoutPortal?: boolean },
  ): Promise<ResolvedTargets> {
    const people = await db.serviceUser.findMany({
      where: { ...suWhere, id: { in: serviceUserIds } },
      select: {
        id: true,
        locationId: true,
        isActive: true,
        portalAccount: { select: { isEnabled: true, deletedAt: true } },
        assignments: { where: { deletedAt: null }, select: { locationId: true } },
      },
    });
    type Person = (typeof people)[number];
    // Someone whose record is no longer active (often after care ends) cannot sign in to the portal.
    const hasPortal = (p: Person) => Boolean(p.isActive && p.portalAccount?.isEnabled && !p.portalAccount.deletedAt);
    const reached = opts.withoutPortal ? people : people.filter(hasPortal);
    const branchOf = (p: Person): string | null => {
      if (!preferredBranches || (p.locationId && preferredBranches.includes(p.locationId))) {
        return p.locationId;
      }
      const assigned = p.assignments.find(
        (a) => a.locationId && preferredBranches.includes(a.locationId),
      );
      return assigned?.locationId ?? p.locationId;
    };
    const branches = reached.map(branchOf);
    return {
      ids: reached.map((p) => p.id),
      skippedNoPortal: people.length - reached.length,
      noPortalIds: opts.withoutPortal ? people.filter((p) => !hasPortal(p)).map((p) => p.id) : [],
      branchIds: branches.some((b) => !b) ? null : unique(branches as string[]),
      emptyMessage: opts.withoutPortal
        ? 'None of the chosen people can be sent this survey now: they have died, are inactive, have not started care, or (for a repeating survey) their care has ended.'
        : 'None of the chosen people has portal access, and an anonymous survey only goes to people with a portal account. Use Open for responses to record their answers by phone or on visits instead.',
    };
  }

  /**
   * Branches recorded on the survey (which also decide who can see it). The first send sets them
   * to the audience; later sends only widen them, so earlier recipients stay covered. Chosen
   * people count under their branch within the sender's branches (never a branch the sender
   * cannot see, which would hide the survey from them).
   */
  private ownershipLocationIds(
    current: string[],
    hadActivity: boolean,
    audience: SurveyAudience,
    targetBranches: string[] | null,
  ): string[] {
    const audienceBranches =
      audience.employeeIds.length || audience.serviceUserIds.length
      ? (targetBranches ?? (audience.locationIds.length ? audience.locationIds : null))
      : audience.locationIds.length
        ? audience.locationIds
        : null;
    if (audienceBranches === null) return [];
    if (!hadActivity) return unique(audienceBranches);
    return current.length === 0 ? [] : unique([...current, ...audienceBranches]);
  }

  /**
   * The 4-week contact rule and sampling for a send (survey-contact-rule.service.ts): who is sent it
   * now and who is held back until their free day. Someone already on this survey is never held.
   */
  private async applyContactRule(
    survey: Survey,
    targets: ResolvedTargets,
    audience: SurveyAudience,
    now: Date,
    override = false,
  ): Promise<{ targets: ResolvedTargets; held: HeldPerson[]; skipped: HeldPerson[]; sampledOut: number }> {
    if (!this.contactRule || !targets.ids.length) return { targets, held: [], skipped: [], sampledOut: 0 };
    const kind = survey.targetKind === SurveyTargetKind.SERVICE_USER ? 'SERVICE_USER' : 'EMPLOYEE';
    const result = await this.contactRule.apply(survey, kind, targets.ids, {
      now,
      override,
      chosenPeople: audience.employeeIds.length > 0 || audience.serviceUserIds.length > 0,
      minimum: survey.isAnonymous ? MIN_ANONYMOUS_RECIPIENTS : 0,
    });
    let held = result.held;
    let skipped = result.skipped ?? [];
    if (held.length || skipped.length) {
      const already = await this.prisma.surveyRecipient.findMany({
        where: {
          surveyId: survey.id,
          ...(kind === 'SERVICE_USER'
            ? { serviceUserId: { in: [...held, ...skipped].map((h) => h.personId) } }
            : { employeeId: { in: [...held, ...skipped].map((h) => h.personId) } }),
        },
        select: { employeeId: true, serviceUserId: true },
      });
      const on = new Set(already.map((r) => (kind === 'SERVICE_USER' ? r.serviceUserId : r.employeeId)));
      held = held.filter((h) => !on.has(h.personId));
      skipped = skipped.filter((h) => !on.has(h.personId));
    }
    const keep = new Set(result.sendIds);
    return {
      targets: { ...targets, ids: result.sendIds, noPortalIds: targets.noPortalIds.filter((id) => keep.has(id)) },
      held,
      skipped,
      sampledOut: result.sampledOut,
    };
  }

  /** Create recipient rows and mark the survey active, in one transaction. Delivery is separate. */
  private async createRecipients(
    survey: Survey,
    audience: SurveyAudience,
    targets: ResolvedTargets,
    actorId: string | null,
    now: Date,
    opts: { clearSchedule: boolean },
  ) {
    const hadActivity = (await this.activity(survey.id)).any;
    const forServiceUsers = survey.targetKind === SurveyTargetKind.SERVICE_USER;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.surveyRecipient.findMany({
        where: forServiceUsers
          ? { surveyId: survey.id, serviceUserId: { in: targets.ids } }
          : { surveyId: survey.id, employeeId: { in: targets.ids } },
        select: { employeeId: true, serviceUserId: true },
      });
      const already = new Set(existing.map((r) => (forServiceUsers ? r.serviceUserId : r.employeeId)));
      const candidates: CreatedRecipient[] = targets.ids
        .filter((id) => !already.has(id))
        .map((id) => ({
          employeeId: forServiceUsers ? null : id,
          serviceUserId: forServiceUsers ? id : null,
          token: randomUUID(),
        }));
      let created = candidates;
      if (candidates.length) {
        const inserted = await tx.surveyRecipient.createMany({
          data: candidates.map((r) => ({
            ...r,
            surveyId: survey.id,
            targetKind: survey.targetKind,
            status: 'SENT' as const,
            sentAt: now,
            createdById: actorId,
          })),
          skipDuplicates: true,
        });
        // Someone's row was created between the read and the insert (staff recording their answer,
        // or another send): the insert skipped it, so their token here was never saved. Only rows this
        // send created are emailed / pushed — never a link that does not exist (or a second invitation).
        if (inserted.count !== candidates.length) {
          const saved = await tx.surveyRecipient.findMany({
            where: { surveyId: survey.id, token: { in: candidates.map((r) => r.token) } },
            select: { token: true },
          });
          const savedTokens = new Set(saved.map((r) => r.token));
          created = candidates.filter((r) => savedTokens.has(r.token));
        }
      }
      const updated = await tx.survey.update({
        where: { id: survey.id },
        data: {
          status: SurveyStatus.ACTIVE,
          publishedAt: survey.publishedAt ?? now,
          distributedAt: now,
          distributionFailedAt: null,
          distributionError: null,
          locationIds: this.ownershipLocationIds(
            survey.locationIds,
            hadActivity,
            audience,
            targets.branchIds,
          ),
          roleIds: audience.roleIds,
          audienceEmployeeIds: audience.employeeIds,
          audienceServiceUserIds: audience.serviceUserIds,
          ...(opts.clearSchedule ? { distributeAt: null, scheduledById: null } : {}),
          ...(actorId ? { updatedById: actorId } : {}),
        },
      });
      return { created, skippedExisting: already.size + (candidates.length - created.length), updated };
    });
  }

  /**
   * Send now, schedule a one-off send, or start a repeating series. The chosen audience is saved
   * on the survey so scheduled and repeating runs reach the same people.
   */
  async send(
    actor: RequestUser,
    surveyId: string,
    dto: SendSurveyDto,
    meta?: RequestAuditMeta,
    requestOrigin?: string,
  ) {
    const scope = this.scopeOf(actor);
    const survey = await this.requireSurvey(actor, surveyId);
    this.assertNotTemplate(survey, 'sent or scheduled');
    if (survey.targetKind === SurveyTargetKind.PUBLIC) {
      throw new BadRequestException(
        'Public surveys are answered through the shareable link — there is no recipient list to send to. Publish it and copy the link.',
      );
    }
    // A stopped repeating survey is restarted by giving it a repeat again (it cannot be
    // "reopened" — its periods are what people answer).
    const restartingSeries =
      survey.status === SurveyStatus.CLOSED &&
      !survey.clonedFromId &&
      Boolean(dto.recurrence) &&
      (await this.cloneCount(surveyId)) > 0;
    if (survey.status === SurveyStatus.CLOSED && !restartingSeries) {
      throw new BadRequestException('This survey is closed. Reopen it before sending.');
    }
    if ((await this.questionCount(surveyId)) === 0) {
      throw new BadRequestException('Add at least one question before sending or scheduling the survey');
    }
    if (readEventTrigger(survey.eventTrigger)) {
      throw new BadRequestException(
        'This survey is sent when something happens in the care records, into a copy for each month. Open a month\'s copy to send it to more people, or switch the event off first.',
      );
    }
    await this.assertNoManagerToken(survey);

    const now = new Date();
    const when = dto.distributeAt ? new Date(dto.distributeAt) : null;
    if (when && Number.isNaN(when.getTime())) {
      throw new BadRequestException('Invalid distribution date');
    }
    const isFuture = Boolean(when && when.getTime() > now.getTime() + SEND_NOW_WINDOW_MS);
    const audience = await this.resolveAudience(scope, survey, dto);
    const recurrence = dto.recurrence !== undefined ? dto.recurrence : survey.recurrence;
    const activity = await this.activity(surveyId);
    const targets = await this.resolveTargets(
      this.prisma,
      survey.targetKind,
      audience,
      scope.locationIds,
      { withoutPortal: !survey.isAnonymous, formerStaff: true, careEndedSurvey: (await this.formerContext(survey)).noReason },
    );
    // Former people (left, or care ended, in the last 3 months), chosen by name: now only, and with a reason
    // unless the survey is for them (leavers, care ending).
    const formerIds = await this.formerAmong(survey.targetKind, targets.ids);
    const formerReason = dto.formerReason?.trim() || null;
    if (formerIds.length) {
      if (isFuture || recurrence) {
        throw new BadRequestException('People who have left or whose care has ended can only be sent a survey now, not on a schedule or a repeat.');
      }
      const { noReason } = await this.formerContext(survey);
      if (!noReason && (!formerReason || formerReason.length < FORMER_REASON_MIN || formerReason.length > FORMER_REASON_MAX)) {
        throw new BadRequestException(
          `Say why ${formerIds.length === 1 ? 'someone who has left or whose care has ended' : 'people who have left or whose care has ended'} should be sent this survey (${FORMER_REASON_MIN} to ${FORMER_REASON_MAX} characters).`,
        );
      }
    }
    if (targets.ids.length === 0) {
      throw new BadRequestException(targets.emptyMessage);
    }
    if (survey.managerCopy) {
      // A copy made for each manager, sent to people chosen here (not its saved list): the team rules
      // apply to who it actually reaches (with anyone already sent it).
      const already = activity.recipients
        ? (await this.prisma.surveyRecipient.findMany({ where: { surveyId }, select: { employeeId: true } })).map((r) => r.employeeId).filter((x): x is string => Boolean(x))
        : [];
      const teamProblem = await managerCopyTeamProblemFor(this.prisma, survey.id, [...already, ...targets.ids]);
      if (teamProblem) throw new BadRequestException(teamProblem);
    }
    if (survey.isAnonymous) {
      // "Send to more" counts everyone the survey has gone to, not just this batch.
      const reach = await this.anonymousReach(survey, targets.ids, activity.recipients);
      if (reach < MIN_ANONYMOUS_RECIPIENTS) {
        throw new BadRequestException(tooFewAnonymousMessage(reach));
      }
    }

    if (recurrence) {
      if (survey.clonedFromId) {
        throw new BadRequestException(
          'This is one period of a repeating survey. Change the repeat on the repeating survey itself.',
        );
      }
      if (activity.recipients > 0 || activity.responses > 0) {
        throw new BadRequestException(
          'This survey has already been sent. Duplicate it to start a repeating survey.',
        );
      }
      // A repeat shorter than 4 weeks asks the same people more often than the 4-week rule allows (periods of
      // one series never hold each other back): it needs a reason, from the sender or the ready-made survey.
      let repeatReason: string | null = null;
      if (isShortRepeat(recurrence)) {
        const given = dto.repeatReason?.trim() ?? '';
        const libMeta = (await this.contactRule?.ruleFor(survey).catch(() => null))?.libraryMeta ?? survey.libraryMeta;
        repeatReason = given.length >= 5 ? given : (libraryRepeatReason(libMeta) ?? storedRepeatReason(survey.contactRule));
        if (!repeatReason || repeatReason.length > 300) {
          throw new BadRequestException(
            'Say why people should be asked every week (5 to 300 characters): the 4-week rule does not stop a repeating survey asking the same people.',
          );
        }
      }
      const first = isFuture ? when! : now;
      const scheduled = await this.prisma.survey.update({
        where: { id: surveyId },
        data: {
          ...(restartingSeries ? { status: SurveyStatus.DRAFT } : {}),
          distributeAt: first,
          distributedAt: null,
          recurrence,
          recurrenceAnchorAt: first,
          distributionFailedAt: null,
          distributionError: null,
          scheduledById: actor.id,
          locationIds: this.ownershipLocationIds(
            survey.locationIds,
            activity.any,
            audience,
            targets.branchIds,
          ),
          roleIds: audience.roleIds,
          audienceEmployeeIds: audience.employeeIds,
          audienceServiceUserIds: audience.serviceUserIds,
          periodOpenDays:
            dto.periodOpenDays !== undefined ? dto.periodOpenDays : survey.periodOpenDays,
          ...(repeatReason && repeatReason !== storedRepeatReason(survey.contactRule)
            ? { contactRule: { ...((survey.contactRule as Record<string, unknown> | null) ?? {}), repeatReason } as Prisma.InputJsonValue }
            : {}),
          updatedById: actor.id,
        },
      });
      if (repeatReason) {
        await this.audit.logAudit({
          userId: actor.id,
          module: AuditModule.SURVEY,
          action: AuditAction.SURVEY_CONTACT_RULE_CHANGED,
          recordType: 'Survey',
          recordId: surveyId,
          description: `Survey "${survey.title}" repeats more often than every 4 weeks`,
          newValues: { recurrence, repeatReason },
          metadata: { surveyId },
          ...meta,
        });
      }
      await this.audit.logAudit({
        userId: actor.id,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_UPDATED,
        recordType: 'Survey',
        recordId: surveyId,
        oldValues: auditSnapshot(survey),
        newValues: auditSnapshot(scheduled),
        metadata: { scheduledDistribution: true, recurring: true, audience },
        ...meta,
      });

      if (!isFuture) {
        const run = await this.runRecurringPeriod(scheduled, now, requestOrigin);
        return {
          message: `${recurrenceLabel(recurrence)} survey started — first period sent to ${run.sent} ${this.audienceNoun(survey.targetKind)}`,
          data: {
            sent: run.sent,
            skippedExisting: 0,
            skippedNoPortal: run.skippedNoPortal,
            noPortal: await this.serviceUserNameList(run.noPortalIds),
            status: scheduled.status,
            scheduled: true,
            distributeAt: toIso(run.nextAt),
            recurrence,
            periodSurveyId: run.cloneId,
          },
        };
      }
      return {
        message: 'Repeating survey scheduled',
        data: {
          sent: 0,
          skippedExisting: 0,
          skippedNoPortal: 0,
          // Chosen people without a portal: added to each period for staff to phone, visit or post.
          noPortal: await this.serviceUserNameList(targets.noPortalIds),
          status: scheduled.status,
          scheduled: true,
          distributeAt: toIso(scheduled.distributeAt),
          recurrence,
        },
      };
    }

    if (!survey.clonedFromId && activity.clones > 0) {
      throw new BadRequestException(
        'This survey repeats on a schedule and each period is sent automatically. Open a period to send it to more people.',
      );
    }
    // A one-off survey is closed at its end date: never send (or schedule) invitations to a survey
    // that will already be closed when they arrive.
    const sendAt = isFuture ? when! : now;
    if (survey.closesAt && survey.closesAt.getTime() <= sendAt.getTime()) {
      const ends = formatSurveyDateTime(survey.closesAt, await this.timeZone());
      throw new BadRequestException(
        isFuture
          ? `This survey ends on ${ends}, before it would be sent. Choose an earlier send time, or change the end date in Edit details.`
          : `This survey's end date (${ends}) has passed, so people could not answer it. Change the end date in Edit details first.`,
      );
    }

    if (isFuture) {
      if (survey.clonedFromId) {
        throw new BadRequestException('Periods of a repeating survey are sent when the period starts.');
      }
      const scheduled = await this.prisma.survey.update({
        where: { id: surveyId },
        data: {
          distributeAt: when,
          distributedAt: null,
          recurrence: null,
          recurrenceAnchorAt: null,
          distributionFailedAt: null,
          distributionError: null,
          scheduledById: actor.id,
          locationIds: this.ownershipLocationIds(
            survey.locationIds,
            activity.any,
            audience,
            targets.branchIds,
          ),
          roleIds: audience.roleIds,
          audienceEmployeeIds: audience.employeeIds,
          audienceServiceUserIds: audience.serviceUserIds,
          updatedById: actor.id,
        },
      });
      await this.audit.logAudit({
        userId: actor.id,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_UPDATED,
        recordType: 'Survey',
        recordId: surveyId,
        oldValues: auditSnapshot(survey),
        newValues: auditSnapshot(scheduled),
        metadata: { scheduledDistribution: true, recurring: false, audience },
        ...meta,
      });
      return {
        message: 'Survey distribution scheduled',
        data: {
          sent: 0,
          skippedExisting: 0,
          skippedNoPortal: 0,
          // Chosen people without a portal: added when it goes out, for staff to phone, visit or post.
          noPortal: await this.serviceUserNameList(targets.noPortalIds),
          status: scheduled.status,
          scheduled: true,
          distributeAt: toIso(scheduled.distributeAt),
          recurrence: null,
        },
      };
    }

    // Send now (also replaces any pending one-off schedule). The 4-week rule holds back people
    // surveyed recently (sent on their free day), unless the sender sends to them anyway with a reason.
    const overrideReason = dto.contactRuleOverride?.reason?.trim() || null;
    if (dto.contactRuleOverride && (!overrideReason || overrideReason.length < 5)) {
      throw new BadRequestException('Say why people surveyed in the last 4 weeks should be sent this now.');
    }
    const ruled = await this.applyContactRule(survey, targets, audience, now, Boolean(overrideReason));
    if (survey.isAnonymous && (ruled.held.length || ruled.skipped.length || ruled.sampledOut)) {
      const reachNow = await this.anonymousReach(survey, ruled.targets.ids, activity.recipients);
      if (reachNow < MIN_ANONYMOUS_RECIPIENTS) {
        throw new BadRequestException(
          `Only ${reachNow} ${reachNow === 1 ? 'person' : 'people'} could be sent this anonymous survey now: ${ruled.held.length + ruled.skipped.length} had another survey in the last 4 weeks. ${tooFewAnonymousMessage(reachNow)}`,
        );
      }
    }
    const result = await this.createRecipients(survey, audience, ruled.targets, actor.id, now, {
      clearSchedule: true,
    });
    await this.contactRule?.recordHeld(survey.id, survey.targetKind === SurveyTargetKind.SERVICE_USER ? 'SERVICE_USER' : 'EMPLOYEE', ruled.held);
    await this.contactRule?.recordHeld(survey.id, survey.targetKind === SurveyTargetKind.SERVICE_USER ? 'SERVICE_USER' : 'EMPLOYEE', ruled.skipped, 'SKIPPED');
    if (overrideReason) {
      await this.audit.logAudit({
        userId: actor.id,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_CONTACT_RULE_OVERRIDDEN,
        recordType: 'Survey',
        recordId: surveyId,
        description: `Survey "${survey.title}" sent without holding back people surveyed in the last 4 weeks`,
        // Counts and the reason only: never who, or which other survey.
        newValues: { sent: result.created.length, reason: overrideReason },
        metadata: { surveyId },
        ...meta,
      });
    }
    if (survey.recurrence && dto.recurrence === null) {
      await this.prisma.survey.update({
        where: { id: surveyId },
        data: { recurrence: null, recurrenceAnchorAt: null },
      });
    }
    this.deliverInBackground(survey, result.created, requestOrigin);
    const noPortalIds = createdWithoutPortal(result.created, targets.noPortalIds);
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_SENT,
      recordType: 'Survey',
      recordId: surveyId,
      newValues: {
        sent: result.created.length,
        skippedExisting: result.skippedExisting,
        skippedNoPortal: targets.skippedNoPortal,
        addedWithoutPortal: noPortalIds.length,
        heldBack: ruled.held.length,
        notSentHeld: ruled.skipped.length,
        notSampled: ruled.sampledOut,
        status: result.updated.status,
        // Former people: the count and the reason, never who.
        ...(formerIds.length ? { formerPeople: formerIds.length, ...(formerReason ? { formerReason } : {}) } : {}),
      },
      metadata: { surveyId, targetKind: survey.targetKind, audience },
      ...meta,
    });

    const heldNote = ruled.held.length
      ? `. ${ruled.held.length} had another survey in the last 4 weeks: they will be sent it when 4 weeks have passed, if it is still open`
      : ruled.skipped.length
        ? `. ${ruled.skipped.length} had another survey in the last 4 weeks and will not be sent this one`
        : '';
    return {
      message: `Survey sent to ${result.created.length} ${this.audienceNoun(survey.targetKind)}${heldNote}`,
      data: {
        sent: result.created.length,
        heldBack: ruled.held.length,
        notSentHeld: ruled.skipped.length,
        notSampled: ruled.sampledOut,
        skippedExisting: result.skippedExisting,
        skippedNoPortal: targets.skippedNoPortal,
        // Named surveys: chosen people without a portal, now in the list to phone, visit or post.
        noPortal: await this.serviceUserNameList(noPortalIds),
        status: result.updated.status,
        scheduled: false,
        distributeAt: null,
        recurrence: null,
      },
    };
  }

  // ─── The 4-week contact rule: check before sending, release, send anyway ───

  /**
   * Before Send now: how many of the people this send would reach had another survey in the last 4
   * weeks (held back until their free day) or would not be sampled. Names of the held people and their
   * free day for the sender (surveys.manage: needed to plan); never which other survey, or when it was
   * sent (being sent some surveys is itself sensitive).
   */
  async checkSend(actor: RequestUser, surveyId: string, dto: SendSurveyDto) {
    const scope = this.scopeOf(actor);
    const survey = await this.requireSurvey(actor, surveyId);
    this.assertNotTemplate(survey, 'sent or scheduled');
    const empty = { total: 0, sendNow: 0, heldBack: 0, notSentHeld: 0, notSampled: 0, held: [] as Array<{ id: string; name: string; freeFrom: string }>, holdBack: false, whenHeld: 'DELAY' as 'DELAY' | 'SKIP', sampling: null as { percent: number } | null };
    if (survey.targetKind === SurveyTargetKind.PUBLIC) return { message: 'Send check', data: empty };
    const audience = await this.resolveAudience(scope, survey, dto);
    const targets = await this.resolveTargets(this.prisma, survey.targetKind, audience, scope.locationIds, {
      withoutPortal: !survey.isAnonymous,
    });
    const now = new Date();
    const ruled = await this.applyContactRule(survey, targets, audience, now);
    const kind = survey.targetKind === SurveyTargetKind.SERVICE_USER ? 'SERVICE_USER' : 'EMPLOYEE';
    const waiting = ruled.held.length ? ruled.held : ruled.skipped;
    const shown = waiting.slice(0, 200);
    const names = await this.loadRecipientNames(
      shown.map((h) => (kind === 'SERVICE_USER' ? { employeeId: null, serviceUserId: h.personId } : { employeeId: h.personId, serviceUserId: null })),
    );
    const ruleInfo = this.contactRule ? await this.contactRule.ruleFor(survey) : null;
    return {
      message: 'Send check',
      data: {
        total: targets.ids.length,
        sendNow: ruled.targets.ids.length,
        heldBack: ruled.held.length,
        /** The survey skips held people (not sent at all this time) rather than sending later. */
        notSentHeld: ruled.skipped.length,
        notSampled: ruled.sampledOut,
        holdBack: ruleInfo?.rule.holdBack ?? false,
        whenHeld: ruleInfo?.rule.whenHeld ?? 'DELAY',
        sampling: readSampling(ruleInfo?.owner.sampling ?? survey.sampling),
        held: shown
          .map((h) => ({ id: h.personId, name: names.get(h.personId) ?? (kind === 'SERVICE_USER' ? 'Service user' : 'Employee'), freeFrom: h.freeFrom }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    };
  }

  /**
   * Send to held-back people now: on their free day (the survey job), or anyway with a reason (a
   * manager). Goes through the normal send (invitation, texts, branch); the survey's audience is kept.
   * Weeks may have passed since they were held: each is checked again as a send would (left, died,
   * care ended, no portal on an anonymous survey); anyone no longer eligible is LAPSED, never sent.
   */
  private async sendToHeld(
    survey: Survey,
    rows: Array<{ id: string; employeeId: string | null; serviceUserId: string | null }>,
    actorId: string | null,
    now: Date,
  ) {
    const forServiceUsers = survey.targetKind === SurveyTargetKind.SERVICE_USER;
    const personOf = (r: { employeeId: string | null; serviceUserId: string | null }) => (forServiceUsers ? r.serviceUserId : r.employeeId);
    const ids = rows.map(personOf).filter((x): x is string => Boolean(x));
    const audience: SurveyAudience = {
      locationIds: survey.locationIds,
      roleIds: survey.roleIds,
      employeeIds: survey.audienceEmployeeIds,
      serviceUserIds: survey.audienceServiceUserIds ?? [],
    };
    const chosenAudience = audience.employeeIds.length > 0 || audience.serviceUserIds.length > 0;
    // A month copy of a survey sent after care ends or a complaint closes (event triggers): held people
    // whose care has ended are still sent it, as when it was first sent (the same rule as reminders).
    const owner = survey.clonedFromId ? await this.prisma.survey.findUnique({ where: { id: survey.clonedFromId }, select: { eventTrigger: true } }) : null;
    const ownerEvent = readEventTrigger(owner?.eventTrigger)?.event;
    const careEndedSurvey = ownerEvent === 'CARE_ENDED' || ownerEvent === 'COMPLAINT_CLOSED';
    // Resolved as chosen people (only these), with the stricter rules unless the survey chose them by
    // name: someone surveyed by branch or by a repeating survey whose care has since ended is not sent.
    const targets = await this.resolveTargets(
      this.prisma,
      survey.targetKind,
      { locationIds: [], roleIds: [], employeeIds: forServiceUsers ? [] : ids, serviceUserIds: forServiceUsers ? ids : [] },
      null,
      { withoutPortal: !survey.isAnonymous, repeating: !careEndedSurvey && (Boolean(survey.clonedFromId) || !chosenAudience) },
    );
    const eligible = new Set(targets.ids);
    const gone = rows.filter((r) => !eligible.has(personOf(r) ?? ''));
    if (gone.length) {
      await this.prisma.surveyHeldBack.updateMany({ where: { id: { in: gone.map((r) => r.id) } }, data: { status: 'LAPSED', resolvedAt: now } });
    }
    if (!targets.ids.length) return { created: [] as CreatedRecipient[], skippedExisting: 0, lapsed: gone.length };
    const result = await this.createRecipients(survey, audience, targets, actorId, now, { clearSchedule: false });
    this.deliverInBackground(survey, result.created);
    return { ...result, lapsed: gone.length };
  }

  /** The survey job: held people whose free day has come are sent the survey if it is still open long enough. */
  async releaseHeldBack(now: Date = new Date()): Promise<{ sent: number; lapsed: number }> {
    if (!this.contactRule) return { sent: 0, lapsed: 0 };
    let lapsed = await this.contactRule.lapseClosed(now);
    const due = await this.prisma.surveyHeldBack.findMany({
      where: { status: 'HELD', freeFrom: { lte: now }, survey: { status: SurveyStatus.ACTIVE, deletedAt: null } },
      select: { id: true, surveyId: true, employeeId: true, serviceUserId: true },
      take: 500,
    });
    const bySurvey = new Map<string, typeof due>();
    for (const d of due) bySurvey.set(d.surveyId, [...(bySurvey.get(d.surveyId) ?? []), d]);
    let sent = 0;
    for (const [surveyId, rows] of bySurvey) {
      try {
        const survey = await this.prisma.survey.findUnique({ where: { id: surveyId } });
        if (!survey) continue;
        if (!SurveyContactRuleService.openLongEnough(survey.closesAt, now)) {
          const r = await this.prisma.surveyHeldBack.updateMany({
            where: { id: { in: rows.map((x) => x.id) }, status: 'HELD' },
            data: { status: 'LAPSED', resolvedAt: now },
          });
          lapsed += r.count;
          continue;
        }
        // Someone may have had another survey since (an exempt one, or one sent anyway): check again.
        const kind = survey.targetKind === SurveyTargetKind.SERVICE_USER ? 'SERVICE_USER' : 'EMPLOYEE';
        const personOf = (r: { employeeId: string | null; serviceUserId: string | null }) => (kind === 'SERVICE_USER' ? r.serviceUserId : r.employeeId)!;
        const tz = await this.contactRule.timeZone();
        const info = await this.contactRule.ruleFor(survey);
        const last = await this.contactRule.lastContacts(kind, rows.map(personOf), survey.clonedFromId ?? survey.id, now, tz, {
          reference: info.owner.libraryReference ?? null,
          sentWith: librarySentWith(info.libraryMeta),
        });
        const today = dayKeyInTimeZone(now, tz);
        const ready: typeof rows = [];
        for (const r of rows) {
          const c = last.get(personOf(r));
          if (!c || freeFromDay(c.day) <= today) {
            ready.push(r);
            continue;
          }
          await this.prisma.surveyHeldBack.update({
            where: { id: r.id },
            data: { lastContactOn: startOfOperationalDayUtc(c.day, tz), freeFrom: startOfOperationalDayUtc(freeFromDay(c.day), tz) },
          });
        }
        if (!ready.length) continue;
        const taken = await this.prisma.surveyHeldBack.updateMany({
          where: { id: { in: ready.map((r) => r.id) }, status: 'HELD' },
          data: { status: 'SENT', resolvedAt: now },
        });
        if (taken.count !== ready.length) continue; // another server took them
        const result = await this.sendToHeld(survey, ready, null, now);
        sent += result.created.length;
        lapsed += result.lapsed;
        await this.audit.logAudit({
          userId: undefined,
          module: AuditModule.SURVEY,
          action: AuditAction.SURVEY_SENT,
          recordType: 'Survey',
          recordId: survey.id,
          description: `Survey "${survey.title}" sent to people held back by the 4-week rule, now free`,
          newValues: { sent: result.created.length, fromHeldBack: true },
          metadata: { surveyId: survey.id },
        });
      } catch (e) {
        this.logger.warn(`Survey ${surveyId}: held-back people not sent yet (${errorKind(e)})`);
      }
    }
    return { sent, lapsed };
  }

  /** A manager sends the survey now to held-back people (some or all), with a reason. Audited as counts. */
  async sendHeldAnyway(actor: RequestUser, surveyId: string, input: { heldIds?: string[]; reason: string }, meta?: RequestAuditMeta) {
    const survey = await this.requireSurvey(actor, surveyId);
    const reason = input.reason?.trim() ?? '';
    if (reason.length < 5 || reason.length > 300) {
      throw new BadRequestException('Say why they should be sent it now (5 to 300 characters).');
    }
    if (survey.status !== SurveyStatus.ACTIVE) throw new BadRequestException('This survey is not open for answers.');
    const now = new Date();
    if (survey.closesAt && survey.closesAt <= now) throw new BadRequestException('This survey has ended.');
    const rows = await this.prisma.surveyHeldBack.findMany({
      where: { surveyId: survey.id, status: 'HELD', ...(input.heldIds?.length ? { id: { in: input.heldIds } } : {}) },
      select: { id: true, employeeId: true, serviceUserId: true },
    });
    if (!rows.length) throw new BadRequestException('Nobody is waiting to be sent this survey.');
    const taken = await this.prisma.surveyHeldBack.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: 'HELD' },
      data: { status: 'OVERRIDDEN', overrideReason: reason, resolvedById: actor.id, resolvedAt: now },
    });
    if (taken.count !== rows.length) throw new BadRequestException('Someone else has just sent it to them. Refresh and try again.');
    const result = await this.sendToHeld(survey, rows, actor.id, now);
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_CONTACT_RULE_OVERRIDDEN,
      recordType: 'Survey',
      recordId: survey.id,
      description: `Survey "${survey.title}" sent to people held back by the 4-week rule, before their free day`,
      // Counts and the reason only: never who, or which other survey held them.
      newValues: { sent: result.created.length, reason },
      metadata: { surveyId: survey.id },
      ...meta,
    });
    return { message: `Sent to ${result.created.length} ${result.created.length === 1 ? 'person' : 'people'}`, data: { sent: result.created.length } };
  }

  // ─── Event triggers (Phase 2 part 3): sends into the month's copy ───

  /**
   * The month copy an event send goes into ("Welcome check-in — Nov 2026"), made on demand like a
   * repeating survey's period (one per month, unique), open until 4 weeks after the month ends. Null when
   * this month's copy was closed by hand (nothing more is sent this month).
   */
  async ensureEventPeriod(source: Survey, now: Date): Promise<Survey | null> {
    const tz = await this.timeZone();
    const today = dayKeyInTimeZone(now, tz);
    const { periodKey, monthStart, closesOn } = eventPeriodFor(today);
    const found = await this.prisma.survey.findFirst({ where: { clonedFromId: source.id, periodKey } });
    if (found) return found.status === SurveyStatus.ACTIVE && !found.deletedAt ? found : null;
    const questions = await this.prisma.surveyQuestion.findMany({ where: { surveyId: source.id, deletedAt: null }, orderBy: QUESTION_ORDER });
    if (!questions.length) throw new SurveyDistributionError('NO_QUESTIONS', 'The survey has no questions.');
    const opensAt = startOfOperationalDayUtc(monthStart, tz);
    try {
      const created = await this.prisma.survey.create({
        data: this.periodCopyData(source, questions, {
          periodKey,
          label: surveyPeriodLabel(opensAt, SurveyRecurrence.MONTHLY, tz),
          opensAt,
          closesAt: startOfOperationalDayUtc(closesOn, tz),
          actorId: source.updatedById ?? source.createdById ?? null,
          now,
        }),
      });
      await this.audit.logAudit({
        userId: undefined,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_CREATED,
        recordType: 'Survey',
        recordId: created.id,
        description: `Month copy "${created.title}" made for sends after events`,
        metadata: { surveyId: created.id, eventSourceSurveyId: source.id, periodKey },
      });
      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.survey.findFirst({ where: { clonedFromId: source.id, periodKey } });
        return again && again.status === SurveyStatus.ACTIVE && !again.deletedAt ? again : null;
      }
      throw e;
    }
  }

  /**
   * Send an event-triggered survey to these people now, in the month's copy, through the normal path:
   * eligibility (chosen people: died, inactive or not started are refused), the 4-week rule (held or
   * skipped), opt-outs, invitations, texts and reminders. Anonymous surveys: nothing goes unless at least
   * the anonymous minimum would be sent at once (the caller batches). Audited as counts only.
   */
  async sendForEvents(source: Survey, personIds: string[], now: Date): Promise<{
    periodId: string | null;
    sent: string[];
    held: string[];
    skipped: string[];
    already: string[];
    unreachable: string[];
    deferred: boolean;
    /** This month's copy was closed by hand: nothing more goes this month. */
    periodClosed?: boolean;
  }> {
    const none = { periodId: null, sent: [], held: [], skipped: [], already: [], unreachable: [], deferred: false };
    const ids = unique(personIds);
    if (!ids.length) return none;
    const period = await this.ensureEventPeriod(source, now);
    if (!period) return { ...none, unreachable: ids, periodClosed: true };
    const forServiceUsers = source.targetKind === SurveyTargetKind.SERVICE_USER;
    const kind = forServiceUsers ? 'SERVICE_USER' : 'EMPLOYEE';
    const existing = await this.prisma.surveyRecipient.findMany({
      where: { surveyId: period.id, ...(forServiceUsers ? { serviceUserId: { in: ids } } : { employeeId: { in: ids } }) },
      select: { employeeId: true, serviceUserId: true },
    });
    const on = new Set(existing.map((r) => (forServiceUsers ? r.serviceUserId : r.employeeId)));
    const already = ids.filter((id) => on.has(id));
    const remaining = ids.filter((id) => !on.has(id));
    if (!remaining.length) return { ...none, periodId: period.id, already };
    const chosen: SurveyAudience = {
      locationIds: [],
      roleIds: [],
      employeeIds: forServiceUsers ? [] : remaining,
      serviceUserIds: forServiceUsers ? remaining : [],
    };
    const targets = await this.resolveTargets(this.prisma, source.targetKind, chosen, source.locationIds.length ? source.locationIds : null, {
      withoutPortal: !source.isAnonymous,
      // Leavers' surveys: someone whose leaving record was entered after they left is still sent it.
      formerStaff: await this.leaversSurvey(source),
      careEndedSurvey: (await this.formerContext(source)).noReason,
    });
    const reachable = new Set(targets.ids);
    const unreachable = remaining.filter((id) => !reachable.has(id));
    if (!targets.ids.length) return { ...none, periodId: period.id, already, unreachable };
    const ruled = await this.applyContactRule(period, targets, chosen, now);
    if (source.isAnonymous && ruled.targets.ids.length < MIN_ANONYMOUS_RECIPIENTS) {
      return { ...none, periodId: period.id, already, unreachable, deferred: true };
    }
    // The copy keeps the source survey's branches and audience (never these people as its audience).
    const branchAudience: SurveyAudience = { locationIds: source.locationIds, roleIds: source.roleIds, employeeIds: [], serviceUserIds: [] };
    const result = await this.createRecipients(period, branchAudience, ruled.targets, null, now, { clearSchedule: false });
    await this.contactRule?.recordHeld(period.id, kind, ruled.held);
    await this.contactRule?.recordHeld(period.id, kind, ruled.skipped, 'SKIPPED');
    this.deliverInBackground(period, result.created);
    const sent = result.created.map((r) => (forServiceUsers ? r.serviceUserId : r.employeeId)).filter((x): x is string => Boolean(x));
    await this.audit.logAudit({
      userId: undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_SENT,
      recordType: 'Survey',
      recordId: period.id,
      description: `Survey "${period.title}" sent after events in the care records`,
      // Counts only: never who, or what happened to them.
      newValues: { sent: sent.length, heldBack: ruled.held.length, notSentHeld: ruled.skipped.length, notReachable: unreachable.length },
      metadata: { surveyId: period.id, eventSourceSurveyId: source.id },
    });
    const sentSet = new Set(sent);
    return {
      periodId: period.id,
      sent,
      held: ruled.held.map((h) => h.personId),
      skipped: ruled.skipped.map((h) => h.personId),
      // Someone whose row appeared between the read and the insert (e.g. an answer recorded) is already on it.
      already: [...already, ...ruled.targets.ids.filter((id) => !sentSet.has(id))],
      unreachable,
      deferred: false,
    };
  }

  private async ownerOf(survey: Survey): Promise<Survey> {
    return survey.clonedFromId ? ((await this.prisma.survey.findUnique({ where: { id: survey.clonedFromId } })) ?? survey) : survey;
  }

  /** Leavers' surveys (events only ever reach former staff on these). */
  private async leaversSurvey(survey: Survey): Promise<boolean> {
    if (survey.targetKind !== SurveyTargetKind.EMPLOYEE) return false;
    return forLeavers(survey, await this.ownerOf(survey));
  }

  /** Former people on this survey: whether it is for them by nature (no reason needed). One rule: survey-eligibility.util. */
  private async formerContext(survey: Survey): Promise<{ noReason: boolean }> {
    const owner = await this.ownerOf(survey);
    const kind = survey.targetKind === SurveyTargetKind.EMPLOYEE ? 'EMPLOYEE' : 'SERVICE_USER';
    return { noReason: formerPeopleNeedNoReason(survey, owner, kind) };
  }

  /** Of these people, those who have left (staff) or whose care has ended (people we support). */
  private async formerAmong(targetKind: SurveyTargetKind, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    if (targetKind === SurveyTargetKind.EMPLOYEE) {
      const rows = await Promise.resolve()
        .then(() => this.prisma.employee.findMany({ where: { id: { in: ids }, isActive: false }, select: { id: true, isActive: true } }))
        .catch(() => [] as Array<{ id: string; isActive: boolean }>);
      return rows.filter((r) => r.isActive === false).map((r) => r.id);
    }
    if (targetKind === SurveyTargetKind.SERVICE_USER) {
      const rows = await Promise.resolve()
        .then(() => this.prisma.serviceUser.findMany({ where: { id: { in: ids }, status: { is: { code: CARE_ENDED_STATUS } } }, select: { id: true, status: { select: { code: true } } } }))
        .catch(() => [] as Array<{ id: string; status: { code: string } | null }>);
      return rows.filter((r) => r.status?.code === CARE_ENDED_STATUS).map((r) => r.id);
    }
    return [];
  }

  /**
   * People who have left (staff) or whose care ended (people we support) in the last 3 months, to choose by
   * name. Sent to the personal email on their record (never a work address, never the carer app or portal),
   * with a one-click "unsubscribe from all surveys"; named surveys carry their own link, anonymous ones ask for
   * a paper copy. A reason is needed unless the survey is for them (leavers, care ending).
   */
  async listFormerPeople(actor: RequestUser, surveyId: string, search?: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.targetKind === SurveyTargetKind.PUBLIC) throw new BadRequestException('Public surveys are not sent to staff or people we support.');
    if (survey.recurrence) throw new BadRequestException('A repeating survey never goes to people who have left.');
    const scope = this.scopeOf(actor);
    const q = search?.trim();
    const now = new Date();
    const tz = await this.timeZone();
    const domains = organisationDomains(
      await Promise.resolve().then(() => this.prisma.companyProfile.findFirst({ select: { email: true, companyWebsite: true } })).catch(() => null),
    );
    const { noReason } = await this.formerContext(survey);
    if (survey.targetKind === SurveyTargetKind.EMPLOYEE) {
      const inScope = this.orgScope.employeeEmploymentScopeWhere(scope);
      const rows = await this.prisma.employee.findMany({
        where: {
          AND: [
            formerStaffWhere(now),
            ...(inScope ? [inScope] : []),
            ...(q ? [{ personalDetail: { OR: [{ firstName: { contains: q, mode: 'insensitive' as const } }, { lastName: { contains: q, mode: 'insensitive' as const } }] } }] : []),
          ],
        },
        select: {
          id: true,
          personalDetail: { select: { firstName: true, lastName: true, email: true } },
          leavingRecords: { where: { deletedAt: null }, orderBy: { leavingDate: 'desc' }, take: 1, select: { leavingDate: true } },
          employment: { select: { endDate: true } },
        },
        take: 100,
      });
      return {
        message: 'Former people',
        data: {
          kind: 'EMPLOYEE',
          needsReason: !noReason,
          people: rows.map((e) => {
            const left = e.leavingRecords[0]?.leavingDate ?? e.employment?.endDate ?? null;
            return {
              id: e.id,
              name: `${e.personalDetail?.firstName ?? ''} ${e.personalDetail?.lastName ?? ''}`.trim() || 'Former employee',
              leftOn: left ? dayKeyInTimeZone(left, tz) : null,
              hasPersonalEmail: Boolean(personalEmail(e.personalDetail?.email, domains)),
            };
          }),
        },
      };
    }
    const inScope = this.orgScope.serviceUserScopeWhere(scope);
    const rows = await this.prisma.serviceUser.findMany({
      where: {
        AND: [
          formerServiceUsersWhere(now),
          ...(inScope ? [inScope] : []),
          ...(q ? [{ OR: [{ firstName: { contains: q, mode: 'insensitive' as const } }, { lastName: { contains: q, mode: 'insensitive' as const } }] }] : []),
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true, serviceEndDate: true },
      take: 100,
    });
    return {
      message: 'Former people',
      data: {
        kind: 'SERVICE_USER',
        needsReason: !noReason,
        people: rows.map((r) => ({
          id: r.id,
          name: `${r.firstName} ${r.lastName ?? ''}`.trim(),
          leftOn: r.serviceEndDate ? dayKeyInTimeZone(r.serviceEndDate, tz) : null,
          hasPersonalEmail: Boolean(r.email?.trim()),
        })),
      },
    };
  }

  /**
   * Has this unanswered invitation lapsed (now or before)? Checked when the link is opened or answered: someone
   * who can no longer be sent the survey (same rules as sending) is marked LAPSED. Answers already given stay.
   */
  private async lapsedNow(recipient: { id: string; status: string; employeeId: string | null; serviceUserId: string | null; externalContactId?: string | null; response?: unknown; survey: Survey }): Promise<boolean> {
    if (recipient.status === 'LAPSED') return true;
    if (recipient.status === 'COMPLETED' || recipient.response) return false;
    const owner = recipient.survey.clonedFromId
      ? ((await this.prisma.survey.findUnique({ where: { id: recipient.survey.clonedFromId } })) ?? recipient.survey)
      : recipient.survey;
    const bad = await ineligibleRecipientIds(this.prisma, recipient.survey, owner, [recipient]);
    if (!bad.size) return false;
    await this.prisma.surveyRecipient.updateMany({
      where: { id: recipient.id, status: { in: LAPSABLE_STATUSES } },
      data: { status: SurveyRecipientStatus.LAPSED, invitationTextPending: false },
    });
    return true;
  }

  /**
   * Send a lapsed invitation again (named surveys): only when the person can be sent it again now (e.g. their
   * care restarted) and the survey is still open. Needs individual responses access (who has not answered is
   * part of them). Audited without the person's name.
   */
  async resendLapsed(actor: RequestUser, surveyId: string, recipientId: string, meta?: RequestAuditMeta, requestOrigin?: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.isAnonymous) {
      throw new BadRequestException('Anonymous surveys never single out one person: choosing whom to send it again would show they had not answered.');
    }
    if (survey.status !== SurveyStatus.ACTIVE || (survey.closesAt && survey.closesAt <= new Date())) throw new BadRequestException('This survey is not open for answers.');
    const access = await surveyAccessFor(this.prisma, actor, survey);
    if (!access.responses) throw new ForbiddenException('Only people who can see this survey’s individual responses can send it again to one person.');
    const recipient = await this.prisma.surveyRecipient.findFirst({
      where: { id: recipientId, surveyId: survey.id },
      select: { id: true, token: true, status: true, employeeId: true, serviceUserId: true, externalContactId: true },
    });
    if (!recipient) throw new NotFoundException('Person not found on this survey');
    if (recipient.status !== 'LAPSED') throw new BadRequestException('Their invitation has not lapsed.');
    const owner = survey.clonedFromId ? ((await this.prisma.survey.findUnique({ where: { id: survey.clonedFromId } })) ?? survey) : survey;
    if ((await ineligibleRecipientIds(this.prisma, survey, owner, [recipient])).size) {
      throw new BadRequestException('They still cannot be sent this survey (for example their care has not restarted).');
    }
    await this.prisma.surveyRecipient.update({ where: { id: recipient.id }, data: { status: SurveyRecipientStatus.SENT, sentAt: new Date() } });
    if (recipient.employeeId || recipient.serviceUserId) {
      this.deliverInBackground(survey, [{ employeeId: recipient.employeeId, serviceUserId: recipient.serviceUserId, token: recipient.token }], requestOrigin);
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_SENT,
      recordType: 'SurveyRecipient',
      recordId: recipient.id,
      description: `Survey "${survey.title}" sent again to one person whose invitation had lapsed`,
      newValues: { sent: 1, resentAfterLapse: true },
      metadata: { surveyId: survey.id },
      ...meta,
    });
    return { message: 'Sent again', data: { sent: 1 } };
  }

  private audienceNoun(targetKind: SurveyTargetKind) {
    return targetKind === SurveyTargetKind.SERVICE_USER ? 'service user(s)' : 'employee(s)';
  }

  /** Names of people we support, for the sender's own result (never notifications). */
  private async serviceUserNameList(ids: string[]): Promise<Array<{ id: string; name: string }>> {
    if (!ids.length) return [];
    const names = await this.loadRecipientNames(ids.map((id) => ({ employeeId: null, serviceUserId: id })));
    return ids
      .map((id) => ({ id, name: names.get(id) ?? 'Service user' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * A scheduled or repeating run added chosen people who have no portal account: tell whoever
   * scheduled it how many (no names in notifications) so the office phones, visits or posts.
   */
  private async notifyAddedWithoutPortal(survey: Survey, surveyId: string, count: number) {
    const userId = survey.scheduledById ?? survey.createdById;
    if (!userId || count === 0) return;
    try {
      await this.notifications.notifyUsers({
        recipientUserIds: [userId],
        type: NotificationType.SYSTEM_MESSAGE,
        module: NotificationModule.SYSTEM,
        severity: NotificationSeverity.INFO,
        title: 'Survey sent: some people need a call or a visit',
        message: `"${survey.title}" was sent. ${count} of the chosen people ${count === 1 ? 'has' : 'have'} no portal account: phone, visit or post it, then use Record response.`,
        recordType: 'Survey',
        recordId: surveyId,
        metadata: { href: `/surveys/${surveyId}`, surveyId, eventType: 'SURVEY_SENT_WITHOUT_PORTAL' },
      });
    } catch (err) {
      this.logger.warn(
        `Survey ${surveyId} no-portal notification not sent: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private deliverInBackground(
    survey: { id: string; title: string; targetKind: SurveyTargetKind; isAnonymous: boolean },
    created: CreatedRecipient[],
    requestOrigin?: string,
  ) {
    if (!created.length) return;
    // A failed email/push never fails the send.
    void this.deliverToRecipients(survey, created, requestOrigin).catch((err) =>
      this.logger.warn(
        `Survey ${survey.id} delivery failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    // Text message invitations, when the survey's contact plan includes them.
    void this.reminders?.sendInvitationTexts(survey.id, created).catch((err: unknown) =>
      this.logger.warn(`Survey ${survey.id} text invitations not sent (${errorKind(err)})`),
    );
  }

  /** Admin web app origin for links: ADMIN_APP_URL, else the (validated) request Origin. */
  private resolveAppBaseUrl(requestOrigin?: string): string | null {
    const configured = this.config.get<string>('app.adminAppUrl', '');
    if (configured) return configured;
    const origin = requestOrigin?.trim().replace(/\/+$/, '');
    return origin && /^https?:\/\/[^/\s]+$/i.test(origin) ? origin : null;
  }

  /**
   * Employees: carer-app push + email, each with their personal survey link.
   * Service users: email telling them a survey is waiting in their portal.
   */
  private async deliverToRecipients(
    survey: { id: string; title: string; targetKind: SurveyTargetKind; isAnonymous: boolean },
    recipients: CreatedRecipient[],
    requestOrigin?: string,
  ): Promise<void> {
    const base = this.resolveAppBaseUrl(requestOrigin);
    if (!base) {
      this.logger.warn(
        `Survey ${survey.id}: ADMIN_APP_URL is not set — emails and push are sent without a link.`,
      );
    }

    // People who asked not to be contacted about surveys (all channels, or this one) are skipped.
    const optOuts = (await this.reminders?.optOutsFor(recipients).catch(() => null)) ?? new Map<string, Set<string>>();
    const optedOut = (key: string, channel: string) => {
      const set = optOuts.get(key);
      return Boolean(set && (set.has('ALL') || set.has(channel)));
    };

    if (survey.targetKind === SurveyTargetKind.SERVICE_USER) {
      // People whose care has ended (chosen by name): their own email, never the portal (it closes with care).
      const formerSu = new Set(
        await this.formerAmong(
          SurveyTargetKind.SERVICE_USER,
          recipients.map((r) => r.serviceUserId).filter((id): id is string => Boolean(id)),
        ),
      );
      if (formerSu.size) {
        const people = await this.prisma.serviceUser.findMany({ where: { id: { in: [...formerSu] } }, select: { id: true, firstName: true, preferredName: true, email: true } });
        // Their own address only, never one on the organisation's own domains (as for former staff).
        const domains = organisationDomains(
          await Promise.resolve()
            .then(() => this.prisma.companyProfile.findFirst({ select: { email: true, companyWebsite: true } }))
            .catch(() => null),
        );
        for (const r of recipients) {
          const su = r.serviceUserId ? people.find((p) => p.id === r.serviceUserId) : undefined;
          const to = personalEmail(su?.email, domains);
          if (!su || !to || optedOut(`SERVICE_USER:${su.id}`, 'EMAIL')) continue;
          const link = base && !survey.isAnonymous ? `${base}/survey/${r.token}` : null;
          const stopAll = this.unsubscribe?.link(base, { subjectKind: 'SERVICE_USER', subjectId: su.id }) ?? null;
          await this.safeMail(survey.id, {
            to,
            subject: `Survey: ${survey.title}`,
            text: [
              `Hello ${su.preferredName?.trim() || su.firstName},`,
              '',
              `We would value your views in the survey "${survey.title}".`,
              link ? `Open your survey: ${link}` : 'Please contact us for a paper copy, or to answer by phone.',
              '',
              survey.isAnonymous ? 'Your answers are anonymous: they are not linked to your name.' : 'This link is personal to you. Please do not share it.',
              'A family member or representative can answer on your behalf.',
              '',
              stopAll ? `To stop all survey messages from us, for good: ${stopAll}` : '',
              'Thank you.',
            ]
              .filter((line, i, all) => line !== '' || all[i - 1] !== '')
              .join('\n'),
          });
        }
      }
      const accounts = await this.prisma.serviceUserPortalAccount.findMany({
        where: {
          serviceUserId: {
            in: recipients.map((r) => r.serviceUserId).filter((id): id is string => Boolean(id)),
          },
          isEnabled: true,
          deletedAt: null,
        },
        select: {
          email: true,
          serviceUserId: true,
          serviceUser: { select: { firstName: true, preferredName: true } },
        },
      });
      for (const a of accounts) {
        if (formerSu.has(a.serviceUserId) || optedOut(`SERVICE_USER:${a.serviceUserId}`, 'PORTAL')) continue;
        const name = a.serviceUser.preferredName?.trim() || a.serviceUser.firstName;
        await this.safeMail(survey.id, {
          to: a.email,
          subject: `New survey in your portal: ${survey.title}`,
          text: [
            `Hello ${name},`,
            '',
            `Your care team would like your feedback in the survey "${survey.title}".`,
            base
              ? `Log in to your portal to answer it: ${base}/portal/surveys`
              : 'Log in to your service user portal and open Surveys to answer it.',
            '',
            'A family member or representative can answer on your behalf.',
            '',
            'Thank you.',
          ].join('\n'),
        });
      }
      return;
    }

    const employeeIds = recipients
      .map((r) => r.employeeId)
      .filter((id): id is string => Boolean(id));
    const details = await this.prisma.employeePersonalDetail.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { employeeId: true, firstName: true, email: true },
    });
    const detailById = new Map(details.map((d) => [d.employeeId, d]));
    // Staff who have left (leavers' surveys): never the carer app, and only a personal email (never a work address).
    const former = new Set(
      (
        await Promise.resolve()
          .then(() => this.prisma.employee.findMany({ where: { id: { in: employeeIds }, isActive: false }, select: { id: true, isActive: true } }))
          .catch(() => [] as Array<{ id: string; isActive: boolean }>)
      )
        .filter((e) => e.isActive === false)
        .map((e) => e.id),
    );
    const domains = former.size
      ? organisationDomains(
          await Promise.resolve()
            .then(() => this.prisma.companyProfile.findFirst({ select: { email: true, companyWebsite: true } }))
            .catch(() => null),
        )
      : [];
    // Anonymous surveys: where each person can answer signed in (carer app, My surveys on the web).
    const places = survey.isAnonymous ? await staffAnswerPlaces(this.prisma, employeeIds) : new Map<string, StaffAnswerPlaces>();
    for (const r of recipients) {
      if (!r.employeeId) continue;
      // Anonymous surveys: no personal link or token in any invitation (as reminders): whoever holds a
      // person's link could see whether they have answered. They answer signed in: the carer app's
      // Surveys, or My surveys in the CareFlow web app.
      const link = base && !survey.isAnonymous ? `${base}/survey/${r.token}` : null;
      try {
        if (!former.has(r.employeeId) && !optedOut(`EMPLOYEE:${r.employeeId}`, 'APP')) await this.push.sendToEmployees([r.employeeId], {
          title: 'New survey',
          body: survey.isAnonymous ? `Please complete "${survey.title}" in Surveys. Your answers are anonymous.` : `Please complete "${survey.title}".`,
          data: {
            type: 'SURVEY',
            surveyId: survey.id,
            ...(survey.isAnonymous ? {} : { token: r.token }),
            ...(link ? { url: link } : {}),
          },
        });
      } catch (err) {
        this.logger.warn(
          `Survey ${survey.id} push to employee ${r.employeeId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const detail = detailById.get(r.employeeId);
      const to = former.has(r.employeeId) ? personalEmail(detail?.email, domains) : detail?.email;
      if (!to || optedOut(`EMPLOYEE:${r.employeeId}`, 'EMAIL')) continue;
      await this.safeMail(survey.id, {
        to,
        subject: `Survey: ${survey.title}`,
        text: [
          detail?.firstName ? `Hi ${detail.firstName},` : 'Hello,',
          '',
          `You have been asked to complete the survey "${survey.title}".`,
          survey.isAnonymous
            ? staffAnswerWhere(
                former.has(r.employeeId)
                  ? { app: false, web: false, webLink: null }
                  : { ...(places.get(r.employeeId) ?? { app: true, web: false }), webLink: base ? `${base}/my-surveys` : null },
              )
            : link
              ? `Open your survey: ${link}`
              : 'Please ask your office for your survey link.',
          '',
          survey.isAnonymous
            ? 'Your answers are anonymous: they are not linked to your name.'
            : 'This link is personal to you — please do not share it.',
          '',
          ...(former.has(r.employeeId) && this.unsubscribe
            ? [`To stop all survey messages from us, for good: ${this.unsubscribe.link(base, { subjectKind: 'EMPLOYEE', subjectId: r.employeeId }) ?? 'reply to this email'}`, '']
            : []),
          'Thank you.',
        ].join('\n'),
      });
    }
  }

  private async safeMail(surveyId: string, input: { to: string; subject: string; text: string }) {
    try {
      // Survey emails carry personal links or unsubscribe tokens: never copy them to MAIL_BCC.
      await this.mail.send({ ...input, skipBcc: true });
    } catch (err) {
      this.logger.warn(
        `Survey ${surveyId} email to ${input.to} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ─── Scheduled and repeating runs (cron) ──────────────────────────────────

  /**
   * One period of a repeating survey: check there are questions and people to send to, then in
   * one transaction close the previous period, create the period copy (questions linked to the
   * originals), create its recipients and move the schedule on. The (survey, period) key is
   * unique, so a retry or a second server can never send the same period twice.
   */
  async runRecurringPeriod(source: Survey, now: Date, requestOrigin?: string) {
    if (!source.recurrence || !source.distributeAt) {
      throw new Error(`Survey ${source.id} has no repeat schedule`);
    }
    const tz = await this.timeZone();
    const recurrence = source.recurrence;
    const anchor = source.recurrenceAnchorAt ?? source.distributeAt;
    // After downtime several runs may be due: send only the latest (the current period), not a
    // stale one whose "open for N days" may already have run out.
    let periodAt = source.distributeAt;
    for (let guard = 0; guard < 10_000; guard += 1) {
      const following = nextSurveyDistributeAt(anchor, recurrence, periodAt, periodAt, tz);
      if (following.getTime() > now.getTime()) break;
      periodAt = following;
    }
    const nextAt = nextSurveyDistributeAt(anchor, recurrence, periodAt, now, tz);
    const periodKey = surveyPeriodKey(periodAt, recurrence, tz);
    const actorId = source.scheduledById ?? source.createdById ?? null;
    const advance = () =>
      this.prisma.survey.update({
        where: { id: source.id },
        data: { distributeAt: nextAt, distributedAt: null },
      });

    const done = await this.prisma.survey.findFirst({
      where: { clonedFromId: source.id, periodKey },
      select: { id: true },
    });
    if (done) {
      await advance();
      return { cloneId: done.id, sent: 0, skippedNoPortal: 0, noPortalIds: [] as string[], nextAt, alreadySent: true };
    }

    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId: source.id, deletedAt: null },
      orderBy: QUESTION_ORDER,
    });
    if (questions.length === 0) {
      throw new SurveyDistributionError('NO_QUESTIONS', 'The survey has no questions.');
    }
    const audience: SurveyAudience = {
      locationIds: source.locationIds,
      roleIds: source.roleIds,
      employeeIds: source.audienceEmployeeIds,
      serviceUserIds: source.audienceServiceUserIds ?? [],
    };
    const targets = await this.resolveTargets(
      this.prisma,
      source.targetKind,
      audience,
      source.locationIds.length ? source.locationIds : null,
      // A repeating survey never goes to anyone whose care has ended since it was set up.
      { withoutPortal: !source.isAnonymous, repeating: true },
    );
    if (targets.ids.length === 0) {
      throw new SurveyDistributionError('NO_RECIPIENTS', targets.emptyMessage);
    }
    if (source.isAnonymous && targets.ids.length < MIN_ANONYMOUS_RECIPIENTS) {
      throw new SurveyDistributionError(
        'TOO_FEW_RECIPIENTS',
        tooFewAnonymousMessage(targets.ids.length),
      );
    }
    // The 4-week rule and sampling: a share of the people, and those surveyed recently sent the period
    // on their free day (if it is still open). Earlier periods of this series never hold anyone back.
    const ruled = await this.applyContactRule(source, targets, audience, now);
    if (source.isAnonymous && ruled.targets.ids.length < MIN_ANONYMOUS_RECIPIENTS) {
      throw new SurveyDistributionError(
        'TOO_FEW_RECIPIENTS',
        `${tooFewAnonymousMessage(ruled.targets.ids.length)} ${ruled.held.length + ruled.skipped.length} had another survey in the last 4 weeks.`,
      );
    }

    const label = surveyPeriodLabel(periodAt, recurrence, tz);
    const forServiceUsers = source.targetKind === SurveyTargetKind.SERVICE_USER;
    let result: { clone: Survey; created: CreatedRecipient[] };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        // The previous period ends when the next one starts.
        await tx.survey.updateMany({
          where: {
            clonedFromId: source.id,
            status: SurveyStatus.ACTIVE,
            deletedAt: null,
            OR: [{ closesAt: null }, { closesAt: { gt: now } }],
          },
          data: { status: SurveyStatus.CLOSED, closesAt: now },
        });
        await tx.survey.updateMany({
          where: { clonedFromId: source.id, status: SurveyStatus.ACTIVE, deletedAt: null },
          data: { status: SurveyStatus.CLOSED },
        });

        const clone = await tx.survey.create({
          data: this.periodCopyData(source, questions, {
            periodKey,
            label,
            opensAt: periodAt,
            closesAt: source.periodOpenDays ? addOperationalDays(periodAt, source.periodOpenDays, tz) : null,
            actorId,
            now,
          }),
        });

        const created: CreatedRecipient[] = ruled.targets.ids.map((id) => ({
          employeeId: forServiceUsers ? null : id,
          serviceUserId: forServiceUsers ? id : null,
          token: randomUUID(),
        }));
        await tx.surveyRecipient.createMany({
          data: created.map((r) => ({
            ...r,
            surveyId: clone.id,
            targetKind: source.targetKind,
            status: 'SENT' as const,
            sentAt: now,
            createdById: actorId,
          })),
          skipDuplicates: true,
        });

        await tx.survey.update({
          where: { id: source.id },
          data: {
            distributeAt: nextAt,
            distributedAt: null,
            distributionFailedAt: null,
            distributionError: null,
          },
        });
        return { clone, created };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Another run created this period first.
        await advance();
        return { cloneId: null, sent: 0, skippedNoPortal: 0, noPortalIds: [] as string[], nextAt, alreadySent: true };
      }
      throw e;
    }

    await this.contactRule?.recordHeld(result.clone.id, forServiceUsers ? 'SERVICE_USER' : 'EMPLOYEE', ruled.held);
    await this.contactRule?.recordHeld(result.clone.id, forServiceUsers ? 'SERVICE_USER' : 'EMPLOYEE', ruled.skipped, 'SKIPPED');
    this.deliverInBackground(result.clone, result.created, requestOrigin);
    const noPortalIds = createdWithoutPortal(result.created, ruled.targets.noPortalIds);
    await this.audit.logAudit({
      userId: actorId ?? undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_SENT,
      recordType: 'Survey',
      recordId: result.clone.id,
      newValues: {
        sent: result.created.length,
        periodKey,
        heldBack: ruled.held.length,
        notSentHeld: ruled.skipped.length,
        notSampled: ruled.sampledOut,
        skippedNoPortal: targets.skippedNoPortal,
        addedWithoutPortal: noPortalIds.length,
      },
      metadata: { surveyId: result.clone.id, recurringSurveyId: source.id, targetKind: source.targetKind },
    });
    return {
      cloneId: result.clone.id,
      sent: result.created.length,
      skippedNoPortal: targets.skippedNoPortal,
      noPortalIds,
      nextAt,
      alreadySent: false,
    };
  }

  /** A period copy of a repeating (or event-sent) survey: its questions, origin and settings as they are now. */
  private periodCopyData(
    source: Survey,
    questions: SurveyQuestion[],
    opts: { periodKey: string; label: string; opensAt: Date; closesAt: Date | null; actorId: string | null; now: Date },
  ): Prisma.SurveyUncheckedCreateInput {
    const periodKeys = new Set(questions.map((q) => q.key).filter((k): k is string => Boolean(k)));
    return {
      title: `${source.title} — ${opts.label}`.slice(0, 200),
      description: source.description,
      closingMessage: source.closingMessage ?? null,
      targetKind: source.targetKind,
      isAnonymous: source.isAnonymous,
      allowAnonymousResponses: storedAllowAnonymousResponses(source.isAnonymous, source.allowAnonymousResponses),
      // A period keeps the repeating survey's origin (template, ready-made reference).
      createdFromTemplateId: source.createdFromTemplateId ?? null,
      libraryReference: source.libraryReference ?? null,
      libraryRevision: source.libraryReference ? (source.libraryRevision ?? null) : null,
      opensAt: opts.opensAt,
      closesAt: opts.closesAt,
      locationIds: source.locationIds,
      roleIds: source.roleIds,
      // "Send to more" on a period starts from the same chosen people.
      audienceEmployeeIds: source.audienceEmployeeIds,
      audienceServiceUserIds: source.audienceServiceUserIds ?? [],
      clonedFromId: source.id,
      periodKey: opts.periodKey,
      // The section introductions people see, as the repeating survey has them now.
      sectionIntros: sectionIntrosForCopy(source),
      status: SurveyStatus.ACTIVE,
      publishedAt: opts.now,
      distributedAt: opts.now,
      createdById: opts.actorId,
      updatedById: opts.actorId,
      questions: {
        create: questions.map((q) => ({
          questionText: q.questionText,
          helpText: q.helpText,
          questionType: q.questionType,
          options: q.options === null ? Prisma.JsonNull : (q.options as Prisma.InputJsonValue),
          optionsFrom: q.optionsFrom ?? null,
          config: q.config === null ? Prisma.JsonNull : (q.config as Prisma.InputJsonValue),
          isRequired: q.isRequired,
          sortOrder: q.sortOrder,
          sectionTitle: q.sectionTitle,
          isActive: q.isActive,
          sourceQuestionId: q.id,
          ...copiedQuestionLogic(q, periodKeys),
        })),
      },
    };
  }

  /** Tell whoever scheduled the survey that a run did not go out. */
  private async notifySchedulingProblem(survey: Survey, title: string, message: string) {
    const userId = survey.scheduledById ?? survey.createdById;
    if (!userId) return;
    try {
      await this.notifications.notifyUsers({
        recipientUserIds: [userId],
        type: NotificationType.SYSTEM_MESSAGE,
        module: NotificationModule.SYSTEM,
        severity: NotificationSeverity.WARNING,
        title,
        message,
        recordType: 'Survey',
        recordId: survey.id,
        metadata: { href: `/surveys/${survey.id}`, surveyId: survey.id, eventType: 'SURVEY_DISTRIBUTION_FAILED' },
      });
    } catch (err) {
      this.logger.warn(
        `Survey ${survey.id} failure notification not sent: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Cron: send due one-off surveys and due periods of repeating surveys. */
  async runDueDistributions(now: Date = new Date()) {
    // Surveys backing off after repeated unexpected errors wait for their next try.
    const deferred = [...this.retryState.entries()]
      .filter(([, st]) => st.nextAttemptAt > now.getTime())
      .map(([id]) => id);
    const due = await this.prisma.survey.findMany({
      where: {
        deletedAt: null,
        isTemplate: false,
        isCatalogue: false,
        distributedAt: null,
        distributionFailedAt: null,
        distributeAt: { lte: now },
        status: { not: SurveyStatus.CLOSED },
        clonedFromId: null,
        ...(deferred.length ? { id: { notIn: deferred } } : {}),
      },
      orderBy: { distributeAt: 'asc' },
      take: 25,
    });

    const out: Array<{ surveyId: string; ok: boolean; detail: string }> = [];
    for (const survey of due) {
      try {
        if (survey.recurrence) {
          const run = await this.runRecurringPeriod(survey, now);
          if (run.cloneId && run.noPortalIds.length) {
            await this.notifyAddedWithoutPortal(survey, run.cloneId, run.noPortalIds.length);
          }
          out.push({
            surveyId: survey.id,
            ok: true,
            detail: run.alreadySent
              ? `period already sent, next ${run.nextAt.toISOString()}`
              : `period ${run.cloneId} sent to ${run.sent}, next ${run.nextAt.toISOString()}`,
          });
        } else {
          const actorId = survey.scheduledById ?? survey.createdById ?? null;
          if ((await this.questionCount(survey.id)) === 0) {
            throw new SurveyDistributionError('NO_QUESTIONS', 'The survey has no questions.');
          }
          // Its end date passed before it was due to go out: invitations would arrive closed.
          if (survey.closesAt && survey.closesAt.getTime() <= now.getTime()) {
            throw new SurveyDistributionError('ENDED', 'Its end date passed before it was due to go out.');
          }
          // A copy made for each manager whose team has shrunk since it was scheduled.
          const teamProblem = await managerCopyTeamProblemFor(this.prisma, survey.id);
          if (teamProblem) throw new SurveyDistributionError('MANAGER_TEAM_TOO_SMALL', teamProblem);
          const audience: SurveyAudience = {
            locationIds: survey.locationIds,
            roleIds: survey.roleIds,
            employeeIds: survey.audienceEmployeeIds,
            serviceUserIds: survey.audienceServiceUserIds ?? [],
          };
          // The saved branches were chosen within the scheduler's branches.
          const targets = await this.resolveTargets(
            this.prisma,
            survey.targetKind,
            audience,
            survey.locationIds.length ? survey.locationIds : null,
            { withoutPortal: !survey.isAnonymous },
          );
          if (targets.ids.length === 0) {
            throw new SurveyDistributionError('NO_RECIPIENTS', targets.emptyMessage);
          }
          if (survey.isAnonymous && targets.ids.length < MIN_ANONYMOUS_RECIPIENTS) {
            throw new SurveyDistributionError(
              'TOO_FEW_RECIPIENTS',
              tooFewAnonymousMessage(targets.ids.length),
            );
          }
          // The 4-week rule: people surveyed recently are sent it on their free day.
          const ruled = await this.applyContactRule(survey, targets, audience, now);
          if (survey.isAnonymous && ruled.targets.ids.length < MIN_ANONYMOUS_RECIPIENTS) {
            throw new SurveyDistributionError(
              'TOO_FEW_RECIPIENTS',
              `${tooFewAnonymousMessage(ruled.targets.ids.length)} ${ruled.held.length} had another survey in the last 4 weeks.`,
            );
          }
          const result = await this.createRecipients(survey, audience, ruled.targets, actorId, now, {
            clearSchedule: false,
          });
          await this.contactRule?.recordHeld(survey.id, survey.targetKind === SurveyTargetKind.SERVICE_USER ? 'SERVICE_USER' : 'EMPLOYEE', ruled.held);
          this.deliverInBackground(survey, result.created);
          const noPortalIds = createdWithoutPortal(result.created, ruled.targets.noPortalIds);
          await this.audit.logAudit({
            userId: actorId ?? undefined,
            module: AuditModule.SURVEY,
            action: AuditAction.SURVEY_SENT,
            recordType: 'Survey',
            recordId: survey.id,
            newValues: {
              sent: result.created.length,
              skippedExisting: result.skippedExisting,
              addedWithoutPortal: noPortalIds.length,
              heldBack: ruled.held.length,
              notSampled: ruled.sampledOut,
            },
            metadata: { surveyId: survey.id, scheduledDistribution: true },
          });
          await this.notifyAddedWithoutPortal(survey, survey.id, noPortalIds.length);
          out.push({
            surveyId: survey.id,
            ok: true,
            detail: `sent ${result.created.length}, skipped ${result.skippedExisting}`,
          });
        }
        this.retryState.delete(survey.id);
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'Distribution failed';
        if (!(e instanceof SurveyDistributionError)) {
          // Unexpected (e.g. a database blip, or a failure after the send was saved): leave the
          // schedule as it is so a later tick retries. Sends and periods are transactional and
          // idempotent, so a retry never double-sends; marking it failed would wrongly tell the
          // scheduler "not sent" or drop a whole period. Retries back off after a few failures.
          const detail = await this.recordUnexpectedFailure(survey, reason, now);
          this.logger.warn(`Survey ${survey.id} run will be retried: ${reason} — ${detail}`);
          out.push({ surveyId: survey.id, ok: false, detail: `${reason} (will retry ${detail})` });
          continue;
        }
        this.retryState.delete(survey.id);
        out.push({ surveyId: survey.id, ok: false, detail: reason });
        await this.handleDistributionFailure(survey, e, reason, now);
      }
    }
    return out;
  }

  /**
   * Count an unexpected failure: the first few retry on the next tick, then the next try is put
   * off (5 → 10 → 20 → 40 → 60 minutes, at most an hour), and the scheduler is told once.
   */
  private async recordUnexpectedFailure(survey: Survey, reason: string, now: Date): Promise<string> {
    const prev = this.retryState.get(survey.id);
    const failures = (prev?.failures ?? 0) + 1;
    const delay = surveyRetryDelayMs(failures);
    const state = {
      failures,
      nextAttemptAt: now.getTime() + delay,
      notified: prev?.notified ?? false,
    };
    this.retryState.set(survey.id, state);
    if (failures >= SURVEY_RETRY_NOTIFY_AFTER && !state.notified) {
      state.notified = true;
      await this.notifySchedulingProblem(
        survey,
        `Survey send keeps failing — ${survey.title}`,
        `"${survey.title}" could not be sent after ${failures} attempts: ${reason} CareFlow keeps trying, at most once an hour. Nothing is sent twice. If this does not clear, cancel the schedule or contact support.`,
      );
    }
    if (delay === 0) return `next minute (attempt ${failures})`;
    const tz = await this.timeZone();
    return `at ${formatSurveyDateTime(new Date(state.nextAttemptAt), tz)} (attempt ${failures})`;
  }

  /**
   * A run that cannot go out is never retried every minute: with no questions (or a one-off with
   * nobody — or, when anonymous, too few people — to send to) the schedule is marked failed until
   * someone reschedules it; a repeating survey with nobody / too few to send to this period skips
   * to the next period. Either way the person who scheduled it is told.
   */
  private async handleDistributionFailure(survey: Survey, e: unknown, reason: string, now: Date) {
    const tz = await this.timeZone();
    const when = survey.distributeAt ? formatSurveyDateTime(survey.distributeAt, tz) : 'now';
    try {
      const skipPeriod =
        survey.recurrence &&
        survey.distributeAt &&
        !(e instanceof SurveyDistributionError && e.code === 'NO_QUESTIONS');
      if (skipPeriod) {
        const nextAt = nextSurveyDistributeAt(
          survey.recurrenceAnchorAt ?? survey.distributeAt!,
          survey.recurrence!,
          survey.distributeAt!,
          now,
          tz,
        );
        await this.prisma.survey.update({
          where: { id: survey.id },
          data: {
            distributeAt: nextAt,
            distributedAt: null,
            distributionError: `${surveyPeriodLabel(survey.distributeAt!, survey.recurrence!, tz)} not sent: ${reason}`,
          },
        });
        await this.notifySchedulingProblem(
          survey,
          `Survey period not sent — ${survey.title}`,
          `The ${when} run of "${survey.title}" was not sent: ${reason} The next period is due ${formatSurveyDateTime(nextAt, tz)}.`,
        );
        return;
      }
      await this.prisma.survey.update({
        where: { id: survey.id },
        data: { distributionFailedAt: now, distributionError: reason },
      });
      await this.notifySchedulingProblem(
        survey,
        `Scheduled survey not sent — ${survey.title}`,
        `"${survey.title}" was due to go out ${when} but was not sent: ${reason} Fix it and schedule it again.`,
      );
    } catch (err) {
      this.logger.error(
        `Survey ${survey.id} failure could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Cron: close every open survey whose end date (closesAt) has passed — one-off surveys and the
   * periods of repeating surveys (whose "open for N days" has run out). Drafts are left alone (they
   * were never open), and so is a repeating survey's own row: its periods are what people answer,
   * and closing it would stop it repeating (an end date on it is not used). Each is closed once,
   * whatever runs at the same moment: the update only applies while it is still open, and only the
   * run that closed it records the close and tells its creator (and whoever scheduled it).
   * Like Close, any pending scheduled send is cleared. The job then writes waiting answers and keeps
   * the results as CQC evidence (the capture picks them up by their updatedAt, set to now here).
   */
  async closeSurveysPastEndDate(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.survey.findMany({
      where: {
        status: SurveyStatus.ACTIVE,
        deletedAt: null,
        isTemplate: false,
        isCatalogue: false,
        closesAt: { lte: now },
        recurrence: null,
        clones: { none: {} },
      },
      orderBy: { closesAt: 'asc' },
      take: AUTO_CLOSE_BATCH,
    });
    let closed = 0;
    for (const survey of due) {
      const res = await this.prisma.survey.updateMany({
        where: { id: survey.id, status: SurveyStatus.ACTIVE, closesAt: { lte: now } },
        data: {
          status: SurveyStatus.CLOSED,
          distributeAt: null,
          recurrenceAnchorAt: null,
          scheduledById: null,
          updatedById: null,
          updatedAt: now,
        },
      });
      if (res.count !== 1) continue;
      closed += 1;
      // A system close: nobody is the actor (the audit row has no user).
      try {
        await this.audit.logAudit({
          userId: undefined,
          module: AuditModule.SURVEY,
          action: AuditAction.SURVEY_UPDATED,
          recordType: 'Survey',
          recordId: survey.id,
          description: CLOSED_AT_END_DATE_REASON,
          oldValues: { status: survey.status, closesAt: toIso(survey.closesAt) },
          newValues: { status: SurveyStatus.CLOSED },
          metadata: { closed: true, closedAtEndDate: true, reason: CLOSED_AT_END_DATE_REASON },
        });
      } catch (err) {
        this.logger.warn(`Survey ${survey.id}: end-date close not audited: ${err instanceof Error ? err.message : String(err)}`);
      }
      await this.notifyClosedAtEndDate(survey);
    }
    return closed;
  }

  /** "<title> closed at its end date — results are ready", to its creator and whoever scheduled it. */
  private async notifyClosedAtEndDate(survey: Survey) {
    const recipientUserIds = unique([survey.createdById, survey.scheduledById].filter((v): v is string => Boolean(v)));
    if (!recipientUserIds.length) return;
    try {
      await this.notifications.notifyUsers({
        recipientUserIds,
        type: NotificationType.SYSTEM_MESSAGE,
        module: NotificationModule.SYSTEM,
        severity: NotificationSeverity.INFO,
        title: 'Survey closed',
        // The title and the fact only: never names or answers.
        message: `${survey.title} closed at its end date — results are ready`,
        recordType: 'Survey',
        recordId: survey.id,
        metadata: { href: `/surveys/${survey.id}/responses`, surveyId: survey.id, eventType: 'SURVEY_CLOSED_AT_END_DATE' },
      });
    } catch (err) {
      this.logger.warn(
        `Survey ${survey.id} end-date close notification not sent: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Of these surveys, the closed ones whose latest close was the automatic one at their end date
   * (read from the audit trail, where every close is recorded).
   */
  private async closedAtEndDate(surveys: ReadonlyArray<{ id: string; status: SurveyStatus }>): Promise<Set<string>> {
    const ids = surveys.filter((s) => s.status === SurveyStatus.CLOSED).map((s) => s.id);
    const out = new Set<string>();
    if (!ids.length) return out;
    const rows = await this.prisma.auditLog.findMany({
      where: {
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_UPDATED,
        recordType: 'Survey',
        recordId: { in: ids },
        metadata: { path: ['closed'], equals: true },
      },
      orderBy: { createdAt: 'desc' },
      select: { recordId: true, metadata: true },
    });
    const seen = new Set<string>();
    for (const r of rows ?? []) {
      if (!r.recordId || seen.has(r.recordId)) continue;
      seen.add(r.recordId);
      const meta = r.metadata as Record<string, unknown> | null;
      if (meta?.closedAtEndDate === true) out.add(r.recordId);
    }
    return out;
  }

  // ─── Results ──────────────────────────────────────────────────────────────

  /** Status of the survey or one of its periods, by id. */
  private statusLookup(survey: { id: string; status: SurveyStatus }, periods: Array<{ id: string; status: SurveyStatus }>) {
    const byId = new Map<string, SurveyStatus>([[survey.id, survey.status], ...periods.map((p) => [p.id, p.status] as const)]);
    return (id: string) => byId.get(id);
  }

  /**
   * Write the answers waiting in the pending store (survey job, close, CQC capture): due surveys
   * only, or — with `force` — everything waiting for `surveyIds`. Dated the operational day they are
   * written out. See survey-pending-responses.ts.
   */
  async flushPendingResponses(opts: { now?: Date; surveyIds?: string[]; force?: boolean } = {}) {
    const timeZone = await this.timeZone();
    const out = await flushPendingResponses(this.prisma, { ...opts, timeZone });
    // The survey job's run: finished days' counts of answers linked to no one go to the audit log,
    // and the office gets one summary a day for each staff survey (never a notice per answer).
    if (!opts.surveyIds) {
      await auditUnlinkedAnswerDays(this.prisma, this.audit, {
        now: opts.now ?? new Date(),
        timeZone,
        onDay: (day) => this.notifyOfficeOfUnlinkedDay(day),
      }).catch((e: unknown) =>
        this.logger.warn(`Daily counts of answers linked to no one not audited yet (${errorKind(e)})`),
      );
    }
    return out;
  }

  /**
   * An answer linked to no one: no audit row of its own (its time and survey would date it), one
   * more in the survey's count for the day instead (survey-unlinked-answer-days.ts).
   */
  private async countUnlinkedAnswer(surveyId: string, source: UnlinkedAnswerSource) {
    await countUnlinkedAnswerSafely(this.prisma, surveyId, source, { now: new Date(), timeZone: await this.timeZone() });
  }

  /** Period copies of a repeating survey (empty for anything else). */
  private async loadPeriods(survey: Survey) {
    if (survey.clonedFromId) return [];
    return this.prisma.survey.findMany({
      where: { clonedFromId: survey.id, deletedAt: null },
      orderBy: [{ opensAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        periodKey: true,
        opensAt: true,
        closesAt: true,
        status: true,
      },
    });
  }

  /**
   * Results rollup. For a repeating survey the figures cover every period, and answers are
   * matched to the repeating survey's questions through each copy's sourceQuestionId. Answers to
   * a wording (or type) that has since changed, or to a question since removed, are not mixed
   * into the current question and not dropped: they are listed as retired questions labelled
   * "reworded" / "removed", with the periods they were asked in. Each period is listed too, so
   * the page can switch to one period (its own survey id).
   */
  async results(actor: RequestUser, surveyId: string, opts: { respondentGroup?: string } = {}) {
    const survey = await this.requireSurvey(actor, surveyId);
    const access = await surveyAccessFor(this.prisma, actor, survey);
    if (!access.results) throw new ForbiddenException(RESULTS_RESTRICTED);
    return this.gateResults(access, await this.buildResults(survey, access.threshold, opts.respondentGroup?.trim() || null));
  }

  /**
   * What a viewer may see of the results: below the reporting threshold no question figures,
   * headline, breakdowns or answer routes at all (participation counts stay); without access to
   * individual responses, no written answers or the names of who wrote them.
   */
  private gateResults<T extends { data: Record<string, unknown> & { participation: { responsesInFigures: number } } }>(
    access: SurveyAccess,
    out: T,
  ): T & {
    data: T['data'] & {
      reporting: { threshold: number; counted: number; belowThreshold: boolean; note: string | null };
      access: { responses: boolean; results: boolean; configure: boolean };
      writtenAnswersRestrictedNote: string | null;
    };
  } {
    const data = out.data as Record<string, unknown> & { participation: { responsesInFigures: number }; questionSummaries?: unknown[] };
    const counted = data.participation.responsesInFigures;
    const below = access.threshold > 0 && counted < access.threshold;
    const summaries = below
      ? []
      : (data.questionSummaries ?? []).map((q) =>
          access.responses
            ? q
            : {
                ...(q as Record<string, unknown>),
                writtenAnswers: [],
                textSamples: (q as { textSamples?: unknown }).textSamples ? [] : undefined,
                writtenAnswersRestricted: true,
              },
        );
    return {
      ...out,
      data: {
        ...data,
        questionSummaries: summaries,
        ...(below ? { headline: null, breakdowns: [], howPeopleAnswered: [] } : {}),
        reporting: {
          threshold: access.threshold,
          counted,
          belowThreshold: below,
          note: below ? ((data as { respondentGroupNote?: string | null }).respondentGroupNote ?? thresholdNote(access.threshold, counted)) : null,
        },
        access: { responses: access.responses, results: access.results, configure: access.configure },
        writtenAnswersRestrictedNote: access.responses ? null : RESPONSES_RESTRICTED,
      },
    } as never;
  }

  /**
   * The results. `threshold` is the survey's reporting threshold: in "All periods", a period with
   * fewer answers than it is left out of every figure (subtracting one view from another would
   * otherwise show it), and CareFlow-list (equality) questions show a detailed entry only when at
   * least max(threshold, EQUALITY_DETAIL_THRESHOLD) chose it.
   */
  private async buildResults(survey: Survey, threshold = 0, respondentGroup: string | null = null) {
    const periods = await this.loadPeriods(survey);
    const isSeries = periods.length > 0;
    const surveyIds = [survey.id, ...periods.map((p) => p.id)];

    const [recipientGroups, responseGroups, pendingGroups, ownQuestions, allAnswers] = await Promise.all([
      this.prisma.surveyRecipient.groupBy({
        by: ['surveyId', 'status'],
        where: { surveyId: { in: surveyIds } },
        _count: { _all: true },
      }),
      // By how they were given, too: answers given without a name are counted (and their written
      // answers held back) separately.
      this.prisma.surveyResponse.groupBy({
        by: ['surveyId', 'isAnonymous', 'channel'],
        where: { surveyId: { in: surveyIds } },
        _count: { _all: true },
      }),
      // Answers not linked to anyone still waiting to be written: counted, never shown.
      pendingResponseGroups(this.prisma, surveyIds),
      // Removed questions too: a repeating survey's periods may hold answers to them. CareFlow-list
      // options include retired entries (answers given before an entry was retired still count).
      this.prisma.surveyQuestion
        .findMany({
          where: isSeries ? { surveyId: survey.id } : { surveyId: survey.id, deletedAt: null },
          orderBy: QUESTION_ORDER,
        })
        .then((qs) => withLookupOptions(this.prisma, qs, { includeRetired: true })),
      this.prisma.surveyAnswer.findMany({
        where: { response: { surveyId: { in: surveyIds } } },
        select: {
          lookupCodes: true,
          booleanValue: true,
          textValue: true,
          numberValue: true,
          selectedOptions: true,
          otherText: true,
          comment: true,
          // Who wrote a written answer (named surveys only; anonymous answers have no recipient).
          response: {
            select: {
              id: true,
              isAnonymous: true,
              channel: true,
              // Which questions were on their form (only ever counted, never shown).
              submittedAt: true,
              recipient: { select: { employeeId: true, serviceUserId: true } },
            },
          },

          question: {
            select: {
              id: true,
              surveyId: true,
              sourceQuestionId: true,
              questionType: true,
              questionText: true,
              options: true,
              otherOption: true,
              config: true,
              sortOrder: true,
            },
          },
        },
        // Newest first. Anonymous answers keep only their day, so within a day the order is by
        // the (random) id — never the order they were saved in, which could match them to people.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    ]);
    const tally = this.responseTally([...responseGroups, ...(pendingGroups ?? [])]);
    const waiting = this.responseTally(pendingGroups ?? []);
    const statusOf = this.statusLookup(survey, periods);
    // Named survey: answers given without a name are left out altogether until the survey / period
    // has closed and at least MIN_WITHOUT_NAME_ANSWERS people answered it that way — see the util.
    const heldIds = new Set(
      surveyIds.filter((id) =>
        withoutNameAnswersHeldBack(survey.isAnonymous, tally.withoutName.get(id) ?? 0, statusOf(id) === SurveyStatus.CLOSED),
      ),
    );
    const withoutNameHeld = [...heldIds].reduce((sum, id) => sum + (tally.withoutName.get(id) ?? 0), 0);
    // Waiting responses not already explained by the note above.
    const responsesWaiting = surveyIds.reduce(
      (sum, id) => sum + (waiting.all.get(id) ?? 0) - (heldIds.has(id) ? (waiting.withoutName.get(id) ?? 0) : 0),
      0,
    );
    const answers = heldIds.size
      ? allAnswers.filter(
          (a) => !(a.response && heldIds.has(a.question.surveyId) && isAnsweredWithoutName(a.response)),
        )
      : allAnswers;
    const writers = await this.writtenAnswerWriters(survey, answers);
    const visibility = writtenAnswerVisibility(survey, periods, tally.all);
    // Named survey: written answers from people who answered without their name follow the
    // anonymous rule (closed, with enough of them), even though everyone else's are shown.
    const withoutNameVisibility = survey.isAnonymous
      ? null
      : withoutNameWrittenVisibility(survey, periods, tally.withoutName);
    const writtenVisible = (a: (typeof answers)[number]) =>
      (visibility.all || visibility.surveyIds.has(a.question.surveyId)) &&
      (!withoutNameVisibility ||
        !a.response ||
        !isAnsweredWithoutName(a.response) ||
        withoutNameVisibility.all ||
        withoutNameVisibility.surveyIds.has(a.question.surveyId));

    const count = (id: string, status?: string) =>
      recipientGroups
        .filter((g) => g.surveyId === id && (!status || g.status === status))
        .reduce((sum, g) => sum + g._count._all, 0);
    const responsesFor = (id: string) => tally.all.get(id) ?? 0;
    const unnamedFor = (id: string) => tally.unnamed.get(id) ?? 0;

    const recipients = surveyIds.reduce((sum, id) => sum + count(id), 0);
    const completed = surveyIds.reduce((sum, id) => sum + count(id, 'COMPLETED'), 0);
    const responses = surveyIds.reduce((sum, id) => sum + responsesFor(id), 0);
    // Named surveys: answers not linked to anyone — given online without a name, or recorded by
    // staff without one (a paper form with the number crossed out, a phone call). null when anonymous.
    const answeredWithoutName = survey.isAnonymous
      ? null
      : surveyIds.reduce((sum, id) => sum + unnamedFor(id), 0);

    // All periods together: a period with answers but fewer than the threshold is left out, or its
    // figures could be worked out by taking the other periods away from the total.
    const writtenSoFar = this.responseTally(responseGroups);
    const leftOut = new Set(
      isSeries && threshold > 0
        ? periods
            .filter((p) => {
              const n = writtenSoFar.all.get(p.id) ?? 0;
              return n > 0 && n < threshold;
            })
            .map((p) => p.id)
        : [],
    );
    const includedIds = surveyIds.filter((id) => !leftOut.has(id));
    const includedPeriods = periods.filter((p) => !leftOut.has(p.id));
    const answersInPeriods = leftOut.size ? answers.filter((a) => !leftOut.has(a.question.surveyId)) : answers;
    // Several groups: each response's answer to the standard "Who are you?" question. Results can be
    // shown for one group (the reporting threshold then applies to that group's answers alone).
    const whoIds = new Set(ownQuestions.filter((q) => q.key === WHO_ARE_YOU_KEY).map((q) => q.id));
    const groupOf = new Map<string, string[]>();
    for (const a of answersInPeriods) {
      if (!a.response || !(whoIds.has(a.question.id) || (a.question.sourceQuestionId && whoIds.has(a.question.sourceQuestionId)))) continue;
      const labels = Array.isArray(a.selectedOptions) ? a.selectedOptions.filter((v): v is string => typeof v === 'string') : [];
      groupOf.set(a.response.id, labels);
    }
    // "Prefer not to say" is counted in the overall figures only: never listed or shown as a group.
    const groupCounts = [...groupOf.values()].flat().reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
    const respondentGroups = whoIds.size
      ? [...groupCounts]
          .filter(([label]) => label !== WHO_ARE_YOU_PREFER_NOT)
          .map(
            // A group with fewer answers than the threshold shows no count (it is still listed).
            ([label, responses]) => ({ label, responses: threshold > 0 && responses < threshold ? null : responses }),
          )
      : [];
    // One group's figures beside the overall figures give the other groups' by subtraction. So while
    // any group with answers is under the threshold, no single group's figures are shown at all. The
    // people who preferred not to say are such a group too (overall minus every group shows them).
    const smallGroupExists = threshold > 0 && [...groupCounts.values()].some((n) => n > 0 && n < threshold);
    const respondentGroupBlocked =
      Boolean(respondentGroup) && (smallGroupExists || respondentGroup === WHO_ARE_YOU_PREFER_NOT);
    const answersIn = respondentGroup
      ? respondentGroupBlocked
        ? []
        : answersInPeriods.filter((a) => a.response && (groupOf.get(a.response.id) ?? []).includes(respondentGroup))
      : answersInPeriods;

    const questions = ownQuestions.filter((q) => !q.deletedAt);
    const questionIds = new Set(questions.map((q) => q.id));
    // Anonymous surveys: written answers could identify someone, so they are shown only once the
    // survey (or a period) has closed with enough answers in it (and never who wrote them).
    const builtSummaries = isSeries
      ? this.seriesQuestionSummaries(ownQuestions, answersIn, includedPeriods, writers, writtenVisible)
      : this.buildQuestionSummaries(
          questions,
          answersIn.filter((a) => questionIds.has(a.question.id)),
          (a) => a.question.id,
          writers,
          writtenVisible,
        ).map((s) => ({ ...s, status: 'current' as const, currentQuestionText: null, askedIn: [] }));
    // CareFlow-list (equality) questions: by group heading, with detailed entries only where enough
    // people chose them; never written answers or who chose what.
    const detailThreshold = Math.max(EQUALITY_DETAIL_THRESHOLD, threshold);
    const questionSummaries = builtSummaries.map((sum) => {
      const q = ownQuestions.find((x) => x.id === sum.questionId);
      if (!q?.lookupEntries) return sum;
      const own = answersIn.filter((a) => a.question.id === q.id || a.question.sourceQuestionId === q.id);
      const l = lookupSummary(q.lookupEntries, own, detailThreshold);
      // Answers that can be given without a name: a group chosen by fewer than detailThreshold people
      // is folded into one "Other groups" figure, as a single rare group would point at someone.
      const unlinkedPossible = survey.isAnonymous || offersAnswerWithoutName(survey);
      const shownGroups = unlinkedPossible ? l.groups.filter((g) => g.count >= detailThreshold) : l.groups;
      const foldedGroups = unlinkedPossible ? l.groups.filter((g) => g.count < detailThreshold) : [];
      const folded = foldedGroups.reduce((n, g) => n + g.count, 0);
      const groupOptions = [
        ...shownGroups.map((g) => ({ label: g.label, count: g.count, percent: g.percent, notCounted: false })),
        ...(folded > 0
          ? [{
              label: `Other groups (fewer than ${detailThreshold} each)`,
              count: folded,
              percent: l.answered ? Math.round((folded / l.answered) * 100) : 0,
              notCounted: false,
            }]
          : []),
      ];
      return {
        ...sum,
        optionsFrom: q.optionsFrom,
        options: groupOptions,
        countedAnswers: l.answered,
        lookupDetails: l.details,
        lookupDetailsNote:
          l.detailsHidden > 0
            ? `Answers are shown by group. A detailed answer is shown only when at least ${detailThreshold} people chose it, so nobody can be identified.`
            : null,
        topTwo: null,
        writtenAnswers: [],
      };
    });

    // Responses whose answers are in the figures: written out (not waiting in the pending store) and
    // not held back. Each question's "not asked or skipped" and the completeness totals use these.
    const written = this.responseTally(responseGroups);
    const responsesInFigures = respondentGroup
      ? respondentGroupBlocked
        ? 0
        : [...groupOf.values()].filter((labels) => labels.includes(respondentGroup)).length
      : includedIds.reduce(
          (sum, id) => sum + (written.all.get(id) ?? 0) - (heldIds.has(id) ? (written.withoutName.get(id) ?? 0) : 0),
          0,
        );
    const completeness = await this.completenessOf(survey, periods, questions, answers, responsesInFigures);

    // Headline: the overall-experience question's "Very good or Good" share.
    const overall = findOverallQuestion(questions);
    const overallSummary = overall
      ? questionSummaries.find((s) => s.status === 'current' && s.questionId === overall.id)
      : undefined;
    const headline =
      overallSummary?.topTwo && overallSummary.topTwo.base > 0
        ? { questionId: overallSummary.questionId, questionText: overallSummary.questionText, ...overallSummary.topTwo }
        : null;

    const isPublic = survey.targetKind === SurveyTargetKind.PUBLIC;
    const recipientCounts = recipientStatusCounts(recipientGroups, { anonymous: survey.isAnonymous });
    const allGroups = [...responseGroups, ...(pendingGroups ?? [])];
    const byChannel = (staff: boolean) =>
      allGroups
        .filter((g) => isStaffRecordedChannel(g.channel) === staff)
        .reduce((sum, g) => sum + g._count._all, 0);

    return {
      message: 'Survey results',
      data: {
        isAnonymous: survey.isAnonymous,
        recipients,
        completed,
        responses,
        responseRate: recipients > 0 ? Math.round((completed / recipients) * 100) : 0,
        /**
         * Who took part, as totals only. Public surveys have no list of people, so no "sent to",
         * rate or "not opened"; instead how many answered through the link and how many staff
         * recorded. Completeness counts only the questions that applied to each person (see
         * survey-completeness.util) over the responses in the figures (`responsesInFigures`).
         */
        participation: {
          sentTo: isPublic ? null : recipientCounts.total,
          answered: responses,
          answeredFromSent: isPublic ? null : recipientCounts.completed,
          responseRate: isPublic ? null : recipients > 0 ? Math.round((completed / recipients) * 100) : 0,
          openedNotFinished: isPublic ? null : recipientCounts.opened,
          notOpened: isPublic ? null : recipientCounts.notStarted,
          answeredThroughLink: isPublic ? byChannel(false) : null,
          /**
           * Staff and service-user surveys: how many answered through the shared link (written and
           * waiting). A count only: these answers are never marked as such anywhere else.
           */
          answeredThroughSharedLink: isPublic
            ? null
            : (await this.prisma.surveyResponse.count({ where: { surveyId: { in: surveyIds }, viaSharedLink: true } })) +
              (await pendingSharedLinkCount(this.prisma, surveyIds)),
          recordedByStaff: isPublic ? byChannel(true) : null,
          answeredEveryQuestion: completeness.answeredEveryQuestion,
          skippedSomeQuestions: completeness.skippedSomeQuestions,
          responsesInFigures,
        },
        /**
         * Shared links: days with unusually many answers through them (possible ballot-stuffing),
         * from counts by day only. Null when nothing looks unusual.
         */
        sharedLinkCaution: await this.sharedLinkCaution(surveyIds),
        /** "N% said Very good or Good" for the overall-experience question; null without one (or answers). */
        headline,
        /** By channel and (service-user surveys) who answered; same protection as the breakdowns. */
        // One group's results: no further breakdown (it would cross one group with another).
        howPeopleAnswered: respondentGroup
          ? []
          : await this.buildAnswerRoutes(survey, includedIds, includedPeriods, allGroups.filter((g) => !leftOut.has(g.surveyId))),
        /** Who it's for, and (Several groups) how many answered as each group and the group shown. */
        audienceGroupLabel: audienceGroupLabel(survey.targetKind, survey.audienceGroup, survey.audienceGroupOther),
        respondentGroups,
        respondentGroup,
        /** One group's figures are withheld while another group is under the threshold (subtraction). */
        respondentGroupNote: respondentGroupBlocked
          ? respondentGroup === WHO_ARE_YOU_PREFER_NOT
            ? 'People who preferred not to say who they are are counted in the overall results only.'
            : `Results for one group show only once every group has at least ${threshold} answers, so no group's answers can be worked out from the totals.`
          : null,
        /** All periods: periods with too few answers to show, left out of every figure. */
        periodsLeftOut: leftOut.size,
        periodsLeftOutNote:
          leftOut.size > 0
            ? `${leftOut.size} ${leftOut.size === 1 ? 'period has' : 'periods have'} too few answers to show and ${leftOut.size === 1 ? 'is' : 'are'} not included in these figures.`
            : null,
        /** Named surveys: how many answered without their name, and their share of all responses. */
        answeredWithoutName,
        answeredWithoutNamePercent:
          answeredWithoutName === null ? null : withoutNameShare(answeredWithoutName, responses),
        /** Named survey that lets people choose to answer without their name. */
        allowAnonymousResponses: offersAnswerWithoutName(survey),
        /** Answers given without a name not yet in the question summaries (too few to protect them). */
        withoutNameAnswersHeldBack: withoutNameHeld,
        withoutNameAnswersNote: withoutNameHeldBackNote(withoutNameHeld),
        /** Responses counted above whose answers are not in the question figures yet (being added). */
        responsesBeingAdded: responsesWaiting,
        responsesBeingAddedNote: responsesBeingAddedNote(responsesWaiting),
        includesPeriodRuns: isSeries,
        periods: periods.map((p) => ({
          id: p.id,
          title: p.title,
          periodKey: p.periodKey,
          opensAt: toIso(p.opensAt),
          closesAt: toIso(p.closesAt),
          status: p.status,
          recipients: count(p.id),
          completed: count(p.id, 'COMPLETED'),
          responses: responsesFor(p.id),
          answeredWithoutName: survey.isAnonymous ? null : unnamedFor(p.id),
        })),
        questionSummaries,
        /** Why some written answers are not shown (anonymous survey, or answers given without a name); null when all are. */
        writtenAnswersNote: questionSummaries.some((s) => s.writtenAnswersWithheld)
          ? (survey.isAnonymous ? visibility.note : (withoutNameVisibility?.note ?? null))
          : null,
        breakdowns: respondentGroup ? [] : await this.buildBreakdowns(survey, includedIds, includedPeriods, answeredWithoutName ?? 0),
      },
    };
  }

  /**
   * "All periods" summaries for a repeating survey. An answer counts towards the current question
   * only when its period asked that question with the same wording and type; anything else is a
   * retired question — "reworded" (the question is still on the survey, worded or typed
   * differently now) or "removed" — summarised separately with the periods it was asked in.
   */
  private seriesQuestionSummaries<
    A extends {
      booleanValue: boolean | null;
      textValue: string | null;
      numberValue: Prisma.Decimal | null;
      selectedOptions: Prisma.JsonValue;
      question: {
        id: string;
        surveyId: string;
        sourceQuestionId: string | null;
        questionType: SurveyQuestionType;
        questionText: string;
        options: Prisma.JsonValue;
        otherOption?: Prisma.JsonValue;
        config?: Prisma.JsonValue;
        sortOrder: number;
      };
      otherText?: string | null;
      comment?: string | null;
      response?: { id: string } | null;
    },
  >(
    sourceQuestions: Array<{
      id: string;
      questionText: string;
      questionType: SurveyQuestionType;
      sortOrder: number;
      options: Prisma.JsonValue;
      otherOption?: Prisma.JsonValue;
      config?: Prisma.JsonValue;
      sectionTitle?: string | null;
      deletedAt: Date | null;
    }>,
    answers: A[],
    periods: Array<{ id: string; title: string; periodKey: string | null; opensAt: Date | null }>,
    writers: ReadonlyMap<string, string> = new Map(),
    writtenVisible: (a: A) => boolean = () => true,
  ) {
    const sourceById = new Map(sourceQuestions.map((q) => [q.id, q]));
    const current = sourceQuestions.filter((q) => !q.deletedAt);
    const periodById = new Map(periods.map((p) => [p.id, p]));

    const currentAnswers: A[] = [];
    /** Current answers → the repeating survey's question they count towards. */
    const currentKey = new Map<A, string>();
    type Retired = {
      key: string;
      status: 'reworded' | 'removed';
      source: (typeof sourceQuestions)[number] | null;
      /** The newest period copy of this wording: its id, text, type and options are shown. */
      latest: A['question'];
      latestAt: number;
      answers: A[];
      periodIds: Set<string>;
    };
    const retired = new Map<string, Retired>();
    const periodTime = (surveyId: string) => periodById.get(surveyId)?.opensAt?.getTime() ?? 0;

    for (const a of answers) {
      // A period copy's question links to its source; an answer on the repeating survey itself
      // (from before it repeated) is to the source question directly.
      const src =
        sourceById.get(a.question.id) ??
        (a.question.sourceQuestionId ? sourceById.get(a.question.sourceQuestionId) : undefined);
      if (
        src &&
        !src.deletedAt &&
        src.questionType === a.question.questionType &&
        src.questionText === a.question.questionText
      ) {
        currentAnswers.push(a);
        currentKey.set(a, src.id);
        continue;
      }
      const key = `${src?.id ?? 'none'}|${a.question.questionType}|${a.question.questionText}`;
      let group = retired.get(key);
      if (!group) {
        group = {
          key,
          status: src && !src.deletedAt ? 'reworded' : 'removed',
          source: src ?? null,
          latest: a.question,
          latestAt: periodTime(a.question.surveyId),
          answers: [],
          periodIds: new Set(),
        };
        retired.set(key, group);
      }
      group.answers.push(a);
      group.periodIds.add(a.question.surveyId);
      const at = periodTime(a.question.surveyId);
      if (at > group.latestAt) {
        group.latest = a.question;
        group.latestAt = at;
      }
    }

    const currentSummaries = this.buildQuestionSummaries(
      current,
      currentAnswers,
      (a) => currentKey.get(a) as string,
      writers,
      writtenVisible,
    ).map((s) => ({
      ...s,
      status: 'current' as const,
      currentQuestionText: null,
      askedIn: [] as Array<{ id: string; title: string; periodKey: string | null }>,
    }));

    const retiredSummaries = [...retired.values()].map((g) => {
      const [summary] = this.buildQuestionSummaries(
        [
          {
            id: g.key,
            questionText: g.latest.questionText,
            questionType: g.latest.questionType,
            sortOrder: g.source?.sortOrder ?? g.latest.sortOrder,
            options: g.latest.options,
            otherOption: g.latest.otherOption ?? null,
            config: g.latest.config ?? null,
            sectionTitle: g.source?.sectionTitle ?? null,
          },
        ],
        g.answers,
        () => g.key,
        writers,
        writtenVisible,
      );
      const askedIn = periods
        .filter((p) => g.periodIds.has(p.id))
        .sort((x, y) => (x.opensAt?.getTime() ?? 0) - (y.opensAt?.getTime() ?? 0))
        .map((p) => ({ id: p.id, title: p.title, periodKey: p.periodKey }));
      return {
        group: g,
        summary: {
          ...summary!,
          questionId: g.latest.id,
          status: g.status,
          currentQuestionText: g.status === 'reworded' ? (g.source?.questionText ?? null) : null,
          askedIn,
        },
      };
    });

    // Reworded entries follow the question they became; removed ones come last.
    const out: Array<
      (typeof currentSummaries)[number] | (typeof retiredSummaries)[number]['summary']
    > = [];
    for (const s of currentSummaries) {
      out.push(s);
      out.push(
        ...retiredSummaries
          .filter((r) => r.group.status === 'reworded' && r.group.source?.id === s.questionId)
          .map((r) => r.summary),
      );
    }
    out.push(
      ...retiredSummaries
        .filter((r) => r.group.status === 'removed')
        .sort(
          (x, y) =>
            x.summary.sortOrder - y.summary.sortOrder ||
            x.summary.questionText.localeCompare(y.summary.questionText),
        )
        .map((r) => r.summary),
    );
    return out;
  }

  /**
   * Responses by branch (and job title for named staff surveys). Anonymous surveys: branch only
   * (job titles are not kept on anonymous answers), with minimum group sizes, and only once the
   * survey — or, for a repeating survey, a period — has closed: while answers are still arriving,
   * watching a branch count tick up would show who just answered.
   */
  private async buildBreakdowns(
    survey: Survey,
    surveyIds: string[],
    periods: Array<{ id: string; status: SurveyStatus }> = [],
    /** Named survey: answers not linked to anyone, left out of the groups (no branch is kept on them). */
    withoutName = 0,
  ): Promise<SurveyBreakdown[]> {
    if (survey.targetKind === SurveyTargetKind.PUBLIC) return [];
    const scope = this.breakdownScope(survey, surveyIds, periods);
    if (scope.notYet) return [{ dimension: 'branch', groups: [], suppressed: true, note: scope.notYet }];
    const { ids, closedNote } = scope;
    const withJobTitle = survey.targetKind === SurveyTargetKind.EMPLOYEE && !survey.isAnonymous;
    // Named survey: answers given without a name are not linked to a branch, so they are left out
    // of the groups (never shown as "No branch recorded").
    const where: Prisma.SurveyResponseWhereInput = survey.isAnonymous
      ? { surveyId: { in: ids } }
      : { surveyId: { in: ids }, isAnonymous: false };
    const [byLocation, byJobTitle] = await Promise.all([
      this.prisma.surveyResponse.groupBy({
        by: ['locationId'],
        where,
        _count: { _all: true },
      }),
      withJobTitle
        ? this.prisma.surveyResponse.groupBy({
            by: ['jobTitleId'],
            where,
            _count: { _all: true },
          })
        : Promise.resolve([] as Array<{ jobTitleId: string | null; _count: { _all: number } }>),
    ]);
    const locationIds = byLocation.map((g) => g.locationId).filter((v): v is string => Boolean(v));
    const jobTitleIds = byJobTitle.map((g) => g.jobTitleId).filter((v): v is string => Boolean(v));
    const [locations, jobTitles] = await Promise.all([
      locationIds.length
        ? this.prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      jobTitleIds.length
        ? this.prisma.jobTitle.findMany({ where: { id: { in: jobTitleIds } }, select: { id: true, name: true } })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
    ]);
    const locationName = new Map(locations.map((l) => [l.id, l.name]));
    const jobTitleName = new Map(jobTitles.map((j) => [j.id, j.name]));

    const branch = buildSurveyBreakdown(
      'branch',
      byLocation.map((g) => ({
        key: g.locationId ?? UNKNOWN_GROUP_KEY,
        label: g.locationId ? (locationName.get(g.locationId) ?? 'Branch') : 'No branch recorded',
        responses: g._count._all,
      })),
      survey.isAnonymous,
    );
    if (closedNote && !branch.suppressed) {
      branch.note = branch.note ? `${closedNote} ${branch.note}` : closedNote;
    }
    const withoutNameNote =
      !survey.isAnonymous && withoutName > 0
        ? `${withoutName} ${withoutName === 1 ? 'response was' : 'responses were'} given without a name and ${withoutName === 1 ? 'is' : 'are'} not counted by group.`
        : null;
    if (withoutNameNote) branch.note = branch.note ? `${branch.note} ${withoutNameNote}` : withoutNameNote;
    const out: SurveyBreakdown[] = [branch];
    if (withJobTitle) {
      out.push(
        buildSurveyBreakdown(
          'jobTitle',
          byJobTitle.map((g) => ({
            key: g.jobTitleId ?? UNKNOWN_GROUP_KEY,
            label: g.jobTitleId ? (jobTitleName.get(g.jobTitleId) ?? 'Job title') : 'No job title recorded',
            responses: g._count._all,
          })),
          false,
        ),
      );
      if (withoutNameNote) {
        const jobTitle = out[out.length - 1]!;
        jobTitle.note = jobTitle.note ? `${jobTitle.note} ${withoutNameNote}` : withoutNameNote;
      }
    }
    return out;
  }

  /**
   * Which surveys (or periods) group figures may cover. Named surveys: all of them. Anonymous
   * surveys: closed ones only — while answers are still arriving, watching a group's count tick up
   * would show who just answered. `notYet` is the note to show when nothing has closed.
   */
  private breakdownScope(
    survey: { id: string; isAnonymous: boolean; status: SurveyStatus },
    surveyIds: string[],
    periods: Array<{ id: string; status: SurveyStatus }>,
  ): { ids: string[]; closedNote: string | null; notYet: string | null } {
    if (!survey.isAnonymous) return { ids: surveyIds, closedNote: null, notYet: null };
    const isSeries = periods.length > 0;
    const ids = isSeries
      ? periods.filter((p) => p.status === SurveyStatus.CLOSED).map((p) => p.id)
      : survey.status === SurveyStatus.CLOSED
        ? [survey.id]
        : [];
    if (ids.length === 0) {
      return {
        ids,
        closedNote: null,
        notYet: isSeries
          ? 'Shown once a period has closed, so answers still coming in cannot be matched to people.'
          : 'Shown once the survey is closed, so answers still coming in cannot be matched to people.',
      };
    }
    return { ids, closedNote: isSeries && ids.length < periods.length ? 'Closed periods only.' : null, notYet: null };
  }

  /**
   * "How people answered": by channel, and on service-user surveys who answered. The same protection
   * as the branch breakdown: anonymous surveys count closed surveys (or periods) only, through the
   * minimum group size (fewer than 5 → combined or withheld). Named surveys: answers given online
   * without a name are one group of their own, never split by channel (their number is already
   * shown); for who answered they are "Not recorded" (who answered is never kept for them).
   */
  private async buildAnswerRoutes(
    survey: Survey,
    surveyIds: string[],
    periods: Array<{ id: string; status: SurveyStatus }>,
    /** Responses per survey, by how they were given — written and still waiting (counts only). */
    groups: ReadonlyArray<{
      surveyId: string;
      isAnonymous: boolean;
      channel: SurveyResponseChannel;
      _count: { _all: number };
    }>,
  ): Promise<SurveyBreakdown[]> {
    const scope = this.breakdownScope(survey, surveyIds, periods);
    const forServiceUsers = survey.targetKind === SurveyTargetKind.SERVICE_USER;
    if (scope.notYet) {
      const withheld = (dimension: SurveyBreakdown['dimension']): SurveyBreakdown => ({
        dimension,
        groups: [],
        suppressed: true,
        note: scope.notYet,
      });
      return forServiceUsers ? [withheld('channel'), withheld('respondent')] : [withheld('channel')];
    }
    const inScope = new Set(scope.ids);
    const withClosedNote = (b: SurveyBreakdown) => {
      if (scope.closedNote && !b.suppressed) b.note = b.note ? `${scope.closedNote} ${b.note}` : scope.closedNote;
      return b;
    };
    type Tally = Map<string, { label: string; responses: number }>;
    const add = (map: Tally, key: string, label: string, n: number) => {
      const g = map.get(key) ?? { label, responses: 0 };
      g.responses += n;
      map.set(key, g);
    };
    const asGroups = (map: Tally) =>
      [...map.entries()].map(([key, g]) => ({ key, label: g.label, responses: g.responses }));

    const channelLabel = (channel: SurveyResponseChannel) =>
      channel === SurveyResponseChannel.ONLINE && survey.targetKind === SurveyTargetKind.EMPLOYEE
        ? 'Survey link or carer app'
        : CHANNEL_GROUP_LABELS[channel];
    const byChannel: Tally = new Map();
    for (const g of groups) {
      if (!inScope.has(g.surveyId)) continue;
      if (!survey.isAnonymous && isAnsweredWithoutName(g)) {
        add(
          byChannel,
          WITHOUT_NAME_GROUP_KEY,
          forServiceUsers ? 'Portal or survey link, without a name' : 'Online, without a name',
          g._count._all,
        );
      } else {
        add(byChannel, g.channel, channelLabel(g.channel), g._count._all);
      }
    }
    const out: SurveyBreakdown[] = [
      withClosedNote(buildSurveyBreakdown('channel', asGroups(byChannel), survey.isAnonymous)),
    ];
    if (!forServiceUsers) return out;

    // Who answered is kept on written responses only; on a named survey everything still waiting is
    // linked to no one, so "Not recorded".
    const byRelation = await this.prisma.surveyResponse.groupBy({
      by: ['respondentRelation', 'surveyId', 'isAnonymous'],
      where: { surveyId: { in: scope.ids } },
      _count: { _all: true },
    });
    const byRespondent: Tally = new Map();
    for (const g of byRelation ?? []) {
      const relation = g.isAnonymous && !survey.isAnonymous ? null : g.respondentRelation;
      if (relation) add(byRespondent, relation, RESPONDENT_GROUP_LABELS[relation], g._count._all);
      else add(byRespondent, UNKNOWN_GROUP_KEY, NOT_RECORDED_LABEL, g._count._all);
    }
    if (!survey.isAnonymous) {
      const waiting = await pendingResponseCount(this.prisma, scope.ids);
      if (waiting > 0) add(byRespondent, UNKNOWN_GROUP_KEY, NOT_RECORDED_LABEL, waiting);
    }
    out.push(withClosedNote(buildSurveyBreakdown('respondent', asGroups(byRespondent), survey.isAnonymous)));
    return out;
  }

  /**
   * "Answered every question" / "Skipped some optional questions" over the responses whose answers
   * are in the figures (answers held back are already left out of `answers`). Totals only.
   */
  private async completenessOf(
    survey: Survey,
    periods: Array<{ id: string }>,
    /** The survey's own current questions. */
    questions: Array<{
      id: string;
      surveyId: string;
      key: string | null;
      questionText: string;
      questionType: SurveyQuestionType;
      options: Prisma.JsonValue;
      showIf: Prisma.JsonValue;
      isActive: boolean;
      createdAt: Date;
    }>,
    answers: Array<{
      booleanValue: boolean | null;
      numberValue: Prisma.Decimal | null;
      selectedOptions: Prisma.JsonValue;
      question: { id: string; surveyId: string };
      response?: { id: string; isAnonymous: boolean; submittedAt?: Date | null } | null;
    }>,
    responsesInFigures: number,
  ) {
    // Each period is its own copy of the questions.
    const periodQuestions = periods.length
      ? await this.prisma.surveyQuestion.findMany({
          where: { surveyId: { in: periods.map((p) => p.id) }, deletedAt: null, isActive: true },
          select: {
            id: true,
            surveyId: true,
            key: true,
            questionText: true,
            questionType: true,
            options: true,
            showIf: true,
            isActive: true,
            createdAt: true,
          },
        })
      : [];
    const questionsBySurvey = new Map<string, CompletenessQuestion[]>();
    for (const q of [...questions.filter((q) => q.isActive), ...(periodQuestions ?? [])]) {
      const list = questionsBySurvey.get(q.surveyId) ?? [];
      list.push(q);
      questionsBySurvey.set(q.surveyId, list);
    }
    const byResponse = new Map<
      string,
      { surveyId: string; unlinked: boolean; submittedAt: Date | null; answers: CompletenessAnswer[] }
    >();
    for (const a of answers) {
      if (!a.response) continue;
      let r = byResponse.get(a.response.id);
      if (!r) {
        r = {
          surveyId: a.question.surveyId,
          unlinked: survey.isAnonymous || a.response.isAnonymous,
          submittedAt: a.response.submittedAt ?? null,
          answers: [],
        };
        byResponse.set(a.response.id, r);
      }
      r.answers.push({
        questionId: a.question.id,
        booleanValue: a.booleanValue,
        numberValue: a.numberValue == null ? null : Number(a.numberValue),
        selectedOptions: a.selectedOptions,
      });
    }
    return completenessTotals(
      [...byResponse.values()].map((r) => ({
        questions: questionsBySurvey.get(r.surveyId) ?? [],
        answers: r.answers,
        unlinked: r.unlinked,
        submittedAt: r.submittedAt,
        // Answers linked to no one keep only their day.
        dateOnly: r.unlinked,
      })),
      responsesInFigures - byResponse.size,
    );
  }

  /**
   * Responses per survey (all), not linked to anyone on a named survey (unnamed: given without a
   * name online or recorded by staff without one) and given online without a name (withoutName).
   */
  private responseTally(
    groups: Array<{ surveyId: string; isAnonymous?: boolean; channel?: SurveyResponseChannel; _count: { _all: number } }>,
  ) {
    const all = new Map<string, number>();
    const unnamed = new Map<string, number>();
    const withoutName = new Map<string, number>();
    const add = (map: Map<string, number>, id: string, n: number) => map.set(id, (map.get(id) ?? 0) + n);
    for (const g of groups) {
      add(all, g.surveyId, g._count._all);
      if (g.isAnonymous) add(unnamed, g.surveyId, g._count._all);
      if (g.isAnonymous && g.channel && isAnsweredWithoutName({ isAnonymous: true, channel: g.channel })) {
        add(withoutName, g.surveyId, g._count._all);
      }
    }
    return { all, unnamed, withoutName };
  }

  private async loadUserNameMap(userIds: string[]): Promise<Map<string, string>> {
    const ids = unique(userIds.filter(Boolean));
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    for (const u of users) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
      map.set(u.id, name || u.email || 'User');
    }
    return map;
  }

  /**
   * Named surveys: response id → the name of whoever wrote a written answer (Other text or a
   * comment). Empty for anonymous surveys, and responses recorded as anonymous are left out.
   */
  private async writtenAnswerWriters(
    survey: { isAnonymous: boolean },
    answers: Array<{
      otherText?: string | null;
      comment?: string | null;
      response?: {
        id: string;
        isAnonymous: boolean;
        recipient: { employeeId: string | null; serviceUserId: string | null } | null;
      } | null;
    }>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (survey.isAnonymous) return out;
    const named = answers.filter(
      (a) => (a.otherText || a.comment) && a.response && !a.response.isAnonymous && a.response.recipient,
    );
    if (!named.length) return out;
    const names = await this.loadRecipientNames(named.map((a) => a.response!.recipient!));
    for (const a of named) {
      const r = a.response!.recipient!;
      const name = names.get(r.employeeId ?? r.serviceUserId ?? '');
      if (name) out.set(a.response!.id, name);
    }
    return out;
  }

  /** "Top two" share of a scale question's answers (see the topTwo field); null for other questions. */
  private topTwoOf(
    q: {
      id: string;
      questionText: string;
      questionType: SurveyQuestionType;
      options: Prisma.JsonValue;
      config?: Prisma.JsonValue;
      sectionTitle?: string | null;
      sortOrder: number;
    },
    answers: ReadonlyArray<{ selectedOptions: Prisma.JsonValue }>,
  ): { labels: string[]; positive: number; base: number; percent: number | null } | null {
    // Threshold 1: every count behind it is already shown on the page, so nothing more is revealed.
    const r = questionResult(
      { ...q, sectionTitle: q.sectionTitle ?? null, config: q.config ?? null },
      answers.map((a) => ({ questionId: q.id, selectedOptions: a.selectedOptions })),
      1,
    );
    if (!r) return null;
    return { labels: r.positiveLabels, positive: r.positive ?? 0, base: r.base, percent: r.percent };
  }

  private buildQuestionSummaries<
    A extends {
      booleanValue: boolean | null;
      textValue: string | null;
      numberValue: Prisma.Decimal | null;
      selectedOptions: Prisma.JsonValue;
      otherText?: string | null;
      comment?: string | null;
      response?: { id: string } | null;
    },
  >(
    questions: Array<{
      id: string;
      questionText: string;
      questionType: SurveyQuestionType;
      sortOrder: number;
      options: Prisma.JsonValue;
      otherOption?: Prisma.JsonValue;
      /** Choice and scale questions: answers marked "Not counted in percentages". */
      config?: Prisma.JsonValue;
      sectionTitle?: string | null;
    }>,
    answers: A[],
    keyOf: (a: A) => string,
    writers: ReadonlyMap<string, string> = new Map(),
    /** Anonymous surveys: whether an answer's written parts may be shown (see writtenAnswerVisibility). */
    writtenVisible: (a: A) => boolean = () => true,
  ) {
    const byKey = new Map<string, A[]>();
    for (const a of answers) {
      const key = keyOf(a);
      const list = byKey.get(key) ?? [];
      list.push(a);
      byKey.set(key, list);
    }

    return questions.map((q) => {
      const qAnswers = byKey.get(q.id) ?? [];
      const answerCount = qAnswers.length;
      // People's own words alongside their answers ("Other" text and comments), newest first.
      const allWritten = qAnswers.filter((a) => a.otherText?.trim() || a.comment?.trim());
      const written = allWritten.filter(writtenVisible);
      const allText = qAnswers.filter((a) => a.textValue?.trim());
      const shownText = allText.filter(writtenVisible);
      const writtenAnswers = written.slice(0, WRITTEN_ANSWERS_SHOWN).map((a) => {
        const numberValue = a.numberValue == null ? null : Number(a.numberValue);
        const labels = answerLabelsFor(q, {
          booleanValue: a.booleanValue,
          numberValue,
          selectedOptions: a.selectedOptions,
        });
        return {
          /** What they answered (e.g. "Never"), so the comment reads in context. */
          answer: labels.length ? labels.join(', ') : numberValue !== null ? String(numberValue) : null,

          otherText: a.otherText?.trim() || null,
          comment: a.comment?.trim() || null,
          /** Named surveys only: who wrote it. Never set on anonymous surveys. */
          respondentName: a.response ? (writers.get(a.response.id) ?? null) : null,
        };
      });
      const base = {
        questionId: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        sortOrder: q.sortOrder,
        sectionTitle: q.sectionTitle ?? null,
        answerCount,
        writtenAnswers,
        writtenAnswerCount: written.length,
        /** Some written answers (or text answers) are held back to protect anonymity. */
        writtenAnswersWithheld: written.length < allWritten.length || shownText.length < allText.length,
        /**
         * Agreement / frequency / rating scales: the share who chose one of the top two answers
         * ("Very good or Good"), of everyone who chose an answer on the scale (the CQC evidence rule:
         * "Don't know" and answers marked not counted are left out). Null for other questions.
         */
        topTwo: this.topTwoOf(q, qAnswers),
      };

      if (
        q.questionType === SurveyQuestionType.YES_NO ||
        q.questionType === SurveyQuestionType.SINGLE_SELECT ||
        q.questionType === SurveyQuestionType.MULTI_SELECT ||
        q.questionType === SurveyQuestionType.LIKERT
      ) {
        const counts = new Map<string, number>();
        if (q.questionType === SurveyQuestionType.YES_NO) {
          counts.set('Yes', 0);
          counts.set('No', 0);
        } else {
          const configured = this.normalizeOptions(q.questionType, q.options) ?? [];
          for (const opt of configured) counts.set(opt, 0);
          // "Other (please tell us)" counts as a choice like any other.
          const other = readOtherOption(q.otherOption);
          if (other) counts.set(other.label, counts.get(other.label) ?? 0);
        }
        // Answers marked "Not counted in percentages" are counted and shown, but left out of the
        // base: a percentage is of the people who gave at least one counted answer.
        const notCounted = new Set(readNotCountedOptions(q.config));
        let countedAnswers = 0;
        for (const a of qAnswers) {
          const selected =
            q.questionType === SurveyQuestionType.YES_NO
              ? a.booleanValue === true
                ? ['Yes']
                : a.booleanValue === false
                  ? ['No']
                  : []
              : currentAnswerLabels(
                  q.questionType,
                  q.options,
                  Array.isArray(a.selectedOptions)
                    ? a.selectedOptions.filter((v): v is string => typeof v === 'string')
                    : [],
                );
          for (const opt of selected) counts.set(opt, (counts.get(opt) ?? 0) + 1);
          if (selected.some((opt) => !notCounted.has(opt))) countedAnswers += 1;
        }
        const options = [...counts.entries()].map(([label, c]) => ({
          label,
          count: c,
          /** Of the people who gave a counted answer; null for an answer that is not counted. */
          percent: notCounted.has(label) ? null : countedAnswers > 0 ? Math.round((c / countedAnswers) * 100) : 0,
          notCounted: notCounted.has(label),
        }));
        return { ...base, countedAnswers, options };
      }

      if (
        q.questionType === SurveyQuestionType.NUMBER ||
        q.questionType === SurveyQuestionType.RATING
      ) {
        const nums = qAnswers
          .map((a) => (a.numberValue === null || a.numberValue === undefined ? null : Number(a.numberValue)))
          .filter((n): n is number => n !== null && !Number.isNaN(n));
        const sum = nums.reduce((acc, n) => acc + n, 0);
        return {
          ...base,
          numeric: {
            average: nums.length ? Math.round((sum / nums.length) * 100) / 100 : null,
            min: nums.length ? Math.min(...nums) : null,
            max: nums.length ? Math.max(...nums) : null,
          },
        };
      }

      const textSamples = shownText.map((a) => a.textValue!.trim()).slice(0, 5);
      return { ...base, textSamples };
    });
  }

  /**
   * Admin: submitted responses with answers. Anonymous surveys never show who answered or the
   * time of day (only the date) — their answers are not linked to anyone in the database.
   * A repeating survey lists the answers from all its periods.
   */
  async listResponses(actor: RequestUser, surveyId: string) {
    {
      const survey = await this.requireSurvey(actor, surveyId);
      const access = await surveyAccessFor(this.prisma, actor, survey);
      if (!access.responses) throw new ForbiddenException(RESPONSES_RESTRICTED);
    }
    const survey = await this.requireSurvey(actor, surveyId);
    const periods = await this.loadPeriods(survey);
    const periodTitle = new Map(periods.map((p) => [p.id, p.title]));
    const surveyIds = [survey.id, ...periods.map((p) => p.id)];
    // Answers still waiting to be written: counted in the totals, never listed.
    const waiting = this.responseTally((await pendingResponseGroups(this.prisma, surveyIds)) ?? []);
    const statusOf = this.statusLookup(survey, periods);
    const rows = await this.prisma.surveyResponse.findMany({
      where: { surveyId: { in: surveyIds } },
      orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
      include: {
        recipient: { select: { id: true, employeeId: true, serviceUserId: true } },
        answers: {
          include: {
            question: {
              select: {
                id: true,
                questionText: true,
                questionType: true,
                options: true,
                sortOrder: true,
                sectionTitle: true,
                otherOption: true,
                optionsFrom: true,
                sourceQuestionId: true,
              },
            },
          },
        },
      },
    });

    const anonymousSurvey = survey.isAnonymous;
    const nameById = anonymousSurvey
      ? new Map<string, string>()
      : await this.loadRecipientNames(
          rows.map((r) => r.recipient).filter((r): r is NonNullable<typeof r> => Boolean(r)),
        );
    const recorderName = await this.loadUserNameMap(
      rows.map((r) => r.recordedById).filter((id): id is string => Boolean(id)),
    );

    // Same rule as the results: anonymous written answers only once closed with enough answers.
    const responsesBySurvey = new Map(waiting.all);
    const withoutNameBySurvey = new Map(waiting.withoutName);
    for (const r of rows) {
      responsesBySurvey.set(r.surveyId, (responsesBySurvey.get(r.surveyId) ?? 0) + 1);
      if (isAnsweredWithoutName(r)) {
        withoutNameBySurvey.set(r.surveyId, (withoutNameBySurvey.get(r.surveyId) ?? 0) + 1);
      }
    }
    // Named survey: answers given without a name are not listed until the survey / period has closed
    // with enough of them (whatever is not named would be theirs) — same rule as the results.
    const heldIds = new Set(
      [...withoutNameBySurvey.entries()]
        .filter(([id, n]) => withoutNameAnswersHeldBack(anonymousSurvey, n, statusOf(id) === SurveyStatus.CLOSED))
        .map(([id]) => id),
    );
    const totalWaiting = [...waiting.all.values()].reduce((a, b) => a + b, 0);
    const waitingNotHeld =
      totalWaiting - [...heldIds].reduce((sum, id) => sum + (waiting.withoutName.get(id) ?? 0), 0);
    const withoutNameHeld = [...heldIds].reduce((sum, id) => sum + (withoutNameBySurvey.get(id) ?? 0), 0);
    const listed = heldIds.size ? rows.filter((r) => !(heldIds.has(r.surveyId) && isAnsweredWithoutName(r))) : rows;

    const chronological = [...listed].sort(
      (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime() || a.id.localeCompare(b.id),
    );
    const indexById = new Map(chronological.map((r, i) => [r.id, i + 1]));
    // Named survey: answers not linked to anyone are numbered among themselves, so the number
    // says nothing about where they fall among the named answers.
    const unnamedIndexById = new Map(
      chronological.filter((r) => r.isAnonymous).map((r, i) => [r.id, i + 1]),
    );
    const visibility = writtenAnswerVisibility(survey, periods, responsesBySurvey);
    const withoutNameVisibility = anonymousSurvey
      ? null
      : withoutNameWrittenVisibility(survey, periods, withoutNameBySurvey);
    let anyWithheld = false;
    let withoutNameWithheld = false;
    // CareFlow-list (equality) answers on responses linked to no one: a group is shown only when at
    // least EQUALITY_DETAIL_THRESHOLD people in the listed responses chose it. With every other
    // answer beside it, a rare group ("the one Arab colleague") would point at one person.
    // Counted among the unlinked responses only: on a named survey, named people's groups are shown
    // by name anyway, and counting them would let one unlinked answer's rare group through.
    const lookupGroupCounts = new Map<string, Map<string, number>>();
    for (const r of listed) {
      if (!(anonymousSurvey || r.isAnonymous)) continue;
      for (const a of r.answers) {
        if (!a.question.optionsFrom || !Array.isArray(a.selectedOptions)) continue;
        const qKey = a.question.sourceQuestionId ?? a.question.id;
        const counts = lookupGroupCounts.get(qKey) ?? new Map<string, number>();
        for (const g of new Set((a.selectedOptions as unknown[]).filter((v): v is string => typeof v === 'string').map(lookupGroupOf))) {
          counts.set(g, (counts.get(g) ?? 0) + 1);
        }
        lookupGroupCounts.set(qKey, counts);
      }
    }
    const lookupGroupShown = (questionKey: string, group: string) =>
      (lookupGroupCounts.get(questionKey)?.get(group) ?? 0) >= EQUALITY_DETAIL_THRESHOLD;

    const responses = listed.map((row) => {
      const hideIdentity = anonymousSurvey || row.isAnonymous;
      const seq = (anonymousSurvey ? indexById : row.isAnonymous ? unnamedIndexById : indexById).get(row.id) ?? 1;
      const withoutName = !anonymousSurvey && isAnsweredWithoutName(row);
      let respondentLabel: string;
      let employeeId: string | null = null;
      let serviceUserId: string | null = null;
      if (hideIdentity) {
        respondentLabel = `Anonymous respondent #${seq}`;
      } else if (row.recipient?.employeeId) {
        employeeId = row.recipient.employeeId;
        respondentLabel = nameById.get(row.recipient.employeeId) ?? 'Employee';
      } else if (row.recipient?.serviceUserId) {
        serviceUserId = row.recipient.serviceUserId;
        respondentLabel = nameById.get(row.recipient.serviceUserId) ?? 'Service user';
      } else {
        respondentLabel = `Open-link respondent #${seq}`;
      }

      const writtenShown =
        (visibility.all || visibility.surveyIds.has(row.surveyId)) &&
        (!withoutName ||
          Boolean(withoutNameVisibility?.all || withoutNameVisibility?.surveyIds.has(row.surveyId)));
      const answers = [...row.answers]
        .sort((a, b) => a.question.sortOrder - b.question.sortOrder)
        .map((a) => {
          const numberValue =
            a.numberValue === null || a.numberValue === undefined ? null : Number(a.numberValue);
          const withheldFields = writtenShown ? [] : withheldWrittenFields(a);
          if (withheldFields.length) {
            anyWithheld = true;
            if (withoutName) withoutNameWithheld = true;
          }
          const textWithheld = withheldFields.includes('textValue');
          // CareFlow-list (equality) answers linked to no one: the group only, and only when enough
          // people chose it. The same words in the list and in what the page shows (displayValue).
          const shownGroups =
            hideIdentity && a.question.optionsFrom && Array.isArray(a.selectedOptions)
              ? [
                  ...new Set(
                    (a.selectedOptions as unknown[])
                      .filter((v): v is string => typeof v === 'string')
                      .map(lookupGroupOf)
                      .map((g) =>
                        lookupGroupShown(a.question.sourceQuestionId ?? a.question.id, g)
                          ? g
                          : `Not shown (fewer than ${EQUALITY_DETAIL_THRESHOLD} chose this group)`,
                      ),
                  ),
                ]
              : null;
          return {
            questionId: a.question.id,
            questionText: a.question.questionText,
            questionType: a.question.questionType,
            sectionTitle: a.question.sectionTitle ?? null,
            booleanValue: a.booleanValue,
            textValue: textWithheld ? null : a.textValue,
            numberValue,
            // CareFlow-list (equality) answers on a response linked to no one: the group only, as
            // the detail with the other answers could point at someone.
            ...(hideIdentity && a.question.optionsFrom ? { lookupGroupOnly: true } : {}),
            selectedOptions: shownGroups
              ? shownGroups
              : Array.isArray(a.selectedOptions)
              ? currentAnswerLabels(
                  a.question.questionType,
                  a.question.options,
                  (a.selectedOptions as unknown[]).filter((v): v is string => typeof v === 'string'),
                )
              : null,
            /** The respondent's own words: their "Other" answer and their comment. */
            otherText: withheldFields.includes('otherText') ? null : (a.otherText ?? null),
            comment: withheldFields.includes('comment') ? null : (a.comment ?? null),
            /** Written parts held back to protect anonymity (kept unchanged when the response is edited). */
            withheldFields,
            displayValue: textWithheld
              ? WITHHELD_TEXT_DISPLAY
              : shownGroups
                ? shownGroups.join(', ')
                : this.formatAnswerDisplay({
                  questionType: a.question.questionType,
                  options: a.question.options,
                  booleanValue: a.booleanValue,
                  textValue: a.textValue,
                  numberValue,
                  selectedOptions: a.selectedOptions,
                  otherOption: a.question.otherOption,
                  otherText: withheldFields.includes('otherText') ? null : a.otherText,
                }),
          };
        });
      // Staff notes on an anonymous recording are written words too: held back under the same rule
      // as its written answers (closed, and enough answers), and kept unchanged when it is edited.
      const contactNotesWithheld = !writtenShown && Boolean(row.contactNotes?.trim());
      if (contactNotesWithheld) anyWithheld = true;

      return {
        id: row.id,
        surveyId: row.surveyId,
        periodTitle: periodTitle.get(row.surveyId) ?? null,
        submittedAt: row.submittedAt.toISOString(),
        /** Anonymous (survey or response): only the date is kept, so show the date without a time. */
        submittedDateOnly: hideIdentity,
        respondentLabel,
        employeeId,
        serviceUserId,
        // Never shown for an answer given without a name (who answered narrows down who it was).
        respondentRelation: withoutName ? null : row.respondentRelation,
        respondentName: hideIdentity ? null : row.respondentName,
        channel: row.channel,
        isAnonymous: hideIdentity,
        /** Named survey: the person chose to answer without their name (online). */
        answeredWithoutName: withoutName,
        recordedByName: row.recordedById ? (recorderName.get(row.recordedById) ?? null) : null,
        contactedAt: hideIdentity ? null : toIso(row.contactedAt),
        contactNumber: hideIdentity ? null : row.contactNumber,
        contactNotes: contactNotesWithheld ? null : row.contactNotes,
        /** The recording's notes are held back with its written answers. */
        contactNotesWithheld,
        consentGiven: row.consentGiven,
        // Only staff-recorded responses can be corrected; people's own answers never change.
        canEdit: isStaffRecordedChannel(row.channel),
        /** Some written answers (or notes) in this response are held back (anonymous survey still open, or too few answers). */
        writtenAnswersWithheld: contactNotesWithheld || answers.some((a) => a.withheldFields.length > 0),
        answerCount: answers.length,
        answers,
      };
    });

    return {
      message: 'Survey responses',
      data: {
        isAnonymous: anonymousSurvey,
        total: rows.length + totalWaiting,
        /** Named surveys: responses not linked to anyone (given or recorded without a name). */
        answeredWithoutName: anonymousSurvey
          ? null
          : rows.filter((r) => r.isAnonymous).length + [...waiting.unnamed.values()].reduce((a, b) => a + b, 0),
        /** Responses given without a name that are not listed yet (open, or too few to protect them). */
        withoutNameAnswersHeldBack: withoutNameHeld,
        withoutNameAnswersNote: withoutNameHeldBackNote(withoutNameHeld),
        /** Responses counted in the total but not listed yet (being added in batches). */
        responsesBeingAdded: waitingNotHeld,
        responsesBeingAddedNote: responsesBeingAddedNote(waitingNotHeld),
        /** Why written answers are not shown; null when nothing is held back. */
        writtenAnswersNote: anyWithheld
          ? withoutNameWithheld
            ? (withoutNameVisibility?.note ?? null)
            : visibility.note
          : null,
        responses,
      },
    };
  }

  /** People this survey can be recorded for (its target, within the user's branches). */
  async listRecordCandidates(actor: RequestUser, surveyId: string, search?: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    const scope = this.scopeOf(actor);
    const q = search?.trim();
    const forServiceUsers = survey.targetKind === SurveyTargetKind.SERVICE_USER;
    if (survey.targetKind === SurveyTargetKind.PUBLIC) {
      return { message: 'Survey record candidates', data: [] };
    }
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
    const words = (q ?? '').split(/\s+/).filter(Boolean).slice(0, 5);

    let people: Array<{ id: string; name: string; hasPortal?: boolean; careEnded?: boolean }>;
    if (forServiceUsers) {
      const where: Prisma.ServiceUserWhereInput = {
        deletedAt: null,
        ...notWithStatus(CHOSEN_EXCLUDED_SERVICE_USER_STATUSES),
        // Every word must match a first or last name or the number, so a full name finds the person.
        ...(words.length
          ? {
              AND: words.map((w) => ({
                OR: [{ firstName: contains(w) }, { lastName: contains(w) }, { serviceUserNumber: contains(w) }],
              })),
            }
          : {}),
      };
      andWhereFragment(where, this.orgScope.serviceUserScopeWhere(scope));
      // People it was sent to by name (outside the survey's branches too) are always candidates.
      const sentTo = survey.isAnonymous
        ? []
        : (
            await this.prisma.surveyRecipient.findMany({
              where: { surveyId, serviceUserId: { not: null }, status: { not: 'COMPLETED' } },
              select: { serviceUserId: true },
              take: 2000,
            })
          ).map((r) => r.serviceUserId as string);
      const select = {
        id: true,
        firstName: true,
        lastName: true,
        serviceUserNumber: true,
        isActive: true,
        portalAccount: { select: { isEnabled: true, deletedAt: true } },
        status: { select: { code: true } },
      } as const;
      const orderBy: Prisma.ServiceUserOrderByWithRelationInput[] = [{ firstName: 'asc' }, { lastName: 'asc' }];
      // Waiting for an answer with no portal account first: the office phones, visits or posts these.
      const first = sentTo.length
        ? await this.prisma.serviceUser.findMany({
            where: {
              AND: [
                where,
                { id: { in: sentTo } },
                { OR: [{ isActive: false }, { NOT: { portalAccount: { is: { isEnabled: true, deletedAt: null } } } }] },
              ],
            },
            select,
            orderBy,
            take: 25,
          })
        : [];
      const rest =
        first.length < 25
          ? await this.prisma.serviceUser.findMany({
              where: {
                AND: [
                  where,
                  { id: { notIn: first.map((r) => r.id) } },
                  survey.locationIds.length
                    ? { OR: [{ locationId: { in: survey.locationIds } }, { id: { in: sentTo } }] }
                    : {},
                ],
              },
              select,
              orderBy,
              take: 25 - first.length,
            })
          : [];
      people = [...first, ...rest].map((r) => {
        const name = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || 'Service user';
        return {
          id: r.id,
          name: r.serviceUserNumber ? `${name} (${r.serviceUserNumber})` : name,
          hasPortal: Boolean(r.isActive && r.portalAccount?.isEnabled && !r.portalAccount.deletedAt),
          careEnded: r.status?.code === CARE_ENDED_STATUS,
        };
      });
    } else {
      const employmentScope: Prisma.EmployeeEmploymentWhereInput = {};
      if (survey.locationIds.length) employmentScope.locationId = { in: survey.locationIds };
      if (survey.roleIds.length) employmentScope.jobTitleId = { in: survey.roleIds };
      const where: Prisma.EmployeeWhereInput = {
        deletedAt: null,
        isActive: true,
        ...(Object.keys(employmentScope).length ? { employment: employmentScope } : {}),
        // Every word must match a first or last name, so a full name ("Jane Smith") finds the person.
        ...(words.length
          ? { AND: words.map((w) => ({ personalDetail: { OR: [{ firstName: contains(w) }, { lastName: contains(w) }] } })) }
          : {}),
      };
      andWhereFragment(where, this.orgScope.employeeEmploymentScopeWhere(scope));
      const rows = await this.prisma.employee.findMany({
        where,
        select: { id: true, personalDetail: { select: { firstName: true, lastName: true } } },
        take: 25,
      });
      people = rows
        .map((r) => ({
          id: r.id,
          name:
            `${r.personalDetail?.firstName ?? ''} ${r.personalDetail?.lastName ?? ''}`.trim() ||
            'Employee',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // Anonymous surveys never show who has answered: a per-person "answered" flag checked
    // against new "Anonymous respondent" rows would name the respondent.
    if (survey.isAnonymous) {
      return {
        message: 'Survey record candidates',
        data: people.map((p) => ({
          id: p.id,
          name: p.name,
          recipientStatus: null,
          hasResponse: false,
          statusHidden: true,
          ...(forServiceUsers ? { careEnded: p.careEnded ?? false } : {}),
        })),
      };
    }

    const ids = people.map((p) => p.id);
    const recipients = ids.length
      ? await this.prisma.surveyRecipient.findMany({
          where: forServiceUsers
            ? { surveyId, serviceUserId: { in: ids } }
            : { surveyId, employeeId: { in: ids } },
          select: { employeeId: true, serviceUserId: true, status: true },
        })
      : [];
    const recipientByPerson = new Map(
      recipients.map((r) => [(forServiceUsers ? r.serviceUserId : r.employeeId) as string, r]),
    );

    return {
      message: 'Survey record candidates',
      data: people.map((p) => {
        const recipient = recipientByPerson.get(p.id);
        return {
          id: p.id,
          name: p.name,
          recipientStatus: recipient?.status ?? null,
          hasResponse: recipient?.status === 'COMPLETED',
          statusHidden: false,
          /** People we support: whether they can answer in the portal (null for staff). */
          hasPortal: p.hasPortal ?? null,
          /** People we support whose care has ended (discharged): "Care ended". */
          careEnded: p.careEnded ?? null,
        };
      }),
    };
  }

  /**
   * People we support who can be chosen when sending a service-user survey: within your
   * branches, still receiving care, with whether each has a portal account and (named surveys)
   * already has this survey. `ids` looks up chosen people by id (to show saved choices).
   */
  async listSendCandidates(actor: RequestUser, surveyId: string, search?: string, ids?: string[]) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.targetKind !== SurveyTargetKind.SERVICE_USER) {
      throw new BadRequestException('Only surveys for people we support are sent to chosen people this way.');
    }
    const scope = this.scopeOf(actor);
    const q = search?.trim();
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
    const wanted = unique((ids ?? []).filter((id) => isUUID(id))).slice(0, 1000);
    const where: Prisma.ServiceUserWhereInput = {
      deletedAt: null,
      ...notWithStatus(CHOSEN_EXCLUDED_SERVICE_USER_STATUSES),
      ...(ids ? { id: { in: wanted } } : {}),
      ...(q
        ? {
            OR: [
              { firstName: contains(q) },
              { lastName: contains(q) },
              { serviceUserNumber: contains(q) },
            ],
          }
        : {}),
    };
    andWhereFragment(where, this.orgScope.serviceUserScopeWhere(scope));
    const rows = await this.prisma.serviceUser.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        serviceUserNumber: true,
        isActive: true,
        portalAccount: { select: { isEnabled: true, deletedAt: true } },
        status: { select: { code: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: ids ? 1000 : 50,
    });
    // Anonymous surveys never show who it went to.
    const sent = survey.isAnonymous || rows.length === 0
      ? new Set<string>()
      : new Set(
          (
            await this.prisma.surveyRecipient.findMany({
              where: { surveyId, serviceUserId: { in: rows.map((r) => r.id) } },
              select: { serviceUserId: true },
            })
          ).map((r) => r.serviceUserId as string),
        );
    return {
      message: 'Survey send candidates',
      data: rows.map((r) => {
        const name = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || 'Service user';
        return {
          id: r.id,
          name: r.serviceUserNumber ? `${name} (${r.serviceUserNumber})` : name,
          hasPortal: Boolean(r.isActive && r.portalAccount?.isEnabled && !r.portalAccount.deletedAt),
          /** Care has ended (discharged): can still be chosen, for the "When your care ends" survey. */
          careEnded: r.status?.code === CARE_ENDED_STATUS,
          alreadySent: survey.isAnonymous ? null : sent.has(r.id),
        };
      }),
    };
  }

  /**
   * Branch / job title snapshot stored on a response, for group breakdowns. Anonymous answers
   * keep the branch only — a job title (often held by one or two people in a branch) would
   * single the respondent out.
   */
  private async respondentSegment(
    db: Db,
    person: { employeeId?: string | null; serviceUserId?: string | null },
    anonymous: boolean,
  ): Promise<{ locationId: string | null; jobTitleId: string | null }> {
    if (person.employeeId) {
      const employment = await db.employeeEmployment.findFirst({
        where: { employeeId: person.employeeId },
        select: { locationId: true, jobTitleId: true },
      });
      return {
        locationId: employment?.locationId ?? null,
        jobTitleId: anonymous ? null : (employment?.jobTitleId ?? null),
      };
    }
    if (person.serviceUserId) {
      const su = await db.serviceUser.findFirst({
        where: { id: person.serviceUserId },
        select: { locationId: true },
      });
      return { locationId: su?.locationId ?? null, jobTitleId: null };
    }
    return { locationId: null, jobTitleId: null };
  }

  /**
   * Office staff record a response collected by telephone, from paper or in person —
   * for a named person (their survey becomes Completed) or anonymously (linked to no one).
   * On an anonymous survey the answers are never linked to the person, even when named here.
   */
  async recordResponse(
    actor: RequestUser,
    surveyId: string,
    dto: RecordSurveyResponseDto,
    meta?: RequestAuditMeta,
    /** `byReviewer`: recorded by an independent reviewer (SurveyReviewersService), counted apart. */
    opts: { byReviewer?: boolean } = {},
  ) {
    const survey = await this.requireSurvey(actor, surveyId);
    this.assertNotTemplate(survey, 'answered');
    if (survey.status === SurveyStatus.DRAFT) {
      throw new BadRequestException(
        survey.targetKind === SurveyTargetKind.PUBLIC
          ? 'Publish the survey before recording responses'
          : 'Use Open for responses (or send the survey) before recording responses',
      );
    }
    // As the responses page allows. A closed survey's answers are final (and an answer recorded after
    // the close would be written on its own, not in a batch); a repeating survey's own row never
    // closes while it repeats, so an answer held there would wait indefinitely — its periods are answered.
    if (survey.status === SurveyStatus.CLOSED) {
      throw new BadRequestException('This survey is closed. Reopen it before recording responses.');
    }
    if (!survey.clonedFromId && (survey.recurrence || (await this.cloneCount(survey.id)) > 0)) {
      throw new BadRequestException(
        'This survey repeats on a schedule. Record the response on the period it belongs to.',
      );
    }
    const scope = this.scopeOf(actor);
    const forServiceUsers = survey.targetKind === SurveyTargetKind.SERVICE_USER;
    const anonymous = Boolean(dto.isAnonymous) || survey.targetKind === SurveyTargetKind.PUBLIC;
    if (!anonymous && !dto.personId) {
      throw new BadRequestException(
        `Choose the ${forServiceUsers ? 'service user' : 'employee'} or record the response as anonymous`,
      );
    }
    const isTelephone = dto.channel === SurveyResponseChannel.TELEPHONE;
    if (isTelephone && dto.consentGiven !== true) {
      throw new BadRequestException('Confirm the person agreed to answer over the phone');
    }

    const relation = dto.respondentRelation ?? null;
    const unlinked = anonymous || survey.isAnonymous;
    const respondentName =
      unlinked || !relation || relation === SurveyRespondentRelation.SELF
        ? null
        : dto.respondentName?.trim() || null;

    let personId: string | null = null;
    if (!anonymous) {
      personId = dto.personId!;
      if (forServiceUsers) {
        await this.orgScope.assertServiceUserInScope(scope, personId);
        const person = await this.prisma.serviceUser.findFirst({
          where: { id: personId, deletedAt: null },
          select: { status: { select: { code: true } } },
        });
        if (person?.status?.code && (CHOSEN_EXCLUDED_SERVICE_USER_STATUSES as readonly string[]).includes(person.status.code)) {
          throw new BadRequestException(
            'Answers cannot be recorded for this person: they have died, are inactive, or their care has not started.',
          );
        }
      } else {
        const employee = await this.prisma.employee.findFirst({
          where: { id: personId, deletedAt: null },
          select: { id: true },
        });
        if (!employee) throw new NotFoundException('Employee not found');
        await this.orgScope.assertEmployeeInScope(scope, personId);
      }
      // Anonymous survey: whether this person has answered is never revealed (record candidates
      // hide it too), so recording behaves the same either way — no "already answered" refusal.
      if (!survey.isAnonymous) {
        const existing = await this.prisma.surveyRecipient.findFirst({
          where: forServiceUsers
            ? { surveyId, serviceUserId: personId }
            : { surveyId, employeeId: personId },
          select: { status: true },
        });
        if (existing?.status === 'COMPLETED') {
          throw new BadRequestException(
            'This person has already answered this survey. Edit the recorded response instead.',
          );
        }
      }
    }

    // A response recorded without a name (or on an anonymous survey) is linked to no one, so the
    // contact-me question is not required and anything entered for it is discarded (we could not reply).
    const { questions, answerByQuestion, adjustments } = await this.validateAnswers(surveyId, dto, {
      withoutName: unlinked,
    });
    const now = new Date();
    // Answers not linked to anyone (an anonymous survey, or a response recorded as anonymous on a
    // named one) keep only the day — an exact call time could be matched to the person called.
    const stamp = unlinked ? await this.anonymousTimestamp(now) : now;
    const contactedRaw = dto.contactedAt ? new Date(dto.contactedAt) : isTelephone ? now : null;
    const contactedAt =
      contactedRaw && unlinked ? await this.anonymousTimestamp(contactedRaw) : contactedRaw;
    const person = personId
      ? forServiceUsers
        ? { serviceUserId: personId }
        : { employeeId: personId }
      : null;

    /** Marks the person's survey Completed (creating their recipient row if needed). */
    const markCompleted = async (db: Db) => {
      const where = forServiceUsers ? { surveyId, serviceUserId: personId! } : { surveyId, employeeId: personId! };
      const existing = await db.surveyRecipient.findFirst({ where, select: { id: true, status: true } });
      if (existing) {
        // Not while the person's own unlinked answer ("without my name") is being submitted.
        const marked = await db.surveyRecipient.updateMany({
          where: { id: existing.id, ...claimableWhere(now) },
          data: { status: 'COMPLETED', ...CLEARED_CLAIM, ...(survey.isAnonymous ? { updatedAt: stamp } : {}) },
        });
        if (marked.count === 0 && !survey.isAnonymous) {
          throw new BadRequestException('This person has already answered this survey.');
        }
        return { recipientId: existing.id };
      }
      const created = await db.surveyRecipient.create({
        data: {
          surveyId,
          targetKind: survey.targetKind,
          employeeId: forServiceUsers ? null : personId,
          serviceUserId: forServiceUsers ? personId : null,
          token: randomUUID(),
          status: 'COMPLETED',
          sentAt: stamp,
          // Made by answering, not sending: never a survey contact on an anonymous survey (4-week rule).
          addedByAnswer: true,
          createdById: actor.id,
          ...(survey.isAnonymous ? { createdAt: stamp, updatedAt: stamp } : {}),
        },
      });
      return { recipientId: created.id };
    };

    /** Named survey: whether the person's survey is Completed now (read again after a duplicate key). */
    const answeredAlready = async () => {
      if (!personId) return false;
      const row = await this.prisma.surveyRecipient
        .findFirst({
          where: forServiceUsers ? { surveyId, serviceUserId: personId } : { surveyId, employeeId: personId },
          select: { status: true },
        })
        .catch(() => null);
      return row?.status === 'COMPLETED';
    };

    let responseId: string;
    try {
      if (survey.isAnonymous && person) {
        // Anonymous survey, recorded for a named person: like their own answer, the Completed mark and
        // the answers are never written together — the answers wait in the pending store (no person,
        // recipient or recorder) and the survey job writes them in a shuffled batch. As for their own
        // answer, the person is CLAIMED first (so their own racing submit is refused before it holds
        // anything), the answers are kept next, then the survey is marked Completed in its own
        // transaction: a crash in between can at worst allow a second answer, never lose this one.
        const segment = await this.respondentSegment(this.prisma, person, true);
        const answers = toPendingAnswers(this.mapAnswersForCreate(questions, answerByQuestion, null));
        const claimed = await this.claimForRecording(survey, person, actor.id, now, stamp);
        try {
          responseId = (
            await holdUnlinkedResponse(this.prisma, {
              surveyId,
              isAnonymous: anonymous,
              channel: dto.channel as SurveyResponseChannel,
              day: stamp,
              payload: {
                locationId: segment.locationId,
                respondentRelation: relation,
                // Day only; never the number called or who recorded it (both would point to the person).
                recorded: {
                  contactedAt: contactedAt ? contactedAt.toISOString() : null,
                  contactNotes: dto.contactNotes?.trim() || null,
                  consentGiven: isTelephone ? true : null,
                },
                answers,
              },
            })
          ).id;
        } catch (err) {
          if (claimed) await this.undoRecordingClaim(surveyId, claimed, stamp);
          throw err;
        }
        if (claimed) {
          await this.completeClaimedAfterHold(surveyId, claimed.recipientId, claimed.claim, stamp, 'a recorded answer');
        }
      } else {
        const write = () => this.prisma.$transaction(async (tx) => {
          const recipientId = person ? (await markCompleted(tx)).recipientId : null;
          const segment = person
            ? await this.respondentSegment(tx, person, survey.isAnonymous)
            : { locationId: null, jobTitleId: null };

          return tx.surveyResponse.create({
            data: {
              surveyId,
              recipientId: unlinked ? null : recipientId,
              ...segment,
              submittedById: null,
              respondentRelation: relation,
              respondentName,
              channel: dto.channel as SurveyResponseChannel,
              recordedById: actor.id,
              isAnonymous: anonymous,
              contactedAt,
              // The number would identify an anonymous respondent.
              contactNumber: unlinked ? null : dto.contactNumber?.trim() || null,
              contactNotes: dto.contactNotes?.trim() || null,
              consentGiven: isTelephone ? true : null,
              submittedAt: stamp,
              ...(unlinked ? { createdAt: stamp, updatedAt: stamp } : {}),
              answers: {
                create: this.mapAnswersForCreate(questions, answerByQuestion, unlinked ? stamp : null),
              },
            },
          });
        });
        let response: { id: string };
        try {
          response = await write();
        } catch (e) {
          // A duplicate key while marking the person is not necessarily an answer: the distribution
          // job (or a send) may have created their recipient row between our read and our create.
          // Re-read: answered → say so; otherwise try once more (the row is found and marked this time).
          if (!isUniqueClash(e) || !person) throw e;
          if (await answeredAlready()) {
            throw new BadRequestException('This person has already answered this survey.');
          }
          response = await write();
        }
        responseId = response.id;
      }
    } catch (e) {
      if (isUniqueClash(e)) {
        // Anonymous survey: whether this person has answered is never revealed.
        const answered = !survey.isAnonymous && person ? await answeredAlready() : false;
        throw new BadRequestException(
          answered
            ? 'This person has already answered this survey.'
            : 'The response could not be recorded just now. Please try again.',
        );
      }
      throw e;
    }

    // Not linked to anyone (anonymous survey, or recorded without a name): no audit row of its own —
    // its time and survey would date the call or collection the response itself keeps to the day.
    // It is counted for the day instead (an independent reviewer's apart), audited once the day is over.
    if (unlinked) {
      await this.countUnlinkedAnswer(surveyId, opts.byReviewer ? 'reviewer' : 'recorded');
    } else {
      await this.audit.logAudit({
        userId: actor.id,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_RESPONSE_RECORDED,
        recordType: 'SurveyResponse',
        recordId: responseId,
        newValues: {
          surveyId,
          channel: dto.channel,
          isAnonymous: false,
          respondentRelation: relation,
          answerCount: dto.answers.length,
        },
        metadata: { surveyId, ...responseAuditAdjustments(adjustments, false), ...(opts.byReviewer ? { independentReviewer: true } : {}) },
        ...meta,
      });
      this.checkAlerts(responseId);
    }

    return {
      message: 'Survey response recorded',
      data: { id: responseId, submittedAt: stamp.toISOString() },
    };
  }

  /** Correct a staff-recorded response; the reason and before / after answers go to the audit log. */
  async updateRecordedResponse(
    actor: RequestUser,
    surveyId: string,
    responseId: string,
    dto: UpdateRecordedSurveyResponseDto,
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.requireSurvey(actor, surveyId);
    const answerInclude = {
      answers: {
        include: {
          question: {
            select: { questionText: true, questionType: true, options: true, sortOrder: true, otherOption: true, optionsFrom: true },
          },
        },
      },
    } as const;
    const existing = await this.prisma.surveyResponse.findFirst({
      where: { id: responseId, surveyId },
      include: answerInclude,
    });
    if (!existing) throw new NotFoundException('Survey response not found');
    if (!isStaffRecordedChannel(existing.channel)) {
      throw new BadRequestException(
        'Only responses recorded by staff (telephone, paper or in person) can be edited.',
      );
    }

    // Anonymous survey whose written answers are still held back: staff never saw them, so whatever
    // they did not replace is kept as it was (never silently wiped). Counted as the responses list
    // counts them (answers still waiting included), so what is kept is exactly what it held back.
    const visibility = writtenAnswerVisibility(
      survey,
      [],
      new Map([
        [
          surveyId,
          (await this.prisma.surveyResponse.count({ where: { surveyId } })) +
            (await pendingResponseCount(this.prisma, surveyId)),
        ],
      ]),
    );
    const writtenHidden = !visibility.all && !visibility.surveyIds.has(surveyId);
    const unlinked = existing.isAnonymous || survey.isAnonymous;
    const withWritten = writtenHidden ? keepWithheldWrittenAnswers(dto, existing.answers) : dto;
    // Equality answers were shown as their group only (or "Not shown"): kept unless a new one is chosen.
    const toSave = unlinked
      ? keepLookupAnswersLinkedToNoOne(withWritten, existing.answers, (stored) => [...new Set(stored.map(lookupGroupOf))])
      : withWritten;
    // Linked to no one: the contact-me question is not required (and is discarded), as when recorded.
    const { questions, answerByQuestion, adjustments } = await this.validateAnswers(surveyId, toSave, {
      withoutName: unlinked,
    });
    const relation = dto.respondentRelation ?? null;
    const respondentName =
      unlinked || !relation || relation === SurveyRespondentRelation.SELF
        ? null
        : dto.respondentName?.trim() || null;

    const snapshot = (rows: typeof existing.answers) =>
      [...rows]
        .sort((a, b) => a.question.sortOrder - b.question.sortOrder)
        .map((a) => ({
          question: a.question.questionText,
          // Held-back written answers stay out of the audit log too, and so does a CareFlow-list
          // (equality) answer linked to no one: audit readers would see one person's rare group.
          answer: unlinked && a.question.optionsFrom
            ? EQUALITY_AUDIT_TEXT
            : this.formatAnswerDisplay({
            questionType: a.question.questionType,
            options: a.question.options,
            booleanValue: a.booleanValue,
            textValue: writtenHidden && a.textValue?.trim() ? WITHHELD_AUDIT_TEXT : a.textValue,
            numberValue: a.numberValue == null ? null : Number(a.numberValue),
            selectedOptions: a.selectedOptions,
            otherOption: a.question.otherOption,
            otherText: writtenHidden && a.otherText?.trim() ? WITHHELD_AUDIT_TEXT : a.otherText,
          }),
          ...(a.comment ? { comment: writtenHidden ? WITHHELD_AUDIT_TEXT : a.comment } : {}),
        }));
    const before = snapshot(existing.answers);
    // A named person's answers on an anonymous survey (written from the pending store: no recorder)
    // keep the day they were written out — a call day typed in here would date them to the day that
    // person's survey turned Completed.
    const writtenOut = survey.isAnonymous && !existing.recordedById;
    const contactedRaw =
      dto.contactedAt && !writtenOut ? new Date(dto.contactedAt) : existing.contactedAt;
    const contactedAt =
      contactedRaw && unlinked ? await this.anonymousTimestamp(contactedRaw) : contactedRaw;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.surveyAnswer.deleteMany({ where: { responseId } });
      return tx.surveyResponse.update({
        where: { id: responseId },
        data: {
          respondentRelation: relation,
          respondentName,
          contactedAt,
          contactNumber: unlinked ? null : dto.contactNumber?.trim() || null,
          // Held-back notes were never shown to staff: left empty, they are kept as they are.
          contactNotes: dto.contactNotes?.trim() || (writtenHidden ? existing.contactNotes : null),
          ...(unlinked ? { updatedAt: existing.updatedAt } : {}),
          answers: {
            create: this.mapAnswersForCreate(questions, answerByQuestion, unlinked ? existing.submittedAt : null),
          },
        },
        include: answerInclude,
      });
    });

    const reason = dto.reason.trim();
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_RESPONSE_UPDATED,
      recordType: survey.isAnonymous ? 'Survey' : 'SurveyResponse',
      recordId: survey.isAnonymous ? surveyId : responseId,
      description: reason,
      oldValues: { answers: before },
      newValues: { answers: snapshot(updated.answers) },
      metadata: {
        surveyId,
        reason,
        channel: existing.channel,
        ...(writtenHidden ? { writtenAnswersKept: true } : {}),
        ...exclusiveAdjustmentsMeta(adjustments),
      },
      ...(survey.isAnonymous ? {} : meta),
    });
    // A corrected answer can meet a rule it did not before (rules already raised are not raised again).
    if (!unlinked) this.checkAlerts(responseId, true);

    return { message: 'Survey response updated', data: { id: responseId } };
  }

  private formatAnswerDisplay(input: {
    questionType: SurveyQuestionType;
    /** The question's stored options: built-in-scale answers saved as "Neutral" read with today's label. */
    options?: unknown;
    booleanValue: boolean | null;
    textValue: string | null;
    numberValue: number | null;
    selectedOptions: unknown;
    /** The question's Other choice and the respondent's text for it ("Other: their words"). */
    otherOption?: unknown;
    otherText?: string | null;
  }): string {
    switch (input.questionType) {
      case SurveyQuestionType.YES_NO:
        if (input.booleanValue === true) return 'Yes';
        if (input.booleanValue === false) return 'No';
        return '—';
      case SurveyQuestionType.SINGLE_SELECT:
      case SurveyQuestionType.LIKERT:
      case SurveyQuestionType.MULTI_SELECT: {
        const opts = currentAnswerLabels(
          input.questionType,
          input.options,
          Array.isArray(input.selectedOptions)
            ? input.selectedOptions.filter((v): v is string => typeof v === 'string')
            : [],
        );
        const other = readOtherOption(input.otherOption);
        const shown = opts.map((o) =>
          other && o === other.label && input.otherText?.trim() ? `${o}: ${input.otherText.trim()}` : o,
        );
        return shown.length ? shown.join(', ') : '—';

      }
      case SurveyQuestionType.TEXT:
      case SurveyQuestionType.TEXTAREA:
        return input.textValue?.trim() || '—';
      case SurveyQuestionType.NUMBER:
      case SurveyQuestionType.RATING:
        return input.numberValue === null || Number.isNaN(input.numberValue)
          ? '—'
          : String(input.numberValue);
      default:
        return '—';
    }
  }

  /**
   * Admin: who the survey was sent to and whether each person has completed it.
   * Anonymous surveys return status counts only — never names next to completion times.
   * A repeating survey returns counts across its periods (open a period for the list).
   * Personal survey link tokens are never returned.
   */
  async listRecipients(actor: RequestUser, surveyId: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    const periods = await this.loadPeriods(survey);
    const surveyIds = [survey.id, ...periods.map((p) => p.id)];
    const groups = await this.prisma.surveyRecipient.groupBy({
      by: ['status'],
      where: { surveyId: { in: surveyIds } },
      _count: { _all: true },
    });
    // Without results access, not even how many have answered (see countsVisible).
    const access = await surveyAccessFor(this.prisma, actor, survey);
    if (!access.results) {
      return { message: 'Survey recipients', data: { isAnonymous: survey.isAnonymous, byPeriod: periods.length > 0, counts: null, recipients: [], recipientsRestricted: true } };
    }
    const counts = recipientStatusCounts(groups, { anonymous: survey.isAnonymous });
    const base = { isAnonymous: survey.isAnonymous, byPeriod: periods.length > 0, counts };
    if (survey.isAnonymous || periods.length > 0) {
      return { message: 'Survey recipients', data: { ...base, recipients: [] } };
    }
    // Who answered, when, and who answered for them is part of the individual responses: when those
    // are limited to particular people, everyone else sees the counts only.
    if (!(await surveyAccessFor(this.prisma, actor, survey)).responses) {
      return { message: 'Survey recipients', data: { ...base, recipients: [], recipientsRestricted: true } };
    }

    const rows = await this.prisma.surveyRecipient.findMany({
      where: { surveyId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        employeeId: true,
        serviceUserId: true,
        sentAt: true,
        createdAt: true,
        reminderCount: true,
        remindedAt: true,
        response: {
          select: { submittedAt: true, respondentRelation: true, respondentName: true },
        },
      },
    });
    const nameById = await this.loadRecipientNames(rows);

    return {
      message: 'Survey recipients',
      data: {
        ...base,
        recipients: rows.map((r) => ({
          id: r.id,
          status: r.status,
          employeeId: r.employeeId,
          employeeName: r.employeeId ? (nameById.get(r.employeeId) ?? 'Employee') : null,
          serviceUserId: r.serviceUserId,
          serviceUserName: r.serviceUserId ? (nameById.get(r.serviceUserId) ?? 'Service user') : null,
          sentAt: toIso(r.sentAt),
          submittedAt: toIso(r.response?.submittedAt),
          respondentRelation: r.response?.respondentRelation ?? null,
          respondentName: r.response?.respondentName ?? null,
          // Reminders sent (named surveys only: anonymous surveys never list people).
          reminderCount: r.reminderCount,
          remindedAt: toIso(r.remindedAt),
          createdAt: r.createdAt.toISOString(),
        })),
      },
    };
  }

  private async sharedLinkCaution(surveyIds: string[]) {
    const rows = await this.prisma.surveySharedLinkDay?.findMany({ where: { surveyId: { in: surveyIds } } }).catch(() => []);
    if (!rows?.length) return null;
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const day = r.day.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + r.answers);
    }
    const days = sharedLinkBursts(byDay);
    return days.length ? { days, note: sharedLinkBurstNote(days) } : null;
  }

  /** Display names for employee / service-user recipients, keyed by their id. */
  private async loadRecipientNames(
    recipients: Array<{ employeeId: string | null; serviceUserId: string | null }>,
  ): Promise<Map<string, string>> {
    const employeeIds = recipients.map((r) => r.employeeId).filter((id): id is string => Boolean(id));
    const serviceUserIds = recipients
      .map((r) => r.serviceUserId)
      .filter((id): id is string => Boolean(id));
    const [employees, serviceUsers] = await Promise.all([
      employeeIds.length
        ? this.prisma.employeePersonalDetail.findMany({
            where: { employeeId: { in: employeeIds } },
            select: { employeeId: true, firstName: true, lastName: true },
          })
        : [],
      serviceUserIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: serviceUserIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
    ]);
    const map = new Map<string, string>();
    for (const e of employees) {
      map.set(e.employeeId, `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || 'Employee');
    }
    for (const su of serviceUsers) {
      map.set(su.id, `${su.firstName ?? ''} ${su.lastName ?? ''}`.trim() || 'Service user');
    }
    return map;
  }

  // ─── Portal / carer app / public ──────────────────────────────────────────

  /**
   * Portal: surveys sent to this service user (open ones first). A survey that closed more than
   * UNANSWERED_CLOSED_LIST_DAYS ago without an answer is no longer listed.
   */
  async listForServiceUserPortal(serviceUserId: string, now: Date = new Date()) {
    const rows = await this.prisma.surveyRecipient.findMany({
      where: {
        serviceUserId,
        survey: { deletedAt: null, isTemplate: false, isCatalogue: false, status: { not: SurveyStatus.DRAFT } },
      },
      orderBy: { sentAt: 'desc' },
      select: {
        token: true,
        status: true,
        sentAt: true,
        survey: {
          select: {
            title: true,
            description: true,
            isAnonymous: true,
            status: true,
            opensAt: true,
            closesAt: true,
            updatedAt: true,
          },
        },
        response: { select: { submittedAt: true, respondentRelation: true } },
      },
    });

    const listed = rows.filter(
      (r) =>
        !isStaleUnansweredSurvey(r.survey, Boolean(r.response) || r.status === 'COMPLETED', now),
    );
    const items = listed.map((r) => {
      const completed = Boolean(r.response) || r.status === 'COMPLETED';
      const availability: Availability =
        !completed && r.status === 'LAPSED'
          ? { canSubmit: false, kind: 'CLOSED_FOR_YOU', reason: CLOSED_FOR_YOU_REASON }
          : this.evaluateAvailability(r.survey, completed);
      const state: 'OPEN' | 'UNAVAILABLE' | 'COMPLETED' = completed
        ? 'COMPLETED'
        : availability.canSubmit
          ? 'OPEN'
          : 'UNAVAILABLE';
      return {
        token: r.token,
        title: r.survey.title,
        description: r.survey.description,
        sentAt: toIso(r.sentAt),
        opensAt: toIso(r.survey.opensAt),
        closesAt: toIso(r.survey.closesAt),
        state,
        unavailableReason: completed ? null : availability.reason,
        completedAt: toIso(r.response?.submittedAt),
        respondentRelation: r.response?.respondentRelation ?? null,
        /** Their answers are kept against their name (so "View my answers" works). */
        answersAvailable: Boolean(r.response),
        /** They chose to answer this named survey without their name (nothing is kept against it). */
        answeredWithoutName: completed && !r.response && !r.survey.isAnonymous,
      };
    });
    const order = { OPEN: 0, UNAVAILABLE: 1, COMPLETED: 2 } as const;
    items.sort((a, b) => order[a.state] - order[b.state]);
    return { message: 'Portal surveys', data: items };
  }

  /**
   * Carer app: surveys sent to the signed-in employee. Open surveys carry their
   * questions so the app can keep them for answering offline. A survey (or period) that closed
   * more than UNANSWERED_CLOSED_LIST_DAYS ago without an answer is no longer listed.
   */
  async listForEmployeeApp(employeeId: string, now: Date = new Date()) {
    const rows = await this.prisma.surveyRecipient.findMany({
      where: {
        employeeId,
        targetKind: SurveyTargetKind.EMPLOYEE,
        survey: { deletedAt: null, isTemplate: false, isCatalogue: false, status: { not: SurveyStatus.DRAFT } },
      },
      orderBy: { sentAt: 'desc' },
      select: {
        token: true,
        status: true,
        sentAt: true,
        survey: {
          select: {
            id: true,
            title: true,
            description: true,
            isAnonymous: true,
            allowAnonymousResponses: true,
            status: true,
            opensAt: true,
            closesAt: true,
            updatedAt: true,
            sectionIntros: true,
            libraryMeta: true,
            closingMessage: true,
          },
        },
        response: { select: { submittedAt: true } },
      },
    });

    const listed = rows.filter(
      (r) =>
        !isStaleUnansweredSurvey(r.survey, Boolean(r.response) || r.status === 'COMPLETED', now),
    );
    const items = listed.map((r) => {
      const completed = Boolean(r.response) || r.status === 'COMPLETED';
      const availability: Availability =
        !completed && r.status === 'LAPSED'
          ? { canSubmit: false, kind: 'CLOSED_FOR_YOU', reason: CLOSED_FOR_YOU_REASON }
          : this.evaluateAvailability(r.survey, completed);
      const state: 'OPEN' | 'UNAVAILABLE' | 'COMPLETED' = completed
        ? 'COMPLETED'
        : availability.canSubmit
          ? 'OPEN'
          : 'UNAVAILABLE';
      return { r, state, reason: completed ? null : availability.reason };
    });

    const openSurveyIds = unique(items.filter((i) => i.state === 'OPEN').map((i) => i.r.survey.id));
    const questions = openSurveyIds.length
      ? await withLookupOptions(
          this.prisma,
          await this.prisma.surveyQuestion.findMany({
            where: { surveyId: { in: openSurveyIds }, deletedAt: null, isActive: true },
            orderBy: QUESTION_ORDER,
          }),
        )
      : [];
    const questionsBySurvey = new Map<string, ReturnType<SurveysService['toFormQuestion']>[]>();
    for (const surveyId of openSurveyIds) {
      const own = questions.filter((q) => q.surveyId === surveyId);
      const idByKey = new Map(own.filter((q) => q.key).map((q) => [q.key!, q.id]));
      // Anonymous: contact-me and its follow-ups are never asked (an older survey may still hold them).
      const anonymous = items.find((i) => i.r.survey.id === surveyId)?.r.survey.isAnonymous ?? false;
      const notAsked = anonymous ? questionsNotAskedWhenUnlinked(own) : new Set<string>();
      questionsBySurvey.set(
        surveyId,
        own.filter((q) => !notAsked.has(q.id)).map((q) => this.toFormQuestion(q, idByKey)),
      );
    }

    const data = items.map(({ r, state, reason }) => ({
      token: r.token,
      surveyId: r.survey.id,
      title: r.survey.title,
      description: r.survey.description,
      isAnonymous: r.survey.isAnonymous,
      /** Named survey: the carer may choose to answer without their name (send answerWithoutName). */
      allowAnonymousResponses: offersAnswerWithoutName(r.survey),
      /** Shown with the choice in the carer app. */
      answerWithoutNameNote: offersAnswerWithoutName(r.survey) ? ANSWER_WITHOUT_NAME_NOTE : null,
      sentAt: toIso(r.sentAt),
      opensAt: toIso(r.survey.opensAt),
      closesAt: toIso(r.survey.closesAt),
      state,
      unavailableReason: reason,
      completedAt: toIso(r.response?.submittedAt),
      /** Answered without their name: nothing is kept against it, so there are no answers to show. */
      answeredWithoutName: state === 'COMPLETED' && !r.response && !r.survey.isAnonymous,
      questions: state === 'OPEN' ? (questionsBySurvey.get(r.survey.id) ?? []) : [],
      /** Introductions shown under section headings: { [sectionTitle]: text } (sections asked only). */
      sectionIntros:
        state === 'OPEN' ? introsForQuestions(sectionIntrosOf(r.survey), questionsBySurvey.get(r.survey.id) ?? []) : {},
      /**
       * The closing screen, on a completed survey only (it can hold the answers to knowledge
       * questions, so never before answering; submitting returns it too). Null = thank-you only.
       */
      closingMessage: state === 'COMPLETED' ? r.survey.closingMessage?.trim() || null : null,
    }));
    const order = { OPEN: 0, UNAVAILABLE: 1, COMPLETED: 2 } as const;
    data.sort((a, b) => order[a.state] - order[b.state]);
    return { message: 'My surveys', data };
  }

  /** Carer app: one of the employee's own surveys (marks it started, like opening the link). */
  async getEmployeeAppForm(employeeId: string, token: string) {
    await this.requireEmployeeRecipient(employeeId, token);
    return this.getPublicByToken(token);
  }

  /**
   * Carer app: submit answers for one of the employee's own surveys.
   * Already answered (e.g. via the email link, or a replayed offline send) → 409.
   */
  async submitEmployeeAppResponse(
    employeeId: string,
    token: string,
    dto: SubmitSurveyResponseDto,
    meta?: RequestAuditMeta,
  ) {
    const recipient = await this.requireEmployeeRecipient(employeeId, token);
    if (recipient.response || recipient.status === 'COMPLETED') {
      throw new ConflictException({ message: 'You have already completed this survey.', code: SURVEY_ALREADY_COMPLETED });
    }
    return this.withClosingMessage(recipient.survey.id, await this.submitRecipientResponse(recipient, dto, meta));
  }

  private async requireEmployeeRecipient(employeeId: string, token: string) {
    const recipient = await this.requireRecipientByToken(token);
    if (recipient.employeeId !== employeeId || recipient.targetKind !== SurveyTargetKind.EMPLOYEE) {
      throw new NotFoundException('Survey link not found');
    }
    return recipient;
  }

  /** Portal: the answers the signed-in service user (or their representative) submitted. */
  async getPortalSurveyAnswers(serviceUserId: string, token: string) {
    return this.loadOwnSurveyAnswers({ token: token?.trim(), serviceUserId });
  }

  /** Carer app: the answers the signed-in employee submitted for one of their surveys. */
  async getEmployeeAppAnswers(employeeId: string, token: string) {
    return this.loadOwnSurveyAnswers({
      token: token?.trim(),
      employeeId,
      targetKind: SurveyTargetKind.EMPLOYEE,
    });
  }

  private async loadOwnSurveyAnswers(where: Prisma.SurveyRecipientWhereInput) {
    const recipient = await this.prisma.surveyRecipient.findFirst({
      where: { ...where, survey: { deletedAt: null, isTemplate: false, isCatalogue: false } },
      select: {
        status: true,
        survey: { select: { title: true, isAnonymous: true } },
        response: {
          select: {
            submittedAt: true,
            respondentRelation: true,
            respondentName: true,
            answers: {
              select: {
                booleanValue: true,
                textValue: true,
                numberValue: true,
                selectedOptions: true,
                otherText: true,
                comment: true,
                question: {
                  select: {
                    id: true,
                    questionText: true,
                    questionType: true,
                    options: true,
                    sortOrder: true,
                    sectionTitle: true,
                    otherOption: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (recipient?.survey.isAnonymous && recipient.status === 'COMPLETED') {
      throw new NotFoundException(
        'Answers to an anonymous survey are not kept against your name, so they cannot be shown.',
      );
    }
    if (recipient?.status === 'COMPLETED' && !recipient.response) {
      throw new NotFoundException(
        'You answered this survey without your name, so your answers are not kept against your name and cannot be shown.',
      );
    }
    if (!recipient?.response) throw new NotFoundException('No submitted answers found for this survey');
    const { response } = recipient;
    const answers = [...response.answers]
      .sort((a, b) => a.question.sortOrder - b.question.sortOrder)
      .map((a) => ({
        questionId: a.question.id,
        questionText: a.question.questionText,
        sectionTitle: a.question.sectionTitle ?? null,
        displayValue: this.formatAnswerDisplay({
          questionType: a.question.questionType,
          options: a.question.options,
          booleanValue: a.booleanValue,
          textValue: a.textValue,
          numberValue: a.numberValue === null || a.numberValue === undefined ? null : Number(a.numberValue),
          selectedOptions: a.selectedOptions,
          otherOption: a.question.otherOption,
          otherText: a.otherText,
        }),
        /** Their comment alongside the answer, if they wrote one. */
        comment: a.comment ?? null,
      }));

    return {
      message: 'Your survey answers',
      data: {
        title: recipient.survey.title,
        submittedAt: response.submittedAt.toISOString(),
        respondentRelation: response.respondentRelation,
        respondentName: response.respondentName,
        answers,
      },
    };
  }

  /**
   * A shared link: the survey's main link (shareToken) or one of its branch links (SurveyShareLink,
   * not turned off). A branch link's answers carry its branch. Public surveys always have it; staff
   * and service-user surveys only while their shared link is on. A repeating survey's link opens the
   * period that is open (`noOpenPeriod` when none is: the form then says when the next one opens).
   * Never templates or ready-made surveys.
   */
  private async findShareSurvey(token: string): Promise<ShareSurvey | null> {
    let linked = await this.prisma.survey.findFirst({
      where: { shareToken: token, deletedAt: null },
    });
    let shareLink: { id: string; locationId: string | null } | undefined;
    if (!linked) {
      const link = await this.prisma.surveyShareLink.findFirst({
        where: { token, revokedAt: null },
        include: { survey: true },
      });
      if (!link || link.survey.deletedAt) return null;
      linked = link.survey;
      shareLink = { id: link.id, locationId: link.locationId };
    }
    if (linked.isTemplate || linked.isCatalogue) throw new NotFoundException('Survey link not found');
    if (linked.targetKind !== SurveyTargetKind.PUBLIC && !linked.sharedLinkEnabled) {
      // Turned off (or never on): the same answer as a link that never existed.
      throw new NotFoundException('Survey link not found');
    }
    let survey: Survey = linked;
    let noOpenPeriod: { nextOpensAt: Date | null } | undefined;
    if (!linked.clonedFromId && (linked.recurrence || (await this.cloneCount(linked.id)) > 0)) {
      const open = await this.prisma.survey.findFirst({
        where: { clonedFromId: linked.id, deletedAt: null, status: SurveyStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      });
      if (open) survey = open;
      else noOpenPeriod = { nextOpensAt: linked.recurrence ? (linked.distributeAt ?? null) : null };
    }
    return {
      ...survey,
      ...(shareLink ? { shareLink } : {}),
      ...(noOpenPeriod ? { noOpenPeriod } : {}),
      linkOncePerDevice: Boolean(linked.sharedLinkOncePerDevice),
    };
  }

  /** Public: load survey form by survey share token OR recipient token. */
  /**
   * An independent reviewer's form (SurveyReviewersService): the questions as people see them, with
   * section introductions; never counts, results or who answered. `anonymous`: the contact-me
   * question and its follow-ups are left out (an anonymous survey, or an anonymous-only review).
   */
  async reviewerForm(surveyId: string, opts: { anonymous: boolean }) {
    const survey = await this.prisma.survey.findFirst({ where: { id: surveyId, deletedAt: null, isCatalogue: false, isTemplate: false } });
    if (!survey) throw new NotFoundException('Survey not found');
    const form = await this.buildPublicForm(survey, {
      alreadyCompleted: false,
      linkKind: 'recipient',
      askRespondent: survey.targetKind === SurveyTargetKind.SERVICE_USER && !opts.anonymous,
      unlinked: opts.anonymous,
    });
    const { contact: _contact, sharedLinkNote: _note, ...data } = form.data;
    return { message: 'Survey to record', data: { ...data, targetKind: survey.targetKind, surveyId: survey.id } };
  }

  async getPublicByToken(token: string) {
    const cleaned = token?.trim();
    if (!cleaned) throw new NotFoundException('Survey link not found');

    const byShare = await this.findShareSurvey(cleaned);
    if (byShare) {
      const staffOrClients = byShare.targetKind !== SurveyTargetKind.PUBLIC;
      const form = await this.buildPublicForm(byShare, {
        alreadyCompleted: false,
        linkKind: 'share',
        // Staff and service-user surveys: an answer through the shared link is never linked to anyone
        // (no contact-me questions). Who is answering is asked on anonymous service-user surveys only
        // (it is not kept for an answer without a name on a named survey).
        unlinked: staffOrClients,
        askRespondent: byShare.targetKind === SurveyTargetKind.SERVICE_USER && byShare.isAnonymous,
        noOpenPeriod: byShare.noOpenPeriod ?? null,
      });
      // Sent back with the answers (spam protection; see survey-link-guard.ts).
      return {
        ...form,
        data: {
          ...form.data,
          formToken: this.linkGuard ? this.linkGuard.issue(cleaned) : null,
          /**
           * One answer per device: the page keeps a random marker under this name on the device
           * after an answer (per survey or period) and never sends it. Null = not asked for.
           */
          deviceMarker: byShare.linkOncePerDevice
            ? `careflow-survey-answered-${createHash('sha256').update(`device:${byShare.id}`).digest('hex').slice(0, 20)}`
            : null,
          oncePerDeviceNote: byShare.linkOncePerDevice ? ONCE_PER_DEVICE_NOTE : null,
        },
      };
    }

    const recipient = await this.requireRecipientByToken(cleaned);
    const survey = recipient.survey;
    if (await this.lapsedNow(recipient)) {
      return this.buildPublicForm(survey, { alreadyCompleted: false, linkKind: 'recipient', closedForYou: true });
    }
    const forServiceUser = recipient.targetKind === SurveyTargetKind.SERVICE_USER;
    const su =
      forServiceUser && recipient.serviceUserId
        ? await this.prisma.serviceUser.findFirst({
            where: { id: recipient.serviceUserId },
            select: { firstName: true, lastName: true },
          })
        : null;
    const alreadyCompleted = Boolean(recipient.response) || recipient.status === 'COMPLETED';

    if (!alreadyCompleted && (recipient.status === 'SENT' || recipient.status === 'PENDING')) {
      // Conditional: a submit that completed after the read above must never be turned back to
      // Started (the person would be asked again, and an unlinked answer could be given twice).
      await this.prisma.surveyRecipient.updateMany({
        where: { id: recipient.id, status: { in: ['SENT', 'PENDING'] } },
        data: {
          status: 'STARTED',
          ...(survey.isAnonymous ? { updatedAt: await this.anonymousTimestamp(new Date()) } : {}),
        },
      });
    }

    return this.buildPublicForm(survey, {
      alreadyCompleted,
      linkKind: 'recipient',
      askRespondent: forServiceUser,
      forName: su ? `${su.firstName} ${su.lastName}`.trim() : null,
    });
  }

  /**
   * The per-link answer limit in force for a shared link: the link's survey's raised limit while its
   * planned sitting lasts, else the standard one (survey-link-guard.ts).
   */
  private async sharedLinkLimitFor(token: string): Promise<number> {
    const select = { sharedLinkLimit: true, sharedLinkLimitUntil: true } as const;
    const own = await this.prisma.survey.findFirst({ where: { shareToken: token, deletedAt: null }, select });
    if (own) return linkLimitFor(own);
    const link = await this.prisma.surveyShareLink.findFirst({ where: { token, revokedAt: null }, select: { survey: { select } } });
    return linkLimitFor(link?.survey ?? null);
  }

  /** Public: submit answers via survey share token OR recipient token. */
  async submitPublicResponse(token: string, dto: SubmitSurveyResponseDto, meta?: RequestAuditMeta) {
    const cleaned = token?.trim();
    if (!cleaned) throw new NotFoundException('Survey link not found');

    const byShare = await this.findShareSurvey(cleaned);
    if (byShare) {
      // Spam protection (nothing about the sender is kept). A form that filled the hidden field is
      // thanked and thrown away, so an automated sender learns nothing.
      if ((await this.linkGuard?.check(cleaned, dto, { limit: await this.sharedLinkLimitFor(cleaned) })) === 'discard') {
        return this.withClosingMessage(byShare.id, {
          message: 'Survey response submitted',
          data: { id: randomUUID(), submittedAt: (await this.anonymousTimestamp(new Date())).toISOString() },
        });
      }
      const progress = { kept: false };
      try {
        const result = await this.submitOpenShareResponse(byShare, dto, meta, progress);
        await this.countSharedLinkAnswer(byShare.id);
        return this.withClosingMessage(byShare.id, result);
      } catch (e) {
        // Not kept (a missing answer, the survey just closed): the same form can be sent again. Once
        // the answers are kept (a later step failed) the form stays used, or a retry would add them twice.
        if (!progress.kept) await this.linkGuard?.release(dto.formToken).catch(() => undefined);
        throw e;
      }
    }

    const recipient = await this.requireRecipientByToken(cleaned);
    return this.withClosingMessage(recipient.survey.id, await this.submitRecipientResponse(recipient, dto, meta));
  }

  /**
   * The closing-screen message goes back with a submit only, never with the form before it (it can
   * hold the answers to knowledge questions, CQC-002), so it is read from the survey here.
   */
  private async withClosingMessage<T extends { message: string; data: Record<string, unknown> }>(
    surveyId: string,
    result: T,
  ): Promise<T & { data: T['data'] & { closingMessage: string | null } }> {
    const row = await this.prisma.survey
      .findUnique({ where: { id: surveyId }, select: { closingMessage: true } })
      .catch(() => null);
    return { ...result, data: { ...result.data, closingMessage: row?.closingMessage?.trim() || null } };
  }

  private async buildPublicForm(
    survey: {
      id: string;
      title: string;
      description: string | null;
      isAnonymous: boolean;
      allowAnonymousResponses?: boolean;
      status: SurveyStatus;
      opensAt: Date | null;
      closesAt: Date | null;
      sectionIntros?: Prisma.JsonValue | null;
      libraryMeta?: Prisma.JsonValue | null;
      closingMessage?: string | null;
    },
    opts: {
      alreadyCompleted: boolean;
      linkKind: 'share' | 'recipient';
      /** Service-user links: ask who is answering (self / family member / representative). */
      askRespondent?: boolean;
      /** Service-user links: whose survey this is, so family / representatives can see. */
      forName?: string | null;
      /** A staff or service-user survey's shared link: the answer is linked to no one. */
      unlinked?: boolean;
      /** A repeating survey's shared link with no period open now. */
      noOpenPeriod?: { nextOpensAt: Date | null } | null;
      /** This person's invitation lapsed (they can no longer be sent it): closed for them. */
      closedForYou?: boolean;
    },
  ) {
    const availability: Availability = opts.closedForYou
      ? { canSubmit: false, kind: 'CLOSED_FOR_YOU' as Availability['kind'], reason: CLOSED_FOR_YOU_REASON }
      : opts.noOpenPeriod
      ? {
          canSubmit: false,
          kind: 'NO_OPEN_PERIOD',
          reason: opts.noOpenPeriod.nextOpensAt
            ? `There is no survey open on this link right now. The next one opens on ${formatUkDateLabel(
                new Date(`${dayKeyInTimeZone(opts.noOpenPeriod.nextOpensAt, await this.timeZone())}T00:00:00Z`),
              )}.`
            : 'There is no survey open on this link right now.',
        }
      : this.evaluateAvailability(survey, opts.alreadyCompleted);
    const unlinked = survey.isAnonymous || Boolean(opts.unlinked);
    const questions = await withLookupOptions(
      this.prisma,
      await this.prisma.surveyQuestion.findMany({
        where: { surveyId: survey.id, deletedAt: null, isActive: true },
        orderBy: QUESTION_ORDER,
      }),
    );
    const idByKey = new Map(questions.filter((q) => q.key).map((q) => [q.key!, q.id]));
    // Linked to no one: contact-me and its follow-ups are never asked (an older survey may still hold them).
    const notAsked = unlinked ? questionsNotAskedWhenUnlinked(questions) : new Set<string>();
    // Who to contact instead when it cannot be answered (the organisation's public phone and email).
    const contact = availability.canSubmit ? null : await this.organisationContact();

    return {
      message: 'Public survey',
      data: {
        title: survey.title,
        description: survey.description,
        isAnonymous: survey.isAnonymous,
        /**
         * Named survey: offer "Answer without my name — we will not be able to reply to you". When
         * chosen, send answerWithoutName: true; questions marked contactRequest are not asked.
         */
        allowAnonymousResponses: opts.unlinked ? false : offersAnswerWithoutName(survey),
        /** Said with the choice: staff can see that they answered, never which answers are theirs. */
        answerWithoutNameNote: !opts.unlinked && offersAnswerWithoutName(survey) ? ANSWER_WITHOUT_NAME_NOTE : null,
        /**
         * The answer will be linked to no one (anonymous survey, or a staff / service-user survey's
         * shared link): contact-me questions are not asked.
         */
        unlinked,
        /** A staff / service-user survey's shared link: what answering through it means. */
        sharedLinkNote: opts.unlinked ? SHARED_LINK_NOTE : null,
        status: survey.status,
        opensAt: toIso(survey.opensAt),
        closesAt: toIso(survey.closesAt),
        alreadyCompleted: opts.alreadyCompleted,
        canSubmit: availability.canSubmit,
        unavailableReason: availability.reason,
        /** Why it cannot be answered: COMPLETED, NOT_PUBLISHED, NOT_OPEN, ENDED, NO_OPEN_PERIOD (null = it can). */
        unavailableKind: availability.kind,
        /** Not answerable: the organisation to contact instead (its public name, phone and email). */
        contact,
        linkKind: opts.linkKind,
        askRespondent: opts.askRespondent ?? false,
        forName: opts.forName ?? null,
        questions: questions.filter((q) => !notAsked.has(q.id)).map((q) => this.toFormQuestion(q, idByKey)),
        /** Introductions shown under section headings: { [sectionTitle]: text } (sections asked only). */
        sectionIntros: introsForQuestions(sectionIntrosOf(survey), questions.filter((q) => !notAsked.has(q.id))),
        /**
         * Shown after submitting (the closing screen), under the thank-you; null = the thank-you only.
         * Only once they have answered: before that it comes back with the submit (it can hold the
         * answers to knowledge questions, so it is never in the form people answer).
         */
        closingMessage: opts.alreadyCompleted ? survey.closingMessage?.trim() || null : null,
      },
    };
  }

  /**
   * A question as respondents' forms (public link, portal, carer app) get it, with its Other
   * choice, comment box and "Show only if" rule (showIf.questionId: the question it depends on).
   */
  private toFormQuestion(
    q: {
      id: string;
      questionText: string;
      helpText: string | null;
      questionType: SurveyQuestionType;
      options: Prisma.JsonValue;
      config: Prisma.JsonValue;
      isRequired: boolean;
      sortOrder: number;
      sectionTitle?: string | null;
      key?: string | null;
      otherOption?: Prisma.JsonValue;
      exclusiveOptions?: Prisma.JsonValue;
      commentConfig?: Prisma.JsonValue;
      showIf?: Prisma.JsonValue;
      optionsFrom?: string | null;
      lookupEntries?: LookupEntry[];
    },
    idByKey: ReadonlyMap<string, string> = new Map(),
  ) {
    return {
      id: q.id,
      questionText: q.questionText,
      helpText: q.helpText,
      questionType: q.questionType,
      options: this.normalizeOptions(q.questionType, q.options),
      config: q.config,
      isRequired: q.isRequired,
      sortOrder: q.sortOrder,
      /** Heading of the section the question sits in (ready-made surveys). */
      sectionTitle: q.sectionTitle ?? null,
      /** "Would you like someone to contact you…": not asked of someone answering without their name. */
      contactRequest: isContactRequestQuestion(q),
      ...lookupFormPayload(q),
      ...this.questionLogicPayload(q, idByKey),
    };
  }

  /**
   * The person chose "Answer without my name". Only on named surveys that offer it; an anonymous
   * survey's answers are never linked to anyone anyway.
   */
  private wantsAnswerWithoutName(
    survey: { isAnonymous: boolean; allowAnonymousResponses?: boolean | null },
    dto: SubmitSurveyResponseDto,
  ): boolean {
    if (!dto.answerWithoutName || survey.isAnonymous) return false;
    if (!offersAnswerWithoutName(survey)) {
      throw new BadRequestException('This survey does not offer answering without your name.');
    }
    return true;
  }

  private async submitOpenShareResponse(
    survey: ShareSurvey,
    dto: SubmitSurveyResponseDto,
    /** Never written for a shared link (see the audit row below). */
    _meta?: RequestAuditMeta,
    /** Set once the answers are kept (the form's token must then stay used). */
    progress: { kept: boolean } = { kept: false },
  ) {
    if (survey.noOpenPeriod) throw new BadRequestException('There is no survey open on this link right now.');
    const availability = this.evaluateAvailability(survey, false);
    if (!availability.canSubmit) {
      throw new BadRequestException(availability.reason ?? 'This survey is not accepting responses');
    }
    if (survey.targetKind !== SurveyTargetKind.PUBLIC) return this.holdSharedLinkResponse(survey, dto, progress);

    const withoutName = this.wantsAnswerWithoutName(survey, dto);
    const unlinked = survey.isAnonymous || withoutName;
    const { questions, answerByQuestion, adjustments } = await this.validateAnswers(survey.id, dto, {
      withoutName: unlinked,
    });
    const now = new Date();
    const stamp = unlinked ? await this.anonymousTimestamp(now) : now;

    if (unlinked) {
      // Linked to no one (anonymous, or "without my name"): never written at once, or anyone watching
      // Results could see each one arrive at a known time. It waits in the held-answer store (no
      // person, token or IP; the day only) and is written out in a shuffled batch, like every other
      // answer linked to no one; a branch link keeps only the branch.
      const held = await holdUnlinkedResponse(this.prisma, {
        surveyId: survey.id,
        isAnonymous: withoutName,
        channel: SurveyResponseChannel.ONLINE,
        day: stamp,
        payload: {
          locationId: survey.shareLink?.locationId ?? null,
          respondentRelation: null,
          answers: toPendingAnswers(this.mapAnswersForCreate(questions, answerByQuestion, null)),
          viaSharedLink: true,
          shareLinkId: survey.shareLink?.id ?? null,
        },
      });
      progress.kept = true;
      // No audit row of its own (its time would date it): counted for the day instead.
      await this.countUnlinkedAnswer(survey.id, 'answered');
      // A receipt only (the held answer's id), never the response it becomes.
      return { message: 'Survey response submitted', data: { id: held.id, submittedAt: stamp.toISOString() } };
    }

    const response = await this.prisma.surveyResponse.create({
      data: {
        surveyId: survey.id,
        recipientId: null,
        submittedById: null,
        isAnonymous: false,
        // Through a shared link; a branch link gives the branch (never anything about the person).
        viaSharedLink: true,
        shareLinkId: survey.shareLink?.id ?? null,
        locationId: survey.shareLink?.locationId ?? null,
        submittedAt: stamp,
        answers: {
          create: this.mapAnswersForCreate(questions, answerByQuestion, null),
        },
      },
    });
    progress.kept = true;

    // A shared link is answered by people CareFlow cannot identify (named public forms ask for
    // details only if people choose to give them): the IP / device would be the only way to trace
    // who wrote it, so it is never kept.
    await this.audit.logAudit({
      userId: undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_RESPONSE_SUBMITTED,
      recordType: 'SurveyResponse',
      recordId: response.id,
      newValues: { surveyId: survey.id, answerCount: dto.answers.length, isAnonymous: false, linkKind: 'share' },
      metadata: { surveyId: survey.id, ...responseAuditAdjustments(adjustments, false) },
    });
    this.checkAlerts(response.id);

    return {
      message: 'Survey response submitted',
      data: { id: response.id, submittedAt: stamp.toISOString() },
    };
  }

  /**
   * One more answer through a shared link today (counts by day only, for the burst warning on
   * Results). Never fails the answer.
   */
  private async countSharedLinkAnswer(surveyId: string): Promise<void> {
    try {
      const day = dayKeyInTimeZone(new Date(), await this.timeZone());
      await this.prisma.$executeRaw`
        INSERT INTO "surveys"."SurveySharedLinkDay" ("surveyId", "day", "answers")
        VALUES (${surveyId}::uuid, ${day}::date, 1)
        ON CONFLICT ("surveyId", "day") DO UPDATE SET "answers" = "SurveySharedLinkDay"."answers" + 1`;
    } catch (e) {
      this.logger.warn(`Survey ${surveyId}: a shared-link answer was not counted for the day (${errorKind(e)})`);
    }
  }

  /**
   * A staff or service-user survey answered through its shared link. Nobody can tell who used the
   * link, and the people who could have are a known, small group (the staff team, the people we
   * support), so the answer is always linked to no one and treated like an anonymous one: it waits
   * in the held-answer store (no person, token or IP; the day only) and is written out later in a
   * shuffled batch, its written answers and alerts following the same rules. On a named survey it
   * is a response "without a name" (no branch, no who answered); on an anonymous survey a branch
   * link's branch and (service-user surveys) who answered are kept, as for every anonymous answer.
   * It never counts as anyone on the survey's list having answered.
   */
  private async holdSharedLinkResponse(survey: ShareSurvey, dto: SubmitSurveyResponseDto, progress: { kept: boolean } = { kept: false }) {
    const forServiceUsers = survey.targetKind === SurveyTargetKind.SERVICE_USER;
    let respondentRelation: SurveyRespondentRelation | null = null;
    if (forServiceUsers && survey.isAnonymous) {
      if (!dto.respondentRelation || dto.respondentRelation === SurveyRespondentRelation.STAFF) {
        throw new BadRequestException('Please choose who is answering this survey');
      }
      respondentRelation = dto.respondentRelation;
    }
    const { questions, answerByQuestion, adjustments } = await this.validateAnswers(survey.id, dto, { withoutName: true });
    const stamp = await this.anonymousTimestamp(new Date());
    const held = await holdUnlinkedResponse(this.prisma, {
      surveyId: survey.id,
      // Named survey: a response without a name. Anonymous survey: like every other answer to it.
      isAnonymous: !survey.isAnonymous,
      channel: SurveyResponseChannel.ONLINE,
      day: stamp,
      payload: {
        locationId: survey.isAnonymous ? (survey.shareLink?.locationId ?? null) : null,
        respondentRelation,
        answers: toPendingAnswers(this.mapAnswersForCreate(questions, answerByQuestion, null)),
        viaSharedLink: true,
        shareLinkId: survey.isAnonymous ? (survey.shareLink?.id ?? null) : null,
      },
    });
    progress.kept = true;
    // Linked to no one: no audit row of its own (its time would date it), counted for the day instead.
    await this.countUnlinkedAnswer(survey.id, 'answered');
    return {
      message: 'Survey response submitted',
      // A receipt only (the held answer's id), never the response it becomes.
      data: { id: held.id, submittedAt: stamp.toISOString() },
    };
  }

  /**
   * A staff survey's answers linked to no one (anonymous, or "without my name"), once a day: one
   * notice per survey for the finished day (the survey job, after the day's count is audited),
   * never one as each answer comes in (its time would date it). Only to people who may see the
   * survey's results (never the manager a copy rates); "N of M" is the list's progress now.
   */
  private async notifyOfficeOfUnlinkedDay(day: UnlinkedDayRow) {
    const survey = await this.prisma.survey.findUnique({
      where: { id: day.surveyId },
      select: { title: true, targetKind: true, deletedAt: true },
    });
    if (!survey || survey.deletedAt || survey.targetKind !== SurveyTargetKind.EMPLOYEE) return;
    const recipientUserIds = await usersWithResultsAccess(this.prisma, day.surveyId, await this.surveyResultsUserIds());
    if (!recipientUserIds.length) return;
    const [completed, total] = await Promise.all([
      this.prisma.surveyRecipient.count({ where: { surveyId: day.surveyId, status: 'COMPLETED' } }),
      this.prisma.surveyRecipient.count({ where: { surveyId: day.surveyId } }),
    ]);
    const note = unlinkedDaySummary(survey.title, day.day, day.answers, { completed, total });
    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.SYSTEM_MESSAGE,
      module: NotificationModule.EMPLOYEE,
      severity: NotificationSeverity.INFO,
      title: note.title,
      message: note.message,
      recordType: 'Survey',
      recordId: day.surveyId,
      metadata: { href: `/surveys/${day.surveyId}/responses`, surveyId: day.surveyId, day: day.day, eventType: 'SURVEY_UNLINKED_ANSWERS_DAY' },
    });
  }

  /**
   * In-app notification to office users who can see survey results (surveys.read / surveys.manage,
   * plus Super Admin) when a carer answers with their name. Answers linked to no one are told once a
   * day instead (notifyOfficeOfUnlinkedDay).
   */
  private async notifyOfficeOfEmployeeResponse(surveyId: string, employeeId: string | null) {
    const recipientUserIds = await usersWithResultsAccess(this.prisma, surveyId, await this.surveyResultsUserIds());
    if (!recipientUserIds.length) return;

    const [survey, completed, total] = await Promise.all([
      this.prisma.survey.findUnique({
        where: { id: surveyId },
        select: { title: true, isAnonymous: true },
      }),
      this.prisma.surveyRecipient.count({ where: { surveyId, status: 'COMPLETED' } }),
      this.prisma.surveyRecipient.count({ where: { surveyId } }),
    ]);
    if (!survey) return;

    // Never for an anonymous survey (its answers are told once a day).
    if (survey.isAnonymous) return;
    let who = 'A carer';
    if (employeeId) {
      const detail = await this.prisma.employeePersonalDetail.findFirst({
        where: { employeeId },
        select: { firstName: true, lastName: true },
      });
      const name = `${detail?.firstName ?? ''} ${detail?.lastName ?? ''}`.trim();
      if (name) who = name;
    }
    const message = `${who} completed "${survey.title}". ${completed} of ${total} responded.`;

    await this.notifications.notifyUsers({
      recipientUserIds,
      type: NotificationType.SYSTEM_MESSAGE,
      module: NotificationModule.EMPLOYEE,
      severity: NotificationSeverity.INFO,
      title: `Survey response — ${survey.title}`,
      message,
      recordType: 'Survey',
      recordId: surveyId,
      metadata: {
        href: `/surveys/${surveyId}/responses`,
        surveyId,
        eventType: 'SURVEY_RESPONSE_SUBMITTED',
      },
    });
  }

  private async surveyResultsUserIds(): Promise<string[]> {
    const [perms, superAdmin] = await Promise.all([
      this.prisma.permission.findMany({
        where: { key: { in: ['surveys.read', 'surveys.manage'] }, deletedAt: null, isActive: true },
        select: { id: true },
      }),
      this.prisma.role.findMany({
        where: { name: IDENTITY_ROLE.SUPER_ADMIN, deletedAt: null, isActive: true },
        select: { id: true },
      }),
    ]);
    const roleLinks = perms.length
      ? await this.prisma.rolePermission.findMany({
          where: { permissionId: { in: perms.map((p) => p.id) }, role: { deletedAt: null } },
          select: { roleId: true },
        })
      : [];
    const roleIds = unique([...roleLinks.map((r) => r.roleId), ...superAdmin.map((r) => r.id)]);
    if (!roleIds.length) return [];
    const userRoles = await this.prisma.userRole.findMany({
      where: { roleId: { in: roleIds }, user: { deletedAt: null, isActive: true } },
      select: { userId: true },
    });
    return unique(userRoles.map((ur) => ur.userId));
  }

  /** Why a submit could not claim the person: already answered, or another submit is in progress. */
  private async refusedClaim(recipientId: string): Promise<ConflictException> {
    const now = await this.prisma.surveyRecipient
      .findUnique({ where: { id: recipientId }, select: { status: true } })
      .catch(() => null);
    if (!now || now.status === 'COMPLETED') {
      return new ConflictException({ message: 'You have already completed this survey.', code: SURVEY_ALREADY_COMPLETED });
    }
    // Its own code: unlike "already completed", an app holding these answers must keep them and try
    // again later (the claim may have been left by a submit that failed before keeping anything).
    return new ConflictException({
      message:
        'Your answers are already being sent. If this survey does not show as completed, please try again in half an hour.',
      code: SURVEY_ANSWER_IN_PROGRESS,
    });
  }

  /**
   * Staff recording a named person's answers on an anonymous survey: claim the person before the
   * answers are held. No recipient row yet → one is created already claimed (Started, never Sent, so
   * nothing is delivered to them; two staff racing to create it → P2002, refused before anything is
   * held). Already answered, or their own submit in progress → null: the answers are still recorded
   * and nobody is marked — whether this person has answered is never revealed on an anonymous survey,
   * so recording never refuses on it (as before).
   */
  private async claimForRecording(
    survey: Survey,
    person: { employeeId: string } | { serviceUserId: string },
    actorId: string,
    now: Date,
    stamp: Date,
  ): Promise<{ recipientId: string; claim: string; created: boolean } | null> {
    const existing = await this.prisma.surveyRecipient.findFirst({
      where: { surveyId: survey.id, ...person },
      select: { id: true },
    });
    if (existing) {
      const claim = await claimRecipient(this.prisma, existing.id, { now, updatedAt: stamp });
      return claim ? { recipientId: existing.id, claim, created: false } : null;
    }
    const claim = randomUUID();
    const created = await this.prisma.surveyRecipient.create({
      data: {
        surveyId: survey.id,
        targetKind: survey.targetKind,
        employeeId: 'employeeId' in person ? person.employeeId : null,
        serviceUserId: 'serviceUserId' in person ? person.serviceUserId : null,
        token: randomUUID(),
        status: 'STARTED',
        sentAt: stamp,
        // Made by answering, not sending: never a survey contact on an anonymous survey (4-week rule).
        addedByAnswer: true,
        createdById: actorId,
        createdAt: stamp,
        updatedAt: stamp,
        submitClaim: claim,
        submitClaimExpiresAt: submitClaimExpiry(now),
      },
      select: { id: true },
    });
    return { recipientId: created.id, claim, created: true };
  }

  /**
   * The recorded answer could not be held: give the claim back. A recipient row this recording
   * created (Started, never sent) is removed again — left behind, the survey would show as open in
   * the person's app although it was never sent to them. Removed only while it is still exactly as
   * created (our claim, Started); anything else falls back to releasing the claim. Nothing about the
   * person, the recipient or the answer is logged.
   */
  private async undoRecordingClaim(
    surveyId: string,
    claimed: { recipientId: string; claim: string; created: boolean },
    stamp: Date,
  ): Promise<void> {
    if (claimed.created) {
      try {
        const removed = await this.prisma.surveyRecipient.deleteMany({
          where: { id: claimed.recipientId, submitClaim: claimed.claim, status: 'STARTED' },
        });
        if (removed.count > 0) return;
      } catch (err) {
        this.logger.error(
          `Survey ${surveyId}: a recorded answer could not be kept and the recipient it created could not be removed (${errorKind(err)}).`,
        );
      }
    }
    await releaseClaim(this.prisma, claimed.recipientId, claimed.claim, stamp).catch((releaseErr: unknown) =>
      this.logger.error(
        `Survey ${surveyId}: a recorded answer could not be kept and its claim could not be released (${errorKind(releaseErr)}).`,
      ),
    );
  }

  /**
   * After the hold: mark the claimed person Completed (tried twice — a failure leaves the claim, so a
   * retry is refused until it lapses). Never fails the submit: the answer is kept. Logged without the
   * person, the recipient or the error's own message.
   */
  private async completeClaimedAfterHold(
    surveyId: string,
    recipientId: string,
    claim: string,
    stamp: Date,
    what: 'an answer' | 'a recorded answer',
  ): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const marked = await completeClaimed(this.prisma, recipientId, claim, stamp);
        if (marked.count === 0) {
          // Cannot happen while the claim is held (the hold takes milliseconds; the claim 15–30
          // minutes): only a claim that lapsed and was taken again. Cannot be undone — logged so it is seen.
          this.logger.error(
            `Survey ${surveyId}: ${what} was kept after its claim had lapsed; the survey may have a second answer from the same person.`,
          );
        }
        return;
      } catch (err) {
        lastError = err;
      }
    }
    this.logger.error(
      `Survey ${surveyId}: ${what} was kept but marking it answered failed (${errorKind(lastError)}).`,
    );
  }

  /**
   * A named recipient answers. On an anonymous survey (or answering without their name) the
   * recipient is only marked completed — the answers are held without any link to them and with the
   * date only, and written as a response later (see survey-pending-responses.ts).
   */
  private async submitRecipientResponse(
    recipient: {
      id: string;
      status: string;
      targetKind: SurveyTargetKind;
      employeeId: string | null;
      serviceUserId: string | null;
      response: { id: string; submittedAt: Date } | null;
      survey: Survey;
    },
    dto: SubmitSurveyResponseDto,
    meta?: RequestAuditMeta,
  ) {
    const survey = recipient.survey;
    const alreadyCompleted = Boolean(recipient.response) || recipient.status === 'COMPLETED';
    const availability = this.evaluateAvailability(survey, alreadyCompleted);
    if (!availability.canSubmit) {
      throw new BadRequestException(availability.reason ?? 'This survey is not accepting responses');
    }
    if (await this.lapsedNow(recipient)) throw new BadRequestException(CLOSED_FOR_YOU_REASON);

    if (dto.respondentRelation === SurveyRespondentRelation.STAFF) {
      throw new BadRequestException('Please choose who is answering this survey');
    }
    // Answering a named survey without their name: stored like an anonymous answer, and who answered
    // (self / family member / representative) is neither required nor kept.
    const withoutName = this.wantsAnswerWithoutName(survey, dto);
    const anonymous = survey.isAnonymous || withoutName;
    let respondentRelation: SurveyRespondentRelation | null = null;
    let respondentName: string | null = null;
    if (recipient.targetKind === SurveyTargetKind.SERVICE_USER && !withoutName) {
      if (!dto.respondentRelation) {
        throw new BadRequestException('Please choose who is answering this survey');
      }
      respondentRelation = dto.respondentRelation;
      respondentName =
        respondentRelation === SurveyRespondentRelation.SELF || anonymous
          ? null
          : dto.respondentName?.trim() || null;
    }

    const { questions, answerByQuestion, adjustments } = await this.validateAnswers(survey.id, dto, {
      withoutName: anonymous,
    });
    const now = new Date();
    const stamp = anonymous ? await this.anonymousTimestamp(now) : now;
    const channel =
      recipient.targetKind === SurveyTargetKind.SERVICE_USER
        ? SurveyResponseChannel.PORTAL
        : SurveyResponseChannel.ONLINE;

    let responseId: string;
    if (anonymous) {
      // Not linked to the person: the answers wait in the pending store (no recipient, person, token
      // or IP) until the survey job writes them in a shuffled batch. The person is CLAIMED first (one
      // conditional update; a racing second submit is refused there, before anything is held), the
      // answers are kept next, in their own transaction, and only then is the person's survey marked
      // Completed, in another — the answers are never written with either. A crash after the hold can
      // at worst let the person answer again once the claim lapses; it never loses an answer.
      // Without their name on a named survey: no branch either (everyone else's branch is known).
      const segment = withoutName
        ? { locationId: null, jobTitleId: null }
        : await this.respondentSegment(this.prisma, recipient, true);
      const answers = toPendingAnswers(this.mapAnswersForCreate(questions, answerByQuestion, null));
      const claim = await claimRecipient(this.prisma, recipient.id, { now, updatedAt: stamp });
      if (!claim) throw await this.refusedClaim(recipient.id);
      try {
        responseId = (
          await holdUnlinkedResponse(this.prisma, {
            surveyId: survey.id,
            isAnonymous: withoutName,
            channel,
            day: stamp,
            payload: { locationId: segment.locationId, respondentRelation, answers },
          })
        ).id;
      } catch (err) {
        // Nothing was held: give the claim back so the person can simply answer again.
        await releaseClaim(this.prisma, recipient.id, claim, stamp).catch((releaseErr: unknown) =>
          this.logger.error(
            `Survey ${survey.id}: an answer could not be kept and its claim could not be released (${errorKind(releaseErr)}).`,
          ),
        );
        throw err;
      }
      await this.completeClaimedAfterHold(survey.id, recipient.id, claim, stamp, 'an answer');
    } else {
      const response = await this.prisma.$transaction(async (tx) => {
        // Only one answer per person, even when two submits race (or an unlinked one is in progress).
        const marked = await tx.surveyRecipient.updateMany({
          where: { id: recipient.id, ...claimableWhere(now) },
          data: { status: 'COMPLETED', ...CLEARED_CLAIM },
        });
        if (marked.count === 0) return null;
        const segment = await this.respondentSegment(tx, recipient, false);
        return tx.surveyResponse.create({
          data: {
            surveyId: survey.id,
            recipientId: recipient.id,
            ...segment,
            isAnonymous: false,
            submittedById: null,
            respondentRelation,
            respondentName,
            channel,
            submittedAt: stamp,
            answers: {
              create: this.mapAnswersForCreate(questions, answerByQuestion, null),
            },
          },
        });
      });
      // Already answered, or their unlinked answer is being kept right now (or a claim a failed submit
      // left has not lapsed yet): said apart, so they are not told they answered when they did not.
      if (!response) throw await this.refusedClaim(recipient.id);
      responseId = response.id;
    }

    // Anonymous (or without their name): the audit trail must not link the answer to the person or
    // date it either — no row of its own (no recipient, response id, time or IP / device details),
    // only one more in the survey's count for the day, audited once the day is over.
    if (anonymous) {
      await this.countUnlinkedAnswer(survey.id, 'answered');
    } else {
      await this.audit.logAudit({
        userId: undefined,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_RESPONSE_SUBMITTED,
        recordType: 'SurveyResponse',
        recordId: responseId,
        newValues: { surveyId: survey.id, recipientId: recipient.id, answerCount: dto.answers.length, isAnonymous: false, linkKind: 'recipient' },
        metadata: { surveyId: survey.id, ...responseAuditAdjustments(adjustments, false) },
        ...meta,
      });
    }

    // Named answers are checked against the alert rules now; unlinked ones only once written out
    // in a batch (the survey job), grouped, so an alert can never point at who gave them.
    if (!anonymous) this.checkAlerts(responseId);

    // Carer answered with their name (app or email link) — tell the office. Never fails the submit.
    // Answers linked to no one are told once a day instead (notifyOfficeOfUnlinkedDay).
    if (recipient.targetKind === SurveyTargetKind.EMPLOYEE && !anonymous) {
      void this.notifyOfficeOfEmployeeResponse(survey.id, recipient.employeeId).catch((err) =>
        this.logger.warn(
          `Survey ${survey.id} response notification failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    return {
      message: 'Survey response submitted',
      // Unlinked: a receipt only (the held answer's id), not the stored response's id.
      data: { id: responseId, submittedAt: stamp.toISOString() },
    };
  }

  private async validateAnswers(
    surveyId: string,
    dto: SubmitSurveyResponseDto,
    opts: { withoutName?: boolean } = {},
  ) {
    // CareFlow-list options: answered from the entries in use (a code is taken as its name).
    const questions = await withLookupOptions(
      this.prisma,
      await this.prisma.surveyQuestion.findMany({
        where: { surveyId, deletedAt: null, isActive: true },
        orderBy: QUESTION_ORDER,
      }),
    );
    for (const a of dto.answers ?? []) {
      const q = questions.find((x) => x.id === a.questionId);
      if (q?.lookupEntries && Array.isArray(a.selectedOptions)) {
        a.selectedOptions = a.selectedOptions.map((v) => q.lookupEntries!.find((e) => e.code === v && e.isActive)?.name ?? v);
      }
    }
    if (questions.length === 0) {
      throw new BadRequestException('This survey has no questions');
    }

    const questionById = new Map(questions.map((q) => [q.id, q]));
    const answerByQuestion = new Map<string, SurveyAnswerItemDto>();
    for (const answer of dto.answers) {
      if (!questionById.has(answer.questionId)) {
        throw new BadRequestException(`Unknown question: ${answer.questionId}`);
      }
      if (answerByQuestion.has(answer.questionId)) {
        throw new BadRequestException('Duplicate answer for the same question');
      }
      answerByQuestion.set(answer.questionId, answer);
    }

    // Linked to no one (an anonymous survey, or answering without a name): the contact-me question
    // and its follow-ups are not asked (we could not reply), so anything sent for them is discarded.
    const notAsked = opts.withoutName ? questionsNotAskedWhenUnlinked(questions) : new Set<string>();
    for (const id of notAsked) answerByQuestion.delete(id);

    // Older carer apps do not know "clearing" answers ("None of these"): one sent with other
    // choices is dropped and the specific choices kept, before "Show only if" is worked out.
    const adjustments: ExclusiveOptionAdjustment[] = [];
    for (const question of questions) {
      const answer = answerByQuestion.get(question.id);
      if (question.questionType !== SurveyQuestionType.MULTI_SELECT || !answer?.selectedOptions) continue;
      const resolved = resolveExclusiveChoices(
        answer.selectedOptions,
        readExclusiveOptions(question.exclusiveOptions),
      );
      if (!resolved.dropped.length) continue;
      answerByQuestion.set(question.id, { ...answer, selectedOptions: resolved.selected });
      adjustments.push({ questionId: question.id, dropped: resolved.dropped, kept: resolved.selected });
    }

    // "Show only if": decided from the answers given, here — not trusted from the form. A hidden
    // question is not required and anything sent for it is discarded.
    const questionsByKey = new Map(questions.filter((q) => q.key).map((q) => [q.key!, q]));
    const hidden = questions.filter(
      (q) => notAsked.has(q.id) || !isQuestionShown(q, questionsByKey, (id) => answerByQuestion.get(id)),
    );
    for (const q of hidden) answerByQuestion.delete(q.id);
    const hiddenIds = new Set(hidden.map((q) => q.id));

    for (const question of questions) {
      if (hiddenIds.has(question.id)) continue;
      const answer = answerByQuestion.get(question.id);
      if (question.isRequired && !this.hasAnswerValue(question.questionType, answer)) {
        throw new BadRequestException(`Answer required for: ${question.questionText}`);
      }
      if (answer && this.hasAnswerValue(question.questionType, answer)) {
        this.assertAnswerMatchesType(question, answer);
        const other = readOtherOption(question.otherOption);
        if (
          other?.textRequired &&
          answerLabelsFor(question, answer).includes(other.label) &&
          !cleanRespondentText(answer.otherText)
        ) {
          throw new BadRequestException(`Please say what "${other.label}" is for: ${question.questionText}`);
        }
      }
    }

    return { questions, answerByQuestion, adjustments };
  }

  /**
   * Answer rows for a response. `anonymousStamp` (anonymous surveys) replaces the answers' own
   * created / updated times with the day-only stamp, so they cannot reveal the exact time either.
   * The respondent's Other text is kept only when they chose Other, and a comment only when the
   * question offers its comment box for the answer given (trimmed; empty is not kept).
   */
  private mapAnswersForCreate(
    questions: {
      id: string;
      questionType: SurveyQuestionType;
      options: Prisma.JsonValue;
      otherOption?: Prisma.JsonValue;
      commentConfig?: Prisma.JsonValue;
      lookupEntries?: LookupEntry[];
    }[],
    answerByQuestion: Map<string, SurveyAnswerItemDto>,
    anonymousStamp?: Date | null,
  ) {
    const questionById = new Map(questions.map((q) => [q.id, q]));
    return questions
      .map((q) => answerByQuestion.get(q.id))
      .filter((a): a is SurveyAnswerItemDto => Boolean(a))
      .filter((a) => this.hasAnswerValue(questionById.get(a.questionId)!.questionType, a))
      .map((a) => {
        const question = questionById.get(a.questionId)!;
        const labels = answerLabelsFor(question, a);
        const other = readOtherOption(question.otherOption);
        return {
          ...(anonymousStamp ? { createdAt: anonymousStamp, updatedAt: anonymousStamp } : {}),
          questionId: a.questionId,
          booleanValue: a.booleanValue ?? null,
          textValue: a.textValue?.trim() || null,
          numberValue:
            a.numberValue === undefined || a.numberValue === null ? null : new Prisma.Decimal(a.numberValue),
          // Built-in scale: an older form's "Neutral" is saved as today's middle label.
          selectedOptions:
            a.selectedOptions === undefined
              ? Prisma.JsonNull
              : (currentAnswerLabels(question.questionType, question.options, a.selectedOptions) as Prisma.InputJsonValue),
          otherText: other && labels.includes(other.label) ? cleanRespondentText(a.otherText) : null,
          comment: isCommentShown(question.commentConfig, true, labels) ? cleanRespondentText(a.comment) : null,
          // CareFlow list: the entries' stable codes, alongside their names at the time.
          lookupCodes: question.lookupEntries ? lookupCodesFor(question.lookupEntries, labels) : Prisma.JsonNull,
        };
      });
  }

  /** A personal survey link. Links to templates or deleted surveys never resolve. */
  private async requireRecipientByToken(token: string) {
    const cleaned = token?.trim();
    if (!cleaned) throw new NotFoundException('Survey link not found');

    const recipient = await this.prisma.surveyRecipient.findUnique({
      where: { token: cleaned },
      include: {
        survey: true,
        response: { select: { id: true, submittedAt: true } },
      },
    });
    if (
      !recipient ||
      recipient.survey.deletedAt ||
      recipient.survey.isTemplate ||
      recipient.survey.isCatalogue
    ) {
      throw new NotFoundException('Survey link not found');
    }
    return recipient;
  }

  private evaluateAvailability(
    survey: { status: SurveyStatus; opensAt: Date | null; closesAt: Date | null },
    alreadyCompleted: boolean,
  ): Availability {
    if (alreadyCompleted) {
      return { canSubmit: false, kind: 'COMPLETED', reason: 'You have already completed this survey.' };
    }
    if (survey.status === SurveyStatus.DRAFT) {
      return { canSubmit: false, kind: 'NOT_PUBLISHED', reason: 'This survey has not been published yet.' };
    }
    if (survey.status === SurveyStatus.CLOSED) {
      return { canSubmit: false, kind: 'ENDED', reason: 'This survey is closed.' };
    }
    const now = Date.now();
    if (survey.opensAt && survey.opensAt.getTime() > now) {
      return { canSubmit: false, kind: 'NOT_OPEN', reason: 'This survey is not open yet.' };
    }
    if (survey.closesAt && survey.closesAt.getTime() < now) {
      return { canSubmit: false, kind: 'ENDED', reason: 'This survey has ended.' };
    }
    return { canSubmit: true, kind: null, reason: null };
  }

  /** The organisation's public contact details (company profile), for a survey that cannot be answered. */
  private async organisationContact(): Promise<{ name: string; phone: string | null; email: string | null } | null> {
    const profile = await this.prisma.companyProfile
      ?.findFirst({ select: { displayName: true, companyName: true, phoneNumber: true, email: true } })
      .catch(() => null);
    if (!profile) return null;
    return {
      name: profile.displayName?.trim() || profile.companyName,
      phone: profile.phoneNumber?.trim() || null,
      email: profile.email?.trim() || null,
    };
  }

  private normalizeOptions(questionType: SurveyQuestionType, options: unknown): string[] | null {
    if (questionType === SurveyQuestionType.LIKERT) {
      const fromDb = this.asStringArray(options);
      return fromDb.length ? fromDb : [...DEFAULT_LIKERT_OPTIONS];
    }
    if (
      questionType === SurveyQuestionType.SINGLE_SELECT ||
      questionType === SurveyQuestionType.MULTI_SELECT
    ) {
      return this.asStringArray(options);
    }
    return null;
  }

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string');
  }

  private hasAnswerValue(
    questionType: SurveyQuestionType,
    answer: SurveyAnswerItemDto | undefined,
  ): boolean {
    if (!answer) return false;
    switch (questionType) {
      case SurveyQuestionType.YES_NO:
        return typeof answer.booleanValue === 'boolean';
      case SurveyQuestionType.SINGLE_SELECT:
      case SurveyQuestionType.LIKERT:
      case SurveyQuestionType.MULTI_SELECT:
        return Array.isArray(answer.selectedOptions) && answer.selectedOptions.length > 0;
      case SurveyQuestionType.TEXT:
      case SurveyQuestionType.TEXTAREA:
        return Boolean(answer.textValue?.trim());
      case SurveyQuestionType.NUMBER:
      case SurveyQuestionType.RATING:
        return typeof answer.numberValue === 'number' && !Number.isNaN(answer.numberValue);
      default:
        return false;
    }
  }

  private assertAnswerMatchesType(
    question: {
      questionText: string;
      questionType: SurveyQuestionType;
      options: unknown;
      config: unknown;
      otherOption?: unknown;
      exclusiveOptions?: unknown;
    },
    answer: SurveyAnswerItemDto,
  ) {
    const label = question.questionText;
    // Choice questions can also be answered with their "Other" choice.
    const other = readOtherOption(question.otherOption);
    const choices = (opts: string[]) => (other ? [...opts, other.label] : opts);
    switch (question.questionType) {
      case SurveyQuestionType.YES_NO: {
        if (typeof answer.booleanValue !== 'boolean') {
          throw new BadRequestException(`Yes/No answer required for: ${label}`);
        }
        return;
      }
      case SurveyQuestionType.SINGLE_SELECT:
      case SurveyQuestionType.LIKERT: {
        const opts = choices(this.normalizeOptions(question.questionType, question.options) ?? []);
        // A form opened before the built-in scale was reworded may still send "Neutral".
        const selected = currentAnswerLabels(question.questionType, question.options, answer.selectedOptions ?? []);
        if (selected.length !== 1 || !opts.includes(selected[0]!)) {
          throw new BadRequestException(`Invalid choice for: ${label}`);
        }
        return;
      }
      case SurveyQuestionType.MULTI_SELECT: {
        const opts = choices(this.normalizeOptions(question.questionType, question.options) ?? []);

        const selected = answer.selectedOptions ?? [];
        // The same choice twice would be counted twice in the results.
        if (!selected.length || selected.some((s) => !opts.includes(s)) || new Set(selected).size !== selected.length) {
          throw new BadRequestException(`Invalid choices for: ${label}`);
        }
        const exclusive = readExclusiveOptions(question.exclusiveOptions).find((o) => selected.includes(o));
        if (exclusive && selected.length > 1) {
          throw new BadRequestException(`"${exclusive}" cannot be chosen with other answers for: ${label}`);
        }
        return;

      }
      case SurveyQuestionType.TEXT:
      case SurveyQuestionType.TEXTAREA: {
        if (!answer.textValue?.trim()) {
          throw new BadRequestException(`Text answer required for: ${label}`);
        }
        return;
      }
      case SurveyQuestionType.NUMBER:
      case SurveyQuestionType.RATING: {
        if (typeof answer.numberValue !== 'number' || Number.isNaN(answer.numberValue)) {
          throw new BadRequestException(`Number answer required for: ${label}`);
        }
        if (question.questionType === SurveyQuestionType.RATING) {
          const { min, max } = ratingRange(question.config);
          if (!Number.isInteger(answer.numberValue) || answer.numberValue < min || answer.numberValue > max) {
            throw new BadRequestException(`Rating must be a whole number from ${min} to ${max} for: ${label}`);
          }
        }
        return;
      }
      default:
        throw new BadRequestException(`Unsupported question type for: ${label}`);
    }
  }
}
