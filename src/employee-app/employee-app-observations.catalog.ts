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
  SLEEP: 'sleep',
  FLUID_MONITOR: 'fluid_intake',
  REPOSITIONING: 'repositioning',
  INFECTION: 'infection',
  SKIN_INTEGRITY: 'skin_integrity',
  BODY_MAP: 'skin_body_map',
  PAIN: 'pain_score',
  FALLS: 'falls',
  BOWEL_MOVEMENT: 'bowel',
  CONTINENCE: 'continence',
  MEALS: 'meals',
  PEG_ENTERAL: 'peg_enteral',
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
    typeCodes: [
      'WELLBEING',
      'SLEEP',
      'PAIN',
      'FLUID_MONITOR',
      'MEALS',
      'PEG_ENTERAL',
      'BOWEL_MOVEMENT',
      'CONTINENCE',
      'REPOSITIONING',
      'SKIN_INTEGRITY',
    ],
  },
  {
    id: 'clinical_charts',
    label: 'Clinical charts',
    typeCodes: ['FALLS', 'SEIZURE_CHART', 'URINALYSIS', 'INFECTION', 'BODY_MAP', 'ABC_PATTERNS'],
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
      key: `wellbeing_${d.code}`,
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

  if (code === 'SLEEP') {
    return {
      ...base,
      subtitle: 'How did the person sleep this visit / overnight?',
      fields: [
        {
          key: 'quality',
          label: 'Sleep',
          inputType: 'select',
          required: true,
          payloadPath: 'quality',
          options: [
            { value: 'SETTLED', label: 'Settled' },
            { value: 'RESTLESS', label: 'Restless' },
            { value: 'DISTURBED', label: 'Disturbed' },
            { value: 'DID_NOT_SLEEP', label: 'Did not sleep' },
          ],
        },
        {
          key: 'reasons',
          label: 'Likely reason',
          inputType: 'select',
          required: false,
          payloadPath: 'reasons',
          helperText: 'Select all that apply when sleep was not settled.',
          options: [
            { value: 'PAIN', label: 'Pain' },
            { value: 'TOILET', label: 'Toilet' },
            { value: 'NOISE', label: 'Noise' },
            { value: 'ANXIETY', label: 'Anxiety' },
            { value: 'UNKNOWN', label: 'Unknown' },
          ],
        },
        notesField(),
      ],
    };
  }

  if (code === 'PEG_ENTERAL') {
    return {
      ...base,
      subtitle: 'Record PEG / enteral feed, flush and tube site',
      fields: [
        {
          key: 'feed_given',
          label: 'Feed given',
          inputType: 'select',
          required: true,
          payloadPath: 'feed_given',
          options: [
            { value: 'YES', label: 'Yes' },
            { value: 'PARTIAL', label: 'Partial' },
            { value: 'NO', label: 'No' },
            { value: 'NOT_DUE', label: 'Not due' },
          ],
        },
        numericField('volume_ml', 'Volume (ml)', 'ml', {
          required: false,
          payloadPath: 'volume_ml',
        }),
        {
          key: 'tube_status',
          label: 'Tube',
          inputType: 'select',
          required: true,
          payloadPath: 'tube_status',
          options: [
            { value: 'PATENT', label: 'Patent' },
            { value: 'BLOCKED', label: 'Blocked' },
            { value: 'DISLODGED', label: 'Dislodged' },
            { value: 'NOT_CHECKED', label: 'Not checked' },
          ],
        },
        {
          key: 'site',
          label: 'Site',
          inputType: 'select',
          required: true,
          payloadPath: 'site',
          options: [
            { value: 'INTACT', label: 'Intact' },
            { value: 'REDNESS', label: 'Redness' },
            { value: 'LEAKAGE', label: 'Leakage' },
            { value: 'DISCHARGE', label: 'Discharge' },
          ],
        },
        {
          key: 'flush',
          label: 'Flush given',
          inputType: 'select',
          required: false,
          payloadPath: 'flush',
          options: [
            { value: 'YES', label: 'Yes' },
            { value: 'NO', label: 'No' },
          ],
        },
        notesField(),
      ],
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
      subtitle: 'Record the new position after turning',
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
        {
          key: 'tolerated',
          label: 'Tolerated',
          inputType: 'select',
          required: false,
          payloadPath: 'tolerated',
          options: [
            { value: 'YES', label: 'Yes' },
            { value: 'DISCOMFORT', label: 'With discomfort' },
            { value: 'REFUSED', label: 'Refused' },
          ],
        },
        {
          key: 'skin_glance',
          label: 'Skin glance',
          inputType: 'select',
          required: false,
          payloadPath: 'skin_glance',
          options: [
            { value: 'INTACT', label: 'Intact' },
            { value: 'REDNESS', label: 'Redness' },
            { value: 'MARK', label: 'Mark' },
          ],
        },
        notesField(),
      ],
    };
  }

  if (code === 'CONTINENCE') {
    return {
      ...base,
      subtitle: 'Record continence care provided this visit',
      fields: [
        {
          key: 'status',
          label: 'Continence',
          inputType: 'select',
          required: true,
          payloadPath: 'status',
          options: [
            { value: 'CONTINENT', label: 'Continent' },
            { value: 'PAD_CHANGED', label: 'Pad changed' },
            { value: 'CATHETER_CARE', label: 'Catheter care' },
            { value: 'INCONTINENT', label: 'Incontinent' },
          ],
        },
        {
          key: 'catheter_action',
          label: 'Care given',
          inputType: 'select',
          required: false,
          payloadPath: 'catheter_action',
          options: [
            { value: 'BAG_EMPTIED', label: 'Bag emptied' },
            { value: 'BAG_CHANGED', label: 'Bag changed' },
            { value: 'FLUSHED', label: 'Flushed' },
            { value: 'CHECKED_ONLY', label: 'Checked only' },
          ],
        },
        numericField('catheter_volume', 'Output (ml)', 'ml', {
          required: false,
          payloadPath: 'catheter_volume',
        }),
        {
          key: 'catheter_appearance',
          label: 'Urine appearance',
          inputType: 'select',
          required: false,
          payloadPath: 'catheter_appearance',
          options: [
            { value: 'CLEAR', label: 'Clear' },
            { value: 'CLOUDY', label: 'Cloudy' },
            { value: 'DARK', label: 'Dark' },
            { value: 'BLOOD_STAINED', label: 'Blood-stained' },
            { value: 'ODOUR', label: 'Odour' },
          ],
        },
        {
          key: 'catheter_issues',
          label: 'Problems',
          inputType: 'select',
          required: false,
          payloadPath: 'catheter_issues',
          options: [
            { value: 'BYPASSING', label: 'Bypassing' },
            { value: 'DISCOMFORT', label: 'Discomfort' },
            { value: 'SITE_REDNESS', label: 'Site redness' },
          ],
        },
        {
          key: 'skin',
          label: 'Skin',
          inputType: 'select',
          required: false,
          payloadPath: 'skin',
          options: [
            { value: 'SKIN_INTACT', label: 'Skin intact' },
            { value: 'REDNESS', label: 'Redness' },
            { value: 'BARRIER_CREAM', label: 'Barrier cream' },
            { value: 'WASH_AND_DRY', label: 'Wash & dry' },
          ],
        },
        notesField(),
      ],
    };
  }

  if (code === 'SKIN_INTEGRITY') {
    return {
      ...base,
      subtitle: 'Record how the skin looks — no body-map mark required',
      fields: [
        {
          key: 'condition',
          label: 'Skin condition',
          inputType: 'select',
          required: true,
          payloadPath: 'condition',
          options: [
            { value: 'INTACT', label: 'Intact' },
            { value: 'REDNESS', label: 'Redness' },
            { value: 'BROKEN', label: 'Broken' },
            { value: 'DRY', label: 'Dry' },
            { value: 'RASH', label: 'Rash' },
            { value: 'PRESSURE_MARK', label: 'Pressure mark' },
          ],
        },
        notesField(),
      ],
    };
  }

  if (code === 'FALLS') {
    return {
      ...base,
      subtitle: 'Record whether a fall happened, then any injury',
      fields: [
        {
          key: 'fall_occurred',
          label: 'Did a fall occur?',
          inputType: 'select',
          required: true,
          payloadPath: 'fall_occurred',
          options: [
            { value: 'YES', label: 'Yes' },
            { value: 'NO', label: 'No' },
          ],
        },
        {
          key: 'location',
          label: 'Location',
          inputType: 'select',
          required: false,
          payloadPath: 'location',
          options: [
            { value: 'BATHROOM', label: 'Bathroom' },
            { value: 'BEDROOM', label: 'Bedroom' },
            { value: 'LOUNGE', label: 'Lounge' },
            { value: 'KITCHEN', label: 'Kitchen' },
            { value: 'OUTSIDE', label: 'Outside' },
            { value: 'OTHER', label: 'Other' },
          ],
        },
        {
          key: 'witnessed',
          label: 'Witnessed',
          inputType: 'select',
          required: false,
          payloadPath: 'witnessed',
          options: [
            { value: 'WITNESSED', label: 'Witnessed' },
            { value: 'UNWITNESSED', label: 'Unwitnessed' },
          ],
        },
        {
          key: 'injury',
          label: 'Injury',
          inputType: 'select',
          required: false,
          payloadPath: 'injury',
          options: [
            { value: 'BRUISE', label: 'Bruise' },
            { value: 'SKIN_BREAK', label: 'Skin break' },
            { value: 'PAIN', label: 'Pain' },
            { value: 'HEAD_INJURY', label: 'Head injury' },
          ],
        },
        {
          key: 'help',
          label: 'Help given',
          inputType: 'select',
          required: false,
          payloadPath: 'help',
          options: [
            { value: 'FIRST_AID', label: 'First aid' },
            { value: 'OFFICE', label: 'Office' },
            { value: '999', label: '999' },
          ],
        },
        notesField(),
      ],
    };
  }

  if (code === 'BOWEL_MOVEMENT') {
    return {
      ...base,
      subtitle: 'Select the Bristol stool type that best matches',
      fields: [
        {
          key: 'bristol',
          label: 'Bristol type',
          inputType: 'select',
          required: true,
          payloadPath: 'bristol',
          options: [
            { value: 'TYPE_1', label: 'Type 1 · hard lumps' },
            { value: 'TYPE_2', label: 'Type 2 · lumpy' },
            { value: 'TYPE_3', label: 'Type 3 · cracked' },
            { value: 'TYPE_4', label: 'Type 4 · smooth' },
            { value: 'TYPE_5', label: 'Type 5 · soft blobs' },
            { value: 'TYPE_6', label: 'Type 6 · mushy' },
            { value: 'TYPE_7', label: 'Type 7 · liquid' },
          ],
        },
        {
          key: 'continence',
          label: 'Continence',
          inputType: 'select',
          required: false,
          payloadPath: 'continence',
          options: [
            { value: 'CONTINENT', label: 'Continent' },
            { value: 'PAD_CHANGED', label: 'Pad changed' },
            { value: 'CATHETER', label: 'Catheter' },
            { value: 'INCONTINENT', label: 'Incontinent' },
          ],
        },
        notesField(),
      ],
    };
  }

  if (code === 'MEALS') {
    return {
      ...base,
      subtitle: 'Record what the client ate this visit',
      fields: [
        {
          key: 'amount',
          label: 'Amount eaten',
          inputType: 'select',
          required: true,
          payloadPath: 'amount',
          options: [
            { value: 'ALL', label: 'All' },
            { value: 'MOST', label: 'Most' },
            { value: 'HALF', label: 'Half' },
            { value: 'LITTLE', label: 'Little' },
            { value: 'REFUSED', label: 'Refused' },
          ],
        },
        {
          key: 'refused_reason',
          label: 'Why refused',
          inputType: 'select',
          required: false,
          payloadPath: 'refused_reason',
          options: [
            { value: 'NOT_HUNGRY', label: 'Not hungry' },
            { value: 'UNWELL', label: 'Unwell' },
            { value: 'DISLIKES', label: 'Dislikes' },
            { value: 'TEXTURE', label: 'Texture' },
            { value: 'UNKNOWN', label: 'Unknown' },
          ],
        },
        {
          key: 'texture',
          label: 'Texture / support',
          inputType: 'select',
          required: false,
          payloadPath: 'texture',
          options: [
            { value: 'NORMAL', label: 'Normal' },
            { value: 'SOFT', label: 'Soft' },
            { value: 'PUREED', label: 'Pureed' },
            { value: 'THICKENED_FLUIDS', label: 'Thickened fluids' },
            { value: 'ASSISTED', label: 'Assisted' },
          ],
        },
        notesField(),
      ],
    };
  }

  if (code === 'BODY_MAP') {
    return {
      ...base,
      subtitle: 'Describe the skin. Body-map pins are recorded on the visit body map.',
      fields: [
        {
          key: 'condition',
          label: 'Skin condition',
          inputType: 'select',
          required: true,
          payloadPath: 'condition',
          options: [
            { value: 'INTACT', label: 'Intact' },
            { value: 'REDNESS', label: 'Redness' },
            { value: 'BLISTER', label: 'Blister' },
            { value: 'BROKEN', label: 'Broken' },
            { value: 'PRESSURE_ULCER', label: 'Pressure ulcer' },
          ],
        },
        notesField(),
      ],
    };
  }

  if (code === 'NEWS2') {
    return {
      ...base,
      subtitle: 'Enter the six NEWS2 parameters and ACVPU. Escalate if the total is 7 or more.',
      fields: [
        numericField('respirationRate', 'Respiration (rpm)', 'rpm', {
          payloadPath: 'respirationRate',
        }),
        numericField('oxygenSaturation', 'SpO₂ %', '%', {
          payloadPath: 'oxygenSaturation',
        }),
        {
          key: 'airOrOxygen',
          label: 'Air or oxygen',
          inputType: 'select',
          required: true,
          payloadPath: 'airOrOxygen',
          options: [
            { value: 'AIR', label: 'Air' },
            { value: 'OXYGEN', label: 'Oxygen' },
          ],
        },
        numericField('systolic', 'Systolic', 'mmHg', { payloadPath: 'systolic' }),
        numericField('diastolic', 'Diastolic', 'mmHg', { payloadPath: 'diastolic' }),
        numericField('pulse', 'Pulse (bpm)', 'bpm', { payloadPath: 'pulse' }),
        {
          key: 'consciousness',
          label: 'Consciousness (ACVPU)',
          inputType: 'select',
          required: true,
          payloadPath: 'consciousness',
          options: [
            { value: 'A', label: 'A' },
            { value: 'C', label: 'C' },
            { value: 'V', label: 'V' },
            { value: 'P', label: 'P' },
            { value: 'U', label: 'U' },
          ],
        },
        numericField('temperature', 'Temperature (°C)', '°C', {
          payloadPath: 'temperature',
        }),
        notesField(),
      ],
    };
  }

  if (code === 'ABC_PATTERNS') {
    return {
      ...base,
      subtitle: 'Antecedent, behaviour, consequences, and action taken',
      fields: [
        {
          key: 'antecedent',
          label: 'Antecedent (A)',
          inputType: 'textarea',
          required: true,
          payloadPath: 'antecedent',
          placeholder: 'What happened just before…',
        },
        {
          key: 'behaviour',
          label: 'Behaviour (B)',
          inputType: 'textarea',
          required: true,
          payloadPath: 'behaviour',
          placeholder: 'What you saw…',
        },
        {
          key: 'consequences',
          label: 'Consequences (C)',
          inputType: 'textarea',
          required: true,
          payloadPath: 'consequences',
          placeholder: 'What happened next…',
        },
        {
          key: 'actionTaken',
          label: 'Action taken',
          inputType: 'textarea',
          required: true,
          payloadPath: 'actionTaken',
          placeholder: 'What you did…',
        },
        {
          key: 'riskLevel',
          label: 'Risk',
          inputType: 'select',
          required: false,
          payloadPath: 'riskLevel',
          options: [
            { value: 'LOW', label: 'Low' },
            { value: 'MEDIUM', label: 'Medium' },
            { value: 'HIGH', label: 'High' },
            { value: 'CRITICAL', label: 'Critical' },
          ],
        },
      ],
    };
  }

  if (code === 'SEIZURE_CHART') {
    return {
      ...base,
      subtitle: 'Record the seizure episode',
      fields: [
        {
          key: 'description',
          label: 'Description',
          inputType: 'textarea',
          required: true,
          payloadPath: 'description',
          placeholder: 'Type / what you saw…',
        },
        {
          key: 'lengthOfSeizure',
          label: 'Duration (minutes)',
          inputType: 'text',
          required: false,
          payloadPath: 'lengthOfSeizure',
          placeholder: 'Minutes',
        },
        notesField(),
      ],
    };
  }

  if (code === 'URINALYSIS') {
    return {
      ...base,
      subtitle: 'Record urine appearance and dipstick',
      fields: [
        {
          key: 'observationOfUrine',
          label: 'Observation of urine',
          inputType: 'select',
          required: true,
          payloadPath: 'observationOfUrine',
          options: [
            { value: 'CLEAR_PALE', label: 'Clear / pale' },
            { value: 'CLEAR_YELLOW', label: 'Clear / yellow' },
            { value: 'CLOUDY', label: 'Cloudy' },
            { value: 'DARK', label: 'Dark' },
            { value: 'BLOOD_STAINED', label: 'Blood stained' },
            { value: 'FOUL_SMELL', label: 'Foul smell' },
            { value: 'INCONTINENCE', label: 'Incontinent sample' },
            { value: 'UNKNOWN', label: 'Unknown' },
            { value: 'OTHER', label: 'Other' },
          ],
        },
        {
          key: 'observationOfUrineOther',
          label: 'Other observation',
          inputType: 'textarea',
          required: false,
          payloadPath: 'observationOfUrineOther',
          placeholder: 'Describe…',
        },
        {
          key: 'dipstick',
          label: 'Dipstick',
          inputType: 'select',
          required: true,
          payloadPath: 'dipstick',
          options: [
            { value: 'NOT_TAKEN', label: 'Dipstick not taken' },
            { value: 'NORMAL_RANGE', label: 'Normal range' },
            { value: 'DIPSTICK_RESULT', label: 'Dipstick result' },
          ],
        },
        {
          key: 'actionTaken',
          label: 'Action taken',
          inputType: 'textarea',
          required: false,
          payloadPath: 'actionTaken',
        },
      ],
    };
  }

  if (code === 'INFECTION') {
    return {
      ...base,
      subtitle: 'Record infection type and status',
      fields: [
        {
          key: 'infectionType',
          label: 'Infection type',
          inputType: 'select',
          required: true,
          payloadPath: 'infectionType',
          options: [
            { value: 'COVID_19', label: 'COVID-19' },
            { value: 'C_DIFF', label: 'C.diff' },
            { value: 'E_COLI', label: 'E.coli' },
            { value: 'MRSA', label: 'MRSA' },
            { value: 'NOROVIRUS', label: 'Norovirus' },
            { value: 'UTI', label: 'UTI' },
          ],
        },
        {
          key: 'infectionCleared',
          label: 'Cleared',
          inputType: 'boolean',
          required: false,
          payloadPath: 'infectionCleared',
        },
        {
          key: 'hospitalisation',
          label: 'Hospitalisation',
          inputType: 'boolean',
          required: false,
          payloadPath: 'hospitalisation',
        },
        {
          key: 'isolationRequired',
          label: 'Isolation required',
          inputType: 'boolean',
          required: false,
          payloadPath: 'isolationRequired',
        },
        notesField(),
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
