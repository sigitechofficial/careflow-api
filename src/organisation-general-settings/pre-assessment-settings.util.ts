import type { Prisma } from '@prisma/client';

export type PreAssessmentChecklistItem = {
  key: string;
  label: string;
  selected: boolean;
};

export const DEFAULT_PRE_ASSESSMENT_COMPONENTS: PreAssessmentChecklistItem[] = [
  { key: 'live_in_service_profile', label: 'Live in Service Profile', selected: false },
  { key: 'pre_admission_assessment', label: 'Pre-admission assessment', selected: true },
  { key: 'about_me_profile', label: 'About Me-My profile', selected: true },
  { key: 'contacts', label: 'Contacts', selected: true },
  { key: 'risk', label: 'Risk', selected: true },
  { key: 'assessments', label: 'Assessments', selected: true },
  { key: 'lasting_power_attorney_lpa', label: 'Lasting power of attorney (LPA)', selected: true },
];

export const DEFAULT_PRE_ASSESSMENT_FORMS: PreAssessmentChecklistItem[] = [
  { key: 'abbey_pain_scale', label: 'Abbey Pain Scale Tool', selected: false },
  {
    key: 'assessing_medication_home_care',
    label: 'Assessing For Medication in home care',
    selected: false,
  },
  { key: 'bed_rail_assessment', label: 'Bed Rail Assessment', selected: false },
  { key: 'capability_assessment', label: 'Capability Assessment', selected: true },
  { key: 'choking_risk_assessment', label: 'Choking Risk Assessment', selected: false },
  {
    key: 'cornell_depression_dementia',
    label: 'Cornell Depression Scale (for those with dementia)',
    selected: false,
  },
  {
    key: 'covid19_best_interest',
    label: 'COVID-19 Best Interest Checklist',
    selected: false,
  },
  { key: 'dementia_risk_assessment', label: 'DEMENTIA RISK ASSESSMENT', selected: false },
  {
    key: 'depression_scale_without_dementia',
    label: 'Depression Scale (for those without dementia)',
    selected: false,
  },
  { key: 'end_of_life_assessment', label: 'End of life Assessment', selected: false },
  {
    key: 'excessive_drinking_risk_pbs',
    label: 'Excessive drinking - Risk Assessment and Positive Behaviour Support Plan',
    selected: false,
  },
  {
    key: 'falls_risk_home_hazards',
    label: 'Falls Risk Management - specific hazards within my home',
    selected: false,
  },
  { key: 'falls_tool', label: 'Falls tool', selected: true },
  { key: 'fire_risk_assessment', label: 'Fire Risk Assessment', selected: true },
  {
    key: 'household_domestic_duties',
    label: 'Household domestic duties assessment',
    selected: false,
  },
  {
    key: 'initial_oral_health',
    label: 'Initial Oral Health Assessment',
    selected: true,
  },
  {
    key: 'learning_disability_risk',
    label: 'Learning Disability Risk Assessment',
    selected: false,
  },
  { key: 'medication_assessment', label: 'Medication Assessment', selected: false },
  {
    key: 'mouth_care_assessment',
    label: 'Mouth Care Assessment and Record',
    selected: true,
  },
  { key: 'moving_and_handling', label: 'Moving and Handling', selected: true },
  { key: 'must_tool', label: 'MUST tool', selected: true },
  { key: 'my_home_environment', label: 'My Home Environment', selected: false },
  {
    key: 'nutritional_risk_muac',
    label: 'Nutritional Risk using Mid Upper Arm Circumference (MUAC)',
    selected: true,
  },
  { key: 'pain_assessment', label: 'Pain Assessment', selected: false },
  {
    key: 'personal_emergency_evacuation',
    label: 'Personal Emergency Evacuation Plan',
    selected: true,
  },
  { key: 'pressure_ulcer_assessment', label: 'Pressure Ulcer Assessment', selected: false },
  { key: 'suspected_uti_assessment', label: 'Suspected UTI Assessment', selected: false },
  { key: 'waterlow_pressure_tool', label: 'Waterlow pressure tool', selected: true },
  { key: 'wellbeing_assessment_tool', label: 'Well-Being Assessment Tool.', selected: false },
  { key: 'wound_assessment', label: 'Wound Assessment', selected: false },
];

export type OrganisationPreAssessmentSettings = {
  careAssessmentRequired: boolean;
  assessmentComponents: PreAssessmentChecklistItem[];
  assessmentForms: PreAssessmentChecklistItem[];
};

export const DEFAULT_PRE_ASSESSMENT_SETTINGS: OrganisationPreAssessmentSettings = {
  careAssessmentRequired: true,
  assessmentComponents: DEFAULT_PRE_ASSESSMENT_COMPONENTS,
  assessmentForms: DEFAULT_PRE_ASSESSMENT_FORMS,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseItem(raw: unknown): PreAssessmentChecklistItem | null {
  if (!isRecord(raw)) return null;
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) return null;
  const label =
    typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : key;
  const selected = raw.selected === true;
  return { key, label, selected };
}

function parseChecklist(
  value: Prisma.JsonValue | null | undefined,
  defaults: PreAssessmentChecklistItem[],
): PreAssessmentChecklistItem[] {
  const byKey = new Map<string, PreAssessmentChecklistItem>();
  if (Array.isArray(value)) {
    for (const row of value) {
      const parsed = parseItem(row);
      if (parsed) byKey.set(parsed.key, parsed);
    }
  }
  return defaults.map(def => {
    const saved = byKey.get(def.key);
    return saved
      ? { key: def.key, label: def.label, selected: saved.selected }
      : { ...def };
  });
}

export function parseOrganisationPreAssessmentSettings(
  row: Partial<{
    preAssessmentCareRequired: boolean;
    preAssessmentComponents: unknown;
    preAssessmentForms: unknown;
  }>,
): OrganisationPreAssessmentSettings {
  return {
    careAssessmentRequired:
      row.preAssessmentCareRequired ?? DEFAULT_PRE_ASSESSMENT_SETTINGS.careAssessmentRequired,
    assessmentComponents: parseChecklist(
      row.preAssessmentComponents as Prisma.JsonValue | null | undefined,
      DEFAULT_PRE_ASSESSMENT_COMPONENTS,
    ),
    assessmentForms: parseChecklist(
      row.preAssessmentForms as Prisma.JsonValue | null | undefined,
      DEFAULT_PRE_ASSESSMENT_FORMS,
    ),
  };
}

export function serializePreAssessmentChecklist(
  items: PreAssessmentChecklistItem[],
): Prisma.InputJsonValue {
  return items.map(item => ({
    key: item.key,
    label: item.label,
    selected: item.selected,
  }));
}
