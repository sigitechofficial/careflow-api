/**
 * Acting on results (Phase 2 part 6): pure helpers for actions, team discussions, "You said, we did" and the pack.
 */
import { normaliseText } from './survey-text-themes.util';

export const ACTION_SOURCES = ['QUESTION', 'THEME', 'ALERT', 'DISCUSSION', 'GENERAL'] as const;
export type ActionSource = (typeof ACTION_SOURCES)[number];
export const ACTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ACTION_TASK_SOURCE = 'SURVEY_ACTION';

export const DISCUSSION_KINDS = {
  TEAM_MEETING: 'Team meeting',
  STAFF_FORUM: 'Staff forum',
  SUPERVISION_GROUP: 'Group supervision',
  MANAGEMENT_MEETING: 'Management meeting',
  CLIENT_OR_FAMILY_MEETING: 'Meeting with people we support or families',
  OTHER: 'Other',
} as const;
export type DiscussionKind = keyof typeof DISCUSSION_KINDS;

export const YSWD_CHANNELS = ['PORTAL', 'APP', 'LETTER', 'PUBLIC'] as const;
export type YswdChannel = (typeof YSWD_CHANNELS)[number];
export const YSWD_MAX_ITEMS = 12;
export const YSWD_TEXT_MAX = 600;

/** Words in a row shared with a written answer that make an item read as a quote. */
export const QUOTE_RUN_WORDS = 8;

const words = (t: string) => normaliseText(t).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Whether `text` repeats QUOTE_RUN_WORDS or more words in a row from any written answer. A quote can point to who wrote
 * it (their way of putting things, a detail only they know), so "You said, we did" must say it in other words.
 */
export function quotesWrittenAnswer(text: string, writtenAnswers: ReadonlyArray<string>, run = QUOTE_RUN_WORDS): boolean {
  const w = words(text);
  if (w.length < run) return false;
  const grams = new Set<string>();
  for (let i = 0; i + run <= w.length; i++) grams.add(w.slice(i, i + run).join(' '));
  for (const a of writtenAnswers) {
    const aw = words(a);
    for (let i = 0; i + run <= aw.length; i++) if (grams.has(aw.slice(i, i + run).join(' '))) return true;
  }
  return false;
}

export type YswdItem = { youSaid: string; weDid: string; actionId?: string | null };

/** Items read leniently from storage. */
export function readItems(v: unknown): YswdItem[] {
  return Array.isArray(v)
    ? v.flatMap((x) =>
        x && typeof x === 'object' && typeof (x as YswdItem).youSaid === 'string' && typeof (x as YswdItem).weDid === 'string'
          ? [{ youSaid: (x as YswdItem).youSaid, weDid: (x as YswdItem).weDid, actionId: typeof (x as YswdItem).actionId === 'string' ? (x as YswdItem).actionId : null }]
          : [],
      )
    : [];
}

export type EvidenceAction = { youSaid: string; weDid: string; actionId?: string };

/**
 * CQC evidence "You said, we did" after an action changes: entries this action wrote before are replaced (or removed
 * when it is no longer done with both parts); entries typed on the evidence itself are kept; an identical typed entry
 * is not repeated.
 */
export function mergeEvidenceActions(existing: ReadonlyArray<EvidenceAction>, action: { id: string; done: boolean; youSaid: string | null; weDid: string | null }): EvidenceAction[] {
  const same = (a: EvidenceAction) => a.youSaid.trim() === (action.youSaid ?? '').trim() && a.weDid.trim() === (action.weDid ?? '').trim();
  const kept = existing.filter((a) => a.actionId !== action.id);
  if (!action.done || !action.youSaid?.trim() || !action.weDid?.trim()) return kept;
  if (kept.some((a) => !a.actionId && same(a))) return kept;
  return [...kept, { youSaid: action.youSaid.trim(), weDid: action.weDid.trim(), actionId: action.id }];
}

/** The role task's status for an action's status. */
export function taskStatusFor(status: ActionStatus): 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' {
  return status;
}

/** "57%" / "4.2" / "–" for a figure label. */
export function figureWords(p: { kind: string; percent?: number | null; average?: number | null; base?: number; count?: number } | null): string {
  if (!p) return 'not shown';
  if (p.kind === 'AVERAGE') return p.average == null ? 'no answers' : `average ${p.average}`;
  if (p.percent == null) return 'no answers';
  return p.kind === 'YES' ? `${p.percent}% said Yes` : `${p.percent}% gave one of the top two answers`;
}
