import type { ObservationValueKind } from '@prisma/client';

export type ObservationTypeSeed = {
  code: string;
  name: string;
  sortOrder: number;
  valueKind: ObservationValueKind;
  usesNews2: boolean;
  unitLabel?: string;
};

export const OBSERVATION_SHARE_TARGETS = [
  { code: 'HANDOVER', name: 'Handover', sortOrder: 10 },
  { code: 'MANAGER', name: 'Manager', sortOrder: 20 },
] as const;

/** Tabs shown on the service user observations page (reference UI). */
export const OBSERVATION_TYPES: ObservationTypeSeed[] = [
  { code: 'WEIGHT', name: 'Weight', sortOrder: 10, valueKind: 'NUMERIC', usesNews2: true, unitLabel: 'KG' },
  { code: 'WELLBEING', name: 'Wellbeing', sortOrder: 20, valueKind: 'WELLBEING', usesNews2: false },
  { code: 'SLEEP', name: 'Sleep', sortOrder: 21, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'RESPIRATION', name: 'Respiration', sortOrder: 30, valueKind: 'NUMERIC', usesNews2: true, unitLabel: 'RPM' },
  { code: 'BLOOD_SUGAR', name: 'Blood Sugar', sortOrder: 40, valueKind: 'NUMERIC', usesNews2: false, unitLabel: 'MMOL/L' },
  { code: 'BLOOD_PRESSURE', name: 'Blood Pressure', sortOrder: 50, valueKind: 'COMPOSITE', usesNews2: true, unitLabel: 'MMHG' },
  { code: 'TEMPERATURE', name: 'Temperature', sortOrder: 60, valueKind: 'NUMERIC', usesNews2: true, unitLabel: 'C' },
  { code: 'OXYGEN_SATURATION', name: 'Oxygen Saturation', sortOrder: 70, valueKind: 'NUMERIC', usesNews2: true, unitLabel: '%' },
  { code: 'PULSE', name: 'Pulse', sortOrder: 80, valueKind: 'NUMERIC', usesNews2: true, unitLabel: 'BPM' },
  { code: 'NEWS2', name: 'NEWS2', sortOrder: 85, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'FLUID_MONITOR', name: 'Fluid Monitor', sortOrder: 90, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'FALLS', name: 'Falls', sortOrder: 100, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'BOWEL_MOVEMENT', name: 'Bowel Movement', sortOrder: 110, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'CONTINENCE', name: 'Continence care', sortOrder: 111, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'MEALS', name: 'Meals', sortOrder: 120, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'PEG_ENTERAL', name: 'PEG / enteral feeding', sortOrder: 121, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'REPOSITIONING', name: 'Repositioning', sortOrder: 130, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'ABC_PATTERNS', name: 'ABC Patterns', sortOrder: 140, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'SEIZURE_CHART', name: 'Seizure Chart', sortOrder: 150, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'URINALYSIS', name: 'Urinalysis', sortOrder: 160, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'INFECTION', name: 'Infection', sortOrder: 170, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'SKIN_INTEGRITY', name: 'Skin integrity', sortOrder: 172, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'BODY_MAP', name: 'Body map', sortOrder: 173, valueKind: 'COMPOSITE', usesNews2: false },
  { code: 'PAIN', name: 'Pain score', sortOrder: 175, valueKind: 'NUMERIC', usesNews2: false, unitLabel: '0-10' },
];

export type WellbeingDimensionSeed = {
  code: string;
  name: string;
  sortOrder: number;
  levelLabels: Record<number, string>;
};

/** Five-point wellbeing scale (1 = lowest / most concern, 5 = highest). */
export const WELLBEING_DIMENSIONS: WellbeingDimensionSeed[] = [
  {
    code: 'MOBILITY',
    name: 'Mobility',
    sortOrder: 10,
    levelLabels: {
      1: 'Fully dependent — unable to mobilise without full assistance',
      2: 'Requires substantial assistance to mobilise',
      3: 'Requires some assistance or supervision to mobilise',
      4: 'Mostly independent with occasional support or aids',
      5: 'Fully independent mobility',
    },
  },
  {
    code: 'HEALTH',
    name: 'Health',
    sortOrder: 20,
    levelLabels: {
      1: 'Significant health concerns requiring urgent clinical review',
      2: 'Ongoing health issues affecting daily care',
      3: 'Stable health with manageable conditions',
      4: 'Generally good health with minor concerns',
      5: 'Excellent overall health',
    },
  },
  {
    code: 'COMMUNICATION',
    name: 'Communication',
    sortOrder: 30,
    levelLabels: {
      1: 'Unable to communicate needs effectively',
      2: 'Limited communication — frequent misunderstanding',
      3: 'Communicates basic needs with some difficulty',
      4: 'Communicates clearly most of the time',
      5: 'Communicates fully and independently',
    },
  },
  {
    code: 'ACTIVITY',
    name: 'Activity',
    sortOrder: 40,
    levelLabels: {
      1: 'No meaningful participation in activities',
      2: 'Minimal engagement in activities',
      3: 'Participates in some activities with encouragement',
      4: 'Regularly engaged in preferred activities',
      5: 'Actively engaged and initiates activities',
    },
  },
  {
    code: 'EMOTIONAL',
    name: 'Emotional',
    sortOrder: 50,
    levelLabels: {
      1: 'Consistently emotionally unstable',
      2: 'Frequently distressed or withdrawn',
      3: 'Variable mood — occasional distress',
      4: 'Generally settled with occasional low mood',
      5: 'Emotionally stable and content',
    },
  },
];
