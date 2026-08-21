/**
 * Service user persona definitions for scheduling QA.
 * Spec: docs/test-data/SERVICE_USER_PERSONAS.md
 */

export const ALL_WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
export const MON_WED_FRI = [1, 3, 5] as const;
export const SATURDAY = [6] as const;

export type PersonaVisitSlot = {
  slotCode: string;
  daysOfWeek: number[];
  plannedStartTime: string;
  plannedEndTime: string;
  requiredCarers: number;
  timeCritical?: boolean;
  timeToleranceMinutes?: number;
  scheduleFrequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  notes?: string;
  slotKind?: 'STANDARD' | 'OVERNIGHT' | 'ONE_OFF';
  nightDuty?: 'NONE' | 'SLEEPING_NIGHT' | 'WAKING_NIGHT';
  durationMinutes?: number;
  slotEffectiveFrom?: string;
  slotEffectiveTo?: string;
  allowBackfillDays?: number;
  /** Per-carer duration for asymmetric double-up (resolved to assignments at seed) */
  carerDurationsMinutes?: number[];
};

export type PersonaMedication = {
  medicationName: string;
  strength: string;
  dose: string;
  frequencyCode: string;
  frequencyText: string;
  categoryCode: string;
  kind: 'REGULAR' | 'PRN';
  instructions?: string;
};

export type PersonaContact = {
  firstName: string;
  lastName: string;
  relationshipCode: string;
  phone?: string;
  mobile?: string;
  isPrimary?: boolean;
  isEmergencyContact?: boolean;
  canReceiveUpdates?: boolean;
  notes?: string;
};

export type PersonaAddress = {
  addressLine1: string;
  addressLine2?: string;
  town: string;
  county?: string;
  postcode: string;
  latitude: number;
  longitude: number;
  accessInstructions?: string;
  keySafeNumber?: string;
};

export type ServiceUserPersona = {
  code: string;
  serviceUserNumber: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  dateOfBirth: string;
  titleCode?: string;
  genderCode: string;
  statusCode: string;
  careTypeCode: string;
  riskLevelCode?: string;
  /** ServiceUserFundingType.code */
  suFundingTypeCode?: string;
  /** FundingType.code for ServiceUserFunding line */
  fundingLineTypeCode?: string;
  nhsNumber: string;
  phone?: string;
  mobile?: string;
  email?: string;
  serviceStartDate?: string;
  serviceEndDate?: string;
  address: PersonaAddress;
  contacts?: PersonaContact[];
  domCare?: {
    numberOfCarers: number;
    weeklyContractedHours?: string;
    doorCode?: string;
    accessInstruction?: string;
    accessRisks?: string;
    careInstructions?: string;
  };
  liveIn?: {
    serviceTypeCode: string;
    levelOfCareCode: string;
    scanTypeCode?: string;
    careInstructions?: string;
  };
  visitPlan?: {
    weeklyContractedHours?: string;
    numberOfCarers: number;
    notes?: string;
    slots: PersonaVisitSlot[];
  };
  legacyIa?: {
    likesToBeKnownAs?: string;
    numberOfCarers?: number;
    reasonForAdmission?: string;
    previousMedicalHistory?: string;
    careInstructions?: string;
    accessInstruction?: string;
    accessRisks?: string;
  };
  carePlanFormNames?: string[];
  medications?: PersonaMedication[];
  allergies?: string[];
  flashMessage?: string;
  dnacpr?: boolean;
  /** Skip visit plan even when dom care (e.g. residential, pre-admission) */
  skipVisitPlan?: boolean;
  /** Reuse demo-service-user-data.seed.ts for rich clinical demo data */
  useDemoClinicalSeed?: boolean;
};

const MORRISON_ADDRESS: PersonaAddress = {
  addressLine1: '2 Rose Cottage',
  town: 'Chingford',
  county: 'London',
  postcode: 'E4 7EN',
  latitude: 51.632,
  longitude: 0.001,
  accessInstructions: 'Shared household — George and Enid Morrison. Ring bell once.',
};

export const SERVICE_USER_PERSONAS: ServiceUserPersona[] = [
  {
    code: 'SU-P01',
    serviceUserNumber: 'SU-TEST-P01',
    firstName: 'Doris',
    lastName: 'Clarke',
    preferredName: 'Doris',
    dateOfBirth: '1943-05-18',
    titleCode: 'MRS',
    genderCode: 'FEMALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'DOMICILIARY',
    riskLevelCode: 'LOW',
    suFundingTypeCode: 'LA_DOMICILIARY',
    fundingLineTypeCode: 'LOCAL_AUTHORITY',
    nhsNumber: '9991234567',
    mobile: '07700901001',
    serviceStartDate: '2025-06-01',
    address: {
      addressLine1: '14 Elm Grove',
      town: 'Wembley',
      county: 'London',
      postcode: 'HA0 2FG',
      latitude: 51.553,
      longitude: -0.296,
      accessInstructions: 'Key safe left of front door.',
      keySafeNumber: '4821',
    },
    contacts: [
      {
        firstName: 'Helen',
        lastName: 'Clarke',
        relationshipCode: 'DAUGHTER',
        mobile: '07700901002',
        isPrimary: true,
        isEmergencyContact: true,
        canReceiveUpdates: true,
      },
    ],
    domCare: {
      numberOfCarers: 1,
      weeklyContractedHours: '10.5',
      doorCode: '4821#',
      careInstructions: 'Female carers preferred. Prompt with medications Level 1A.',
    },
    visitPlan: {
      weeklyContractedHours: '10.5',
      numberOfCarers: 1,
      slots: [
        {
          slotCode: 'MORNING',
          daysOfWeek: [...ALL_WEEK_DAYS],
          plannedStartTime: '08:00',
          plannedEndTime: '09:30',
          requiredCarers: 1,
        },
        {
          slotCode: 'EVENING',
          daysOfWeek: [...ALL_WEEK_DAYS],
          plannedStartTime: '17:00',
          plannedEndTime: '18:00',
          requiredCarers: 1,
        },
      ],
    },
    legacyIa: {
      likesToBeKnownAs: 'Doris',
      numberOfCarers: 1,
      reasonForAdmission: 'Increasing frailty — needs prompting with meds and meal support.',
      previousMedicalHistory: 'Osteoarthritis, mild COPD.',
      careInstructions: 'Uses walking stick indoors. Independent toileting with grab rails.',
    },
    carePlanFormNames: ['Home Care Plan', 'Eating and Drinking', 'Washing and dressing', 'Physical Health'],
    medications: [
      {
        medicationName: 'Amlodipine',
        strength: '5mg',
        dose: '1 tablet',
        frequencyCode: 'ONCE_DAILY',
        frequencyText: 'Once daily in the morning',
        categoryCode: 'BLOOD_PRESSURE',
        kind: 'REGULAR',
      },
      {
        medicationName: 'Paracetamol',
        strength: '500mg',
        dose: '2 tablets',
        frequencyCode: 'AS_REQUIRED',
        frequencyText: 'As required for pain',
        categoryCode: 'PAIN_RELIEF',
        kind: 'PRN',
      },
    ],
  },
  {
    code: 'SU-P02',
    serviceUserNumber: 'SU-TEST-P02',
    firstName: 'James',
    lastName: 'Okafor',
    dateOfBirth: '1954-09-03',
    titleCode: 'MR',
    genderCode: 'MALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'DOMICILIARY',
    riskLevelCode: 'MEDIUM',
    suFundingTypeCode: 'LA_DOMICILIARY',
    fundingLineTypeCode: 'LOCAL_AUTHORITY',
    nhsNumber: '9991234568',
    mobile: '07700902001',
    serviceStartDate: '2025-08-15',
    address: {
      addressLine1: '42 Maple Court',
      town: 'Stratford',
      county: 'London',
      postcode: 'E15 4BQ',
      latitude: 51.543,
      longitude: -0.002,
      accessInstructions: '2nd floor — lift available. Speak slowly — expressive dysphasia.',
    },
    contacts: [
      {
        firstName: 'Grace',
        lastName: 'Okafor',
        relationshipCode: 'WIFE',
        mobile: '07700902002',
        isPrimary: true,
        isEmergencyContact: true,
        notes: 'Lives at same address — informal carer overnight.',
      },
    ],
    domCare: {
      numberOfCarers: 2,
      weeklyContractedHours: '21',
      careInstructions: 'Two carers for ALL transfers. Physio exercises daily.',
    },
    visitPlan: {
      weeklyContractedHours: '21',
      numberOfCarers: 2,
      slots: [
        {
          slotCode: 'MORNING',
          daysOfWeek: [...ALL_WEEK_DAYS],
          plannedStartTime: '07:30',
          plannedEndTime: '09:00',
          requiredCarers: 2,
          durationMinutes: 90,
          carerDurationsMinutes: [90, 45],
          timeCritical: true,
          timeToleranceMinutes: 30,
        },
        {
          slotCode: 'EVENING',
          daysOfWeek: [...ALL_WEEK_DAYS],
          plannedStartTime: '20:00',
          plannedEndTime: '21:30',
          requiredCarers: 2,
        },
      ],
    },
    legacyIa: {
      numberOfCarers: 2,
      reasonForAdmission: 'Post-stroke — left-sided weakness, needs double-up personal care.',
      previousMedicalHistory: 'Ischaemic stroke 2025, Type 2 diabetes, hypertension.',
      careInstructions: 'Allow time to respond. Wife assists between visits.',
    },
    carePlanFormNames: ['Home Care Plan - needs/goals/support', 'Physical Health', 'Person Centred care plan'],
    medications: [
      {
        medicationName: 'Metformin',
        strength: '500mg',
        dose: '1 tablet',
        frequencyCode: 'TWICE_DAILY',
        frequencyText: 'Twice daily with meals',
        categoryCode: 'DIABETES',
        kind: 'REGULAR',
      },
      {
        medicationName: 'Clopidogrel',
        strength: '75mg',
        dose: '1 tablet',
        frequencyCode: 'ONCE_DAILY',
        frequencyText: 'Once daily',
        categoryCode: 'GENERAL',
        kind: 'REGULAR',
      },
    ],
  },
  {
    code: 'SU-P03',
    serviceUserNumber: 'SU-TEST-P03',
    firstName: 'Michael',
    lastName: 'Patel',
    dateOfBirth: '1957-11-22',
    titleCode: 'MR',
    genderCode: 'MALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'DOMICILIARY',
    riskLevelCode: 'MEDIUM',
    suFundingTypeCode: 'MIXED_LA_SELF',
    fundingLineTypeCode: 'LOCAL_AUTHORITY',
    nhsNumber: '9991234569',
    mobile: '07700903001',
    serviceStartDate: '2025-04-01',
    address: {
      addressLine1: '8 Priory Gardens',
      town: 'Southall',
      county: 'London',
      postcode: 'UB1 2RD',
      latitude: 51.509,
      longitude: -0.371,
    },
    domCare: {
      numberOfCarers: 1,
      weeklyContractedHours: '28',
      careInstructions: 'Parkinson\'s — do not rush. Freezing episodes possible.',
    },
    visitPlan: {
      weeklyContractedHours: '28',
      numberOfCarers: 1,
      slots: [
        { slotCode: 'MORNING', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '08:00', plannedEndTime: '09:00', requiredCarers: 1 },
        {
          slotCode: 'MIDDAY',
          daysOfWeek: [...ALL_WEEK_DAYS],
          plannedStartTime: '12:00',
          plannedEndTime: '13:00',
          requiredCarers: 1,
          timeCritical: true,
          timeToleranceMinutes: 15,
        },
        { slotCode: 'AFTERNOON', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '15:00', plannedEndTime: '16:00', requiredCarers: 1 },
        { slotCode: 'EVENING', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '21:00', plannedEndTime: '22:00', requiredCarers: 1 },
      ],
    },
    legacyIa: {
      numberOfCarers: 1,
      previousMedicalHistory: 'Parkinson\'s disease, previous UTI-related delirium.',
      careInstructions: 'Calm environment. Timed medication rounds critical.',
    },
    carePlanFormNames: ['Dementia Care plan', 'Eating and Drinking', 'Pain Management', 'Physical Health'],
    medications: [
      {
        medicationName: 'Co-careldopa',
        strength: '25/100mg',
        dose: '1 tablet',
        frequencyCode: 'FOUR_TIMES_DAILY',
        frequencyText: 'Four times daily',
        categoryCode: 'GENERAL',
        kind: 'REGULAR',
      },
    ],
    flashMessage: 'Freezing episodes — allow 30 seconds, do not pull. Call 111 if sudden confusion.',
  },
  {
    code: 'SU-P04',
    serviceUserNumber: 'SU-TEST-P04',
    firstName: 'Fatima',
    lastName: 'Al-Rashid',
    dateOfBirth: '1971-02-14',
    titleCode: 'MRS',
    genderCode: 'FEMALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'DOMICILIARY',
    riskLevelCode: 'HIGH',
    suFundingTypeCode: 'DP_SELF_MANAGED',
    fundingLineTypeCode: 'DIRECT_PAYMENT',
    nhsNumber: '9991234570',
    mobile: '07700904001',
    serviceStartDate: '2025-03-10',
    address: {
      addressLine1: 'Flat 3, 22 Queens Road',
      town: 'Croydon',
      county: 'London',
      postcode: 'CR0 2BD',
      latitude: 51.372,
      longitude: -0.098,
      accessInstructions: 'Ground floor flat. Ceiling track hoist in bedroom.',
    },
    contacts: [
      {
        firstName: 'Layla',
        lastName: 'Al-Rashid',
        relationshipCode: 'SISTER',
        mobile: '07700904002',
        isPrimary: true,
        isEmergencyContact: true,
        notes: 'POA — female carers only.',
      },
    ],
    domCare: {
      numberOfCarers: 2,
      weeklyContractedHours: '31.5',
      careInstructions: 'Female carers ONLY. Two carers for all hoisting. Halal diet.',
    },
    visitPlan: {
      weeklyContractedHours: '31.5',
      numberOfCarers: 2,
      slots: [
        { slotCode: 'MORNING', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '08:00', plannedEndTime: '09:30', requiredCarers: 2 },
        { slotCode: 'MIDDAY', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '13:00', plannedEndTime: '14:00', requiredCarers: 2 },
        { slotCode: 'EVENING', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '20:30', plannedEndTime: '22:00', requiredCarers: 2 },
      ],
    },
    legacyIa: {
      numberOfCarers: 2,
      previousMedicalHistory: 'Multiple sclerosis — wheelchair dependent.',
      careInstructions: 'Ceiling hoist transfers. Pressure area care.',
    },
    carePlanFormNames: ['Home Support Plan', 'Pressure Ulcer', 'Skin Integrity', 'Culture/Religion/Spirituality'],
    allergies: ['Penicillin'],
  },
  {
    code: 'SU-P05',
    serviceUserNumber: 'SU-TEST-P05',
    firstName: 'Sarah',
    lastName: 'Williams',
    dateOfBirth: '1996-07-08',
    titleCode: 'MS',
    genderCode: 'FEMALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'SUPPORTED_LIVING',
    riskLevelCode: 'MEDIUM',
    suFundingTypeCode: 'LA_SUPPORTED_LIVING',
    fundingLineTypeCode: 'LOCAL_AUTHORITY',
    nhsNumber: '9991234571',
    mobile: '07700905001',
    serviceStartDate: '2024-01-15',
    address: {
      addressLine1: 'Flat 2, 5 Cedar Mews',
      town: 'Hackney',
      county: 'London',
      postcode: 'E8 3DL',
      latitude: 51.549,
      longitude: -0.055,
    },
    domCare: {
      numberOfCarers: 1,
      weeklyContractedHours: '10',
      careInstructions: 'Learning disability — visual timetable. Same small team preferred.',
    },
    visitPlan: {
      weeklyContractedHours: '10',
      numberOfCarers: 1,
      slots: [
        {
          slotCode: 'MORNING',
          daysOfWeek: [...MON_WED_FRI],
          plannedStartTime: '09:00',
          plannedEndTime: '11:00',
          requiredCarers: 1,
          scheduleFrequency: 'WEEKLY',
        },
        {
          slotCode: 'AFTERNOON',
          daysOfWeek: [...SATURDAY],
          plannedStartTime: '10:00',
          plannedEndTime: '14:00',
          requiredCarers: 1,
          scheduleFrequency: 'WEEKLY',
          notes: 'Community outreach / shopping',
        },
      ],
    },
    legacyIa: {
      likesToBeKnownAs: 'Sarah',
      numberOfCarers: 1,
      previousMedicalHistory: 'Mild learning disability, epilepsy (controlled).',
      careInstructions: 'Autism traits — prefers routine. Rescue protocol for seizures on file.',
    },
    carePlanFormNames: ['Person Centred care plan', 'Social Activities', 'Personal Safety'],
    medications: [
      {
        medicationName: 'Levetiracetam',
        strength: '500mg',
        dose: '1 tablet',
        frequencyCode: 'TWICE_DAILY',
        frequencyText: 'Twice daily',
        categoryCode: 'GENERAL',
        kind: 'REGULAR',
      },
    ],
  },
  {
    code: 'SU-P06',
    serviceUserNumber: 'SU-TEST-P06',
    firstName: 'Eleanor',
    lastName: 'Davies',
    preferredName: 'Ellie',
    dateOfBirth: '1938-12-01',
    titleCode: 'MRS',
    genderCode: 'FEMALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'DOMICILIARY',
    riskLevelCode: 'CRITICAL',
    suFundingTypeCode: 'NHS_CHC_FAST_TRACK',
    fundingLineTypeCode: 'NHS',
    nhsNumber: '9991234572',
    serviceStartDate: '2025-10-01',
    address: {
      addressLine1: '1 Meadow Lane',
      town: 'Enfield',
      county: 'London',
      postcode: 'EN2 8AB',
      latitude: 51.653,
      longitude: -0.084,
    },
    domCare: {
      numberOfCarers: 1,
      weeklyContractedHours: '168',
      careInstructions: 'End-of-life pathway. Live-in Mon–Fri, waking nights Sat–Sun.',
    },
    liveIn: {
      serviceTypeCode: 'LIVE_IN_CARE',
      levelOfCareCode: 'B',
      scanTypeCode: 'QR_OR_BARCODE',
      careInstructions: 'Comfort care only. DNACPR in place.',
    },
    visitPlan: {
      weeklyContractedHours: '168',
      numberOfCarers: 1,
      notes: 'Supplemental slots alongside live-in package',
      slots: [
        {
          slotCode: 'NIGHT',
          daysOfWeek: [6, 0],
          plannedStartTime: '22:00',
          plannedEndTime: '07:00',
          requiredCarers: 1,
          slotKind: 'OVERNIGHT',
          nightDuty: 'WAKING_NIGHT',
          durationMinutes: 540,
          notes: 'Waking night Sat–Sun',
        },
      ],
    },
    legacyIa: {
      likesToBeKnownAs: 'Ellie',
      numberOfCarers: 1,
      previousMedicalHistory: 'Advanced COPD, heart failure.',
      careInstructions: 'Symptom management, oxygen monitoring, anticipatory meds.',
    },
    carePlanFormNames: ['Advance', 'Final Days', 'Pain Management', 'Sleeping and Night'],
    medications: [
      {
        medicationName: 'Morphine sulfate',
        strength: '10mg/5ml',
        dose: '2.5ml',
        frequencyCode: 'AS_REQUIRED',
        frequencyText: 'PRN breathlessness',
        categoryCode: 'PAIN_RELIEF',
        kind: 'PRN',
      },
    ],
    flashMessage: 'DNACPR in place — comfort care only. Contact on-call nurse for symptom escalation.',
    dnacpr: true,
  },
  {
    code: 'SU-P07',
    serviceUserNumber: 'SU-TEST-P07',
    firstName: 'David',
    lastName: 'Thompson',
    dateOfBirth: '1980-04-25',
    titleCode: 'MR',
    genderCode: 'MALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'DOMICILIARY',
    riskLevelCode: 'HIGH',
    suFundingTypeCode: 'LA_DOMICILIARY',
    fundingLineTypeCode: 'LOCAL_AUTHORITY',
    nhsNumber: '9991234573',
    mobile: '07700907001',
    serviceStartDate: '2025-02-01',
    address: {
      addressLine1: '17B High Street',
      town: 'Tottenham',
      county: 'London',
      postcode: 'N17 6QA',
      latitude: 51.588,
      longitude: -0.071,
      accessInstructions: 'Cluttered access — may refuse entry. Report to coordinator.',
    },
    domCare: {
      numberOfCarers: 1,
      weeklyContractedHours: '12',
      careInstructions: 'Mental health — motivational approach. Same small team.',
    },
    visitPlan: {
      weeklyContractedHours: '12',
      numberOfCarers: 1,
      slots: [
        {
          slotCode: 'MORNING',
          daysOfWeek: [1, 3, 5, 0],
          plannedStartTime: '10:00',
          plannedEndTime: '11:30',
          requiredCarers: 1,
          timeToleranceMinutes: 60,
        },
        {
          slotCode: 'EVENING',
          daysOfWeek: [...ALL_WEEK_DAYS],
          plannedStartTime: '17:00',
          plannedEndTime: '18:00',
          requiredCarers: 1,
        },
      ],
    },
    legacyIa: {
      numberOfCarers: 1,
      previousMedicalHistory: 'Schizoaffective disorder.',
      careInstructions: 'May refuse care — document and escalate.',
    },
    carePlanFormNames: ['Personal Safety', 'Cognition and Behaviour', 'Home Care Plan'],
  },
  {
    code: 'SU-P08',
    serviceUserNumber: 'SU-TEST-P08',
    firstName: 'Robert',
    lastName: 'Chen',
    dateOfBirth: '1947-06-30',
    titleCode: 'MR',
    genderCode: 'MALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'DOMICILIARY',
    riskLevelCode: 'LOW',
    suFundingTypeCode: 'NHS_DISCHARGE_TO_ASSESS',
    fundingLineTypeCode: 'NHS',
    nhsNumber: '9991234574',
    mobile: '07700908001',
    serviceStartDate: '2026-05-28',
    address: {
      addressLine1: '55 Oak Avenue',
      town: 'Barnet',
      county: 'London',
      postcode: 'EN4 8PL',
      latitude: 51.644,
      longitude: -0.165,
    },
    contacts: [
      {
        firstName: 'Linda',
        lastName: 'Chen',
        relationshipCode: 'WIFE',
        mobile: '07700908002',
        isPrimary: true,
        isEmergencyContact: true,
      },
    ],
    domCare: {
      numberOfCarers: 1,
      weeklyContractedHours: '31.5',
      careInstructions: 'Reablement phase 1 — intensive visits, taper from week 3.',
    },
    visitPlan: {
      weeklyContractedHours: '31.5',
      numberOfCarers: 1,
      notes: 'Reablement intensive phase',
      slots: [
        { slotCode: 'MORNING', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '08:00', plannedEndTime: '09:30', requiredCarers: 1 },
        { slotCode: 'MIDDAY', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '12:00', plannedEndTime: '13:00', requiredCarers: 1 },
        { slotCode: 'EVENING', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '17:00', plannedEndTime: '18:00', requiredCarers: 1 },
      ],
    },
    legacyIa: {
      numberOfCarers: 1,
      reasonForAdmission: 'Post hip fracture (#NOF) — reablement package.',
      previousMedicalHistory: 'ORIF 3 weeks ago. Previously independent.',
      careInstructions: 'Walking frame. Physio exercises with visits.',
    },
    carePlanFormNames: ['Home Care Plan - needs/goals/support', 'Physical Health', 'Risk Assessment'],
    medications: [
      {
        medicationName: 'Apixaban',
        strength: '2.5mg',
        dose: '1 tablet',
        frequencyCode: 'TWICE_DAILY',
        frequencyText: 'Twice daily',
        categoryCode: 'GENERAL',
        kind: 'REGULAR',
      },
    ],
  },
  {
    code: 'SU-P09',
    serviceUserNumber: 'SU-TEST-P09',
    firstName: 'Patricia',
    lastName: 'Morgan',
    preferredName: 'Pat',
    dateOfBirth: '1949-08-19',
    titleCode: 'MRS',
    genderCode: 'FEMALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'RESPITE',
    riskLevelCode: 'LOW',
    suFundingTypeCode: 'LA_RESPITE',
    fundingLineTypeCode: 'FAMILY_FUNDED',
    nhsNumber: '9991234575',
    serviceStartDate: '2026-06-05',
    serviceEndDate: '2026-06-19',
    address: {
      addressLine1: '9 Lilac Close',
      addressLine2: 'Annex',
      town: 'Richmond',
      county: 'London',
      postcode: 'TW10 6DH',
      latitude: 51.461,
      longitude: -0.303,
    },
    domCare: {
      numberOfCarers: 1,
      weeklyContractedHours: '21',
      careInstructions: 'Respite — early Alzheimer\'s. Supervision required — may wander.',
    },
    visitPlan: {
      weeklyContractedHours: '21',
      numberOfCarers: 1,
      notes: '2-week respite package',
      slots: [
        { slotCode: 'MORNING', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '08:30', plannedEndTime: '10:00', requiredCarers: 1 },
        { slotCode: 'MIDDAY', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '12:30', plannedEndTime: '13:30', requiredCarers: 1 },
        { slotCode: 'EVENING', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '17:30', plannedEndTime: '19:00', requiredCarers: 1 },
      ],
    },
    legacyIa: {
      likesToBeKnownAs: 'Pat',
      numberOfCarers: 1,
      previousMedicalHistory: 'Early Alzheimer\'s disease.',
      careInstructions: 'Pleasant but may wander — door sensors recommended.',
    },
    carePlanFormNames: ['Dementia Care plan', 'Personal Safety', 'Social Activities'],
    medications: [
      {
        medicationName: 'Donepezil',
        strength: '10mg',
        dose: '1 tablet',
        frequencyCode: 'ONCE_DAILY',
        frequencyText: 'Once at night',
        categoryCode: 'GENERAL',
        kind: 'REGULAR',
      },
    ],
  },
  {
    code: 'SU-P10',
    serviceUserNumber: 'SU-TEST-P10',
    firstName: 'Betty',
    lastName: 'Henderson',
    preferredName: 'Betty',
    dateOfBirth: '1941-01-20',
    titleCode: 'MRS',
    genderCode: 'FEMALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'RESIDENTIAL',
    riskLevelCode: 'HIGH',
    suFundingTypeCode: 'LA_NURSING_HOME',
    fundingLineTypeCode: 'LOCAL_AUTHORITY',
    nhsNumber: '9991234576',
    serviceStartDate: '2024-06-01',
    address: {
      addressLine1: 'Oakwood EMI Unit',
      addressLine2: 'Room 12',
      town: 'Sutton',
      county: 'London',
      postcode: 'SM1 2LG',
      latitude: 51.361,
      longitude: -0.192,
      accessInstructions: 'Residential care home — on-site 24h care, no domiciliary visits.',
    },
    legacyIa: {
      likesToBeKnownAs: 'Betty',
      numberOfCarers: 2,
      reasonForAdmission: 'Vascular dementia — requires 24-hour residential support.',
      previousMedicalHistory: 'Vascular dementia, Type 2 diabetes, hypertension, osteoarthritis.',
      careInstructions: 'Two carers for transfers. Unsettled at night.',
      accessRisks: 'Falls risk. Night sensor mat in use.',
    },
    skipVisitPlan: true,
    useDemoClinicalSeed: true,
    carePlanFormNames: ['Dementia Care plan', 'Cognition and Behaviour', 'Eating and Drinking', 'Sleeping and Night'],
    dnacpr: true,
  },
  {
    code: 'SU-P11',
    serviceUserNumber: 'SU-TEST-P11',
    firstName: 'George',
    lastName: 'Morrison',
    dateOfBirth: '1945-03-11',
    titleCode: 'MR',
    genderCode: 'MALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'DOMICILIARY',
    riskLevelCode: 'MEDIUM',
    suFundingTypeCode: 'SELF_WITH_AA',
    fundingLineTypeCode: 'SELF_FUNDED',
    nhsNumber: '9991234577',
    mobile: '07700911001',
    serviceStartDate: '2025-01-01',
    address: MORRISON_ADDRESS,
    contacts: [
      {
        firstName: 'Enid',
        lastName: 'Morrison',
        relationshipCode: 'WIFE',
        isPrimary: true,
        notes: 'Lives at same address.',
      },
      {
        firstName: 'Carol',
        lastName: 'Morrison',
        relationshipCode: 'DAUGHTER',
        mobile: '07700911003',
        isEmergencyContact: true,
      },
    ],
    domCare: {
      numberOfCarers: 1,
      weeklyContractedHours: '7',
      careInstructions: 'Post-CABG — breathless on exertion. Shower assist.',
    },
    visitPlan: {
      weeklyContractedHours: '7',
      numberOfCarers: 1,
      notes: 'Shared address with Enid Morrison (SU-TEST-P12)',
      slots: [
        { slotCode: 'MORNING', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '09:00', plannedEndTime: '10:00', requiredCarers: 1 },
      ],
    },
    legacyIa: {
      numberOfCarers: 1,
      previousMedicalHistory: 'Post-CABG 6 months ago.',
    },
    carePlanFormNames: ['Physical Health', 'Home Care Plan'],
  },
  {
    code: 'SU-P12',
    serviceUserNumber: 'SU-TEST-P12',
    firstName: 'Enid',
    lastName: 'Morrison',
    dateOfBirth: '1947-10-05',
    titleCode: 'MRS',
    genderCode: 'FEMALE',
    statusCode: 'ACTIVE',
    careTypeCode: 'DOMICILIARY',
    riskLevelCode: 'LOW',
    suFundingTypeCode: 'SELF_WITH_AA',
    fundingLineTypeCode: 'SELF_FUNDED',
    nhsNumber: '9991234578',
    mobile: '07700912001',
    serviceStartDate: '2025-01-01',
    address: MORRISON_ADDRESS,
    domCare: {
      numberOfCarers: 1,
      weeklyContractedHours: '10.5',
      careInstructions: 'Macular degeneration — poor vision. Frail but cognitively intact.',
    },
    visitPlan: {
      weeklyContractedHours: '10.5',
      numberOfCarers: 1,
      notes: 'Shared address with George Morrison (SU-TEST-P11)',
      slots: [
        { slotCode: 'MORNING', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '08:00', plannedEndTime: '09:00', requiredCarers: 1 },
        { slotCode: 'EVENING', daysOfWeek: [...ALL_WEEK_DAYS], plannedStartTime: '17:00', plannedEndTime: '18:00', requiredCarers: 1 },
      ],
    },
    legacyIa: {
      numberOfCarers: 1,
      previousMedicalHistory: 'Age-related macular degeneration.',
    },
    carePlanFormNames: ['Home Care Plan', 'Washing and dressing'],
  },
  {
    code: 'SU-P13',
    serviceUserNumber: 'SU-TEST-P13',
    firstName: 'Aisha',
    lastName: 'Mohammed',
    dateOfBirth: '1958-11-30',
    titleCode: 'MRS',
    genderCode: 'FEMALE',
    statusCode: 'PRE_ADMISSION',
    careTypeCode: 'DOMICILIARY',
    suFundingTypeCode: 'LA_PENDING',
    fundingLineTypeCode: 'UNKNOWN',
    nhsNumber: '9991234579',
    mobile: '07700913001',
    address: {
      addressLine1: '31 Station Road',
      town: 'Ilford',
      county: 'London',
      postcode: 'IG1 4DR',
      latitude: 51.559,
      longitude: 0.071,
    },
    contacts: [
      {
        firstName: 'Zara',
        lastName: 'Mohammed',
        relationshipCode: 'DAUGHTER',
        mobile: '07700913002',
        isPrimary: true,
        isEmergencyContact: true,
      },
    ],
    skipVisitPlan: true,
  },
];
