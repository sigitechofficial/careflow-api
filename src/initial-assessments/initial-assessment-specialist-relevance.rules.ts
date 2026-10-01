/**
 * Specialist / conditional assessment relevance — which specialist tabs a person needs, from the Core
 * IA screening answers. Pure rules over already-extracted values (no template lookups), mirrored
 * line-for-line in careflow-admin `utils/specialist-relevance-rules.ts` — change both.
 *
 * - required: a clear clinical / risk trigger fired
 * - suggested: assessor judgement needed
 * - not_needed: a clear negative screen (no typing needed)
 * - pending: the screening question has not been answered yet (never treated as required)
 */
import {
  fallsCaseFinding,
  type FallsCaseFindingInput,
} from './initial-assessment-falls.util';

export type SpecialistStatus =
  | 'required'
  | 'suggested'
  | 'not_needed'
  | 'pending';

export type SpecialistRelevance = {
  status: SpecialistStatus;
  /** Why (shown on the badge / in the submit message). */
  reasons: string[];
  /** For pending: which screening answer is missing. */
  pendingHint?: string;
};

export type SpecialistInputs = {
  painConcerns: string[] | null;
  nutritionStatus: string | null;
  appetiteStatus: string[] | null;
  unableToWeigh: boolean | null;
  swallowingConcerns: string[] | null;
  capacityDoubt: boolean | null;
  understands: string | null;
  covertMedication: boolean | null;
  mcaRequired: boolean | null;
  /** Core restrictions screen (§2.9a) and the deprivation-of-liberty concern (§2.9). */
  dolRestrictions: string[] | null;
  dolConcern: string | null;
  skinCondition: boolean | null;
  hasWounds: boolean | null;
  restrictedToBed: boolean | null;
  usesHoist: boolean | null;
  independentAllTransfers: boolean | null;
  bladder: string[] | null;
  bowel: string[] | null;
  diabetic: boolean | null;
  /** MUST total, or null when not scored. */
  mustScore: number | null;
  /** Waterlow total; 0 / null = not scored. */
  waterlowScore: number | null;
  /** ADL activity id → 0–4 score; null when the worksheet has no rows. */
  adlScores: Record<string, number> | null;
  falls: FallsCaseFindingInput;
  furtherEquipment: boolean | null;
  fireRisks: boolean | null;
  smokeAlarmWorking: boolean | null;
  smoking: string | null;
  oxygen: boolean | null;
  hoarding: boolean | null;
  infectionPrecautions: boolean | null;
  bedRails: boolean | null;
  canSelfEvacuate: boolean | null;
  acpOffered: string | null;
  eolRelevant: string | null;
};

/** Holistic tab ids (frozen) of the specialist / conditional assessments. */
export const SPECIALIST_TAB_IDS = {
  pain: 10,
  therapy: 11,
  must: 7,
  mca: 3,
  mcaChecklist: 17,
  skin: 4,
  waterlow: 5,
  falls: 8,
  movingHandling: 9,
  equipment: 6,
  fire: 22,
  infection: 21,
  bedRails: 20,
  peep: 19,
  acp: 13,
  eol: 14,
} as const;

const SPECIALIST_IDS = new Set<number>(Object.values(SPECIALIST_TAB_IDS));

export function isSpecialistTab(tabId: number): boolean {
  return SPECIALIST_IDS.has(tabId);
}

/** ADL rows that describe mobility and transfers (0 = independent … 4 = done by others). */
const MOBILITY_ADL_IDS = [
  'walking',
  'room_to_room',
  'turning_in_bed',
  'stairs',
  'lying_to_sitting',
  'chair_transfer',
  'toilet_transfer',
  'bed_transfer',
] as const;

const PAIN_SEVERITY = new Set([
  'mild_movement',
  'moderate_movement',
  'severe_movement',
  'mild_rest',
  'moderate_rest',
  'severe_rest',
]);
const INCONTINENCE = new Set([
  'incontinence',
  'stress',
  'nocturnal',
  'products',
  'catheter',
  'urostomy',
  'stoma',
]);

const required = (...reasons: string[]): SpecialistRelevance => ({
  status: 'required',
  reasons,
});
const suggested = (...reasons: string[]): SpecialistRelevance => ({
  status: 'suggested',
  reasons,
});
const notNeeded = (reason: string): SpecialistRelevance => ({
  status: 'not_needed',
  reasons: [reason],
});
const pending = (pendingHint: string): SpecialistRelevance => ({
  status: 'pending',
  reasons: [],
  pendingHint,
});

function mobilityDependency(adl: Record<string, number> | null): number | null {
  if (!adl) return null;
  let max = 0;
  for (const id of MOBILITY_ADL_IDS) max = Math.max(max, adl[id] ?? 0);
  return max;
}

function pain(i: SpecialistInputs): SpecialistRelevance {
  const v = i.painConcerns;
  if (!v?.length)
    return pending('Answer "Pain / distress options" (Personal Details)');
  const reasons: string[] = [];
  if (v.some((x) => x.endsWith('_movement'))) reasons.push('Pain on movement');
  if (v.some((x) => x.endsWith('_rest'))) reasons.push('Pain at rest');
  if (v.includes('unable_to_self_report'))
    reasons.push('Unable to self-report pain — use Abbey');
  if (v.includes('gp_review_requested'))
    reasons.push('GP review requested for pain');
  if (reasons.length) return required(...reasons);
  if (v.some((x) => PAIN_SEVERITY.has(x))) return required('Pain reported');
  return notNeeded('No pain or distress reported');
}

function falls(i: SpecialistInputs): SpecialistRelevance {
  const finding = fallsCaseFinding(i.falls);
  if (finding.status === 'pending')
    return pending('Answer the falls history questions (Falls tab)');
  if (finding.status === 'not_needed')
    return notNeeded('No falls, unsteadiness, fear of falling or concern');
  return { status: finding.status, reasons: finding.reasons };
}

function movingHandling(i: SpecialistInputs): SpecialistRelevance {
  const reasons: string[] = [];
  if (i.usesHoist === true) reasons.push('Hoist in use');
  if (i.restrictedToBed === true) reasons.push('Restricted to bed');
  if (i.independentAllTransfers === false)
    reasons.push('Not independent with transfers');
  const dep = mobilityDependency(i.adlScores);
  if (dep != null && dep >= 2)
    reasons.push('Needs help from another person to move or transfer (ADL)');
  if (reasons.length) return required(...reasons);
  const hints: string[] = [];
  if (dep === 1) hints.push('Occasional help or difficulty moving (ADL)');
  if (fallsCaseFinding(i.falls).status === 'required')
    hints.push('Falls case-finding positive');
  if (i.painConcerns?.some((x) => x.endsWith('_movement')))
    hints.push('Pain on movement');
  if (hints.length) return suggested(...hints);
  // ADL rows start at 0, so an all-zero worksheet alone is not proof of independence.
  if (i.independentAllTransfers === true)
    return notNeeded('Independent with mobility and transfers');
  return pending(
    'Confirm "Independent with all transfers?" (Moving and Handling)',
  );
}

function nutrition(i: SpecialistInputs): SpecialistRelevance {
  const reasons: string[] = [];
  if (
    i.nutritionStatus === 'malnourished' ||
    i.nutritionStatus === 'severely_malnourished'
  ) {
    reasons.push('Nutrition status: malnourished');
  }
  const appetitePoor = Boolean(i.appetiteStatus?.includes('poor'));
  if (i.unableToWeigh === true && appetitePoor)
    reasons.push('Unable to weigh with poor appetite');
  const swallowing = Boolean(
    i.swallowingConcerns?.some((v) => v !== 'no_concern'),
  );
  if (swallowing && appetitePoor)
    reasons.push('Swallowing concern affecting intake');
  if (reasons.length) return required(...reasons);
  const hints: string[] = [];
  if (appetitePoor) hints.push('Poor appetite');
  if (i.appetiteStatus?.includes('supplements_required'))
    hints.push('Supplements may be needed');
  if (i.appetiteStatus?.includes('dietitian_referral'))
    hints.push('Dietitian referral');
  if (hints.length) return suggested(...hints);
  if (!i.nutritionStatus || !i.appetiteStatus?.length) {
    return pending('Answer appetite and nutrition status (Personal Details)');
  }
  return notNeeded('No nutrition concern reported');
}

function mca(i: SpecialistInputs): SpecialistRelevance {
  const reasons: string[] = [];
  if (i.capacityDoubt === true)
    reasons.push('Reason to doubt capacity (Consent)');
  if (i.covertMedication === true) reasons.push('Covert medication proposed');
  if (i.dolRestrictions?.some((v) => v !== 'none')) {
    reasons.push(
      'Restrictions recorded — complete the deprivation of liberty screen',
    );
  }
  if (i.dolConcern === 'yes' || i.dolConcern === 'unsure') {
    reasons.push(
      'Possible deprivation of liberty — capacity for the care arrangements',
    );
  }
  if (reasons.length) return required(...reasons);
  if (i.understands === 'no' || i.understands === 'unsure') {
    return suggested('May not understand the assessment information (Consent)');
  }
  if (i.capacityDoubt == null)
    return pending('Answer "reason to doubt capacity" (Consent)');
  return notNeeded('No reason to doubt capacity');
}

function mcaChecklist(i: SpecialistInputs): SpecialistRelevance {
  if (i.mcaRequired === true) return required('MCA required');
  return notNeeded('Only needed when an MCA is required');
}

function skin(i: SpecialistInputs): SpecialistRelevance {
  const reasons: string[] = [];
  if (i.skinCondition === true) reasons.push('Skin condition or concern');
  if (i.hasWounds === true) reasons.push('Ulcers or wounds');
  if (reasons.length) return required(...reasons);
  if ((i.waterlowScore ?? 0) >= 10) return suggested('Waterlow 10+ (at risk)');
  if (i.restrictedToBed === true) return suggested('Restricted to bed');
  if (i.skinCondition == null || i.hasWounds == null)
    return pending('Answer the skin questions (Personal Details)');
  return notNeeded('Skin intact, no wounds');
}

function waterlow(i: SpecialistInputs): SpecialistRelevance {
  const reasons: string[] = [];
  if (i.restrictedToBed === true) reasons.push('Restricted to bed');
  if (i.usesHoist === true) reasons.push('Hoist in use');
  if (i.hasWounds === true) reasons.push('Ulcers or wounds');
  if (i.skinCondition === true) reasons.push('Skin condition or concern');
  if (reasons.length) return required(...reasons);
  const hints: string[] = [];
  const dep = mobilityDependency(i.adlScores);
  if (dep != null && dep >= 1) hints.push('Reduced mobility (ADL)');
  if (
    i.bladder?.some((v) => INCONTINENCE.has(v)) ||
    i.bowel?.some((v) => INCONTINENCE.has(v))
  ) {
    hints.push('Continence needs');
  }
  if ((i.mustScore ?? 0) >= 1) hints.push('MUST 1+');
  if (i.diabetic === true) hints.push('Diabetes');
  if (hints.length) return suggested(...hints);
  if (
    i.skinCondition == null ||
    i.hasWounds == null ||
    !i.bladder?.length ||
    !i.bowel?.length
  ) {
    return pending(
      'Answer the skin and continence questions (Personal Details)',
    );
  }
  return notNeeded('Mobile, continent and skin intact');
}

function equipment(i: SpecialistInputs): SpecialistRelevance {
  const score = i.waterlowScore ?? 0;
  if (score >= 10) return required(`Waterlow ${score} (10+)`);
  if (i.hasWounds === true) return required('Ulcers or wounds');
  if (i.usesHoist === true)
    return suggested('Hoist in use — check handling equipment');
  if (score <= 0) return pending('Complete the Waterlow first');
  return notNeeded(`Waterlow ${score} (below 10)`);
}

function therapy(i: SpecialistInputs): SpecialistRelevance {
  const mh = movingHandling(i).status;
  const fl = falls(i).status;
  const hints: string[] = [];
  if (mh === 'required') hints.push('Mobility or transfer support needed');
  if (fl === 'required') hints.push('Falls case-finding positive');
  if (i.furtherEquipment === true) hints.push('Further equipment needed');
  if (hints.length) return suggested(...hints);
  if (mh === 'pending' || fl === 'pending')
    return pending('Answer the mobility and falls screening first');
  return notNeeded('No mobility, falls or equipment need');
}

function fire(i: SpecialistInputs): SpecialistRelevance {
  const reasons: string[] = [];
  if (i.fireRisks === true) reasons.push('Fire safety risks identified');
  if (i.smokeAlarmWorking === false) reasons.push('No working smoke alarm');
  if (i.smoking === 'current_smoker' || i.smoking === 'vapes')
    reasons.push('Smokes or vapes');
  if (i.oxygen === true) reasons.push('Home oxygen');
  if (i.hoarding === true) reasons.push('Hoarding or clutter');
  if (reasons.length) return required(...reasons);
  if (i.fireRisks == null || i.smokeAlarmWorking == null) {
    return pending(
      'Answer "fire safety risks" and "smoke alarm" (Fire Safety)',
    );
  }
  return notNeeded('Working smoke alarm, no fire risks');
}

function selfGated(
  value: boolean | null,
  yesIs: 'required' | 'not_needed',
  labels: { required: string; notNeeded: string; pending: string },
): SpecialistRelevance {
  if (value == null) return pending(labels.pending);
  const isRequired = yesIs === 'required' ? value : !value;
  return isRequired ? required(labels.required) : notNeeded(labels.notNeeded);
}

function peep(i: SpecialistInputs): SpecialistRelevance {
  if (i.canSelfEvacuate === false)
    return required('Cannot leave the home unaided in an emergency');
  if (
    i.canSelfEvacuate === true &&
    (i.restrictedToBed === true || i.usesHoist === true)
  ) {
    return suggested(
      'Can self-evacuate recorded, but bed-bound / hoist also recorded — check',
    );
  }
  if (i.canSelfEvacuate == null)
    return pending('Answer "can the person self-evacuate?" (PEEP)');
  return notNeeded('Can leave the home unaided');
}

function acp(i: SpecialistInputs): SpecialistRelevance {
  if (i.acpOffered === 'yes_now')
    return required('The person wants to talk about future care wishes now');
  if (i.acpOffered === 'not_now')
    return notNeeded('Not now — offer again later');
  if (i.acpOffered === 'declined') return notNeeded('Declined');
  if (i.acpOffered === 'unable_now')
    return notNeeded('Not able to take part now');
  if (i.eolRelevant === 'yes')
    return suggested('Palliative / end-of-life care relevant');
  return pending('Answer "future care wishes" (Personal Details)');
}

function eol(i: SpecialistInputs): SpecialistRelevance {
  if (i.eolRelevant === 'yes')
    return required('Palliative / end-of-life care relevant or documented');
  if (i.eolRelevant === 'no')
    return notNeeded('End-of-life care not currently relevant');
  if (i.eolRelevant === 'unsure')
    return pending('Clinical clarification needed (GP / clinical team)');
  return pending('Answer the end-of-life question (Personal Details)');
}

export function specialistRelevanceFromInputs(
  tabId: number,
  i: SpecialistInputs,
): SpecialistRelevance | null {
  const T = SPECIALIST_TAB_IDS;
  switch (tabId) {
    case T.pain:
      return pain(i);
    case T.therapy:
      return therapy(i);
    case T.must:
      return nutrition(i);
    case T.mca:
      return mca(i);
    case T.mcaChecklist:
      return mcaChecklist(i);
    case T.skin:
      return skin(i);
    case T.waterlow:
      return waterlow(i);
    case T.falls:
      return falls(i);
    case T.movingHandling:
      return movingHandling(i);
    case T.equipment:
      return equipment(i);
    case T.fire:
      return fire(i);
    case T.infection:
      return selfGated(i.infectionPrecautions, 'required', {
        required: 'Precautions beyond standard infection control',
        notNeeded: 'Standard precautions only',
        pending: 'Answer "infection control precautions required?"',
      });
    case T.bedRails:
      return selfGated(i.bedRails, 'required', {
        required: 'Bed rails in use or being considered',
        notNeeded: 'No bed rails',
        pending: 'Answer "bed rails in use or being considered?"',
      });
    case T.peep:
      return peep(i);
    case T.acp:
      return acp(i);
    case T.eol:
      return eol(i);
    default:
      return null;
  }
}

/** Manager / assessor override of a computed status. Downgrading a trigger needs a reason. */
export type SpecialistOverride = {
  status: 'required' | 'not_needed';
  reason?: string;
  byUserId?: string;
  byName?: string;
  at: string;
};

export function overrideNeedsReason(
  computed: SpecialistStatus,
  next: SpecialistOverride['status'],
): boolean {
  return (
    next === 'not_needed' &&
    (computed === 'required' || computed === 'suggested')
  );
}

export function applySpecialistOverride(
  computed: SpecialistRelevance,
  override: SpecialistOverride | undefined,
): SpecialistRelevance & { overridden?: SpecialistOverride } {
  if (!override) return computed;
  if (
    overrideNeedsReason(computed.status, override.status) &&
    !override.reason?.trim()
  )
    return computed;
  return {
    status: override.status,
    reasons: override.reason?.trim()
      ? [`Override: ${override.reason.trim()}`]
      : override.status === 'required'
        ? ['Marked as needed']
        : computed.reasons,
    overridden: override,
  };
}

/** Skippable submit block text — the same on client and server. */
export function specialistRequiredMessage(
  tabTitle: string,
  reasons: string[],
): string {
  return `Specialist assessment required: ${tabTitle} — ${reasons.join(', ')}`;
}

/**
 * Worksheet specialist tabs whose completion is a stored worksheet (question-based specialist tabs —
 * fire, infection, bed rails, PEEP, MCA screening — raise "Required:" blocks for their own questions).
 */
export const SPECIALIST_WORKSHEET_TITLES: Readonly<Record<number, string>> = {
  [SPECIALIST_TAB_IDS.pain]: 'Pain Assessment Tool',
  [SPECIALIST_TAB_IDS.must]: 'Nutrition (MUST)',
  [SPECIALIST_TAB_IDS.skin]: 'Total Skin Integrity Check',
  [SPECIALIST_TAB_IDS.waterlow]: 'Waterlow Pressure Score',
  [SPECIALIST_TAB_IDS.falls]: 'Falls Screening',
  [SPECIALIST_TAB_IDS.movingHandling]: 'Moving and Handling',
  [SPECIALIST_TAB_IDS.equipment]: 'Equipment Selection',
  [SPECIALIST_TAB_IDS.acp]: 'Advance Care Planning',
  [SPECIALIST_TAB_IDS.eol]: 'End of Life Assessment',
  [SPECIALIST_TAB_IDS.mcaChecklist]: 'Mental Capacity Assessment Identified',
};

/** Tab a "Specialist assessment required: <title> — …" message points at. */
export function specialistTabForMessage(message: string): number | undefined {
  for (const [tabId, title] of Object.entries(SPECIALIST_WORKSHEET_TITLES)) {
    if (message.startsWith(`Specialist assessment required: ${title} —`))
      return Number(tabId);
  }
  return undefined;
}
