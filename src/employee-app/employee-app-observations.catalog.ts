/**
 * Enterprise carer-app Obs catalog: picker sections, form schemas, units, ranges.
 * Clinical content lives here (and DB observation types / vital ranges) — not on mobile.
 */

export type EmployeeAppUnableReason = {
  code: string;
  label: string;
  resolvesRequirement: boolean;
  requiresNotes: boolean;
};

export type EmployeeAppObsFormField = {
  key: string;
  label: string;
  inputType: 'number' | 'text' | 'textarea' | 'select' | 'boolean' | 'score' | 'datetime';
  required: boolean;
  unit?: string | null;
  placeholder?: string | null;
  helperText?: string | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  options?: Array<{ value: string; label: string }>;
  payloadPath?: string | null;
};

export type EmployeeAppObsBounds = {
  unit: string | null;
  normalRangeLabel: string | null;
  minAccepted: number | null;
  maxAccepted: number | null;
  warningMin: number | null;
  warningMax: number | null;
  criticalMin: number | null;
  criticalMax: number | null;
  /** Secondary component bounds (e.g. BP diastolic). */
  secondary?: {
    key: string;
    label: string;
    unit: string | null;
    minAccepted: number | null;
    maxAccepted: number | null;
    warningMin: number | null;
    warningMax: number | null;
    criticalMin: number | null;
    criticalMax: number | null;
    normalRangeLabel: string | null;
  } | null;
};

export type EmployeeAppObsForm = {
  title: string;
  subtitle: string | null;
  submitLabel: string;
  unableLabel: string;
  fields: EmployeeAppObsFormField[];
  showUnableToRecord: boolean;
  requiresNotesWhenAbnormal: boolean;
  requiresNotesWhenCritical: boolean;
};

export const EMPLOYEE_APP_UNABLE_REASONS: EmployeeAppUnableReason[] = [
  {
    code: 'client_declined',
    label: 'Client declined',
    resolvesRequirement: true,
    requiresNotes: false,
  },
  {
    code: 'equipment_unavailable',
    label: 'Equipment unavailable',
    resolvesRequirement: true,
    requiresNotes: false,
  },
  {
    code: 'unable_to_obtain',
    label: 'Unable to obtain a reading',
    resolvesRequirement: true,
    requiresNotes: false,
  },
  {
    code: 'client_asleep',
    label: 'Client asleep',
    resolvesRequirement: true,
    requiresNotes: false,
  },
  {
    code: 'client_unavailable',
    label: 'Client unavailable',
    resolvesRequirement: true,
    requiresNotes: false,
  },
  {
    code: 'unsafe',
    label: 'Unsafe to take the observation',
    resolvesRequirement: true,
    requiresNotes: false,
  },
  {
    code: 'not_clinically_required',
    label: 'Not clinically required',
    resolvesRequirement: true,
    requiresNotes: false,
  },
  {
    code: 'other',
    label: 'Other',
    resolvesRequirement: true,
    requiresNotes: true,
  },
];

/** Maps DB observation type code → mobile typeCode used in catalog / lists. */
export const OBS_TYPE_CODE_ALIASES: Record<string, string> = {
  BLOOD_PRESSURE: 'bp',
  PULSE: 'pulse',
  OXYGEN_SATURATION: 'spo2',
  TEMPERATURE: 'temp',
  BLOOD_SUGAR: 'blood_glucose',
  RESPIRATION: 'respiration',
  WEIGHT: 'weight',
  NEWS2: 'news2',
  WELLBEING: 'mood_wellbeing',
  FLUID_MONITOR: 'fluid_intake',
  REPOSITIONING: 'repositioning',
  INFECTION: 'skin_body_map',
  PAIN: 'pain_score',
  FALLS: 'falls',
  BOWEL_MOVEMENT: 'bowel',
  MEALS: 'meals',
  ABC_PATTERNS: 'abc_patterns',
  SEIZURE_CHART: 'seizure',
  URINALYSIS: 'urinalysis',
};

/** Maps vital accepted-range fieldKey → observation type code. */
export const VITAL_RANGE_TO_OBS_CODE: Record<string, string> = {
  temperature: 'TEMPERATURE',
  respirations: 'RESPIRATION',
  bloodGlucose: 'BLOOD_SUGAR',
  pulse: 'PULSE',
  spo2: 'OXYGEN_SATURATION',
  bpSystolic: 'BLOOD_PRESSURE',
  bpDiastolic: 'BLOOD_PRESSURE',
};

type CatalogSectionDef = {
  id: string;
  label: string;
  typeCodes: string[];
};

export const OBS_CATALOG_SECTIONS: CatalogSectionDef[] = [
  {
    id: 'vitals',
    label: 'Vitals',
    typeCodes: [
      'BLOOD_PRESSURE',
      'PULSE',
      'OXYGEN_SATURATION',
      'TEMPERATURE',
      'RESPIRATION',
      'BLOOD_SUGAR',
      'WEIGHT',
      'NEWS2',
    ],
  },
  {
    id: 'wellbeing_care',
    label: 'Wellbeing & care',
    typeCodes: ['WELLBEING', 'PAIN', 'FLUID_MONITOR', 'MEALS', 'BOWEL_MOVEMENT', 'REPOSITIONING'],
  },
  {
    id: 'clinical_charts',
    label: 'Clinical charts',
    typeCodes: ['FALLS', 'SEIZURE_CHART', 'URINALYSIS', 'INFECTION', 'ABC_PATTERNS'],
  },
];

function numericField(
  key: string,
  label: string,
  unit: string | null,
  opts: Partial<EmployeeAppObsFormField> = {},
): EmployeeAppObsFormField {
  return {
    key,
    label,
    inputType: 'number',
    required: true,
    unit,
    placeholder: unit ? `Enter ${unit}` : 'Enter value',
    step: unit === '°C' || unit === 'C' || unit === 'mmol/L' || unit === 'MMOL/L' ? 0.1 : 1,
    ...opts,
  };
}

function notesField(required = false): EmployeeAppObsFormField {
  return {
    key: 'notes',
    label: 'Notes',
    inputType: 'textarea',
    required,
    placeholder: 'Optional notes for handover…',
  };
}

function deriveBands(min: number | null, max: number | null): {
  warningMin: number | null;
  warningMax: number | null;
  criticalMin: number | null;
  criticalMax: number | null;
} {
  if (min == null || max == null) {
    return { warningMin: null, warningMax: null, criticalMin: null, criticalMax: null };
  }
  const span = max - min;
  const pad = span > 0 ? span * 0.15 : 1;
  return {
    warningMin: Math.round((min - pad / 2) * 100) / 100,
    warningMax: Math.round((max + pad / 2) * 100) / 100,
    criticalMin: Math.round((min - pad) * 100) / 100,
    criticalMax: Math.round((max + pad) * 100) / 100,
  };
}

export function buildObsBounds(input: {
  unit: string | null;
  minAccepted: number | null;
  maxAccepted: number | null;
  secondary?: EmployeeAppObsBounds['secondary'];
}): EmployeeAppObsBounds {
  const bands = deriveBands(input.minAccepted, input.maxAccepted);
  const normalRangeLabel =
    input.minAccepted != null && input.maxAccepted != null
      ? `${input.minAccepted}–${input.maxAccepted}${input.unit ? ` ${input.unit}` : ''}`
      : null;
  return {
    unit: input.unit,
    normalRangeLabel,
    minAccepted: input.minAccepted,
    maxAccepted: input.maxAccepted,
    ...bands,
    secondary: input.secondary ?? null,
  };
}

export function buildObsFormForType(input: {
  code: string;
  name: string;
  unitLabel: string | null;
  valueKind: string;
  bounds: EmployeeAppObsBounds;
  wellbeingDimensions?: Array<{
    code: string;
    name: string;
    levels: Array<{ level: number; label: string }>;
  }>;
}): EmployeeAppObsForm {
  const code = input.code.toUpperCase();
  const unit = input.bounds.unit ?? input.unitLabel;
  const base = {
    title: input.name,
    subtitle: input.bounds.normalRangeLabel
      ? `Typical range ${input.bounds.normalRangeLabel}`
      : null,
    submitLabel: 'Save observation',
    unableLabel: 'Unable to record',
    showUnableToRecord: true,
    requiresNotesWhenAbnormal: true,
    requiresNotesWhenCritical: true,
  };

  if (code === 'BLOOD_PRESSURE') {
    return {
      ...base,
      fields: [
        numericField('systolic', 'Systolic', unit, {
          min: input.bounds.minAccepted,
          max: input.bounds.maxAccepted,
          payloadPath: 'systolic',
        }),
        numericField('diastolic', 'Diastolic', unit, {
          min: input.bounds.secondary?.minAccepted ?? null,
          max: input.bounds.secondary?.maxAccepted ?? null,
          payloadPath: 'diastolic',
        }),
        {
          key: 'situation',
          label: 'Situation',
          inputType: 'select',
          required: true,
          payloadPath: 'situation',
          options: [
            { value: 'RESTING', label: 'Resting' },
            { value: 'SITTING', label: 'Sitting' },
            { value: 'STANDING', label: 'Standing' },
            { value: 'LYING', label: 'Lying' },
            { value: 'AFTER_ACTIVITY', label: 'After activity' },
            { value: 'OTHER', label: 'Other' },
          ],
        },
        notesField(),
      ],
    };
  }

  if (code === 'WELLBEING') {
    const scoreFields: EmployeeAppObsFormField[] = (input.wellbeingDimensions ?? []).map((d) => ({
      key: `wellbeing_${d.code.toLowerCase()}`,
      label: d.name,
      inputType: 'score' as const,
      required: true,
      payloadPath: d.code,
      min: 1,
      max: 5,
      options: d.levels.map((l) => ({ value: String(l.level), label: `${l.level} — ${l.label}` })),
    }));
    return {
      ...base,
      subtitle: 'Rate each dimension from 1 (most concern) to 5 (best)',
      fields: [...scoreFields, notesField()],
    };
  }

  if (code === 'PAIN') {
    return {
      ...base,
      subtitle: 'Ask the person to rate pain from 0 (none) to 10 (worst imaginable)',
      fields: [
        {
          key: 'value',
          label: 'Pain score',
          inputType: 'score',
          required: true,
          min: 0,
          max: 10,
          step: 1,
          unit: '0–10',
          placeholder: '0–10',
          helperText: '0 = no pain · 10 = worst pain',
        },
        notesField(),
      ],
    };
  }

  if (code === 'FLUID_MONITOR') {
    return {
      ...base,
      fields: [
        numericField('fluidInMl', 'Fluid in (ml)', 'ml', {
          required: false,
          payloadPath: 'fluidInMl',
        }),
        numericField('fluidOutMl', 'Fluid out (ml)', 'ml', {
          required: false,
          payloadPath: 'fluidOutMl',
        }),
        notesField(),
      ],
    };
  }

  if (code === 'REPOSITIONING') {
    return {
      ...base,
      fields: [
        {
          key: 'position',
          label: 'Position',
          inputType: 'select',
          required: true,
          payloadPath: 'position',
          options: [
            { value: 'LEFT', label: 'Left side' },
            { value: 'RIGHT', label: 'Right side' },
            { value: 'BACK', label: 'Back' },
            { value: 'SITTING', label: 'Sitting' },
            { value: 'OTHER', label: 'Other' },
          ],
        },
        notesField(),
      ],
    };
  }

  if (code === 'FALLS') {
    return {
      ...base,
      fields: [
        {
          key: 'fallOccurred',
          label: 'Did a fall occur?',
          inputType: 'boolean',
          required: true,
          payloadPath: 'fallOccurred',
        },
        notesField(true),
      ],
    };
  }

  if (input.valueKind === 'NUMERIC') {
    return {
      ...base,
      fields: [
        numericField('value', 'Reading', unit, {
          min: input.bounds.warningMin ?? input.bounds.minAccepted,
          max: input.bounds.warningMax ?? input.bounds.maxAccepted,
        }),
        notesField(),
      ],
    };
  }

  // Generic composite / free-text fallback
  return {
    ...base,
    fields: [
      {
        key: 'value',
        label: 'Observation',
        inputType: 'textarea',
        required: true,
        placeholder: 'Describe what was observed…',
      },
      notesField(),
    ],
  };
}

export function mobileTypeCode(observationTypeCode: string): string {
  const upper = observationTypeCode.toUpperCase();
  return OBS_TYPE_CODE_ALIASES[upper] ?? upper.toLowerCase();
}

/** Resolve mobile typeCode / alias / DB code → ObservationType.code (uppercase). */
export function resolveObservationTypeCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase().replace(/-/g, '_');
  if (OBS_TYPE_CODE_ALIASES[upper]) return upper;
  const lower = trimmed.toLowerCase().replace(/-/g, '_');
  for (const [dbCode, alias] of Object.entries(OBS_TYPE_CODE_ALIASES)) {
    if (alias === lower) return dbCode;
  }
  return upper;
}

export function buildCatalogSections(
  types: Array<{ code: string; name: string; unitLabel: string | null }>,
) {
  const byCode = new Map(types.map((t) => [t.code.toUpperCase(), t]));
  return OBS_CATALOG_SECTIONS.map((section) => {
    const items = section.typeCodes
      .map((code) => byCode.get(code))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => {
        const typeCode = mobileTypeCode(t.code);
        return {
          id: typeCode,
          typeCode,
          observationTypeCode: t.code,
          label: t.name,
          subtitle: t.unitLabel ? `Unit: ${t.unitLabel}` : null,
          iconKey: typeCode,
          allowsUnableToRecord: true,
        };
      });
    return {
      id: section.id,
      label: section.label,
      items,
    };
  }).filter((s) => s.items.length > 0);
}
