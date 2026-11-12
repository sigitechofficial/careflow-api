/** Lower case, accents and punctuation removed. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Letter pairs of a word, padded so starts and ends count. */
function pairs(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of s.split(' ')) {
    const p = ` ${w} `;
    for (let i = 0; i < p.length - 1; i++) {
      const k = p.slice(i, i + 2);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}

/** Edits to turn one into the other, a swap of two neighbouring letters counting as one ("Jnoes" → "Jones"). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** 0..1: how alike two names are: the better of letter-pair overlap and edit distance (typos, swapped letters). */
export function nameSimilarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  const longest = Math.max(na.length, nb.length);
  const byEdits = longest ? 1 - editDistance(na, nb) / longest : 0;
  return Math.max(byEdits, pairSimilarity(na, nb));
}

function pairSimilarity(a: string, b: string): number {
  const pa = pairs(a);
  const pb = pairs(b);
  let shared = 0;
  let total = 0;
  for (const [, n] of pa) total += n;
  for (const [, n] of pb) total += n;
  for (const [k, n] of pa) shared += Math.min(n, pb.get(k) ?? 0);
  return total ? (2 * shared) / total : 0;
}

/**
 * The known names closest to what was typed ("Mery Jnes" → "Mary Jones"). A one-word search is compared with each
 * word of a name too ("Jnes" → "Jones"). Only fairly close matches count.
 */
export function closestNames(typed: string, names: string[], limit = 3, threshold = 0.6): string[] {
  const q = norm(typed);
  if (q.length < 3) return [];
  const oneWord = !q.includes(' ');
  const scored: Array<{ name: string; score: number }> = [];
  for (const name of names) {
    let score = nameSimilarity(q, name);
    if (oneWord) for (const part of norm(name).split(' ')) score = Math.max(score, nameSimilarity(q, part));
    if (score >= threshold) scored.push({ name: oneWord ? bestPart(q, name) : name, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return [...new Set(scored.map((s) => s.name))].slice(0, limit);
}

/** For a one-word search, the word of the name that matched (search "Jones", not the whole name). */
function bestPart(q: string, name: string): string {
  let best = name;
  let bestScore = nameSimilarity(q, name);
  for (const part of name.split(' ')) {
    const s = nameSimilarity(q, part);
    if (s > bestScore) {
      best = part;
      bestScore = s;
    }
  }
  return best;
}
