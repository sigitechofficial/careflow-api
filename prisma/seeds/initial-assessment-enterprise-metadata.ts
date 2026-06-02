/** Metadata helpers for enterprise template questions (BE1.12). */

type ShowWhen = {
  gateTextIncludes?: string;
  gateFieldKey?: string;
  yes?: boolean;
  no?: boolean;
};

type ConditionalRule = {
  kind: 'showWhen';
  gateTextIncludes?: string;
  gateFieldKey?: string;
  yes?: boolean;
  no?: boolean;
};

export function iaMeta(
  specRef: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { specRef, ...extra };
}

export function whenYes(gateTextIncludes: string): {
  showWhen: ShowWhen;
  conditionalRules: ConditionalRule[];
} {
  const rule: ConditionalRule = { kind: 'showWhen', gateTextIncludes, yes: true };
  return { showWhen: { gateTextIncludes, yes: true }, conditionalRules: [rule] };
}

export function whenNo(gateTextIncludes: string): {
  showWhen: ShowWhen;
  conditionalRules: ConditionalRule[];
} {
  const rule: ConditionalRule = { kind: 'showWhen', gateTextIncludes, no: true };
  return { showWhen: { gateTextIncludes, no: true }, conditionalRules: [rule] };
}

export function whenFieldYes(gateFieldKey: string): {
  showWhen: ShowWhen;
  conditionalRules: ConditionalRule[];
} {
  const rule: ConditionalRule = { kind: 'showWhen', gateFieldKey, yes: true };
  return { showWhen: { gateFieldKey, yes: true }, conditionalRules: [rule] };
}

/** Default specRef prefix for legacy catalog rows imported into a section subsection. */
export const LEGACY_SPEC_REF_BY_CATALOG_SECTION: Record<string, string> = {
  sec_breathing_difficulties: '5.1',
  sec_distress_pain_physical_state: '5.3',
  sec_swallowing: '5.4',
  sec_appetite: '6.2',
  sec_hydration: '6.3',
  sec_nutrition: '6.4',
  sec_incontinence: '7.4',
  sec_speech_impairment: '8.1',
  sec_hearing: '8.3',
  sec_sight: '8.4',
  sec_medication: '9.1',
  sec_emotional_well_being_client_states: '10.2',
  sec_cognitive_ability: '10.6a',
  sec_skin_condition: '11.1a',
  sec_additional_risks: '13.15',
  sec_environment: '3.10',
  sec_pets: '3.8',
  sec_flooring: '3.11',
};

/** §3.11 — two trip/fall flooring checks only (enterprise YES/NO). */
export const SECTION_311_CANONICAL_QUESTION_TEXT = [
  'Rugs or worn carpet (flooring risk)?',
  'Worn carpet on stairs?',
] as const;

export const SECTION_311_FLOORING_QUESTION_TEXT = new Set<string>([
  ...SECTION_311_CANONICAL_QUESTION_TEXT,
  'Worn carpet in the home?',
  'Worn carpet?',
]);

/**
 * §3.10 — consolidated property environment checklist (enterprise YES/NO + notes).
 * Legacy sec_environment checkboxes are superseded by merged fields below.
 */
export const SECTION_310_CANONICAL_QUESTION_TEXT = [
  'Smoke alarm fitted and working?',
  'Referral required for smoke, CO or fire alarm?',
  'Steps or uneven access at entrance?',
  'Level access throughout the property?',
  'Hoarding or clutter risk?',
  'Environment / access hazard notes',
] as const;

/** §3.8 — pets and smoking; legacy sec_pets checkboxes superseded. */
export const SECTION_38_CANONICAL_QUESTION_TEXT = [
  'Pets present?',
  'Pets secured during visits?',
  'Smoking in property?',
  'Pet infestation or hygiene risk?',
] as const;

