import { InitialAssessmentRiskType, InitialAssessmentRiskLevel } from '@prisma/client';

/**
 * Shared mapping for service-user alerts shown to the carer in the app.
 *
 * This is the single source of truth for turning the various admin/IA data
 * sources into a uniform, prioritised alert list. It is display-only (no
 * acknowledge/gate in this phase); `requiresAck` is reserved for a later phase.
 */

export type AlertTier = 'CRITICAL' | 'IMPORTANT' | 'INFO';
export type AlertSource = 'ADMIN' | 'IA' | 'DOM';

export interface ServiceUserAlertItem {
  /** Stable id (source row id, or a synthetic id for aggregated alerts). */
  id: string;
  /** Stable code for grouping/icon selection on the client, e.g. 'ALLERGY', 'IA_FALLS'. */
  category: string;
  /** Carer-facing short label. */
  title: string;
  /** Plain-language "what this means for you". */
  actionLine: string;
  /** Extra context (allergy names, notes, risk description); may be null. */
  detail: string | null;
  tier: AlertTier;
  source: AlertSource;
  /** Reserved for a later acknowledge phase — always false for now. */
  requiresAck: boolean;
}

const TIER_ORDER: Record<AlertTier, number> = { CRITICAL: 0, IMPORTANT: 1, INFO: 2 };

/** Sort comparator: CRITICAL first, then IMPORTANT, then INFO; stable within a tier. */
export function compareAlertsByTier(a: ServiceUserAlertItem, b: ServiceUserAlertItem): number {
  return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
}

export function countCriticalAlerts(alerts: ServiceUserAlertItem[]): number {
  return alerts.filter((a) => a.tier === 'CRITICAL').length;
}

// ── IA risk records ──────────────────────────────────────────────────────────
const IA_RISK_MAP: Partial<
  Record<InitialAssessmentRiskType, { tier: AlertTier; title: string; actionLine: string }>
> = {
  LONE_WORKER: { tier: 'CRITICAL', title: 'Lone worker risk', actionLine: 'Follow the lone-worker safety plan.' },
  SAFEGUARDING: { tier: 'CRITICAL', title: 'Safeguarding concern', actionLine: 'Stay alert and report any concerns.' },
  CHOKING: { tier: 'CRITICAL', title: 'Choking risk', actionLine: 'Follow food texture and fluid thickness.' },
  FIRE: { tier: 'CRITICAL', title: 'Fire safety risk', actionLine: 'Follow the fire safety plan.' },
  INFECTION_CONTROL: { tier: 'CRITICAL', title: 'Infection precautions', actionLine: 'Wear PPE as instructed.' },
  SKIN_INTEGRITY: { tier: 'IMPORTANT', title: 'Pressure ulcer risk', actionLine: 'Check skin and reposition.' },
  FALLS: { tier: 'IMPORTANT', title: 'Falls risk', actionLine: 'Assist with all transfers.' },
  MOVING_HANDLING: { tier: 'IMPORTANT', title: 'Moving & handling — high risk', actionLine: 'Use the hoist; never lift manually.' },
  NUTRITION: { tier: 'IMPORTANT', title: 'Nutrition risk', actionLine: 'Encourage food and log intake.' },
  HYDRATION: { tier: 'IMPORTANT', title: 'Dehydration risk', actionLine: 'Encourage fluids and log intake.' },
  MEDICATION: { tier: 'IMPORTANT', title: 'Medication risk', actionLine: 'Follow the MAR carefully.' },
  HOME_ENVIRONMENT: { tier: 'INFO', title: 'Home environment risk', actionLine: 'Be aware of hazards in the home.' },
  FINANCE: { tier: 'INFO', title: 'Finance risk', actionLine: 'Follow finance-handling guidance.' },
};

export function mapIaRiskToAlert(input: {
  id: string;
  riskType: InitialAssessmentRiskType;
  riskLevel: InitialAssessmentRiskLevel;
  description?: string | null;
}): ServiceUserAlertItem | null {
  const spec = IA_RISK_MAP[input.riskType];
  if (!spec) return null; // OTHER and any unmapped type are not surfaced
  return {
    id: input.id,
    category: `IA_${input.riskType}`,
    title: spec.title,
    actionLine: spec.actionLine,
    detail: input.description?.trim() || null,
    tier: spec.tier,
    source: 'IA',
    requiresAck: false,
  };
}

// ── Medical conditions (admin-managed, catalog codes) ────────────────────────
const CONDITION_MAP: Record<string, { tier: AlertTier; actionLine: string }> = {
  EPILEPSY: { tier: 'CRITICAL', actionLine: 'Know the seizure protocol.' },
  AGGRESSION: { tier: 'CRITICAL', actionLine: 'Follow de-escalation and the safety plan.' },
  DYSPHAGIA: { tier: 'CRITICAL', actionLine: 'Follow SALT plan; modified diet and fluids.' },
  DIABETES: { tier: 'IMPORTANT', actionLine: 'Watch for hypo/hyper signs.' },
  COPD: { tier: 'IMPORTANT', actionLine: 'Watch breathing; know rescue meds.' },
  ASTHMA: { tier: 'IMPORTANT', actionLine: 'Watch breathing; know inhaler use.' },
  RESPIRATORY_DISEASE: { tier: 'IMPORTANT', actionLine: 'Watch breathing.' },
  SHORTNESS_OF_BREATH: { tier: 'IMPORTANT', actionLine: 'Watch breathing.' },
  LUNG_DISEASE: { tier: 'IMPORTANT', actionLine: 'Watch breathing.' },
  HIGH_RISK_FALLS: { tier: 'IMPORTANT', actionLine: 'Assist with all transfers.' },
  SKIN_ULCERS_WOUNDS: { tier: 'IMPORTANT', actionLine: 'Check skin; follow wound care.' },
  PALLIATIVE_CARE: { tier: 'IMPORTANT', actionLine: 'Follow the comfort and care plan.' },
  END_OF_LIFE: { tier: 'IMPORTANT', actionLine: 'Follow the end-of-life care plan.' },
  DEMENTIA: { tier: 'IMPORTANT', actionLine: 'Reassure; watch for disorientation.' },
  ALZHEIMERS: { tier: 'IMPORTANT', actionLine: 'Reassure; watch for disorientation.' },
  STROKE: { tier: 'IMPORTANT', actionLine: 'Support mobility and communication.' },
  PARKINSONS: { tier: 'IMPORTANT', actionLine: 'Allow time; watch for freezing and falls.' },
  MND: { tier: 'IMPORTANT', actionLine: 'Support mobility and breathing.' },
  COMMUNITY_DOLS: { tier: 'IMPORTANT', actionLine: 'Respect capacity and consent.' },
  LACK_CAPACITY: { tier: 'IMPORTANT', actionLine: 'Respect capacity; act in best interests.' },
  DETAINED_MHA: { tier: 'IMPORTANT', actionLine: 'Follow the legal restrictions in the plan.' },
  NON_VERBAL: { tier: 'INFO', actionLine: 'Uses non-verbal communication.' },
  COMMUNICATION_NEEDS: { tier: 'INFO', actionLine: 'Has communication needs — see the plan.' },
  HEARING_IMPAIRMENT: { tier: 'INFO', actionLine: 'Support hearing needs.' },
  VISUAL_IMPAIRMENT: { tier: 'INFO', actionLine: 'Support visual needs.' },
  SENSORY_IMPAIRMENT: { tier: 'INFO', actionLine: 'Support sensory needs.' },
};

export function mapMedicalConditionToAlert(input: {
  id: string;
  code: string;
  name: string;
  notes?: string | null;
}): ServiceUserAlertItem {
  const spec = CONDITION_MAP[input.code];
  return {
    id: input.id,
    category: `CONDITION_${input.code}`,
    title: input.name,
    actionLine: spec?.actionLine ?? 'Be aware of this condition.',
    detail: input.notes?.trim() || null,
    tier: spec?.tier ?? 'INFO',
    source: 'ADMIN',
    requiresAck: false,
  };
}

// ── Allergies (aggregated into one critical alert) ───────────────────────────
export function mapAllergiesToAlert(names: string[]): ServiceUserAlertItem | null {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  return {
    id: 'allergies',
    category: 'ALLERGY',
    title: 'Allergies',
    actionLine: 'Check before any food or medication.',
    detail: clean.join(', '),
    tier: 'CRITICAL',
    source: 'ADMIN',
    requiresAck: false,
  };
}

// ── DNACPR ───────────────────────────────────────────────────────────────────
export function mapDnacprToAlert(input: {
  dnacprInPlace: boolean;
  location?: string | null;
}): ServiceUserAlertItem | null {
  if (!input.dnacprInPlace) return null;
  return {
    id: 'dnacpr',
    category: 'DNACPR',
    title: 'DNACPR in place',
    actionLine: 'Do not attempt CPR. See the DNACPR form.',
    detail: input.location?.trim() ? `Form location: ${input.location.trim()}` : null,
    tier: 'CRITICAL',
    source: 'ADMIN',
    requiresAck: false,
  };
}

// ── Reasonable adjustments ───────────────────────────────────────────────────
export function mapReasonableAdjustmentToAlert(input: {
  id: string;
  description: string;
  notes?: string | null;
}): ServiceUserAlertItem | null {
  const title = input.description.trim();
  if (!title) return null;
  return {
    id: input.id,
    category: 'ADJUSTMENT',
    title,
    actionLine: 'Make this reasonable adjustment.',
    detail: input.notes?.trim() || null,
    tier: 'INFO',
    source: 'ADMIN',
    requiresAck: false,
  };
}

// ── Flash message (manual office note) ───────────────────────────────────────
export function mapFlashMessageToAlert(input: {
  id: string;
  message: string;
}): ServiceUserAlertItem | null {
  const message = input.message.trim();
  if (!message) return null;
  return {
    id: input.id,
    category: 'FLASH',
    title: 'Office note',
    actionLine: message,
    detail: null,
    tier: 'IMPORTANT',
    source: 'ADMIN',
    requiresAck: false,
  };
}

// ── Admin medical alerts (CRUD) ──────────────────────────────────────────────
export function mapMedicalAlertToAlert(input: {
  id: string;
  title: string;
  category?: string | null;
  severity?: string | null;
  description?: string | null;
  actionForCarer?: string | null;
  notes?: string | null;
}): ServiceUserAlertItem | null {
  const title = input.title.trim();
  if (!title) return null;
  const severity = (input.severity ?? 'IMPORTANT').toUpperCase();
  const tier: AlertTier =
    severity === 'CRITICAL' ? 'CRITICAL' : severity === 'INFO' ? 'INFO' : 'IMPORTANT';
  const action =
    input.actionForCarer?.trim() ||
    input.description?.trim() ||
    'Follow the care plan for this alert.';
  const detailParts = [input.description?.trim(), input.notes?.trim()].filter(Boolean);
  return {
    id: input.id,
    category: input.category?.trim()
      ? `MEDICAL_ALERT_${input.category.trim()}`
      : 'MEDICAL_ALERT',
    title,
    actionLine: action,
    detail: detailParts.length > 0 ? detailParts.join('\n') : null,
    tier,
    source: 'ADMIN',
    requiresAck: false,
  };
}
