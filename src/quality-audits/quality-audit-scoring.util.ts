/**
 * Audit scoring: the share of answered standards that are met, overall and for each section.
 * Pure functions: no database, so the service, the screens and the tests share one calculation.
 */

export type AuditStandard = { id: string; text: string; hint?: string };
export type AuditSection = { title: string; standards: AuditStandard[] };
export type AuditAnswerValue = 'MET' | 'NOT_MET';
export type AuditAnswerInput = {
  standardId: string;
  answer: AuditAnswerValue;
  celebrate: boolean;
  note: string | null;
};

export type AuditCount = {
  total: number;
  answered: number;
  met: number;
  notMet: number;
  /** Met as a share of answered standards (one decimal); null when nothing is answered. */
  percent: number | null;
};

export type AuditResult = AuditCount & {
  celebrated: number;
  sections: (AuditCount & { title: string })[];
  /** Every standard is answered. */
  complete: boolean;
  /** Not met standards that still need a note before the audit can be completed. */
  missingNotes: string[];
};

export function readSections(value: unknown): AuditSection[] {
  return Array.isArray(value) ? (value as AuditSection[]) : [];
}

const percentOf = (met: number, answered: number) =>
  answered ? Math.round((met / answered) * 1000) / 10 : null;

/** Counts for the audit, ignoring answers to standards it does not have. */
export function auditResult(
  sections: AuditSection[],
  answers: AuditAnswerInput[],
): AuditResult {
  const byId = new Map(answers.map((a) => [a.standardId, a]));
  const totals = { total: 0, answered: 0, met: 0, notMet: 0 };
  let celebrated = 0;
  const missingNotes: string[] = [];
  const perSection = sections.map((s) => {
    const c = { total: 0, answered: 0, met: 0, notMet: 0 };
    for (const st of s.standards) {
      c.total += 1;
      const a = byId.get(st.id);
      if (!a) continue;
      c.answered += 1;
      if (a.answer === 'MET') {
        c.met += 1;
        if (a.celebrate) celebrated += 1;
      } else {
        c.notMet += 1;
        if (!a.note?.trim()) missingNotes.push(st.id);
      }
    }
    totals.total += c.total;
    totals.answered += c.answered;
    totals.met += c.met;
    totals.notMet += c.notMet;
    return { title: s.title, ...c, percent: percentOf(c.met, c.answered) };
  });
  return {
    ...totals,
    percent: percentOf(totals.met, totals.answered),
    celebrated,
    sections: perSection,
    complete: totals.total > 0 && totals.answered === totals.total,
    missingNotes,
  };
}
