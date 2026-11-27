import type {
  CqcRating,
  CqcScoringRules,
} from '../cqc-mock-inspection/cqc-mock-inspection-scoring.util';
import type {
  KeyQuestionChange,
  StatementChange,
} from '../cqc-mock-inspection/cqc-mock-inspection-compare.util';

/**
 * The average change across branches for the CQC dashboard. For each branch (and the whole
 * organisation), each key question's latest score is compared with the score before it, and the same
 * for each quality statement; the dashboard shows the average of those across the branches. A focused
 * inspection only moves the key questions and statements it covers. Pure: the service loads the rows.
 */

export type AveragedInspection = {
  id: string;
  /** The branch; null = the whole organisation. */
  locationId: string | null;
  keyQuestions: { code: string; percent: number | null }[];
  statements: { code: string; score: number }[];
};

export type Named = { code: string; title: string };

export type AverageComparison = {
  /** The branches that had something to compare (null = the whole organisation). */
  branchIds: (string | null)[];
  /** The inspections compared (newer `toId` against older `fromId`), newest first. */
  compared: { fromId: string; toId: string }[];
  /** The average of the key questions' averages, in percent, and the band that gives. */
  overall: {
    from: CqcRating | null;
    to: CqcRating | null;
    fromPercent: number | null;
    toPercent: number | null;
    change: number | null;
  };
  keyQuestions: (KeyQuestionChange & { branchCount: number })[];
  improved: StatementChange[];
  declined: StatementChange[];
  unchangedCount: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The key question band a percentage falls in (no limiters: an average has no single statement). */
function band(percent: number, rules: CqcScoringRules | null) {
  return (
    rules?.keyQuestionBands.find((b) => percent > b.abovePercent)?.rating ??
    null
  );
}

/**
 * For each code, one { from, to } per branch: the branch's latest value and the one before it.
 * `inspections` are newest first.
 */
function latestPairs(
  inspections: AveragedInspection[],
  valuesOf: (i: AveragedInspection) => [string, number][],
) {
  const byBranch = new Map<string | null, AveragedInspection[]>();
  for (const i of inspections)
    byBranch.set(i.locationId, [...(byBranch.get(i.locationId) ?? []), i]);
  const pairs = new Map<
    string,
    { from: number; to: number; fromId: string; toId: string }[]
  >();
  const branches = new Set<string | null>();
  for (const [branch, rows] of byBranch) {
    const seen = new Map<string, { v: number; id: string }[]>();
    for (const r of rows)
      for (const [code, v] of valuesOf(r)) {
        const list = seen.get(code) ?? [];
        if (list.length < 2) list.push({ v, id: r.id });
        seen.set(code, list);
      }
    for (const [code, [to, from]] of seen) {
      if (from === undefined) continue;
      pairs.set(code, [
        ...(pairs.get(code) ?? []),
        { from: from.v, to: to.v, fromId: from.id, toId: to.id },
      ]);
      branches.add(branch);
    }
  }
  return { pairs, branches };
}

export function averageComparison(
  inspections: AveragedInspection[],
  keyQuestions: Named[],
  statements: Named[],
  rules: CqcScoringRules | null,
): AverageComparison | null {
  const kq = latestPairs(inspections, (i) =>
    i.keyQuestions.flatMap((k) =>
      k.percent === null ? [] : [[k.code, k.percent] as [string, number]],
    ),
  );
  const st = latestPairs(inspections, (i) =>
    i.statements.map((s) => [s.code, s.score] as [string, number]),
  );
  if (!kq.pairs.size && !st.pairs.size) return null;

  const kqRows = keyQuestions.flatMap((k) => {
    const p = kq.pairs.get(k.code);
    if (!p) return [];
    const from = mean(p.map((x) => x.from));
    const to = mean(p.map((x) => x.to));
    return [
      {
        code: k.code,
        title: k.title,
        fromRating: band(from, rules),
        toRating: band(to, rules),
        fromPercent: round1(from),
        toPercent: round1(to),
        change: round1(to - from),
        branchCount: p.length,
      },
    ];
  });
  const overallFrom = kqRows.length
    ? mean(kqRows.map((k) => k.fromPercent))
    : null;
  const overallTo = kqRows.length ? mean(kqRows.map((k) => k.toPercent)) : null;

  const improved: StatementChange[] = [];
  const declined: StatementChange[] = [];
  let unchangedCount = 0;
  for (const s of statements) {
    const p = st.pairs.get(s.code);
    if (!p) continue;
    const from = round1(mean(p.map((x) => x.from)));
    const to = round1(mean(p.map((x) => x.to)));
    if (to > from) improved.push({ code: s.code, title: s.title, from, to });
    else if (to < from)
      declined.push({ code: s.code, title: s.title, from, to });
    else unchangedCount += 1;
  }
  // Biggest moves first.
  improved.sort((a, b) => b.to - b.from - (a.to - a.from));
  declined.sort((a, b) => a.to - a.from - (b.to - b.from));

  // Each pair of inspections used, newest first (as the inspections are given).
  const order = new Map(inspections.map((i, n) => [i.id, n]));
  const compared = new Map<string, { fromId: string; toId: string }>();
  for (const list of [...kq.pairs.values(), ...st.pairs.values()])
    for (const { fromId, toId } of list)
      compared.set(`${toId}|${fromId}`, { fromId, toId });

  return {
    branchIds: [...new Set([...kq.branches, ...st.branches])],
    compared: [...compared.values()].sort(
      (a, b) =>
        order.get(a.toId)! - order.get(b.toId)! ||
        order.get(a.fromId)! - order.get(b.fromId)!,
    ),
    overall: {
      from: overallFrom === null ? null : band(overallFrom, rules),
      to: overallTo === null ? null : band(overallTo, rules),
      fromPercent: overallFrom === null ? null : round1(overallFrom),
      toPercent: overallTo === null ? null : round1(overallTo),
      change:
        overallFrom === null || overallTo === null
          ? null
          : round1(overallTo - overallFrom),
    },
    keyQuestions: kqRows,
    improved,
    declined,
    unchangedCount,
  };
}
