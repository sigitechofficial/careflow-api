/**
 * Surveys about each manager (SUR-STF-018 "Feedback on your manager"): one anonymous copy per
 * manager, sent only to the staff their staff record names them as supervisor of
 * (EmployeeEmployment.supervisorUserId), with the manager's name merged in for `{{manager}}`.
 *
 * Anonymity (see docs/SURVEY_ROADMAP.md A7):
 *  - a manager's own copy needs at least the survey's minimum team (library perManagerMinTeam,
 *    default and never below MIN_TEAM: CareFlow never sends an anonymous survey to fewer than 5);
 *  - smaller teams share one pooled copy, reported only as a group, worded "your line manager";
 *  - secondary suppression: the pooled copy is made only when it hides which manager an answer is
 *    about — at least MIN_POOL_MANAGERS managers, at least the minimum team in all, and no one manager's staff
 *    more than half of it. Otherwise none of those smaller teams is sent a copy that year;
 *  - staff named under a manager for less than MIN_NAMED_DAYS are left out (they cannot yet say);
 *  - a manager who can open surveys could watch their own copy's answer count: the plan warns, and
 *    copies are only made once someone confirms they have dealt with it.
 */

export const MANAGER_TOKEN = '{{manager}}';
/** What `{{manager}}` becomes in the pooled copy for smaller teams. */
export const POOLED_MANAGER_WORDS = 'your line manager';
export const MIN_TEAM = 5;
/** The highest minimum team a survey can ask for (library perManagerMinTeam). */
export const MAX_MIN_TEAM = 50;

/** A survey's minimum team (library perManagerMinTeam): a whole number from 5 to 50, else 5. */
export function managerMinTeam(libraryMeta: unknown): number {
  const v = libraryMeta && typeof libraryMeta === 'object' ? (libraryMeta as Record<string, unknown>).perManagerMinTeam : undefined;
  return typeof v === 'number' && Number.isInteger(v) ? Math.min(MAX_MIN_TEAM, Math.max(MIN_TEAM, v)) : MIN_TEAM;
}
/**
 * The range the minimum team may be set to when making the copies: never below the survey's
 * reporting threshold for results (its access policy's minimum answers) nor MIN_TEAM, never above
 * MAX_MIN_TEAM. A copy smaller than the threshold would only ever show its answers one by one.
 */
export function managerMinTeamBounds(reportingThreshold: number | null | undefined): { min: number; max: number } {
  const t = typeof reportingThreshold === 'number' && Number.isFinite(reportingThreshold) ? Math.floor(reportingThreshold) : 0;
  return { min: Math.min(MAX_MIN_TEAM, Math.max(MIN_TEAM, t)), max: MAX_MIN_TEAM };
}

/** Why the minimum team cannot go lower (the dialog says the same). */
export const minTeamFloorReason = (min: number) => `Below ${min}, answers could be traced to one person.`;

/**
 * The minimum team for this set of copies: `chosen` (from the dialog) when given, else the library
 * default raised to the floor. Refuses a chosen value outside the bounds; never quietly changes it.
 */
export function chooseManagerMinTeam(
  libraryDefault: number,
  bounds: { min: number; max: number },
  chosen?: number | null,
): { ok: true; minTeam: number } | { ok: false; message: string } {
  if (chosen === undefined || chosen === null) {
    return { ok: true, minTeam: Math.min(bounds.max, Math.max(bounds.min, libraryDefault)) };
  }
  if (typeof chosen !== 'number' || !Number.isInteger(chosen)) return { ok: false, message: 'The smallest team must be a whole number.' };
  if (chosen < bounds.min) return { ok: false, message: `The smallest team can be no fewer than ${bounds.min}. ${minTeamFloorReason(bounds.min)}` };
  if (chosen > bounds.max) return { ok: false, message: `The smallest team can be at most ${bounds.max}.` };
  return { ok: true, minTeam: chosen };
}

export const MIN_POOL_MANAGERS = 3;
/** About 3 months. */
export const MIN_NAMED_DAYS = 91;

export const hasManagerToken = (texts: ReadonlyArray<string | null | undefined>) => texts.some((t) => typeof t === 'string' && t.includes(MANAGER_TOKEN));

/** `{{manager}}` → the name (or "your line manager"), capitalised where it starts a sentence. */
export const fillManager = (text: string, name: string) =>
  text
    .replace(/(^|[.!?]\s+|\n\s*)\{\{manager\}\}/g, (_m, lead: string) => `${lead}${name.charAt(0).toLocaleUpperCase('en-GB')}${name.slice(1)}`)
    .split(MANAGER_TOKEN)
    .join(name);

/** Fill `{{manager}}` in every string of a JSON value. */
export function fillManagerDeep<T>(value: T, name: string): T {
  if (typeof value === 'string') return fillManager(value, name) as T;
  if (Array.isArray(value)) return value.map((v) => fillManagerDeep(v, name)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fillManagerDeep(v, name)])) as T;
  }
  return value;
}

export type ManagerTeam = {
  managerUserId: string;
  managerName: string;
  /** Holds survey access now (could watch their own copy's answer count). */
  holdsSurveyAccess: boolean;
  /**
   * The role label when this manager holds a role whose own staff are never asked (perManagerExclude,
   * e.g. "Registered Manager"): no copy, and their staff are never pooled.
   */
  excludedAs?: string | null;
  staff: Array<{ employeeId: string; name: string; /** When the staff record last named this manager (null = not known). */ namedSince: Date | null }>;
};

export type ManagerCopyPlan = {
  copies: Array<{
    managerUserId: string;
    managerName: string;
    employeeIds: string[];
    staffNames: string[];
    holdsSurveyAccess: boolean;
  }>;
  pooled: {
    managerUserIds: string[];
    managerNames: string[];
    employeeIds: string[];
    staffNames: string[];
    holdsSurveyAccess: string[];
  } | null;
  /** Managers whose staff get no copy this time, and why. */
  notSent: Array<{ managerName: string; reason: string }>;
  /** Staff left out because they have been named under the manager for less than about 3 months. */
  recentlyNamed: Array<{ managerName: string; count: number }>;
  /** Managers with survey access who would be rated (they must not hold it while their copy is open). */
  accessWarnings: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why a manager excluded by role gets no copy. */
export const excludedReason = (roleLabel: string) =>
  `The ${roleLabel}'s team is not asked: their answers could not stay anonymous.`;

/** `minTeam`: the fewest staff a manager's own copy (and the pooled copy) goes to; never below MIN_TEAM. */
export function planManagerCopies(teams: readonly ManagerTeam[], now: Date = new Date(), minTeam: number = MIN_TEAM): ManagerCopyPlan {
  const min = Math.max(MIN_TEAM, Math.floor(minTeam));
  const plan: ManagerCopyPlan = { copies: [], pooled: null, notSent: [], recentlyNamed: [], accessWarnings: [] };
  const small: Array<{ team: ManagerTeam; staff: ManagerTeam['staff'] }> = [];
  const sorted = [...teams].sort((a, b) => a.managerName.localeCompare(b.managerName, 'en-GB'));
  for (const team of sorted) {
    if (team.excludedAs) {
      plan.notSent.push({ managerName: team.managerName, reason: excludedReason(team.excludedAs) });
      continue;
    }
    const staff = team.staff.filter((s) => !s.namedSince || now.getTime() - s.namedSince.getTime() >= MIN_NAMED_DAYS * DAY_MS);
    const recent = team.staff.length - staff.length;
    if (recent) plan.recentlyNamed.push({ managerName: team.managerName, count: recent });
    if (!staff.length) {
      plan.notSent.push({ managerName: team.managerName, reason: 'Nobody has been named under them for 3 months yet.' });
    } else if (staff.length >= min) {
      plan.copies.push({
        managerUserId: team.managerUserId,
        managerName: team.managerName,
        employeeIds: staff.map((s) => s.employeeId),
        staffNames: staff.map((s) => s.name).sort((a, b) => a.localeCompare(b, 'en-GB')),
        holdsSurveyAccess: team.holdsSurveyAccess,
      });
      if (team.holdsSurveyAccess) plan.accessWarnings.push(team.managerName);
    } else {
      small.push({ team, staff });
    }
  }
  if (small.length) {
    const total = small.reduce((n, s) => n + s.staff.length, 0);
    const largest = Math.max(...small.map((s) => s.staff.length));
    const reason =
      small.length < MIN_POOL_MANAGERS
        ? `Fewer than ${min} staff, and the smaller-teams copy would cover only ${small.length} manager${small.length === 1 ? '' : 's'}, so its results would point at ${small.length === 1 ? 'them' : 'one of them'}.`
        : total < min
          ? `Fewer than ${min} staff, and all the smaller teams together are only ${total} people.`
          : largest * 2 > total
            ? `Fewer than ${min} staff, and one manager’s staff would be more than half of the smaller-teams copy, so its results would point at them.`
            : null;
    if (reason) {
      for (const s of small) plan.notSent.push({ managerName: s.team.managerName, reason });
    } else {
      plan.pooled = {
        managerUserIds: small.map((s) => s.team.managerUserId),
        managerNames: small.map((s) => s.team.managerName),
        employeeIds: small.flatMap((s) => s.staff.map((x) => x.employeeId)),
        staffNames: small.flatMap((s) => s.staff.map((x) => x.name)).sort((a, b) => a.localeCompare(b, 'en-GB')),
        holdsSurveyAccess: small.filter((s) => s.team.holdsSurveyAccess).map((s) => s.team.managerName),
      };
      plan.accessWarnings.push(...plan.pooled.holdsSurveyAccess);
    }
  }
  return plan;
}

/** Every place a survey can say {{manager}}: its questions (answers and section titles too) and its alert rules. */
export const MANAGER_TOKEN_QUESTION_SELECT = {
  id: true,
  questionText: true,
  helpText: true,
  sectionTitle: true,
  options: true,
  commentConfig: true,
  otherOption: true,
  exclusiveOptions: true,
  config: true,
} as const;
export const MANAGER_TOKEN_RULE_SELECT = { id: true, title: true, whenText: true, actionText: true, conditions: true } as const;

/** Whether a survey says {{manager}} anywhere: details, section introductions, questions, answers, section titles, alert rules. */
export function surveyNamesManager(
  survey: { title: string; description: string | null; closingMessage: string | null; sectionIntros: unknown },
  questions: ReadonlyArray<object>,
  rules: ReadonlyArray<object>,
): boolean {
  return hasManagerToken([
    survey.title,
    survey.description,
    survey.closingMessage,
    JSON.stringify(survey.sectionIntros ?? null),
    ...questions.map((q) => JSON.stringify(q)),
    ...rules.map((r) => JSON.stringify(r)),
  ]);
}

/** Fill `{{manager}}` in an object's keys as well as its values (section introductions are keyed by title). */
export function fillManagerKeysDeep<T>(value: T, name: string): T {
  if (Array.isArray(value)) return value.map((v) => fillManagerKeysDeep(v, name)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [fillManager(k, name), fillManagerKeysDeep(v, name)]),
    ) as T;
  }
  return fillManagerDeep(value, name);
}

/** Sending a survey that still names {{manager}} (it is the starting point for the copies). */
export const MANAGER_TOKEN_MESSAGE =
  'This survey still says {{manager}} where a manager’s name goes. Use "Make a copy for each manager" and send those copies instead.';
