import { BadRequestException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  LOOKUP_QUESTION_TYPES,
  SURVEY_LOOKUP_SOURCES,
  SURVEY_LOOKUP_SOURCE_KEYS,
  lookupSourceKey,
  type SurveyLookupSource,
} from '../../prisma/seed-lib/survey-lookup-sources';

export { SURVEY_LOOKUP_SOURCES, SURVEY_LOOKUP_SOURCE_KEYS, lookupSourceKey, type SurveyLookupSource };

/**
 * Choice questions whose options come from a CareFlow list (ethnicity, sexual orientation, gender,
 * sex, language, marital status). People answering see the list's ACTIVE entries, in its groups;
 * an answer is kept by the entry's stable code (SurveyAnswer.lookupCodes) with its name at the time
 * (selectedOptions), so renaming or retiring an entry never breaks results.
 *
 * Reporting: these are equality questions. Results show the group heading (the part of the name
 * before " - ", e.g. "Asian" for "Asian - Gujarati"); a detailed entry is shown only when at least
 * EQUALITY_DETAIL_THRESHOLD (or the survey's reporting threshold, if higher) chose it. They are never
 * broken down by another characteristic, and on anonymous surveys (and answers given without a name)
 * individual responses show the group only and alerts cannot check individual entries.
 */
export const EQUALITY_DETAIL_THRESHOLD = 10;

export type LookupEntry = { code: string; name: string; isActive: boolean; group: string };

type Db = Prisma.TransactionClient | PrismaClient;

/** "Asian - Gujarati" → "Asian"; "Arab" → "Arab". */
export function lookupGroupOf(name: string): string {
  const i = name.indexOf(' - ');
  return (i > 0 ? name.slice(0, i) : name).trim();
}

/** Every entry of a list (active and retired), in name order. */
export async function loadLookup(db: Db, source: SurveyLookupSource): Promise<LookupEntry[]> {
  const table = SURVEY_LOOKUP_SOURCES[source].table; // from a fixed list, never user input
  const rows = await db.$queryRawUnsafe<Array<{ code: string; name: string; isActive: boolean }>>(
    `SELECT "code", "name", "isActive" FROM "service_users"."${table}" ORDER BY "name" ASC`,
  );
  return rows.map((r) => ({ code: r.code, name: r.name, isActive: r.isActive, group: lookupGroupOf(r.name) }));
}

/** The lists a set of questions needs, loaded once each. */
export async function loadLookups(db: Db, questions: ReadonlyArray<{ optionsFrom?: string | null }>): Promise<Map<SurveyLookupSource, LookupEntry[]>> {
  const out = new Map<SurveyLookupSource, LookupEntry[]>();
  for (const q of questions) {
    const key = lookupSourceKey(q.optionsFrom);
    if (key && !out.has(key)) out.set(key, await loadLookup(db, key));
  }
  return out;
}

export type WithLookup<Q> = Q & { lookupEntries?: LookupEntry[] };

/**
 * Questions with their CareFlow list filled in as `options` (active entries' names; with
 * `includeRetired`, every entry — for reading answers already given) and the list kept on
 * `lookupEntries`. Other questions are returned unchanged.
 */
export async function withLookupOptions<Q extends { optionsFrom?: string | null; options: unknown }>(
  db: Db,
  questions: Q[],
  opts: { includeRetired?: boolean } = {},
): Promise<Array<WithLookup<Q>>> {
  if (!questions.some((q) => q.optionsFrom)) return questions;
  const lists = await loadLookups(db, questions);
  return questions.map((q) => {
    const key = lookupSourceKey(q.optionsFrom);
    const entries = key ? lists.get(key) : undefined;
    if (!entries) return q;
    const shown = opts.includeRetired ? entries : entries.filter((e) => e.isActive);
    return { ...q, options: shown.map((e) => e.name), lookupEntries: entries };
  });
}

/** For respondents' forms: the entries in their groups (active only). */
export function lookupOptionGroups(entries: readonly LookupEntry[]): Array<{ group: string; options: Array<{ code: string; label: string }> }> {
  const groups = new Map<string, Array<{ code: string; label: string }>>();
  for (const e of entries.filter((x) => x.isActive)) {
    groups.set(e.group, [...(groups.get(e.group) ?? []), { code: e.code, label: e.name }]);
  }
  return [...groups].map(([group, options]) => ({ group, options }));
}

/** The codes for chosen names (names at the time; a code given instead of a name is accepted). */
export function lookupCodesFor(entries: readonly LookupEntry[], chosen: readonly string[]): string[] {
  return chosen
    .map((c) => entries.find((e) => e.name === c)?.code ?? entries.find((e) => e.code === c)?.code)
    .filter((c): c is string => Boolean(c));
}

/**
 * A CareFlow list chosen for a question being saved: its key, refusing a type that cannot use one
 * or fixed options given as well. Returns the active names (to validate the question's other
 * settings against) or null when the question has fixed options.
 */
export async function lookupForQuestion(
  db: Db,
  input: { optionsFrom?: string | null; questionType: string; options?: unknown },
): Promise<{ key: SurveyLookupSource; names: string[] } | null> {
  if (input.optionsFrom == null || input.optionsFrom === '') return null;
  const key = lookupSourceKey(input.optionsFrom);
  if (!key) throw new BadRequestException('Choose a CareFlow list for the options');
  if (!(LOOKUP_QUESTION_TYPES as readonly string[]).includes(input.questionType)) {
    throw new BadRequestException('Only single and multiple choice questions can take their options from a CareFlow list');
  }
  if (Array.isArray(input.options) && input.options.length) {
    throw new BadRequestException('A question takes its options from a CareFlow list or has its own, not both');
  }
  const names = (await loadLookup(db, key)).filter((e) => e.isActive).map((e) => e.name);
  if (names.length < 2) throw new BadRequestException(`The ${SURVEY_LOOKUP_SOURCES[key].label} list in Settings has fewer than two entries in use`);
  return { key, names };
}

/**
 * Results for a CareFlow-list question: counts by group, and the detailed entries chosen by at least
 * `detailThreshold` (the rest are only in their group's count). Counted by code (renaming is safe);
 * an answer from before codes were kept is matched by its name.
 */
export function lookupSummary(
  entries: readonly LookupEntry[],
  answers: ReadonlyArray<{ lookupCodes?: unknown; selectedOptions?: unknown }>,
  detailThreshold: number,
): {
  groups: Array<{ label: string; count: number; percent: number }>;
  details: Array<{ group: string; label: string; count: number }>;
  detailsHidden: number;
  answered: number;
} {
  const byCode = new Map(entries.map((e) => [e.code, e]));
  const byName = new Map(entries.map((e) => [e.name, e]));
  const groupCounts = new Map<string, number>();
  const entryCounts = new Map<string, { group: string; label: string; count: number }>();
  let answered = 0;
  for (const a of answers) {
    const codes = Array.isArray(a.lookupCodes) ? a.lookupCodes.filter((c): c is string => typeof c === 'string') : [];
    const names = Array.isArray(a.selectedOptions) ? a.selectedOptions.filter((c): c is string => typeof c === 'string') : [];
    const picked = codes.length
      ? codes.map((c, i) => byCode.get(c) ?? { code: c, name: names[i] ?? c, isActive: false, group: lookupGroupOf(names[i] ?? c) })
      : names.map((n) => byName.get(n) ?? { code: `name:${n}`, name: n, isActive: false, group: lookupGroupOf(n) });
    if (!picked.length) continue;
    answered += 1;
    for (const g of new Set(picked.map((p) => p.group))) groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
    for (const p of picked) {
      const cur = entryCounts.get(p.code) ?? { group: p.group, label: p.name, count: 0 };
      cur.count += 1;
      entryCounts.set(p.code, cur);
    }
  }
  const all = [...entryCounts.values()];
  const details = all.filter((d) => d.count >= detailThreshold && d.label !== d.group).sort((x, y) => y.count - x.count);
  return {
    groups: [...groupCounts]
      .map(([label, count]) => ({ label, count, percent: answered ? Math.round((count / answered) * 100) : 0 }))
      .sort((x, y) => y.count - x.count),
    details,
    detailsHidden: all.filter((d) => d.label !== d.group && d.count < detailThreshold).length,
    answered,
  };
}
