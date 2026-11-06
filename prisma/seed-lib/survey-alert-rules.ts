/**
 * Structured alerts for the ready-made survey library: the shared vocabulary.
 *
 * Every library alert has a "when" and an "action" in words (managers read them). An alert that
 * can be checked from the answers alone also carries a `rule`, which CareFlow turns into a task:
 *
 *   "rule": {
 *     "task": "Feels unsafe with care workers",          // the task's title (≤ 80 characters)
 *     "if": [                                              // fires when ANY of these matches
 *       { "question": "q-safe", "answers": ["Sometimes", "Rarely", "Never"] }
 *     ],
 *     "owner": "SAFEGUARDING_LEAD",                        // who does it (SURVEY_ALERT_OWNERS)
 *     "dueWorkingDays": 0,                                 // 0 = the same working day, or instead
 *     "dueCalendarDays": 7,                                //   calendar days ("within 7 days")
 *     "urgent": true,                                      // tell the role at once (optional)
 *     "record": "SAFEGUARDING",                            // record to start (optional)
 *     "contactRequest": true,                              // contact-me follow-up list (optional)
 *     "minimumAnswers": 10                                 // anonymous answers: raise only if at least
 *   }                                                      // this many answered (optional, 5–100)
 *
 * Combining: `if` holds when ANY entry holds. An entry `{ "all": [ {…}, {…} ] }` holds only when
 * every condition in it does ("poor supervision AND asked to be contacted"; "help most nights AND
 * the night care is a sleep-in"). A condition with `"not": true` holds when the question was
 * answered but none of its `answers` was chosen (a gap in a multi-select checklist). A question not
 * answered never matches.
 *
 * Answers given without a name (anonymous surveys, "answer without my name") raise grouped,
 * count-only alerts only when the survey or period closes and only if at least the survey's
 * reporting threshold (5 at the least, or `minimumAnswers` when higher) answered that way.
 *
 * `question` is the question's id, or its exact text when it has no id. `answers` are exact answer
 * choices (YES_NO: "Yes" / "No"; RATING: the scores as text). Parts of an alert that need someone to
 * read a written answer ("any comment suggesting abuse") cannot be a rule: they stay in the words,
 * and the "when" says so. Kept free of src/ imports (the seed runs without it); src imports it.
 */

/** Library roles an alert can go to, with the organisation role names they usually match. */
export const SURVEY_ALERT_OWNERS = {
  REGISTERED_MANAGER: { label: 'Registered Manager', names: ['Registered Manager'] },
  DEPUTY_MANAGER: { label: 'Deputy Manager', names: ['Deputy Manager', 'Manager'] },
  NOMINATED_INDIVIDUAL: { label: 'Nominated Individual', names: ['Nominated Individual'] },
  CARE_COORDINATOR: { label: 'Care Coordinator', names: ['Care Coordinator', 'Coordinator'] },
  FIELD_CARE_SUPERVISOR: { label: 'Field Care Supervisor', names: ['Field Care Supervisor', 'Senior Carer/Nurse', 'Senior Carer'] },
  SAFEGUARDING_LEAD: { label: 'Safeguarding lead', names: ['Safeguarding Lead', 'Registered Manager'] },
  HR_MANAGER: { label: 'HR manager', names: ['HR Manager', 'HR'] },
  TRAINING_LEAD: { label: 'Training lead', names: ['Training Lead', 'Training Manager'] },
  MEDICINES_LEAD: { label: 'Medicines lead', names: ['Medicines Lead', 'Registered Manager'] },
} as const;

export type SurveyAlertOwnerKey = keyof typeof SURVEY_ALERT_OWNERS;
export const SURVEY_ALERT_OWNER_KEYS = Object.keys(SURVEY_ALERT_OWNERS) as SurveyAlertOwnerKey[];

/** Records an alert can start (complaints and compliments are both FeedbackRecord). */
export const SURVEY_ALERT_RECORDS = ['COMPLAINT', 'COMPLIMENT', 'SAFEGUARDING', 'INCIDENT'] as const;
export type SurveyAlertRecordKind = (typeof SURVEY_ALERT_RECORDS)[number];

export const MAX_ALERT_TASK_LENGTH = 80;
export const MAX_ALERT_DUE_WORKING_DAYS = 60;
export const MAX_ALERT_DUE_CALENDAR_DAYS = 365;

export type LibraryAlertCondition = { question: string; answers: string[]; not?: boolean };
export type LibraryAlertEntry = LibraryAlertCondition | { all: LibraryAlertCondition[] };
export type LibraryAlertRule = {
  task: string;
  if: LibraryAlertEntry[];
  minimumAnswers?: number;
  owner: SurveyAlertOwnerKey;
  /** Working days (0 = the same working day). Give this or dueCalendarDays. */
  dueWorkingDays?: number;
  /** Calendar days, when the policy says "within 7 days" (due the last working day on or before). */
  dueCalendarDays?: number;
  urgent?: boolean;
  record?: SurveyAlertRecordKind;
  contactRequest?: boolean;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A question as the rule checker needs it. */
export type AlertRuleQuestion = { key: string; text: string; type: string; choices: string[] | null; contactMe: boolean; lookup?: boolean };

/**
 * Problems with one alert's rule (none when it has no rule). `questions` are the survey's questions
 * in order; `anonymous` surveys cannot have contact-me rules (nobody could be contacted).
 */
export function alertRuleProblems(
  rule: unknown,
  questions: readonly AlertRuleQuestion[],
  opts: { anonymous: boolean; neverRouteTo?: readonly string[] },
): string[] {
  if (rule === undefined) return [];
  if (!isObject(rule)) return ['rule must be an object'];
  const errors: string[] = [];
  const allowed = new Set(['task', 'if', 'owner', 'dueWorkingDays', 'dueCalendarDays', 'urgent', 'record', 'contactRequest', 'minimumAnswers']);
  for (const k of Object.keys(rule)) if (!allowed.has(k)) errors.push(`rule has an unknown field "${k}"`);
  const task = typeof rule.task === 'string' ? rule.task.trim() : '';
  if (!task) errors.push('rule.task (the task title) is required');
  else if (task.length > MAX_ALERT_TASK_LENGTH) errors.push(`rule.task must be at most ${MAX_ALERT_TASK_LENGTH} characters`);
  if (typeof rule.owner !== 'string' || !(SURVEY_ALERT_OWNER_KEYS as string[]).includes(rule.owner)) {
    errors.push(`rule.owner must be one of ${SURVEY_ALERT_OWNER_KEYS.join(', ')}`);
  }
  const due = rule.dueWorkingDays;
  const cal = rule.dueCalendarDays;
  if ((due === undefined) === (cal === undefined)) {
    errors.push('rule needs exactly one of dueWorkingDays (working days) and dueCalendarDays (calendar days)');
  }
  if (due !== undefined && (!Number.isInteger(due) || (due as number) < 0 || (due as number) > MAX_ALERT_DUE_WORKING_DAYS)) {
    errors.push(`rule.dueWorkingDays must be a whole number from 0 (the same working day) to ${MAX_ALERT_DUE_WORKING_DAYS}`);
  }
  if (cal !== undefined && (!Number.isInteger(cal) || (cal as number) < 1 || (cal as number) > MAX_ALERT_DUE_CALENDAR_DAYS)) {
    errors.push(`rule.dueCalendarDays must be a whole number from 1 to ${MAX_ALERT_DUE_CALENDAR_DAYS}`);
  }
  if (rule.urgent !== undefined && typeof rule.urgent !== 'boolean') errors.push('rule.urgent must be true or false');
  if (rule.record !== undefined && !(SURVEY_ALERT_RECORDS as readonly unknown[]).includes(rule.record)) {
    errors.push(`rule.record must be one of ${SURVEY_ALERT_RECORDS.join(', ')}`);
  }
  if (rule.contactRequest !== undefined && typeof rule.contactRequest !== 'boolean') errors.push('rule.contactRequest must be true or false');
  if (rule.minimumAnswers !== undefined && (!Number.isInteger(rule.minimumAnswers) || (rule.minimumAnswers as number) < 5 || (rule.minimumAnswers as number) > 100)) {
    errors.push('rule.minimumAnswers must be a whole number from 5 to 100');
  }
  if (opts.neverRouteTo?.includes(String(rule.owner))) {
    errors.push(`rule.owner ${String(rule.owner)} is one of the roles this survey rates (alertsNeverTo): choose another owner`);
  }
  const conditions = Array.isArray(rule.if) ? rule.if : null;
  if (!conditions || !conditions.length) {
    errors.push('rule.if needs at least one { question, answers }');
    return errors;
  }
  // Entries hold one condition, or { all: [two or more] }; a question appears once per entry.
  const checkEntry = (list: unknown[]) => {
    const seen = new Set<string>();
    for (const c of list) checkOne(c, seen);
  };
  for (const e of conditions) {
    if (isObject(e) && 'all' in e) {
      if (!Array.isArray(e.all) || e.all.length < 2 || Object.keys(e).length !== 1) {
        errors.push('a rule.if "all" entry needs a list of at least two conditions (and nothing else)');
        continue;
      }
      if (e.all.some((x) => isObject(x) && 'all' in x)) errors.push('"all" entries cannot be nested');
      checkEntry(e.all);
    } else {
      checkEntry([e]);
    }
  }
  if (rule.contactRequest === true) {
    if (opts.anonymous) errors.push('an anonymous survey cannot have a contact-me rule (nobody could be contacted)');
    const only = conditions.length === 1 && isObject(conditions[0]) && !('all' in conditions[0]) ? conditions[0] : null;
    const q = only ? questions.find((x) => x.key === String(only.question).trim() || x.text === String(only.question).trim()) : null;
    if (!q || !q.contactMe || only?.not === true || !Array.isArray(only?.answers) || only.answers.length !== 1 || only.answers[0] !== 'Yes') {
      errors.push('a contactRequest rule must check only the contact-me question answered Yes');
    }
  }
  return errors;

  function checkOne(c: unknown, seen: Set<string>) {
    if (!isObject(c) || typeof c.question !== 'string' || !Array.isArray(c.answers) || !c.answers.length) {
      errors.push('each rule.if condition needs a question and at least one answer');
      return;
    }
    for (const k of Object.keys(c)) if (!['question', 'answers', 'not'].includes(k)) errors.push(`rule.if condition has an unknown field "${k}"`);
    if (c.not !== undefined && typeof c.not !== 'boolean') errors.push('rule.if "not" must be true or false');
    const ref = c.question.trim();
    const matches = questions.filter((q) => q.key === ref || q.text === ref);
    if (matches.length !== 1) {
      errors.push(`rule.if question "${ref.slice(0, 60)}" must be one question's id or exact text (found ${matches.length})`);
      return;
    }
    const q = matches[0];
    if (seen.has(q.key)) errors.push(`rule.if names "${ref.slice(0, 60)}" twice in one entry; list all its answers once`);
    seen.add(q.key);
    if (q.lookup) {
      errors.push(`rule.if question "${ref.slice(0, 60)}" takes its answers from a CareFlow list (each organisation's own): library rules cannot name its entries`);
      return;
    }
    if (!q.choices) {
      errors.push(`rule.if question "${ref.slice(0, 60)}" is a written answer: alerts can only check chosen answers`);
      return;
    }
    for (const a of c.answers) {
      if (typeof a !== 'string' || !q.choices.includes(a)) errors.push(`rule.if answer "${String(a)}" is not an answer to "${ref.slice(0, 60)}"`);
    }
    if (new Set(c.answers).size !== c.answers.length) errors.push(`rule.if lists an answer to "${ref.slice(0, 60)}" twice`);
    if (c.not === true && c.answers.length >= q.choices.length) errors.push(`rule.if "not" on "${ref.slice(0, 60)}" must leave some answers`);
  }
}
