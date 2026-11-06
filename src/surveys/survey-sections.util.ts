import { Prisma } from '@prisma/client';

/**
 * Sections of a survey. A section is the `sectionTitle` its questions share: consecutive questions
 * with the same title form a section (the heading is shown once, before the first of them). Each
 * section can have a short introduction, shown under its heading to people answering:
 * Survey.sectionIntros { [title]: text }. Ready-made surveys bring theirs in libraryMeta.sections
 * (`introduction`); the survey's own entries win, and an empty one means "removed".
 */
export const SECTION_TITLE_MAX = 200;
export const SECTION_INTRO_MAX = 300;

type IntroSource = { sectionIntros?: Prisma.JsonValue | null; libraryMeta?: Prisma.JsonValue | null };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** The ready-made survey's section introductions (libraryMeta.sections[].introduction). */
export function libraryIntros(libraryMeta: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const sections = isObject(libraryMeta) && Array.isArray(libraryMeta.sections) ? libraryMeta.sections : [];
  for (const s of sections) {
    if (isObject(s) && typeof s.title === 'string' && typeof s.introduction === 'string' && s.introduction.trim()) {
      out[s.title] = s.introduction.trim();
    }
  }
  return out;
}

/** The survey's own entries as stored ('' = removed on purpose). */
export function storedIntros(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObject(value)) return out;
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v.trim();
  return out;
}

/** The introductions people see: the ready-made ones, then the survey's own (empty = none). */
export function sectionIntrosOf(survey: IntroSource): Record<string, string> {
  const merged = { ...libraryIntros(survey.libraryMeta), ...storedIntros(survey.sectionIntros) };
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== ''));
}

/** Only the sections the questions actually have (what forms are sent). */
export function introsForQuestions(
  intros: Record<string, string>,
  questions: ReadonlyArray<{ sectionTitle?: string | null }>,
): Record<string, string> {
  const titles = new Set(questions.map((q) => q.sectionTitle?.trim()).filter((t): t is string => Boolean(t)));
  return Object.fromEntries(Object.entries(intros).filter(([t]) => titles.has(t)));
}

/** For a copy (duplicate, period, template use): the introductions as they are now, stored on it. */
export function sectionIntrosForCopy(survey: IntroSource): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const intros = sectionIntrosOf(survey);
  return Object.keys(intros).length ? intros : Prisma.JsonNull;
}

/** Runs of consecutive questions with the same title, in order ("" = no section). */
export function sectionRuns<Q extends { sectionTitle?: string | null }>(ordered: readonly Q[]): Array<{ title: string; questions: Q[] }> {
  const runs: Array<{ title: string; questions: Q[] }> = [];
  for (const q of ordered) {
    const title = q.sectionTitle?.trim() ?? '';
    const last = runs[runs.length - 1];
    if (last && last.title === title) last.questions.push(q);
    else runs.push({ title, questions: [q] });
  }
  return runs;
}

/** Section titles used on questions that are not next to each other (the heading shows twice). */
export function splitSections(ordered: ReadonlyArray<{ sectionTitle?: string | null }>): string[] {
  const seen = new Map<string, number>();
  for (const run of sectionRuns(ordered)) if (run.title) seen.set(run.title, (seen.get(run.title) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([t]) => t);
}
