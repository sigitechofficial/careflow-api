import {
  conditionProblems,
  flatConditions,
  isGroup,
  readConditions,
  type AlertConditionEntry,
  type AlertQuestion,
  type AlertRuleRow,
  type StoredAlertCondition,
} from './survey-alert-rules.util';

/**
 * Applying a ready-made update to an adopted template (SurveyLibraryService.applyUpdate): what
 * happens to the template's alert rules and its own section introductions. Pure, so the update
 * dialog can show it first (forTemplate) and applyUpdate does exactly what was shown.
 *
 * Question keys are frozen against the library revision (prisma/seed-lib/survey-library.ts,
 * releasedIdProblems): a key keeps its question for good, a question taken out is recorded in
 * keyChanges.retiredQuestions and a renamed or dropped answer in keyChanges.answerChanges.
 */

export type LibraryKeyChanges = {
  retiredQuestions: Array<{ id: string; revision: number; reason: string }>;
  answerChanges: Array<{ question: string; from: string; to: string | null; revision: number }>;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** libraryMeta.keyChanges, read safely. */
export function readKeyChanges(libraryMeta: unknown): LibraryKeyChanges {
  const k = isObject(libraryMeta) && isObject(libraryMeta.keyChanges) ? libraryMeta.keyChanges : {};
  const retiredQuestions = (Array.isArray(k.retiredQuestions) ? k.retiredQuestions : []).flatMap((r) =>
    isObject(r) && typeof r.id === 'string' && Number.isInteger(r.revision)
      ? [{ id: r.id, revision: r.revision as number, reason: typeof r.reason === 'string' ? r.reason : '' }]
      : [],
  );
  const answerChanges = (Array.isArray(k.answerChanges) ? k.answerChanges : []).flatMap((c) =>
    isObject(c) && typeof c.question === 'string' && typeof c.from === 'string' && (c.to === null || typeof c.to === 'string') && Number.isInteger(c.revision)
      ? [{ question: c.question, from: c.from, to: c.to as string | null, revision: c.revision as number }]
      : [],
  );
  return { retiredQuestions, answerChanges };
}

/** An alert rule as stored on the template. */
export type ExistingRule = {
  id: string;
  key: string;
  title: string;
  whenText: string;
  actionText: string;
  conditions: unknown;
  ownerKey: string | null;
  roleId: string | null;
  dueWorkingDays: number;
  dueCalendarDays: number | null;
  urgent: boolean;
  recordKind: string | null;
  contactRequest: boolean;
  isActive: boolean;
  libraryAlert: number | null;
  minimumAnswers: number | null;
};

export type RulePlanStep =
  /** A ready-made rule the organisation never changed: takes the new ready-made version. */
  | { kind: 'refresh'; ruleId: string; title: string; row: AlertRuleRow }
  /** A ready-made rule the new version no longer has (and the organisation never changed). */
  | { kind: 'remove'; ruleId: string; title: string }
  /** The organisation's own or changed rule, its answers renamed to the new version's. */
  | { kind: 'map'; ruleId: string; title: string; conditions: AlertConditionEntry[]; changes: string[] }
  /** The organisation's own or changed rule, unchanged. */
  | { kind: 'keep'; ruleId: string; title: string }
  /** A rule that can no longer work as it was set: turned off, the manager is told why. */
  | { kind: 'turnOff'; ruleId: string; title: string; reason: string }
  /** A new ready-made alert. */
  | { kind: 'add'; title: string; row: AlertRuleRow };

export type LibraryUpdatePlan = {
  rules: RulePlanStep[];
  /** The template's own section introductions kept (their sections are still there). */
  sectionIntros: Record<string, string> | null;
  /** Section introductions dropped, because their section is no longer in the survey. */
  droppedSectionIntros: string[];
};

const norm = (v: unknown): string => {
  const sort = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(sort)
      : isObject(x)
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])]))
        : x;
  return JSON.stringify(sort(v));
};

/** Same rule as the ready-made row it came from (the organisation never changed it). */
function sameAsLibrary(r: ExistingRule, row: AlertRuleRow, fill: (s: string) => string): boolean {
  return (
    fill(r.title) === fill(row.title) &&
    fill(r.whenText) === fill(row.whenText) &&
    fill(r.actionText) === fill(row.actionText) &&
    norm(readConditions(r.conditions)) === norm(row.conditions) &&
    r.ownerKey === row.ownerKey &&
    r.roleId === null &&
    r.dueWorkingDays === row.dueWorkingDays &&
    (r.dueCalendarDays ?? null) === (row.dueCalendarDays ?? null) &&
    r.urgent === row.urgent &&
    (r.recordKind ?? null) === (row.recordKind ?? null) &&
    r.contactRequest === row.contactRequest &&
    r.isActive &&
    // Set up before the library minimum was copied (null) counts as unchanged.
    (r.minimumAnswers === null || r.minimumAnswers === row.minimumAnswers)
  );
}

/**
 * The answers a condition checks, mapped through the library's answer changes between the two
 * revisions (applied in revision order, so a renamed-then-renamed answer follows both). null when
 * the rule cannot be kept safely, with the reason.
 */
function mapCondition(
  c: StoredAlertCondition,
  changes: LibraryKeyChanges,
  range: { from: number; to: number },
  questionText: (key: string) => string,
): { condition: StoredAlertCondition; notes: string[] } | { reason: string } {
  const retired = changes.retiredQuestions.find((r) => r.id === c.questionKey && r.revision > range.from && r.revision <= range.to);
  if (retired) {
    return { reason: `"${questionText(c.questionKey)}" was taken out of the ready-made survey${retired.reason ? ` (${retired.reason})` : ''}.` };
  }
  const steps = changes.answerChanges
    .filter((a) => a.question === c.questionKey && a.revision > range.from && a.revision <= range.to)
    .sort((a, b) => a.revision - b.revision);
  if (!steps.length) return { condition: c, notes: [] };
  const notes: string[] = [];
  let answers = [...c.answers];
  for (const step of steps) {
    if (!answers.includes(step.from)) continue;
    if (step.to === null) {
      // Dropping an answer from a "not chosen" list would widen what the rule catches.
      if (c.not) return { reason: `The answer "${step.from}" was taken out of "${questionText(c.questionKey)}", which this rule checks as "not chosen".` };
      answers = answers.filter((a) => a !== step.from);
      notes.push(`"${step.from}" is no longer an answer`);
    } else {
      answers = [...new Set(answers.map((a) => (a === step.from ? step.to! : a)))];
      notes.push(`"${step.from}" is now "${step.to}"`);
    }
  }
  if (!answers.length) {
    return { reason: `None of the answers this rule checks on "${questionText(c.questionKey)}" is in the ready-made survey any more.` };
  }
  return { condition: c.not ? { questionKey: c.questionKey, answers, not: true } : { questionKey: c.questionKey, answers }, notes };
}

/**
 * What applying the update does to the template's rules and section introductions.
 * - A ready-made rule the organisation never changed takes the new version (or goes, if the new
 *   version has no such alert).
 * - The organisation's own and changed rules keep their settings; answers the library renamed are
 *   renamed in them. A rule that would check a question taken out, an answer gone from a "not
 *   chosen" check, or anything else the new questions cannot answer is turned off (never left
 *   firing on the wrong thing), and the manager is told why.
 * - New ready-made alerts are added. A ready-made rule the organisation deleted stays deleted.
 * `rulesSetUp` false: the template has no rules yet (they are copied from the new version when first
 * needed), so there is nothing to plan.
 */
export function planLibraryUpdate(input: {
  rulesSetUp: boolean;
  rules: readonly ExistingRule[];
  /** Ready-made rows of the revision the template has (its own libraryMeta and current questions). */
  oldLibraryRows: readonly AlertRuleRow[];
  /** Ready-made rows of the new revision, for the new questions. */
  newLibraryRows: readonly AlertRuleRow[];
  newQuestions: readonly AlertQuestion[];
  oldQuestions: readonly AlertQuestion[];
  changes: LibraryKeyChanges;
  fromRevision: number;
  toRevision: number;
  sectionIntros: unknown;
  newSectionTitles: readonly string[];
  /** The organisation's name in place of {{organisation}} (rules may hold either). */
  fill: (s: string) => string;
}): LibraryUpdatePlan {
  const rules: RulePlanStep[] = [];
  const range = { from: input.fromRevision, to: input.toRevision };
  const text = (key: string) =>
    input.oldQuestions.find((q) => q.key === key)?.questionText ?? input.newQuestions.find((q) => q.key === key)?.questionText ?? key;
  if (input.rulesSetUp) {
    const oldByAlert = new Map(input.oldLibraryRows.flatMap((r) => (r.libraryAlert === null ? [] : [[r.libraryAlert, r] as const])));
    const newByAlert = new Map(input.newLibraryRows.flatMap((r) => (r.libraryAlert === null ? [] : [[r.libraryAlert, r] as const])));
    for (const r of input.rules) {
      const libraryRow = r.libraryAlert !== null ? oldByAlert.get(r.libraryAlert) : undefined;
      if (libraryRow && sameAsLibrary(r, libraryRow, input.fill)) {
        const next = newByAlert.get(r.libraryAlert!);
        rules.push(next ? { kind: 'refresh', ruleId: r.id, title: next.title, row: next } : { kind: 'remove', ruleId: r.id, title: r.title });
        continue;
      }
      const conditions = readConditions(r.conditions);
      const notes: string[] = [];
      let reason: string | null = null;
      const mapOne = (c: StoredAlertCondition): StoredAlertCondition | null => {
        const out = mapCondition(c, input.changes, range, text);
        if ('reason' in out) {
          reason ??= out.reason;
          return null;
        }
        notes.push(...out.notes.map((n) => `${n} in "${text(c.questionKey)}"`));
        return out.condition;
      };
      const mapped: AlertConditionEntry[] = conditions.map((e) =>
        isGroup(e) ? { all: e.all.map((c) => mapOne(c) ?? c) } : (mapOne(e) ?? e),
      );
      if (!reason) {
        const problems = conditionProblems(mapped, input.newQuestions);
        if (problems.length) {
          const gone = flatConditions(mapped).find((c) => !input.newQuestions.some((q) => q.key === c.questionKey));
          reason = gone ? `"${text(gone.questionKey)}" is no longer in the survey.` : problems[0]!;
        }
      }
      if (reason) {
        // Already off: nothing changes, but the manager still sees why it cannot be turned back on.
        rules.push({ kind: 'turnOff', ruleId: r.id, title: r.title, reason });
      } else if (notes.length) {
        rules.push({ kind: 'map', ruleId: r.id, title: r.title, conditions: mapped, changes: notes });
      } else {
        rules.push({ kind: 'keep', ruleId: r.id, title: r.title });
      }
    }
    const present = new Set(input.rules.flatMap((r) => (r.libraryAlert === null ? [] : [r.libraryAlert])));
    for (const row of input.newLibraryRows) {
      if (row.libraryAlert === null || present.has(row.libraryAlert)) continue;
      // A ready-made rule the old version already had and the organisation deleted stays deleted.
      if (oldByAlert.has(row.libraryAlert)) continue;
      rules.push({ kind: 'add', title: row.title, row });
    }
  }

  const intros = isObject(input.sectionIntros) ? input.sectionIntros : {};
  const titles = new Set(input.newSectionTitles);
  const kept: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [title, value] of Object.entries(intros)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (titles.has(title)) kept[title] = value;
    else dropped.push(title);
  }
  return { rules, sectionIntros: Object.keys(kept).length ? kept : null, droppedSectionIntros: dropped };
}

/** The plan in the words the update dialog and the audit use. */
export function describePlan(plan: LibraryUpdatePlan) {
  const of = (kind: RulePlanStep['kind']) => plan.rules.filter((s) => s.kind === kind);
  return {
    refreshed: of('refresh').map((s) => s.title),
    added: of('add').map((s) => s.title),
    removed: of('remove').map((s) => s.title),
    renamedAnswers: of('map').map((s) => ({ title: s.title, changes: s.kind === 'map' ? s.changes : [] })),
    kept: of('keep').map((s) => s.title),
    turnedOff: of('turnOff').map((s) => ({ title: s.title, reason: s.kind === 'turnOff' ? s.reason : '' })),
    sectionIntrosKept: Object.keys(plan.sectionIntros ?? {}),
    sectionIntrosDropped: plan.droppedSectionIntros,
  };
}
