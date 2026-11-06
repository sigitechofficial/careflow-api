import { SurveyQuestionType, SurveyStatus, type SurveyResponseChannel } from '@prisma/client';
import { MIN_ANONYMOUS_GROUP_SIZE } from './survey-breakdown.util';
import { STAFF_RECORDED_CHANNELS } from './dto/record-survey-response.dto';
import { readShowIf } from './survey-question-config.util';

/**
 * Respondent-chosen anonymity on named (confidential) surveys. When a survey allows it
 * (Survey.allowAnonymousResponses), each person may choose "Answer without my name": the response
 * is then stored like an anonymous one — no recipient link, no branch or job title, day-only times,
 * no name / IP / device in notifications or the audit log — and the contact-me question is not
 * asked (we could not reply). Their written answers are held back like an anonymous survey's.
 */

/**
 * The closing "Would you like someone to contact you…" question (survey library house style; same
 * text as CONTACT_ME_PREFIX in prisma/seed-lib/survey-library.ts — a spec checks they agree).
 */
export const CONTACT_ME_PREFIX = 'Would you like someone to contact you';
const CONTACT_ME_PATTERN = /^\s*would you like (someone|us) to (contact|get in touch with) you\b/i;

/** What respondents see as the choice (forms and the carer app show the same words). */
export const ANSWER_WITHOUT_NAME_LABEL = 'Answer without my name — we will not be able to reply to you';

/**
 * Said to the person alongside the choice (forms, portal and the carer app): their survey still
 * turns Completed, so staff can see that they answered — never which answers are theirs.
 */
export const ANSWER_WITHOUT_NAME_NOTE = 'Staff can see that you have answered, but not which answers are yours.';

/**
 * Removing a question once anyone has answered the survey. Deliberately says nothing about whether
 * that question has answers: some answers (given without a name) are held back from the counts, and
 * a refusal that depended on them would reveal they exist.
 */
export const QUESTION_REMOVAL_REFUSED = "This question can't be removed once the survey has responses.";

/** A YES_NO question asking whether the person would like to be contacted about their answers. */
export function isContactRequestQuestion(q: { questionType: SurveyQuestionType | string; questionText: string }): boolean {
  return q.questionType === SurveyQuestionType.YES_NO && CONTACT_ME_PATTERN.test(q.questionText ?? '');
}

/**
 * The questions not asked of anyone whose answers are linked to no one (an anonymous survey, or
 * answering without a name): the contact-me question — we could not reply — and the questions asked
 * only after it (its contact-details follow-ups), however deep. An anonymous survey made before
 * contact-me was refused there may still hold them: they are never shown and any answer is discarded.
 */
export function questionsNotAskedWhenUnlinked(
  questions: ReadonlyArray<{ id: string; key: string | null; questionType: SurveyQuestionType | string; questionText: string; showIf: unknown }>,
): Set<string> {
  const out = new Set(questions.filter((q) => isContactRequestQuestion(q)).map((q) => q.id));
  const keyOf = new Map(questions.map((q) => [q.id, q.key]));
  let changed = out.size > 0;
  while (changed) {
    changed = false;
    const removedKeys = new Set([...out].map((id) => keyOf.get(id)).filter((k): k is string => Boolean(k)));
    for (const q of questions) {
      const rule = readShowIf(q.showIf);
      if (!out.has(q.id) && rule && removedKeys.has(rule.questionKey)) {
        out.add(q.id);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * An anonymous survey never asks "Would you like someone to contact you…": its answers are linked to
 * no one, so nobody could be contacted (the same rule as answering without a name).
 */
export const CONTACT_ME_ON_ANONYMOUS_REFUSED =
  'This survey is anonymous, so nobody could be contacted about their answers. A "Would you like someone to contact you" question cannot be added — ask people to contact the office instead, or make the survey named.';

/** Whether a survey offers the choice: named surveys with the setting on. */
export function offersAnswerWithoutName(survey: { isAnonymous: boolean; allowAnonymousResponses?: boolean | null }): boolean {
  return !survey.isAnonymous && Boolean(survey.allowAnonymousResponses);
}

/** The setting as stored: never on for an anonymous survey (every answer there is anonymous). */
export function storedAllowAnonymousResponses(isAnonymous: boolean, allow: boolean | null | undefined): boolean {
  return !isAnonymous && Boolean(allow);
}

/**
 * A response the person chose to give without their name (online, on a named survey). Responses
 * staff recorded as anonymous (paper with the number crossed out, phone) are not linked to anyone
 * either, but the person's survey was never marked answered, so nothing can be matched to them.
 */
export function isAnsweredWithoutName(response: { isAnonymous: boolean; channel: SurveyResponseChannel | string }): boolean {
  return response.isAnonymous && !(STAFF_RECORDED_CHANNELS as readonly string[]).includes(response.channel);
}

/** Written answers from people who answered without their name: shown only from this many such answers. */
export const MIN_WITHOUT_NAME_WRITTEN_ANSWERS = MIN_ANONYMOUS_GROUP_SIZE;

export type WithoutNameVisibility = {
  /** Every such written answer is shown. */
  all: boolean;
  /** Survey ids (the survey and / or closed periods) whose such written answers are shown. */
  surveyIds: Set<string>;
  note: string | null;
};

/**
 * Named survey: written answers (Other text, comments, short and long text answers) from people
 * who answered without their name follow the anonymous-survey rule — shown only once the survey
 * (or a repeating survey's period) has closed and at least MIN_WITHOUT_NAME_WRITTEN_ANSWERS people
 * answered it without their name. Otherwise a new comment could be matched to the person whose
 * survey has just turned to Completed.
 */
export function withoutNameWrittenVisibility(
  survey: { id: string; status: SurveyStatus },
  periods: Array<{ id: string; status: SurveyStatus }>,
  withoutNameBySurvey: ReadonlyMap<string, number>,
): WithoutNameVisibility {
  const isSeries = periods.length > 0;
  const closed = isSeries
    ? periods.filter((p) => p.status === SurveyStatus.CLOSED).map((p) => p.id)
    : survey.status === SurveyStatus.CLOSED
      ? [survey.id]
      : [];
  const closedCount = closed.reduce((sum, id) => sum + (withoutNameBySurvey.get(id) ?? 0), 0);
  const rule = `Written answers from people who answered without their name are shown once the ${isSeries ? 'period' : 'survey'} has closed and at least ${MIN_WITHOUT_NAME_WRITTEN_ANSWERS} people have answered that way, so they cannot be traced to anyone.`;
  if (!closed.length || closedCount < MIN_WITHOUT_NAME_WRITTEN_ANSWERS) {
    return { all: false, surveyIds: new Set(), note: rule };
  }
  if (closed.length < periods.length) {
    return { all: false, surveyIds: new Set(closed), note: `Closed periods only. ${rule}` };
  }
  return { all: true, surveyIds: new Set(closed), note: null };
}

/**
 * Named survey: who chose to answer without their name can be seen (their survey turns Completed
 * but no named response is linked to them), and everyone else's answers are shown with their name.
 * With only a few such answers, whatever is not named would be theirs — read directly from the list
 * or worked out from the totals — and while the survey is open, a new unnamed answer could be matched
 * to whoever has just turned Completed. So their answers (every part: per-question counts, flags,
 * written answers, CQC scale answers) are left out of the results, the response list and
 * per-question counts until the survey (or a repeating survey's period) has CLOSED and at least this
 * many people have answered it that way. They are still counted in "Responses" and in the
 * "answered without a name" totals.
 */
export const MIN_WITHOUT_NAME_ANSWERS = MIN_ANONYMOUS_GROUP_SIZE;

/** Whether a survey's (or period's) answers given without a name are still left out. */
export function withoutNameAnswersHeldBack(
  isAnonymousSurvey: boolean,
  withoutNameCount: number,
  /** That survey (or period) has closed (status CLOSED). */
  closed: boolean,
): boolean {
  return !isAnonymousSurvey && withoutNameCount > 0 && (!closed || withoutNameCount < MIN_WITHOUT_NAME_ANSWERS);
}

/** Why some responses are not shown or counted yet; null when none are held back. */
export function withoutNameHeldBackNote(held: number): string | null {
  if (held <= 0) return null;
  return `${held} ${held === 1 ? 'response was' : 'responses were'} given without a name and ${held === 1 ? 'is' : 'are'} not shown or counted in the answers yet: they are included once the survey (or period) has closed and at least ${MIN_WITHOUT_NAME_ANSWERS} people have answered that way, so they cannot be traced to anyone.`;
}

/** Prisma filter: responses given without a name online (portal, link or carer app). */
export const ANSWERED_WITHOUT_NAME = {
  isAnonymous: true,
  channel: { notIn: [...STAFF_RECORDED_CHANNELS] as SurveyResponseChannel[] },
};

/** Prisma filter: responses that are not "answered without a name" (named, or recorded by staff). */
export const NOT_ANSWERED_WITHOUT_NAME = { NOT: ANSWERED_WITHOUT_NAME };

/** "3 of 40 responses (8%) were given without a name"; share as a whole per cent. */
export function withoutNameShare(withoutName: number, responses: number): number {
  return responses > 0 ? Math.round((withoutName / responses) * 100) : 0;
}
