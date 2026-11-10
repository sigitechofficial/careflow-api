/**
 * Full-enterprise IA expansion for the five Care Plan demo people.
 * Verified against enterprise questionText / fieldKey / option codes and persona seeds.
 * Does not invent ethnicity, N/A fillers, or dynamic “today” dates.
 */
import { IA_REGISTERED_HOLISTIC_TAB_IDS } from '../seed-lib/ia-registered-holistic-tab-ids';
import { enrichWaterlowMetadata } from '../seed-lib/initial-assessment-waterlow.util';
import {
  clearAnswer,
  dateAnswer,
  jsonAnswer,
  multi,
  numberAnswer,
  select,
  text,
  yesNo,
  type IaDemoOverlayAnswer,
  type IaDemoOverlayPersona,
} from './care-plan-ia-demo-overlay.data';

const IA_DEMO_ADL_ACTIVITY_IDS = [
  'eating_drinking',
  'toileting',
  'walking',
  'dressing_undressing',
  'bathing',
  'grooming',
  'preparing_food',
  'laundry',
  'housework',
  'shopping',
  'room_to_room',
  'turning_in_bed',
  'stairs',
  'lying_to_sitting',
  'chair_transfer',
  'toilet_transfer',
  'bed_transfer',
  'enter_leave_home',
  'public_transport',
  'short_walks',
  'long_walks',
] as const;

export const IA_DEMO_ASSESSOR_NAME = 'Sarah Thompson';
export const IA_DEMO_ASSESSOR_ROLE = 'Registered Manager';

export const IA_DEMO_DETERMINISTIC_DATES: Record<
  string,
  { assessment: string; review: string; frequency: 'six_monthly' | 'quarterly' }
> = {
  'SU-1042': { assessment: '2025-11-01', review: '2026-05-01', frequency: 'six_monthly' },
  'SU-TEST-P01': { assessment: '2025-06-01', review: '2025-12-01', frequency: 'six_monthly' },
  'SU-TEST-P02': { assessment: '2025-08-15', review: '2026-02-15', frequency: 'six_monthly' },
  'SU-TEST-P04': { assessment: '2025-03-10', review: '2025-09-10', frequency: 'six_monthly' },
  'SU-TEST-P10': { assessment: '2024-06-01', review: '2024-09-01', frequency: 'quarterly' },
};

/** Optional / unavailable fields left empty on purpose (also cleared if generic autofill filled them). */
export const IA_DEMO_INTENTIONALLY_EMPTY_QUESTIONS = [
  'Middle name',
  'NI number',
  'Ethnicity',
  'PO number',
  'External About Me link',
  'Local authority ID (if funded)',
  'Language required',
  'LPA contact details',
  'LPA designation',
  'LPA name',
  'Mental health team contact',
  'Advocate contact',
  'Care manager contact',
  'GP contact details',
  'Pharmacy name and phone',
  'Preferred hospital',
  'Informal carer contact (if different)',
  'Other accommodation (please state)',
  'Other communication aid — specify',
  'Other personal care location details',
  'Other car parking risks or considerations for staff',
  'Vital signs context (optional)',
  'Safeguarding reference number',
] as const;

type Round = { code: string; from: string; to: string; name: string };

function visitTimes(rounds: Round[]): IaDemoOverlayAnswer {
  const value: Record<string, unknown> = {};
  for (const r of rounds) {
    value[r.code] = { selected: true, from: r.from, to: r.to, roundName: r.name };
  }
  return jsonAnswer('Preferred visit times', value, 'preferredVisitTimes');
}

function empties(): IaDemoOverlayAnswer[] {
  return IA_DEMO_INTENTIONALLY_EMPTY_QUESTIONS.map((q) => clearAnswer(q));
}

function mustMeta(bmiOptionId: string, weightLossOptionId: string, acuteDiseaseOptionId: string) {
  const bmiScores: Record<string, number> = { gt20: 0, '18_5to20': 1, lt18_5: 2 };
  const wlScores: Record<string, number> = { lt5: 0, '5to10': 1, gt10: 2 };
  const acuteScores: Record<string, number> = { no: 0, yes: 2 };
  const score =
    (bmiScores[bmiOptionId] ?? 0) + (wlScores[weightLossOptionId] ?? 0) + (acuteScores[acuteDiseaseOptionId] ?? 0);
  return {
    bmiOptionId,
    weightLossOptionId,
    acuteDiseaseOptionId,
    score,
    riskLevel: score >= 2 ? 'high' : score === 1 ? 'medium' : 'low',
  };
}

function adlRows(scores: Partial<Record<(typeof IA_DEMO_ADL_ACTIVITY_IDS)[number], number>>, fallback: number) {
  return IA_DEMO_ADL_ACTIVITY_IDS.map((id) => ({
    id,
    activity: id.replace(/_/g, ' '),
    score: scores[id] ?? fallback,
    notes: '',
  }));
}

function weekRoutine(weekday: Record<string, string>, weekend?: Partial<Record<string, string>>) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  const slots = ['getUp', 'breakfast', 'lunch', 'afternoon', 'teaTime', 'bedtime'] as const;
  const routine: Record<string, Record<string, string>> = {};
  for (const day of days) {
    const src = day === 'saturday' || day === 'sunday' ? { ...weekday, ...weekend } : weekday;
    routine[day] = Object.fromEntries(slots.map((s) => [s, src[s] ?? ''])) as Record<string, string>;
  }
  return routine;
}

function routineAnswers(routine: Record<string, Record<string, string>>): IaDemoOverlayAnswer[] {
  const dayLabel: Record<string, string> = {
    sunday: 'Sunday',
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
  };
  const slotLabel: Record<string, string> = {
    getUp: 'Get up',
    breakfast: 'Breakfast',
    lunch: 'Lunch',
    afternoon: 'Afternoon',
    teaTime: 'Tea time',
    bedtime: 'Bedtime',
  };
  const rows: IaDemoOverlayAnswer[] = [];
  for (const [day, slots] of Object.entries(routine)) {
    for (const [slot, value] of Object.entries(slots)) {
      if (!value) continue;
      rows.push(text(`${dayLabel[day]} — ${slotLabel[slot]}`, value));
    }
  }
  return rows;
}

function governance(number: string, agrees: boolean, representativeSignOff: boolean): IaDemoOverlayAnswer[] {
  const d = IA_DEMO_DETERMINISTIC_DATES[number];
  const rows: IaDemoOverlayAnswer[] = [
    select('Assessment reason', number === 'SU-TEST-P02' ? 'post_hospital' : 'initial', 'assessmentReason'),
    dateAnswer('Assessment date', d.assessment, 'assessmentDate'),
    dateAnswer('Next review date', d.review, 'nextReviewDate'),
    select('Review frequency', d.frequency, 'reviewFrequency'),
    text('Responsible reviewer (name or role)', `${IA_DEMO_ASSESSOR_NAME}, ${IA_DEMO_ASSESSOR_ROLE}`, 'responsibleReviewer'),
    yesNo('Service User agrees with assessment?', agrees),
    yesNo('Representative involved in sign-off?', representativeSignOff, 'representativeInvolved'),
    yesNo('Service user / representative signature obtained?', true, 'suSignatureObtained'),
    yesNo('Assessor declaration confirmed?', true),
    text('Assessor name', IA_DEMO_ASSESSOR_NAME, 'assessorName'),
    text('Assessor designation / role', IA_DEMO_ASSESSOR_ROLE, 'assessorRole'),
    dateAnswer('Assessor sign-off date', d.assessment, 'assessorSignDate'),
    dateAnswer('Assessment completed date and time', d.assessment, 'assessmentCompletedAt'),
  ];
  if (representativeSignOff) {
    rows.push(
      text('Representative name', 'Family and named nurse (best interest)', 'representativeName'),
      text('Representative relationship', 'Family / unit', 'representativeRelationship'),
    );
  }
  return rows;
}

function identityCommon(params: {
  first: string;
  last: string;
  preferred: string;
  gender: 'female' | 'male';
  dob: string;
  nhs: string;
  address: string;
  funding: string;
  referral: string;
  location: string;
  contacts: string;
  access: string;
}): IaDemoOverlayAnswer[] {
  return [
    text('First name', params.first, 'firstName'),
    text('Last name', params.last, 'lastName'),
    text('Preferred name', params.preferred),
    select('Gender', params.gender),
    dateAnswer('Date of birth', params.dob),
    text('NHS number', params.nhs, 'nhsNumber'),
    text('Address and contact details', params.address),
    select('Funding type', params.funding, 'fundingType'),
    select('Referral source', params.referral, 'referralSource'),
    select('Assessment location', params.location, 'assessmentLocation'),
    text('Family, representative, next of kin, advocate, key contacts', params.contacts),
    text('Access instructions for staff', params.access, 'accessInstructions'),
    select('Preferred communication format', 'spoken'),
    yesNo('Interpreter required?', false, 'interpreterRequired'),
    yesNo('Easy read or large print required?', false),
    select('LPA appointed?', 'none', 'lpoaAppointed'),
    yesNo('Is the client receiving a care package?', true, 'receivingCarePackage'),
    yesNo('Any safeguarding concerns identified?', false, 'safeguardingConcern'),
    yesNo('Emergency contact 1 recorded?', true),
    yesNo('No response procedure agreed?', true, 'noResponseProcedureAgreed'),
    yesNo('Should staff contact office if no response?', true),
    yesNo('Pets present?', false, 'petsPresent'),
    yesNo('Smoking in property?', false, 'smokingInProperty'),
    yesNo('Any fire safety risks identified?', false, 'fireSafetyRisksIdentified'),
    yesNo('London Fire Brigade informed?', false, 'londonFireBrigadeInformed'),
    yesNo('Can client manage home environment safely?', true, 'manageHomeEnvironmentSafely'),
    yesNo('Hoarding or clutter risk?', false),
    yesNo('Restricted to bed?', false),
    yesNo('Any amputation?', false),
    yesNo('Finance support required?', false, 'financeSupportRequired'),
    yesNo('Oxygen dependent?', false, 'oxygenDependent'),
    yesNo('Asthma present?', false),
    yesNo('Swallowing or choking concerns?', false),
    yesNo('Enterally fed?', false),
    yesNo('Catheter in situ?', false),
    yesNo('Urostomy or stoma present?', false),
    select('Fluid thickness requirement', 'normal', 'fluidThickness'),
    select('Pulse rhythm', 'regular', 'pulseRhythm'),
    yesNo('Standing blood pressure required?', false, 'standingBpRequired'),
    yesNo('Assessor competent to record vital signs?', true),
    yesNo('Clinical observations completed?', true),
    yesNo('Smoke alarm fitted and working?', true),
    yesNo('Referral required for smoke, CO or fire alarm?', false),
    yesNo('All mobilising aids in good working order?', true),
    yesNo('Current mental health issues reported?', false),
    yesNo('Feels depressed?', false, 'feelsDepressed'),
    yesNo('Low mood or depression concern?', false),
    select('Community Psychiatric Nurse involved?', 'no'),
    yesNo('Learning disability?', false),
    yesNo('Does the service user consent to this Initial Assessment being carried out?', true, 'consentToAssessment'),
    yesNo('Has the Service User consented to receive care and support?', true),
    yesNo('Has the purpose of this assessment been explained to the service user?', true, 'infoExplainedUnderstood'),
    yesNo(
      'Does the service user consent to relevant information being shared with authorised people/professionals involved in their care?',
      true,
      'infoSharingConsent',
    ),
    yesNo('Taking prescribed medication?', true, 'takingPrescribedMedication'),
    ...empties(),
  ];
}

function mcaIntact(): IaDemoOverlayAnswer[] {
  return [
    yesNo('Is there any reason to doubt the service user’s capacity to make this specific decision?', false, 'capacityDoubt'),
    select('Is anyone legally authorised to make relevant Health & Welfare decisions on their behalf?', 'no', 'legalAuthority'),
    yesNo('MCA required?', false),
    yesNo('Best interest decision required?', false),
    yesNo(
      'Does the person have an impairment or disturbance in the functioning of the mind or brain?',
      false,
      'mcaStage1Impairment',
    ),
    yesNo(
      'Does that impairment or disturbance mean that the person is unable to make the decision in question at the time that it needs to be made?',
      false,
      'mcaStage2UnableToDecide',
    ),
    yesNo('Can the person understand the provided information relevant to the decision?', true, 'mcaFunctionalUnderstand'),
    yesNo('Can the person retain the information given?', true, 'mcaFunctionalRetain'),
    yesNo(
      'Can the person use or weigh the information given as part of their decision making process?',
      true,
      'mcaFunctionalWeigh',
    ),
    yesNo(
      'Can the person communicate their decision? (whether by talking or any other means)',
      true,
      'mcaFunctionalCommunicate',
    ),
    select('Outcome of the mental capacity screening tool', 'has_capacity', 'mcaScreeningOutcome'),
  ];
}

function footers(number: string, displayName: string) {
  const d = IA_DEMO_DETERMINISTIC_DATES[number];
  const sectionComments: Record<string, { text: string }> = {};
  const sectionFooters: Record<string, { dateCompleted?: string; assessorNameDesignation?: string }> = {};
  for (const n of IA_REGISTERED_HOLISTIC_TAB_IDS) {
    sectionComments[String(n)] = { text: `${displayName} — section ${n} reviewed.` };
    sectionFooters[String(n)] = {
      dateCompleted: d.assessment,
      assessorNameDesignation: `${IA_DEMO_ASSESSOR_NAME} — ${IA_DEMO_ASSESSOR_ROLE}`,
    };
  }
  return { sectionComments, sectionFooters, assessmentDate: d.assessment, review: d.review };
}

function worksheetShell(
  number: string,
  displayName: string,
  extra: {
    waterlow: Parameters<typeof enrichWaterlowMetadata>[0];
    must: ReturnType<typeof mustMeta>;
    adl: ReturnType<typeof adlRows>;
    transfersComment: string;
    independentTransfers: boolean;
    hoist: boolean;
    fallsConcern: boolean;
    mcaImpairment: boolean;
  },
): Record<string, unknown> {
  const { sectionComments, sectionFooters, assessmentDate, review } = footers(number, displayName);
  const waterlow = enrichWaterlowMetadata({
    ...extra.waterlow,
    nextReviewDate: review,
    recommendationBy: IA_DEMO_ASSESSOR_NAME,
    recommendationDate: assessmentDate,
  });
  return {
    adl: {
      rows: extra.adl,
      mobilityAidsRequired: extra.hoist,
      mobilityAidsList: extra.hoist ? 'Hoist / sling as documented' : '',
      fallsAssessmentCompleted: extra.fallsConcern,
      fallsAssessmentDate: extra.fallsConcern ? assessmentDate : null,
      additionalComments: extra.transfersComment,
    },
    waterlow,
    mustAssessment: extra.must,
    transfers: {
      rows: [{ id: 'bedToChair', label: 'Bed to chair', level: extra.independentTransfers ? 0 : 1 }],
      independentWithAll: extra.independentTransfers,
      comments: extra.transfersComment,
    },
    sectionComments,
    sectionFooters,
    fallsScreening: {
      fallOrConcern: extra.fallsConcern,
      firstScreenSinceLastFall: 'na',
      consentToSixQuestions: true,
      q1FallsNeedInvestigating: false,
      q2DizzyOrBlackouts: false,
      q3WalkingBalanceUnassessed: extra.hoist,
      q4FourPlusMedsNoReview: false,
      q5TrippingMore: false,
      q6FearOfFalling: extra.fallsConcern,
      additionalComments: extra.fallsConcern
        ? 'Night-time getting up is a concern; no fall recorded in the last 12 months.'
        : 'No fall in the last 12 months.',
    },
    advanceCarePlanning: {
      patientName: displayName,
      dateCompleted: assessmentDate,
      legalAdvanceDecision: number === 'SU-TEST-P10',
    },
    clinicalOutcomeSummary: {
      initial: { assessmentDate, practitioner: IA_DEMO_ASSESSOR_NAME },
      reviews: Array(6).fill({}),
    },
    mcaChecklist: { impairment: extra.mcaImpairment },
  };
}

const MARGARET_ROUTINE = weekRoutine({
  getUp: '8:00 — I need help to wash and dress',
  breakfast: '9:00 — porridge and tea',
  lunch: '12:30 — soup and sandwich',
  afternoon: '14:00 — radio and a short walk if the weather allows',
  teaTime: '17:00 — a light meal',
  bedtime: '21:00 — personal care then bed',
});

const DORIS_ROUTINE = weekRoutine({
  getUp: '8:00 — I like a prompt to wash and dress',
  breakfast: '8:30 — breakfast and my tablets',
  lunch: '12:30 — a light lunch',
  afternoon: 'I like a quiet afternoon',
  teaTime: '17:00 — evening meal',
  bedtime: 'I get ready for bed on the evening call',
});

const JAMES_ROUTINE = weekRoutine({
  getUp: '7:30 — two carers help me get up, wash and dress',
  breakfast: 'Breakfast after I am up. Please give me time.',
  lunch: 'Grace helps me at lunch',
  afternoon: 'I like to practise my exercises',
  teaTime: 'A drink and a rest',
  bedtime: '20:00 — two carers help me to bed',
});

const FATIMA_ROUTINE = weekRoutine({
  getUp: '8:00 — two female carers, hoist, wash and breakfast',
  breakfast: 'Halal breakfast and my tablets',
  lunch: '13:00 — lunch, pad change and a turn',
  afternoon: 'Please give me a quiet moment if I am praying',
  teaTime: 'A drink. Halal food only.',
  bedtime: '20:30 — hoist to bed, evening care',
});

const BETTY_ROUTINE = weekRoutine({
  getUp: 'I like a shower in the morning with the radio on',
  breakfast: 'Porridge and tea with one sugar',
  lunch: 'Soft cooked food. Please help me to eat.',
  afternoon: 'Please offer me a drink',
  teaTime: 'A light soft meal and a drink',
  bedtime: 'I get unsettled at night. I have a sensor mat.',
});

function margaretExpansion(): Pick<IaDemoOverlayPersona, 'answers' | 'aboutMe' | 'aboutMeRoutine' | 'worksheet'> {
  const number = 'SU-1042';
  return {
    aboutMeRoutine: MARGARET_ROUTINE,
    aboutMe: {
      myChildhood: 'I was born in Bromley.',
      myAdulthood: 'I have lived in this house for 40 years.',
    },
    worksheet: worksheetShell(number, 'Margaret Hughes', {
      waterlow: {
        gender: 2,
        age: 5,
        build: 0,
        appetite: 0,
        mobility: 3,
        continence: 0,
        neurological: 0,
        surgery: 0,
        medication: 0,
        weightLoss: 0,
        skinTypes: ['thin', 'broken'],
        tissueMalnutrition: [],
        comments: 'Sacral Category 2 pressure damage and lower-leg skin tear recorded on body map. Frame indoors.',
      },
      must: mustMeta('gt20', 'lt5', 'no'),
      adl: adlRows(
        {
          bathing: 3,
          dressing_undressing: 3,
          grooming: 2,
          toileting: 1,
          walking: 2,
          chair_transfer: 2,
          bed_transfer: 2,
          eating_drinking: 1,
          preparing_food: 3,
        },
        1,
      ),
      transfersComment: 'Walking frame indoors. Two carers on the front steps and after showering.',
      independentTransfers: false,
      hoist: false,
      fallsConcern: false,
      mcaImpairment: false,
    }),
    answers: [
      ...identityCommon({
        first: 'Margaret',
        last: 'Hughes',
        preferred: 'Margaret',
        gender: 'female',
        dob: '1944-03-12',
        nhs: '9434765821',
        address: '14 Oak Lane, Bromley, Kent, BR2 7QP. Phone 02084661234. Mobile 07700900123.',
        funding: 'LA_DOMICILIARY',
        referral: 'family',
        location: 'home',
        contacts: 'Sarah Hughes (daughter) — primary and emergency contact, mobile 07711222333.',
        access: 'Key safe on left of front door. Ring doorbell twice.',
      }),
      ...mcaIntact(),
      ...governance(number, true, false),
      yesNo('Does the service user consent to family or representatives being involved in this assessment?', true, 'familyInvolvementConsent'),
      text('Representative name', 'Sarah Hughes'),
      text('Representative relationship', 'Daughter'),
      select('Hearing impairment level', 'mild', 'hearingLevel'),
      yesNo('Hearing impairment (moderate or worse)?', false),
      yesNo('Hearing aid in use?', false),
      yesNo('Does the client receive support from an informal carer?', true, 'informalCarerSupport'),
      text('Informal carer name', 'Sarah Hughes', 'informalCarerName'),
      yesNo('Does the client live alone?', true, 'livesAlone'),
      yesNo('Is client able to answer front door?', true, 'canAnswerFrontDoor'),
      multi('Type of living accommodation', ['private_house'], 'accommodationType'),
      yesNo('Key safe present?', true, 'keySafePresent'),
      yesNo('Key safe present?', true, 'keySafePresentHolistic'),
      text('Key safe location', 'Left of the front door'),
      text('Door entry code (secure — from DOM Care)', '4821#', 'doorCode'),
      yesNo('Pendant / telecare in use?', true, 'pendantTelecare'),
      yesNo('Steps or uneven access at entrance?', true),
      yesNo('Level access throughout the property?', false),
      yesNo('Trip hazards identified?', true),
      yesNo('Rugs or worn carpet (flooring risk)?', false),
      yesNo('Worn carpet on stairs?', false),
      text(
        'Environment / access hazard notes',
        'Two steps at the front door. The wet room floor is slippery after bathing.',
      ),
      text(
        'Any identified risks to visiting staff members?',
        'Two steps at the front door. Wet room floor can be slippery after bathing.',
        'staffVisitRisks',
      ),
      text(
        'Car parking arrangements when visiting my home',
        'Quiet residential street. Park on Oak Lane, close to number 14.',
        'carParkingArrangements',
      ),
      yesNo('Roadside parking available near the home?', true, 'roadsideParkingAvailable'),
      select('Likelihood of harm from car parking at my home (without control measures in place)', 'unlikely', 'carParkingHarmLikelihood'),
      select('How serious could the harm from car parking be?', 'minor', 'carParkingHarmSeverity'),
      text(
        'Control measures and actions to reduce car parking harm',
        'Park close to the kerb, check for passing traffic before opening the door, and use the key safe as documented.',
        'carParkingControlMeasures',
      ),
      visitTimes([
        { code: 'MORNING', from: '08:00', to: '10:00', name: 'Morning' },
        { code: 'EVENING', from: '17:00', to: '21:00', name: 'Evening' },
      ]),
      numberAnswer('Planned number of carers', 2, 'plannedCarers'),
      text(
        'Carer numbers / rota note',
        'Two carers for personal care and the front steps. One carer can remain after she is washed and settled.',
      ),
      text(
        'Reason for admission / starting care',
        'Increasing frailty and mobility needs. Package agreed so she can remain at home with her daughter’s support.',
      ),
      text(
        'Previous medical history (summary)',
        'Osteoarthritis. Hard of hearing in the left ear. Uses a walking frame indoors. Sacral Category 2 pressure damage and a lower-leg skin tear on the body map. Shellfish allergy.',
      ),
      text(
        'Care instructions for staff',
        'Assist with all personal care. Female carers preferred. Morning shower before 10am. Do not rush. Speak to the better ear.',
      ),
      text(
        'Allergies (summary)',
        'Shellfish — allergic. Do not give shellfish.',
        'allergiesSummary',
      ),
      yesNo('Comfortable with double-up care?', true),
      text('Things they do not want support with', 'I do not want to be rushed.'),
      text('Hobbies and interests', 'I like Classic FM, gardening programmes, and looking at family photos.'),
      text(
        'Food likes and dislikes',
        'I like porridge, soft cooked vegetables, and tea with one sugar. I cannot eat shellfish.',
      ),
      text(
        'Known triggers (anxiety, distress, confusion)',
        'I get upset if I am rushed during personal care, or if there is a loud sudden noise.',
      ),
      text(
        'Lifestyle, role and choices',
        'I like to sit by the window with the radio on. Please let me do what I can for myself.',
        'lifestyleRoleChoices',
      ),
      text('Care package comments', 'I have two carers for my morning personal care so I can manage the rest of the day at home.', 'carePackageComments'),
      yesNo('No concerns identified in this section', false),
      multi('Breathing concern options', ['no_concern'], 'breathingConcerns'),
      yesNo('Emphysema / COPD present?', false),
      multi('Pain / distress options', ['mild_movement'], 'painConcerns'),
      yesNo('Pain or distress identified?', true),
      text('Pain location', 'Hips and knees'),
      numberAnswer('Pain score (0-10)', 3),
      text('Pain trigger / aggravating factors', 'Walking and transfers.'),
      text('Current pain relief', 'Paracetamol as prescribed.'),
      yesNo('Pain assessment completed?', true),
      dateAnswer('Pain assessment date', IA_DEMO_DETERMINISTIC_DATES[number].assessment),
      multi('Swallowing concern options', ['no_concern'], 'swallowingConcerns'),
      yesNo('Requires aids for eating or drinking?', false),
      multi('Appetite status', ['good'], 'appetiteStatus'),
      yesNo('Appetite concern (poor appetite)?', false),
      yesNo('BMI completed?', false),
      yesNo('MUST assessment completed?', true),
      numberAnswer('MUST score', 0),
      yesNo('Nutritional supplements prescribed?', false, 'nutritionalSupplementsPrescribed'),
      yesNo('Dietitian referral made or required?', false, 'dietitianReferralRequired'),
      multi('Oral health options', ['no_concern'], 'oralHealthOptions'),
      yesNo('Oral health concern?', false),
      yesNo('Continence products in use?', false),
      yesNo('Bladder continence concern?', false),
      yesNo('Bowel continence concern?', false),
      yesNo('Doubly incontinent?', false),
      yesNo('Continence service referral required?', false),
      multi('Speech impairment options', ['no_concern'], 'speechOptions'),
      yesNo('Speech impairment or concern?', false),
      yesNo('Sight impairment (moderate or worse)?', false),
      yesNo('Glasses or visual aids in use?', false),
      select('Knows why they take prescribed medication?', 'yes'),
      select('Knows when to take prescribed medication?', 'yes'),
      select('Knows how to take prescribed medication?', 'yes'),
      yesNo('No concerns identified in this section', false),
      select('Emotional wellbeing status', 'content_most', 'emotionalWellbeing'),
      yesNo('Sleep medication prescribed or OTC?', false),
      select('Cognitive impairment level', 'none', 'cognitiveImpairment'),
      yesNo('Diagnosed dementia?', false),
      yesNo('Ever had a brain injury?', false),
      yesNo('Good long-term memory recall?', true),
      yesNo('Good short-term memory recall?', true),
      yesNo('Able to follow basic instructions?', true),
      yesNo('Fully orientated?', true),
      yesNo('AMT completed?', false),
      yesNo('Skin condition or concern?', true, 'skinCondition'),
      text('Skin condition comment', 'Sacral pressure area and lower-leg skin tear — see body map.'),
      yesNo('Has wound assessment been completed?', true),
      yesNo('Waterlow assessment completed?', true),
      yesNo('Fluid chart required?', false),
      yesNo('Weight monitoring required?', false),
      yesNo('District nurse involved?', true),
      yesNo('DNACPR or ReSPECT in place?', false),
      yesNo('Additional risk guidelines required?', false),
      yesNo('Service User is diabetic?', false, 'serviceUserIsDiabetic'),
      yesNo('Ongoing vital signs monitoring required?', false),
      select('General physical wellbeing status', 'well_most', 'generalPhysicalWellbeing'),
      yesNo('GP review requested for physical wellbeing?', false),
      yesNo('Unable to weigh using standard scales?', false, 'unableToWeigh'),
      numberAnswer('Temperature (°C)', 36.6, 'temperature'),
      numberAnswer('Pulse (bpm)', 72, 'pulse'),
      numberAnswer('Respirations (per minute)', 16, 'respirations'),
      numberAnswer('Blood pressure — systolic (mmHg)', 128, 'bpSystolic'),
      numberAnswer('Blood pressure — diastolic (mmHg)', 78, 'bpDiastolic'),
      numberAnswer('Oxygen saturation (SpO2 %)', 96, 'spo2'),
      yesNo('Equipment ordered?', true),
      dateAnswer('Date equipment ordered', '2025-11-01'),
      text(
        'What should staff do if no answer?',
        'Ring back once, then contact the office, then Sarah Hughes on 07711222333.',
      ),
      text(
        'When should emergency services be contacted?',
        'If there is no answer and Margaret cannot be seen, or if she has fallen and is hurt.',
      ),
      text('Review and sign-off notes', 'Assessment agreed with Margaret and her daughter Sarah.'),
      ...routineAnswers(MARGARET_ROUTINE),
    ],
  };
}

function dorisExpansion(): Pick<IaDemoOverlayPersona, 'answers' | 'aboutMe' | 'aboutMeRoutine' | 'worksheet'> {
  const number = 'SU-TEST-P01';
  return {
    aboutMeRoutine: DORIS_ROUTINE,
    aboutMe: {
      supportedToWriteThisBy: 'Helen Clarke (daughter)',
      peopleImportantToMe: 'Helen Clarke (daughter).',
    },
    worksheet: worksheetShell(number, 'Doris Clarke', {
      waterlow: {
        gender: 2,
        age: 5,
        build: 0,
        appetite: 0,
        mobility: 1,
        continence: 0,
        neurological: 0,
        surgery: 0,
        medication: 0,
        weightLoss: 0,
        skinTypes: ['healthy'],
        tissueMalnutrition: [],
        comments: 'Mobile with a stick. No pressure damage recorded.',
      },
      must: mustMeta('gt20', 'lt5', 'no'),
      adl: adlRows(
        {
          bathing: 1,
          dressing_undressing: 1,
          toileting: 0,
          walking: 1,
          eating_drinking: 1,
          preparing_food: 2,
          housework: 1,
        },
        0,
      ),
      transfersComment: 'Independent transfers. Walking stick indoors.',
      independentTransfers: true,
      hoist: false,
      fallsConcern: false,
      mcaImpairment: false,
    }),
    answers: [
      ...identityCommon({
        first: 'Doris',
        last: 'Clarke',
        preferred: 'Doris',
        gender: 'female',
        dob: '1943-05-18',
        nhs: '9991234567',
        address: '14 Elm Grove, Wembley, HA0 2FG. Mobile 07700901001.',
        funding: 'LA_DOMICILIARY',
        referral: 'gp',
        location: 'home',
        contacts: 'Helen Clarke (daughter) — primary and emergency contact, mobile 07700901002.',
        access: 'Key safe left of front door. Ground floor, no steps.',
      }),
      ...mcaIntact(),
      ...governance(number, true, false),
      yesNo('Does the service user consent to family or representatives being involved in this assessment?', true, 'familyInvolvementConsent'),
      text('Representative name', 'Helen Clarke'),
      text('Representative relationship', 'Daughter'),
      select('Languages spoken', 'ENGLISH', 'languagesSpoken'),
      yesNo('Does the client receive support from an informal carer?', true, 'informalCarerSupport'),
      text('Informal carer name', 'Helen Clarke', 'informalCarerName'),
      yesNo('Does the client live alone?', true, 'livesAlone'),
      yesNo('Is client able to answer front door?', true, 'canAnswerFrontDoor'),
      multi('Type of living accommodation', ['private_house'], 'accommodationType'),
      yesNo('Key safe present?', true, 'keySafePresent'),
      yesNo('Key safe present?', true, 'keySafePresentHolistic'),
      text('Key safe location', 'Left of the front door'),
      text('Door entry code (secure — from DOM Care)', '4821#', 'doorCode'),
      yesNo('Pendant / telecare in use?', false, 'pendantTelecare'),
      yesNo('Steps or uneven access at entrance?', false),
      yesNo('Level access throughout the property?', true),
      yesNo('Trip hazards identified?', false),
      yesNo('Rugs or worn carpet (flooring risk)?', false),
      yesNo('Worn carpet on stairs?', false),
      text('Environment / access hazard notes', 'Ground floor. Key safe in use. No steps.'),
      text(
        'Car parking arrangements when visiting my home',
        'Residential street in Wembley. Park on Elm Grove near number 14.',
        'carParkingArrangements',
      ),
      yesNo('Roadside parking available near the home?', true, 'roadsideParkingAvailable'),
      select('Likelihood of harm from car parking at my home (without control measures in place)', 'unlikely', 'carParkingHarmLikelihood'),
      select('How serious could the harm from car parking be?', 'minor', 'carParkingHarmSeverity'),
      text(
        'Control measures and actions to reduce car parking harm',
        'Park close to the kerb and use the key safe as documented.',
        'carParkingControlMeasures',
      ),
      visitTimes([
        { code: 'MORNING', from: '08:00', to: '09:30', name: 'Morning' },
        { code: 'EVENING', from: '17:00', to: '18:00', name: 'Evening' },
      ]),
      numberAnswer('Planned number of carers', 1, 'plannedCarers'),
      text('Carer numbers / rota note', 'One carer for morning and evening calls.'),
      text(
        'Reason for admission / starting care',
        'Increasing frailty — needs prompting with medication and meal support.',
      ),
      text('Previous medical history (summary)', 'Osteoarthritis, mild COPD.'),
      text(
        'Care instructions for staff',
        'Female carers preferred. Prompt with medications Level 1A. Uses walking stick indoors. Independent toileting with grab rails.',
      ),
      text('Allergies (summary)', 'No known allergies recorded on the persona record.', 'allergiesSummary'),
      text('Things they do not want support with', 'Please do not take over things I can still do.'),
      text('Hobbies and interests', 'I like a quiet evening and to keep doing what I can for myself.'),
      text('Food likes and dislikes', 'I like simple home-cooked meals.'),
      text('Known triggers (anxiety, distress, confusion)', 'I do not like being rushed.'),
      text(
        'Lifestyle, role and choices',
        'I like to stay independent. A little help in the morning and evening is enough.',
        'lifestyleRoleChoices',
      ),
      text('Care package comments', 'I have one carer in the morning and one in the evening.', 'carePackageComments'),
      yesNo('Does the carer require a carer’s assessment?', false, 'carerAssessmentRequired'),
      yesNo('No concerns identified in this section', false),
      multi('Breathing concern options', ['mild_exertion'], 'breathingConcerns'),
      yesNo('Emphysema / COPD present?', true),
      text('Breathing condition details', 'Mild COPD. Salbutamol inhaler as required. Not oxygen dependent.', 'breathingDetails'),
      multi('Pain / distress options', ['mild_movement'], 'painConcerns'),
      yesNo('Pain or distress identified?', true),
      text('Pain location', 'Knees'),
      numberAnswer('Pain score (0-10)', 3),
      text('Pain trigger / aggravating factors', 'Walking.'),
      text('Current pain relief', 'Paracetamol as required.'),
      yesNo('Pain assessment completed?', true),
      dateAnswer('Pain assessment date', IA_DEMO_DETERMINISTIC_DATES[number].assessment),
      multi('Swallowing concern options', ['no_concern'], 'swallowingConcerns'),
      yesNo('Requires aids for eating or drinking?', false),
      multi('Appetite status', ['good'], 'appetiteStatus'),
      yesNo('Appetite concern (poor appetite)?', false),
      yesNo('BMI completed?', false),
      yesNo('MUST assessment completed?', true),
      numberAnswer('MUST score', 0),
      multi('Oral health options', ['no_concern'], 'oralHealthOptions'),
      yesNo('Oral health concern?', false),
      yesNo('Continence products in use?', false),
      yesNo('Bladder continence concern?', false),
      yesNo('Bowel continence concern?', false),
      yesNo('Doubly incontinent?', false),
      multi('Speech impairment options', ['no_concern'], 'speechOptions'),
      yesNo('Speech impairment or concern?', false),
      yesNo('Hearing impairment (moderate or worse)?', false),
      yesNo('Sight impairment (moderate or worse)?', false),
      select('Knows why they take prescribed medication?', 'yes'),
      select('Knows when to take prescribed medication?', 'yes'),
      select('Knows how to take prescribed medication?', 'yes'),
      select('Emotional wellbeing status', 'content_most', 'emotionalWellbeing'),
      yesNo('Sleep medication prescribed or OTC?', false),
      select('Cognitive impairment level', 'none', 'cognitiveImpairment'),
      yesNo('Diagnosed dementia?', false),
      yesNo('Ever had a brain injury?', false),
      yesNo('Good long-term memory recall?', true),
      yesNo('Good short-term memory recall?', true),
      yesNo('Able to follow basic instructions?', true),
      yesNo('Fully orientated?', true),
      yesNo('AMT completed?', false),
      yesNo('Skin condition or concern?', false, 'skinCondition'),
      yesNo('Pressure ulcer risk assessment completed (including photography)?', true, 'pressureUlcerRiskAssessmentCompleted'),
      yesNo('Has wound assessment been completed?', false),
      yesNo('Pressure relieving equipment in use?', false),
      yesNo('Further pressure equipment required?', false, 'furtherPressureEquipmentRequired'),
      yesNo('Waterlow assessment completed?', true),
      yesNo('Fluid chart required?', false),
      yesNo('Weight monitoring required?', false),
      yesNo('District nurse involved?', false),
      yesNo('DNACPR or ReSPECT in place?', false),
      yesNo('Additional risk guidelines required?', false),
      yesNo('Service User is diabetic?', false, 'serviceUserIsDiabetic'),
      yesNo('Ongoing vital signs monitoring required?', false),
      select('General physical wellbeing status', 'well_most', 'generalPhysicalWellbeing'),
      yesNo('Unable to weigh using standard scales?', false, 'unableToWeigh'),
      numberAnswer('Temperature (°C)', 36.5, 'temperature'),
      numberAnswer('Pulse (bpm)', 76, 'pulse'),
      numberAnswer('Respirations (per minute)', 18, 'respirations'),
      numberAnswer('Blood pressure — systolic (mmHg)', 132, 'bpSystolic'),
      numberAnswer('Blood pressure — diastolic (mmHg)', 80, 'bpDiastolic'),
      numberAnswer('Oxygen saturation (SpO2 %)', 95, 'spo2'),
      text(
        'Nutrition / hydration comments',
        'I like simple home-cooked meals. Please prompt me rather than doing everything for me.',
      ),
      text(
        'What should staff do if no answer?',
        'Ring back once, then contact the office, then Helen Clarke on 07700901002.',
      ),
      text(
        'When should emergency services be contacted?',
        'If there is no answer and Doris cannot be seen, or if she has fallen and is hurt.',
      ),
      text('Review and sign-off notes', 'Assessment agreed with Doris.'),
      text('Continence / oral care notes', 'I manage the toilet with grab rails.'),
      ...routineAnswers(DORIS_ROUTINE),
    ],
  };
}

function jamesExpansion(): Pick<IaDemoOverlayPersona, 'answers' | 'aboutMe' | 'aboutMeRoutine' | 'worksheet'> {
  const number = 'SU-TEST-P02';
  return {
    aboutMeRoutine: JAMES_ROUTINE,
    aboutMe: {
      supportedToWriteThisBy: 'Grace Okafor (wife)',
    },
    worksheet: worksheetShell(number, 'James Okafor', {
      waterlow: {
        gender: 1,
        age: 3,
        build: 0,
        appetite: 0,
        mobility: 3,
        continence: 0,
        neurological: 4,
        surgery: 0,
        medication: 0,
        weightLoss: 0,
        skinTypes: ['healthy'],
        tissueMalnutrition: [],
        comments: 'Post-stroke transfers with two carers. No hoist. No pressure damage recorded.',
      },
      must: mustMeta('gt20', 'lt5', 'no'),
      adl: adlRows(
        {
          bathing: 3,
          dressing_undressing: 3,
          toileting: 3,
          walking: 3,
          chair_transfer: 3,
          bed_transfer: 3,
          toilet_transfer: 3,
          eating_drinking: 2,
        },
        2,
      ),
      transfersComment: 'Two carers for bed, chair and commode. No hoist.',
      independentTransfers: false,
      hoist: false,
      fallsConcern: false,
      mcaImpairment: false,
    }),
    answers: [
      ...identityCommon({
        first: 'James',
        last: 'Okafor',
        preferred: 'James',
        gender: 'male',
        dob: '1954-09-03',
        nhs: '9991234568',
        address: '42 Maple Court, Stratford, London, E15 4BQ. Mobile 07700902001.',
        funding: 'LA_DOMICILIARY',
        referral: 'hospital_discharge',
        location: 'home',
        contacts: 'Grace Okafor (wife) — lives at the same address, informal carer overnight. Mobile 07700902002.',
        access: '2nd floor — lift available. Speak slowly — expressive dysphasia. Narrow hallway.',
      }),
      ...mcaIntact(),
      ...governance(number, true, false),
      yesNo('Does the service user consent to family or representatives being involved in this assessment?', true, 'familyInvolvementConsent'),
      text('Representative name', 'Grace Okafor'),
      text('Representative relationship', 'Wife'),
      yesNo('Does the client live alone?', false, 'livesAlone'),
      yesNo('Is client able to answer front door?', true, 'canAnswerFrontDoor'),
      multi('Type of living accommodation', ['private_flat'], 'accommodationType'),
      yesNo('Key safe present?', false, 'keySafePresent'),
      yesNo('Key safe present?', false, 'keySafePresentHolistic'),
      yesNo('Pendant / telecare in use?', false, 'pendantTelecare'),
      yesNo('Steps or uneven access at entrance?', false),
      yesNo('Level access throughout the property?', false),
      yesNo('Trip hazards identified?', false),
      yesNo('Rugs or worn carpet (flooring risk)?', false),
      yesNo('Worn carpet on stairs?', false),
      text(
        'Environment / access hazard notes',
        'Second-floor flat with a lift. Narrow hallway. Two carers for transfers.',
      ),
      text(
        'Any identified risks to visiting staff members?',
        'Second-floor access via lift. Two-carer transfers. Expressive dysphasia — do not rush.',
        'staffVisitRisks',
      ),
      text(
        'Car parking arrangements when visiting my home',
        'Park on Maple Court or the nearest permitted bay. Allow extra time for the lift.',
        'carParkingArrangements',
      ),
      yesNo('Roadside parking available near the home?', true, 'roadsideParkingAvailable'),
      select('Likelihood of harm from car parking at my home (without control measures in place)', 'possible', 'carParkingHarmLikelihood'),
      select('How serious could the harm from car parking be?', 'minor', 'carParkingHarmSeverity'),
      text(
        'Control measures and actions to reduce car parking harm',
        'Use a permitted bay, check traffic before opening doors, and go up together in the lift.',
        'carParkingControlMeasures',
      ),
      visitTimes([
        { code: 'MORNING', from: '07:30', to: '09:00', name: 'Morning' },
        { code: 'EVENING', from: '20:00', to: '21:30', name: 'Evening' },
      ]),
      numberAnswer('Planned number of carers', 2, 'plannedCarers'),
      text('Carer numbers / rota note', 'Two carers for morning and evening personal care and all transfers.'),
      text(
        'Reason for admission / starting care',
        'Post-stroke — left-sided weakness, needs double-up personal care.',
      ),
      text(
        'Previous medical history (summary)',
        'Ischaemic stroke 2025, Type 2 diabetes, hypertension. Expressive dysphasia.',
      ),
      text(
        'Care instructions for staff',
        'Two carers for ALL transfers. Allow time to respond. Wife assists between visits. Fluid balance chart.',
      ),
      text('Allergies (summary)', 'No known allergies recorded on the persona record.', 'allergiesSummary'),
      text('Things they do not want support with', 'Please do not finish my sentences.'),
      text('Hobbies and interests', 'I still want to practise my exercises every day.'),
      text('Food likes and dislikes', 'I need help with my meals. Please give me time to eat and drink.'),
      text(
        'Known triggers (anxiety, distress, confusion)',
        'I get frustrated if I am rushed or if people finish my sentences.',
      ),
      text(
        'Lifestyle, role and choices',
        'I want to stay at home with Grace and keep practising my exercises.',
        'lifestyleRoleChoices',
      ),
      text(
        'Care package comments',
        'I have two carers in the morning and evening. Grace helps me overnight.',
        'carePackageComments',
      ),
      yesNo('Does the carer require a carer’s assessment?', true, 'carerAssessmentRequired'),
      yesNo('Carer assessment referral made?', false, 'carerAssessmentReferralMade'),
      yesNo('No concerns identified in this section', false),
      multi('Breathing concern options', ['no_concern'], 'breathingConcerns'),
      yesNo('Emphysema / COPD present?', false),
      multi('Pain / distress options', ['mild_movement'], 'painConcerns'),
      yesNo('Pain or distress identified?', true),
      text('Pain location', 'Left side / shoulder on transfers'),
      numberAnswer('Pain score (0-10)', 4),
      text('Pain trigger / aggravating factors', 'Transfers.'),
      text('Current pain relief', 'As prescribed.'),
      yesNo('Pain assessment completed?', true),
      dateAnswer('Pain assessment date', IA_DEMO_DETERMINISTIC_DATES[number].assessment),
      multi('Swallowing concern options', ['no_concern'], 'swallowingConcerns'),
      yesNo('Requires aids for eating or drinking?', true),
      text('Eating / drinking equipment details', 'Needs assistance at mealtimes. Keep a fluid balance chart.'),
      multi('Appetite status', ['good'], 'appetiteStatus'),
      yesNo('Appetite concern (poor appetite)?', false),
      yesNo('BMI completed?', false),
      yesNo('MUST assessment completed?', true),
      numberAnswer('MUST score', 0),
      multi('Oral health options', ['no_concern'], 'oralHealthOptions'),
      yesNo('Oral health concern?', false),
      yesNo('Continence products in use?', false),
      yesNo('Bladder continence concern?', false),
      yesNo('Bowel continence concern?', false),
      yesNo('Doubly incontinent?', false),
      yesNo('Hearing impairment (moderate or worse)?', false),
      yesNo('Sight impairment (moderate or worse)?', false),
      select('Knows why they take prescribed medication?', 'yes'),
      select('Knows when to take prescribed medication?', 'yes'),
      select('Knows how to take prescribed medication?', 'no'),
      select('Emotional wellbeing status', 'content_some', 'emotionalWellbeing'),
      yesNo('Sleep medication prescribed or OTC?', false),
      select('Cognitive impairment level', 'none', 'cognitiveImpairment'),
      yesNo('Diagnosed dementia?', false),
      yesNo('Ever had a brain injury?', true),
      yesNo('Good long-term memory recall?', true),
      yesNo('Good short-term memory recall?', true),
      yesNo('Able to follow basic instructions?', true),
      yesNo('Fully orientated?', true),
      yesNo('AMT completed?', false),
      yesNo('Skin condition or concern?', false, 'skinCondition'),
      yesNo('Pressure ulcer risk assessment completed (including photography)?', true, 'pressureUlcerRiskAssessmentCompleted'),
      yesNo('Has wound assessment been completed?', false),
      yesNo('Pressure relieving equipment in use?', false),
      yesNo('Further pressure equipment required?', false, 'furtherPressureEquipmentRequired'),
      yesNo('Waterlow assessment completed?', true),
      yesNo('Fluid chart required?', true),
      yesNo('Weight monitoring required?', false),
      yesNo('District nurse involved?', false),
      yesNo('DNACPR or ReSPECT in place?', false),
      yesNo('Additional risk guidelines required?', true),
      text(
        'Additional risk guidelines details',
        'Two carers for all transfers. Do not move him on your own. Allow time for speech.',
      ),
      yesNo('Service User is diabetic?', true, 'serviceUserIsDiabetic'),
      select('Type of diabetes', 'Type B', 'diabetesType'),
      numberAnswer('Blood glucose (mmol/L)', 7.2, 'bloodGlucose'),
      yesNo('Ongoing vital signs monitoring required?', true),
      text('Monitoring schedule / frequency', 'Blood glucose as per diabetes plan. Insulin glargine in the evening.'),
      select('General physical wellbeing status', 'well_some', 'generalPhysicalWellbeing'),
      yesNo('Unable to weigh using standard scales?', false, 'unableToWeigh'),
      numberAnswer('Temperature (°C)', 36.6, 'temperature'),
      numberAnswer('Pulse (bpm)', 78, 'pulse'),
      numberAnswer('Respirations (per minute)', 16, 'respirations'),
      numberAnswer('Blood pressure — systolic (mmHg)', 138, 'bpSystolic'),
      numberAnswer('Blood pressure — diastolic (mmHg)', 82, 'bpDiastolic'),
      numberAnswer('Oxygen saturation (SpO2 %)', 97, 'spo2'),
      text(
        'What should staff do if no answer?',
        'Ring back once, then contact the office, then Grace Okafor on 07700902002.',
      ),
      text(
        'When should emergency services be contacted?',
        'If there is no answer and James cannot be seen, or if he has fallen and is hurt.',
      ),
      text('Review and sign-off notes', 'Assessment agreed with James and Grace.'),
      text('Details of other care agencies involved with client', 'Stroke physiotherapy. Stroke OT.', 'otherCareAgencies'),
      ...routineAnswers(JAMES_ROUTINE),
    ],
  };
}

function fatimaExpansion(): Pick<IaDemoOverlayPersona, 'answers' | 'aboutMe' | 'aboutMeRoutine' | 'worksheet'> {
  const number = 'SU-TEST-P04';
  return {
    aboutMeRoutine: FATIMA_ROUTINE,
    aboutMe: {
      supportedToWriteThisBy: 'Layla Al-Rashid (sister)',
      peopleImportantToMe: 'Layla Al-Rashid (sister, POA). My son lives with me and is home after school.',
    },
    worksheet: worksheetShell(number, 'Fatima Al-Rashid', {
      waterlow: {
        gender: 2,
        age: 2,
        build: 0,
        appetite: 0,
        mobility: 5,
        continence: 3,
        neurological: 4,
        surgery: 0,
        medication: 0,
        weightLoss: 0,
        skinTypes: ['discoloured', 'broken'],
        tissueMalnutrition: [],
        comments: 'Wheelchair, ceiling hoist, double incontinence, pressure area care. No wound grade recorded on the persona seed.',
      },
      must: mustMeta('gt20', 'lt5', 'no'),
      adl: adlRows(
        {
          bathing: 3,
          dressing_undressing: 3,
          toileting: 3,
          walking: 3,
          chair_transfer: 3,
          bed_transfer: 3,
          eating_drinking: 2,
        },
        3,
      ),
      transfersComment: 'Ceiling track hoist, two carers, every transfer. Do not lift.',
      independentTransfers: false,
      hoist: true,
      fallsConcern: false,
      mcaImpairment: false,
    }),
    answers: [
      ...identityCommon({
        first: 'Fatima',
        last: 'Al-Rashid',
        preferred: 'Fatima',
        gender: 'female',
        dob: '1971-02-14',
        nhs: '9991234570',
        address: 'Flat 3, 22 Queens Road, Croydon, CR0 2BD. Mobile 07700904001.',
        funding: 'DP_SELF_MANAGED',
        referral: 'local_authority',
        location: 'home',
        contacts:
          'Layla Al-Rashid (sister) — POA, primary for care decisions, mobile 07700904002. Son — emergency contact, under 18, present after school only.',
        access: 'Ground floor flat. Ceiling track hoist in bedroom.',
      }),
      ...mcaIntact(),
      ...governance(number, true, false),
      yesNo('Does the service user consent to family or representatives being involved in this assessment?', true, 'familyInvolvementConsent'),
      text('Representative name', 'Layla Al-Rashid'),
      text('Representative relationship', 'Sister / POA'),
      select('Languages spoken', 'ENGLISH', 'languagesSpoken'),
      select('LPA appointed?', 'health', 'lpoaAppointed'),
      text('LPA name', 'Layla Al-Rashid', 'lpoaName'),
      text('LPA designation', 'Sister / lasting power of attorney (health)', 'lpoaDesignation'),
      text('LPA contact details', '07700904002', 'lpoaContactDetails'),
      yesNo('Does the client receive support from an informal carer?', true, 'informalCarerSupport'),
      text('Informal carer name', 'Layla Al-Rashid', 'informalCarerName'),
      yesNo('Does the client live alone?', false, 'livesAlone'),
      yesNo('Is client able to answer front door?', true, 'canAnswerFrontDoor'),
      multi('Type of living accommodation', ['private_flat'], 'accommodationType'),
      yesNo('Key safe present?', false, 'keySafePresent'),
      yesNo('Key safe present?', false, 'keySafePresentHolistic'),
      yesNo('Pendant / telecare in use?', false, 'pendantTelecare'),
      yesNo('Steps or uneven access at entrance?', false),
      yesNo('Level access throughout the property?', true),
      yesNo('Trip hazards identified?', false),
      yesNo('Rugs or worn carpet (flooring risk)?', false),
      yesNo('Worn carpet on stairs?', false),
      text('Environment / access hazard notes', 'Ground-floor flat. Ceiling track hoist in the bedroom.'),
      text(
        'Any identified risks to visiting staff members?',
        'Hoist and sling transfers. Female carers only for personal care.',
        'staffVisitRisks',
      ),
      text('Social worker contact', 'Local authority social worker — direct payment package.', 'socialWorkerContact'),
      text(
        'Car parking arrangements when visiting my home',
        'Park on Queens Road or the nearest permitted bay. Ground-floor flat.',
        'carParkingArrangements',
      ),
      yesNo('Roadside parking available near the home?', true, 'roadsideParkingAvailable'),
      select('Likelihood of harm from car parking at my home (without control measures in place)', 'possible', 'carParkingHarmLikelihood'),
      select('How serious could the harm from car parking be?', 'minor', 'carParkingHarmSeverity'),
      text(
        'Control measures and actions to reduce car parking harm',
        'Use a permitted bay and check traffic before opening doors.',
        'carParkingControlMeasures',
      ),
      visitTimes([
        { code: 'MORNING', from: '08:00', to: '09:30', name: 'Morning' },
        { code: 'MIDDAY', from: '13:00', to: '14:00', name: 'Midday' },
        { code: 'EVENING', from: '20:30', to: '22:00', name: 'Evening' },
      ]),
      numberAnswer('Planned number of carers', 2, 'plannedCarers'),
      text('Carer numbers / rota note', 'Two female carers for morning, midday and evening hoist calls.'),
      text(
        'Reason for admission / starting care',
        'Multiple sclerosis — wheelchair dependent. Ceiling hoist transfers. Pressure area care.',
      ),
      text(
        'Previous medical history (summary)',
        'Multiple sclerosis — wheelchair dependent. Penicillin allergy (anaphylaxis). Double incontinence. Pressure area care.',
      ),
      text(
        'Care instructions for staff',
        'Female carers ONLY. Two carers for all hoisting. Halal diet. Ceiling hoist transfers. Pressure area care.',
      ),
      text('Allergies (summary)', 'Penicillin — anaphylaxis.', 'allergiesSummary'),
      text(
        'Any equality related risk or need',
        'I only want women to help me with personal care. Please keep me covered.',
      ),
      text('Things they do not want support with', 'I do not want male carers for personal care, or food that is not Halal.'),
      text('Hobbies and interests', 'I want to keep my prayers and eat food that is Halal.'),
      text('Food likes and dislikes', 'I eat Halal food only. I do not eat pork or anything that is not Halal.'),
      text(
        'Known triggers (anxiety, distress, confusion)',
        'I get upset if male carers help me with personal care, if food is not Halal, or if I am interrupted when I am praying.',
      ),
      text(
        'Lifestyle, role and choices',
        'I am Muslim. Prayer times and Halal food matter to me.',
        'lifestyleRoleChoices',
      ),
      text(
        'Care package comments',
        'I have three double-up calls a day. Please use the ceiling hoist whenever you move me.',
        'carePackageComments',
      ),
      yesNo('Does the carer require a carer’s assessment?', false, 'carerAssessmentRequired'),
      yesNo('No concerns identified in this section', false),
      multi('Breathing concern options', ['no_concern'], 'breathingConcerns'),
      yesNo('Emphysema / COPD present?', false),
      multi('Pain / distress options', ['moderate_movement'], 'painConcerns'),
      yesNo('Pain or distress identified?', true),
      text('Pain location', 'Back / spasm on transfers'),
      numberAnswer('Pain score (0-10)', 5),
      text('Pain trigger / aggravating factors', 'Transfers and sitting for long periods.'),
      text('Current pain relief', 'Baclofen as prescribed.'),
      yesNo('Pain assessment completed?', true),
      dateAnswer('Pain assessment date', IA_DEMO_DETERMINISTIC_DATES[number].assessment),
      multi('Swallowing concern options', ['no_concern'], 'swallowingConcerns'),
      yesNo('Requires aids for eating or drinking?', false),
      multi('Appetite status', ['good'], 'appetiteStatus'),
      yesNo('Appetite concern (poor appetite)?', false),
      yesNo('BMI completed?', false),
      yesNo('MUST assessment completed?', true),
      numberAnswer('MUST score', 0),
      multi('Oral health options', ['no_concern'], 'oralHealthOptions'),
      yesNo('Oral health concern?', false),
      yesNo('Pads supplied by family?', false),
      yesNo('Pads supplied by district nurses?', false),
      yesNo('Continence service referral required?', true),
      multi('Speech impairment options', ['no_concern'], 'speechOptions'),
      yesNo('Speech impairment or concern?', false),
      yesNo('Hearing impairment (moderate or worse)?', false),
      yesNo('Sight impairment (moderate or worse)?', false),
      select('Knows why they take prescribed medication?', 'yes'),
      select('Knows when to take prescribed medication?', 'yes'),
      select('Knows how to take prescribed medication?', 'no'),
      select('Emotional wellbeing status', 'content_some', 'emotionalWellbeing'),
      yesNo('Sleep medication prescribed or OTC?', false),
      select('Cognitive impairment level', 'none', 'cognitiveImpairment'),
      yesNo('Diagnosed dementia?', false),
      yesNo('Ever had a brain injury?', false),
      yesNo('Good long-term memory recall?', true),
      yesNo('Good short-term memory recall?', true),
      yesNo('Able to follow basic instructions?', true),
      yesNo('Fully orientated?', true),
      yesNo('AMT completed?', false),
      yesNo('Skin condition or concern?', true, 'skinCondition'),
      text('Skin condition comment', 'Pressure areas need checking when she is moved. No wound grade on the persona seed.'),
      yesNo('Pressure ulcer risk assessment completed (including photography)?', true, 'pressureUlcerRiskAssessmentCompleted'),
      yesNo('Has wound assessment been completed?', true),
      yesNo('Further pressure equipment required?', false, 'furtherPressureEquipmentRequired'),
      yesNo('Waterlow assessment completed?', true),
      yesNo('Fluid chart required?', true),
      yesNo('Weight monitoring required?', true),
      yesNo('District nurse involved?', true),
      yesNo('DNACPR or ReSPECT in place?', false),
      yesNo('Additional risk guidelines required?', true),
      text(
        'Additional risk guidelines details',
        'Female carers only. Ceiling hoist with two carers. Pressure area and pad checks each visit.',
      ),
      yesNo('Service User is diabetic?', false, 'serviceUserIsDiabetic'),
      yesNo('Ongoing vital signs monitoring required?', false),
      select('General physical wellbeing status', 'unwell_some', 'generalPhysicalWellbeing'),
      yesNo('Unable to weigh using standard scales?', false, 'unableToWeigh'),
      numberAnswer('Temperature (°C)', 36.7, 'temperature'),
      numberAnswer('Pulse (bpm)', 80, 'pulse'),
      numberAnswer('Respirations (per minute)', 16, 'respirations'),
      numberAnswer('Blood pressure — systolic (mmHg)', 118, 'bpSystolic'),
      numberAnswer('Blood pressure — diastolic (mmHg)', 76, 'bpDiastolic'),
      numberAnswer('Oxygen saturation (SpO2 %)', 98, 'spo2'),
      text(
        'What should staff do if no answer?',
        'Ring back once, then contact the office, then Layla Al-Rashid on 07700904002.',
      ),
      text(
        'When should emergency services be contacted?',
        'If there is no answer and Fatima cannot be seen, or if she has fallen and is hurt.',
      ),
      text('Review and sign-off notes', 'Assessment agreed with Fatima and Layla (POA).'),
      ...routineAnswers(FATIMA_ROUTINE),
    ],
  };
}

function bettyExpansion(): Pick<IaDemoOverlayPersona, 'answers' | 'aboutMe' | 'aboutMeRoutine' | 'worksheet'> {
  const number = 'SU-TEST-P10';
  return {
    aboutMeRoutine: BETTY_ROUTINE,
    aboutMe: {
      supportedToWriteThisBy: 'Named nurse on the unit',
    },
    worksheet: worksheetShell(number, 'Betty Henderson', {
      waterlow: {
        gender: 2,
        age: 5,
        build: 0,
        appetite: 1,
        mobility: 3,
        continence: 1,
        neurological: 0,
        surgery: 0,
        medication: 0,
        weightLoss: 0,
        skinTypes: ['thin'],
        tissueMalnutrition: ['single_organ'],
        comments: 'Vascular dementia, hoist transfers, continence support, stable heart failure. No wound on the clinical seed.',
      },
      must: mustMeta('gt20', 'lt5', 'no'),
      adl: adlRows(
        {
          bathing: 3,
          dressing_undressing: 3,
          toileting: 3,
          eating_drinking: 3,
          chair_transfer: 3,
          bed_transfer: 3,
        },
        3,
      ),
      transfersComment: 'Two carers for transfers and hoisting. Night sensor mat.',
      independentTransfers: false,
      hoist: true,
      fallsConcern: true,
      mcaImpairment: true,
    }),
    answers: [
      ...identityCommon({
        first: 'Betty',
        last: 'Henderson',
        preferred: 'Betty',
        gender: 'female',
        dob: '1941-01-20',
        nhs: '9991234576',
        address: 'Oakwood EMI Unit, Room 12, Sutton, SM1 2LG. Residential care — on-site 24-hour care.',
        funding: 'LA_NURSING_HOME',
        referral: 'local_authority',
        location: 'other',
        contacts: 'On-site EMI unit. Family updates as agreed with the home. No named informal carer on the persona record.',
        access: 'Residential care home — on-site 24h care, no domiciliary visits.',
      }),
      yesNo('Is there any reason to doubt the service user’s capacity to make this specific decision?', true, 'capacityDoubt'),
      select('Is anyone legally authorised to make relevant Health & Welfare decisions on their behalf?', 'no', 'legalAuthority'),
      yesNo('MCA required?', true),
      yesNo('MCA completed?', true),
      yesNo('Best interest decision required?', true),
      text(
        'Best interest decision details',
        'This decision was made in Betty’s best interests with her family and the home, consistent with the DoLS authorisation.',
      ),
      yesNo(
        'Does the person have an impairment or disturbance in the functioning of the mind or brain?',
        true,
        'mcaStage1Impairment',
      ),
      yesNo(
        'Does that impairment or disturbance mean that the person is unable to make the decision in question at the time that it needs to be made?',
        true,
        'mcaStage2UnableToDecide',
      ),
      yesNo('Can the person understand the provided information relevant to the decision?', true, 'mcaFunctionalUnderstand'),
      yesNo('Can the person retain the information given?', false, 'mcaFunctionalRetain'),
      yesNo(
        'Can the person use or weigh the information given as part of their decision making process?',
        false,
        'mcaFunctionalWeigh',
      ),
      yesNo(
        'Can the person communicate their decision? (whether by talking or any other means)',
        true,
        'mcaFunctionalCommunicate',
      ),
      select('Outcome of the mental capacity screening tool', 'lacks_capacity', 'mcaScreeningOutcome'),
      text(
        'MCA screening tool comments',
        'Vascular dementia. Short-term memory is poor. Use short sentences and do not rush.',
        'mcaScreeningComments',
      ),
      ...governance(number, false, true),
      yesNo('Does the service user consent to family or representatives being involved in this assessment?', true, 'familyInvolvementConsent'),
      text('Representative name', 'Named nurse / family'),
      text('Representative relationship', 'Unit / family'),
      yesNo('Does the client receive support from an informal carer?', false, 'informalCarerSupport'),
      yesNo('Does the client live alone?', false, 'livesAlone'),
      yesNo('Is client able to answer front door?', false, 'canAnswerFrontDoor'),
      multi('Type of living accommodation', ['residential_home'], 'accommodationType'),
      yesNo('Key safe present?', false, 'keySafePresent'),
      yesNo('Key safe present?', false, 'keySafePresentHolistic'),
      yesNo('Pendant / telecare in use?', true, 'pendantTelecare'),
      yesNo('Steps or uneven access at entrance?', false),
      yesNo('Level access throughout the property?', true),
      yesNo('Trip hazards identified?', true),
      yesNo('Rugs or worn carpet (flooring risk)?', true),
      yesNo('Worn carpet on stairs?', false),
      text(
        'Environment / access hazard notes',
        'EMI unit. Loose carpet edge at bedroom door. Nightlight fitted. Night sensor mat in use.',
      ),
      text(
        'Any identified risks to visiting staff members?',
        'On-site residential unit. Night unsettled. Two carers for hoisting.',
        'staffVisitRisks',
      ),
      text(
        'Car parking arrangements when visiting my home',
        'Staff park in the care home car park as directed by the unit.',
        'carParkingArrangements',
      ),
      yesNo('Roadside parking available near the home?', false, 'roadsideParkingAvailable'),
      select('Likelihood of harm from car parking at my home (without control measures in place)', 'unlikely', 'carParkingHarmLikelihood'),
      select('How serious could the harm from car parking be?', 'minor', 'carParkingHarmSeverity'),
      text(
        'Control measures and actions to reduce car parking harm',
        'Use the allocated care home parking and follow site speed limits.',
        'carParkingControlMeasures',
      ),
      visitTimes([{ code: 'MORNING', from: '08:00', to: '10:00', name: 'Morning' }]),
      numberAnswer('Planned number of carers', 2, 'plannedCarers'),
      text(
        'Carer numbers / rota note',
        'Two carers required for all transfers, hoisting and personal care. One carer for medication, meals and social engagement.',
      ),
      text(
        'Reason for admission / starting care',
        'Vascular dementia — requires 24-hour residential support.',
      ),
      text(
        'Previous medical history (summary)',
        'Vascular dementia (2019), Type 2 diabetes, hypertension, osteoarthritis of both knees, mild heart failure — stable on current medication.',
      ),
      text(
        'Care instructions for staff',
        'Assist with all personal care including washing, dressing, and continence. Encourage fluids throughout the day — minimum 1.5 litres. Prefers shower in the morning. Radio in the background. Speak clearly and calmly — short sentences. Do not rush. Two carers for transfers and hoisting.',
      ),
      text('Allergies (summary)', 'Shellfish — allergic. Do not give shellfish.', 'allergiesSummary'),
      text('Things they do not want support with', 'Please do not rush me or turn the radio off if I am enjoying it.'),
      text('Hobbies and interests', 'I like listening to the radio. Please leave it on if I am enjoying it.'),
      text(
        'Food likes and dislikes',
        'I like porridge and soft cooked vegetables. I like warm tea with one sugar. I cannot eat shellfish.',
      ),
      text(
        'Known triggers (anxiety, distress, confusion)',
        'I get unsettled if I am rushed, if carers are unfamiliar, or at night in the dark.',
      ),
      text(
        'Lifestyle, role and choices',
        'I like the radio on while you help me. Please speak slowly and do not rush.',
        'lifestyleRoleChoices',
      ),
      text(
        'Care package comments',
        'I live on the EMI unit. Staff help me with washing, dressing, meals and the toilet.',
        'carePackageComments',
      ),
      yesNo('Does the carer require a carer’s assessment?', false, 'carerAssessmentRequired'),
      yesNo('No concerns identified in this section', false),
      multi('Breathing concern options', ['no_concern'], 'breathingConcerns'),
      yesNo('Emphysema / COPD present?', false),
      multi('Pain / distress options', ['mild_movement'], 'painConcerns'),
      yesNo('Pain or distress identified?', true),
      text('Pain location', 'Knees'),
      numberAnswer('Pain score (0-10)', 3),
      text('Pain trigger / aggravating factors', 'Movement and transfers.'),
      text('Current pain relief', 'Paracetamol as prescribed.'),
      yesNo('Pain assessment completed?', true),
      dateAnswer('Pain assessment date', IA_DEMO_DETERMINISTIC_DATES[number].assessment),
      multi('Swallowing concern options', ['no_concern'], 'swallowingConcerns'),
      yesNo('Requires aids for eating or drinking?', false),
      multi('Appetite status', ['poor'], 'appetiteStatus'),
      yesNo('Appetite concern (poor appetite)?', true),
      yesNo('BMI completed?', false),
      yesNo('MUST assessment completed?', true),
      numberAnswer('MUST score', 0),
      numberAnswer('Weight (kg)', 68.4, 'weightKg'),
      multi('Oral health options', ['concern'], 'oralHealthOptions'),
      yesNo('Oral health concern?', true),
      yesNo('Toothbrushing support required?', true),
      yesNo('Pads supplied by family?', false),
      yesNo('Pads supplied by district nurses?', false),
      yesNo('Continence service referral required?', false),
      multi('Speech impairment options', ['no_concern'], 'speechOptions'),
      yesNo('Speech impairment or concern?', false),
      text(
        'Staff communication instructions',
        'Please speak clearly and calmly with me, and use short sentences. I do not like to be rushed.',
      ),
      yesNo('Hearing impairment (moderate or worse)?', false),
      yesNo('Sight impairment (moderate or worse)?', false),
      select('Knows why they take prescribed medication?', 'no'),
      select('Knows when to take prescribed medication?', 'no'),
      select('Knows how to take prescribed medication?', 'no'),
      select('Emotional wellbeing status', 'content_some', 'emotionalWellbeing'),
      yesNo('Sleep medication prescribed or OTC?', false),
      yesNo('GP referral for sleep concern requested?', false),
      yesNo('Ever had a brain injury?', false),
      yesNo('Good long-term memory recall?', true),
      yesNo('Challenging behaviour or agitation with change?', false),
      yesNo('AMT completed?', true),
      numberAnswer('AMT score', 5),
      dateAnswer('AMT date', IA_DEMO_DETERMINISTIC_DATES[number].assessment),
      yesNo('GP referral for cognition requested?', false, 'cognitionGpReferralRequested'),
      yesNo('Skin condition or concern?', false, 'skinCondition'),
      yesNo('Pressure ulcer risk assessment completed (including photography)?', true, 'pressureUlcerRiskAssessmentCompleted'),
      yesNo('Has wound assessment been completed?', false),
      yesNo('Pressure relieving equipment in use?', false),
      yesNo('Further pressure equipment required?', false, 'furtherPressureEquipmentRequired'),
      yesNo('Waterlow assessment completed?', true),
      yesNo('Fluid chart required?', true),
      yesNo('Weight monitoring required?', true),
      yesNo('District nurse involved?', false),
      yesNo('DNACPR or ReSPECT in place?', true),
      text(
        'ReSPECT / DNACPR location and summary',
        'DNACPR is in place — signed copy is in the red folder in the bedroom. Do not attempt resuscitation.',
      ),
      yesNo('Additional risk guidelines required?', true),
      text(
        'Additional risk guidelines details',
        'Two carers for transfers and hoisting. Night sensor mat. Unsettled at night. Encourage fluids. Soft diet. Shellfish allergy.',
      ),
      yesNo('Service User is diabetic?', true, 'serviceUserIsDiabetic'),
      select('Type of diabetes', 'Type B', 'diabetesType'),
      numberAnswer('Blood glucose (mmol/L)', 8.1, 'bloodGlucose'),
      yesNo('Ongoing vital signs monitoring required?', true),
      text('Monitoring schedule / frequency', 'Blood glucose and weekly weight as per the unit plan.'),
      select('General physical wellbeing status', 'well_some', 'generalPhysicalWellbeing'),
      yesNo('Unable to weigh using standard scales?', false, 'unableToWeigh'),
      numberAnswer('Temperature (°C)', 36.5, 'temperature'),
      numberAnswer('Pulse (bpm)', 74, 'pulse'),
      numberAnswer('Respirations (per minute)', 16, 'respirations'),
      numberAnswer('Blood pressure — systolic (mmHg)', 134, 'bpSystolic'),
      numberAnswer('Blood pressure — diastolic (mmHg)', 78, 'bpDiastolic'),
      numberAnswer('Oxygen saturation (SpO2 %)', 96, 'spo2'),
      text(
        'What should staff do if no answer?',
        'This is a staffed EMI unit. Follow the unit no-response procedure and inform the nurse in charge.',
      ),
      text(
        'When should emergency services be contacted?',
        'If Betty has fallen and is hurt, or if there is an acute medical emergency. DNACPR is in the red folder.',
      ),
      text(
        'Review and sign-off notes',
        'Signed off in Betty’s best interests with the unit, consistent with the DoLS authorisation.',
      ),
      ...routineAnswers(BETTY_ROUTINE),
    ],
  };
}

const BY_NUMBER: Record<string, ReturnType<typeof margaretExpansion>> = {
  'SU-1042': margaretExpansion(),
  'SU-TEST-P01': dorisExpansion(),
  'SU-TEST-P02': jamesExpansion(),
  'SU-TEST-P04': fatimaExpansion(),
  'SU-TEST-P10': bettyExpansion(),
};

export function expandIaDemoOverlayPersona(persona: IaDemoOverlayPersona): IaDemoOverlayPersona {
  const extra = BY_NUMBER[persona.serviceUserNumber];
  if (!extra) return persona;
  return {
    ...persona,
    answers: [...persona.answers, ...extra.answers],
    aboutMe: { ...persona.aboutMe, ...extra.aboutMe },
    aboutMeRoutine: extra.aboutMeRoutine,
    worksheet: extra.worksheet,
  };
}

