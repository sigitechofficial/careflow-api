/**
 * Current conditions staged in the initial assessment (`metadata.conditionProposals`) and promoted to the
 * service user's conditions register on submit. Never overwrites the register:
 * - a condition not on the register is added (source INITIAL_ASSESSMENT);
 * - on an active row only empty care details are filled; different wording goes to the office to review;
 * - an inactive / discontinued row is never reactivated automatically — the office confirms.
 */

export type ConditionProposal = {
  id: string;
  conditionId: string;
  conditionName?: string;
  impactOnCare?: string;
  carerGuidance?: string;
  confirmationSource?: string;
};

export type RegisterConditionRow = {
  id: string;
  conditionId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  impactOnCare: string;
  carerGuidance: string;
  confirmationSource: string;
};

const DETAIL_KEYS = [
  'impactOnCare',
  'carerGuidance',
  'confirmationSource',
] as const;
type DetailKey = (typeof DETAIL_KEYS)[number];

export type ConditionPromotionPlan = {
  create: ConditionProposal[];
  fill: Array<{ rowId: string; data: Partial<Record<DetailKey, string>> }>;
  /** Office to review — the assessment differs from, or would reactivate, a register row. */
  review: Array<{
    proposal: ConditionProposal;
    reason: 'details_differ' | 'inactive_on_register';
  }>;
};

const clean = (v: string | undefined) =>
  (v ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function normalizeConditionProposals(raw: unknown): ConditionProposal[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ConditionProposal[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const p = r as Record<string, unknown>;
    if (
      typeof p.id !== 'string' ||
      typeof p.conditionId !== 'string' ||
      !p.conditionId
    )
      continue;
    if (seen.has(p.conditionId)) continue;
    seen.add(p.conditionId);
    out.push({
      id: p.id,
      conditionId: p.conditionId,
      conditionName:
        typeof p.conditionName === 'string' ? p.conditionName : undefined,
      impactOnCare:
        typeof p.impactOnCare === 'string' ? p.impactOnCare : undefined,
      carerGuidance:
        typeof p.carerGuidance === 'string' ? p.carerGuidance : undefined,
      confirmationSource:
        typeof p.confirmationSource === 'string'
          ? p.confirmationSource
          : undefined,
    });
  }
  return out;
}

export function planConditionPromotion(
  proposals: ConditionProposal[],
  register: RegisterConditionRow[],
): ConditionPromotionPlan {
  const byCondition = new Map(register.map((r) => [r.conditionId, r]));
  const plan: ConditionPromotionPlan = { create: [], fill: [], review: [] };
  for (const p of proposals) {
    const row = byCondition.get(p.conditionId);
    if (!row) {
      plan.create.push(p);
      continue;
    }
    if (row.status !== 'ACTIVE') {
      plan.review.push({ proposal: p, reason: 'inactive_on_register' });
      continue;
    }
    const data: Partial<Record<DetailKey, string>> = {};
    let differs = false;
    for (const key of DETAIL_KEYS) {
      const next = clean(p[key]);
      if (!next) continue;
      const current = clean(row[key]);
      if (!current) data[key] = next;
      else if (current.toLowerCase() !== next.toLowerCase()) differs = true;
    }
    if (Object.keys(data).length) plan.fill.push({ rowId: row.id, data });
    if (differs) plan.review.push({ proposal: p, reason: 'details_differ' });
  }
  return plan;
}

export function cleanConditionText(v: string | undefined): string {
  return clean(v);
}
