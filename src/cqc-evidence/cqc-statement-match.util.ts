/**
 * Matching quality-statement labels from library metadata to the framework.
 *
 * Survey (and later policy) library files name statements by title, sometimes with the key
 * question in front ("Safe: Safe and effective staffing") or with a small spelling difference
 * ("Medicine optimisation"). Statements also carry aliases for these. Matching ignores case,
 * punctuation, "&" vs "and" and dash style.
 */

export type MatchableStatement = {
  id: string;
  code: string;
  title: string;
  aliases: string[];
  keyQuestionCode: string;
};

const KEY_QUESTION_PREFIX = /^\s*(safe|effective|caring|responsive|well[\s-]?led)\s*[:\-–—]\s*/i;

/** Lower case, "&" → "and", punctuation and dashes to spaces, single spaces. */
export function normaliseStatementLabel(label: string): string {
  return label
    .toLocaleLowerCase('en-GB')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The key question code a "Safe: …" prefix names, or null. */
export function keyQuestionPrefix(label: string): string | null {
  const m = KEY_QUESTION_PREFIX.exec(label);
  if (!m) return null;
  return m[1].toUpperCase().replace(/[\s-]/g, '_').replace('WELLLED', 'WELL_LED');
}

/**
 * The statement a label names, or null. A "Key question: title" prefix must agree with the
 * statement's key question when it is given.
 */
export function matchStatement<S extends MatchableStatement>(label: string, statements: readonly S[]): S | null {
  if (typeof label !== 'string' || !label.trim()) return null;
  const prefix = keyQuestionPrefix(label);
  const wanted = normaliseStatementLabel(label.replace(KEY_QUESTION_PREFIX, ''));
  if (!wanted) return null;
  const candidates = statements.filter((s) => !prefix || s.keyQuestionCode === prefix);
  for (const s of candidates) {
    if (normaliseStatementLabel(s.code) === wanted) return s;
    if ([s.title, ...s.aliases].some((t) => normaliseStatementLabel(t) === wanted)) return s;
  }
  return null;
}

/** Statements named by a list of labels (unique, in framework order), plus the labels that matched nothing. */
export function matchStatements<S extends MatchableStatement>(
  labels: readonly string[],
  statements: readonly S[],
): { matched: S[]; unmatched: string[] } {
  const ids = new Set<string>();
  const unmatched: string[] = [];
  for (const label of labels) {
    const s = matchStatement(label, statements);
    if (s) ids.add(s.id);
    else if (typeof label === 'string' && label.trim()) unmatched.push(label);
  }
  return { matched: statements.filter((s) => ids.has(s.id)), unmatched };
}
