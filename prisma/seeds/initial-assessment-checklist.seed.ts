import { InitialAssessmentQuestionType, PrismaClient } from '@prisma/client';

type QuestionSeed = {
  questionText: string;
  questionType?: InitialAssessmentQuestionType;
  isRequired?: boolean;
  riskFlag?: boolean;
  carePlanTrigger?: boolean;
  sortOrder: number;
};

type SectionSeed = {
  sectionNumber: number;
  title: string;
  carePlanArea?: string;
  questions: QuestionSeed[];
};

const CHECKBOX = InitialAssessmentQuestionType.CHECKBOX;
const TEXT = InitialAssessmentQuestionType.TEXT;
const TEXTAREA = InitialAssessmentQuestionType.TEXTAREA;

export const DEFAULT_INITIAL_ASSESSMENT_SECTIONS: SectionSeed[] = [
  {
    sectionNumber: 1,
    title: 'Mobility',
    carePlanArea: 'Mobility',
    questions: [
      { questionText: 'Able to walk independently?', sortOrder: 1, carePlanTrigger: true },
      { questionText: 'Requires walking frame?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Requires walking stick?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Uses wheelchair?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'Requires hoist?', sortOrder: 5, carePlanTrigger: true, riskFlag: true },
      { questionText: 'Requires assistance of one carer?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'Requires assistance of two carers?', sortOrder: 7, carePlanTrigger: true, riskFlag: true },
      { questionText: 'Uses handrails?', sortOrder: 8, carePlanTrigger: true },
      { questionText: 'Bed bound?', sortOrder: 9, carePlanTrigger: true, riskFlag: true },
      { questionText: 'Has falls risk?', sortOrder: 10, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Requires transfer assistance?', sortOrder: 11, carePlanTrigger: true },
      { questionText: 'Other mobility concerns?', sortOrder: 12, questionType: TEXTAREA, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 2,
    title: 'Amputation',
    carePlanArea: 'Mobility',
    questions: [
      { questionText: 'Upper limb amputation?', sortOrder: 1, carePlanTrigger: true },
      { questionText: 'Lower limb amputation?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Uses prosthesis?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Requires support due to amputation?', sortOrder: 4, carePlanTrigger: true, riskFlag: true },
    ],
  },
  {
    sectionNumber: 3,
    title: 'Skin Condition',
    carePlanArea: 'Skin Integrity',
    questions: [
      { questionText: 'Skin intact?', sortOrder: 1 },
      { questionText: 'Dry or sensitive skin?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Bruising present?', sortOrder: 3, riskFlag: true },
      { questionText: 'Pressure sore risk?', sortOrder: 4, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Pressure sore present?', sortOrder: 5, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Ulcer present?', sortOrder: 6, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Body map required?', sortOrder: 7, carePlanTrigger: true },
      { questionText: 'District Nurse involved?', sortOrder: 8, carePlanTrigger: true },
      { questionText: 'Requires pressure relief equipment?', sortOrder: 9, carePlanTrigger: true },
      { questionText: 'Wound dressing required?', sortOrder: 10, carePlanTrigger: true },
      { questionText: 'Medication-related skin marks?', sortOrder: 11 },
      { questionText: 'Skin condition requires monitoring?', sortOrder: 12, carePlanTrigger: true },
      { questionText: 'Requires repositioning?', sortOrder: 13, carePlanTrigger: true },
      { questionText: 'Other skin concerns?', sortOrder: 14, questionType: TEXTAREA, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 4,
    title: 'Incontinence',
    carePlanArea: 'Continence',
    questions: [
      { questionText: 'Urinary incontinence?', sortOrder: 1, carePlanTrigger: true },
      { questionText: 'Faecal incontinence?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Double incontinence?', sortOrder: 3, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Uses continence pads?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'Who supplies pads?', sortOrder: 5, questionType: TEXT },
      { questionText: 'Catheter in place?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'Requires toileting support?', sortOrder: 7, carePlanTrigger: true },
      { questionText: 'Requires commode?', sortOrder: 8, carePlanTrigger: true },
      { questionText: 'Continence referral required?', sortOrder: 9, carePlanTrigger: true },
      { questionText: 'Urgency issues?', sortOrder: 10, riskFlag: true },
      { questionText: 'Other continence concerns?', sortOrder: 11, questionType: TEXTAREA, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 5,
    title: 'Build',
    carePlanArea: 'Physical Health',
    questions: [
      { questionText: 'Frail / petite?', sortOrder: 1 },
      { questionText: 'Small build?', sortOrder: 2 },
      { questionText: 'Medium build?', sortOrder: 3 },
      { questionText: 'Large build?', sortOrder: 4 },
      { questionText: 'Obese?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'Severe obesity?', sortOrder: 6, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Weight concerns?', sortOrder: 7, carePlanTrigger: true },
      { questionText: 'Requires specialist equipment due to build?', sortOrder: 8, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 6,
    title: 'Cognitive Ability',
    carePlanArea: 'Cognition',
    questions: [
      { questionText: 'Fully orientated?', sortOrder: 1 },
      { questionText: 'Confusion present?', sortOrder: 2, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Dementia diagnosis?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Memory issues?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'Requires prompting?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'Risk of wandering?', sortOrder: 6, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Can make own decisions?', sortOrder: 7 },
      { questionText: 'MCA assessment needed?', sortOrder: 8, carePlanTrigger: true },
      { questionText: 'Deprivation of Liberty concerns?', sortOrder: 9, riskFlag: true },
      { questionText: 'Behavioural concerns?', sortOrder: 10, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Requires reassurance?', sortOrder: 11, carePlanTrigger: true },
      { questionText: 'Other cognitive concerns?', sortOrder: 12, questionType: TEXTAREA, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 7,
    title: 'Hearing',
    carePlanArea: 'Communication',
    questions: [
      { questionText: 'Hearing normal?', sortOrder: 1 },
      { questionText: 'Hard of hearing?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Uses hearing aid?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Requires communication support?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'Hearing aid care required?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'Other hearing concerns?', sortOrder: 6, questionType: TEXTAREA },
    ],
  },
  {
    sectionNumber: 8,
    title: 'Sight',
    carePlanArea: 'Communication',
    questions: [
      { questionText: 'Sight normal?', sortOrder: 1 },
      { questionText: 'Partially sighted?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Blind?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Wears glasses?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'Requires visual aids?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'Needs assistance reading information?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'Environmental risks due to sight?', sortOrder: 7, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Other sight concerns?', sortOrder: 8, questionType: TEXTAREA },
    ],
  },
  {
    sectionNumber: 9,
    title: 'Environment',
    carePlanArea: 'Environment',
    questions: [
      { questionText: 'Home environment safe?', sortOrder: 1 },
      { questionText: 'Cluttered environment?', sortOrder: 2, riskFlag: true },
      { questionText: 'Access issues?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Stairs present?', sortOrder: 4, riskFlag: true },
      { questionText: 'Lift available?', sortOrder: 5 },
      { questionText: 'Poor lighting?', sortOrder: 6, riskFlag: true },
      { questionText: 'Trip hazards?', sortOrder: 7, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Pets in property?', sortOrder: 8 },
      { questionText: 'Smoking in property?', sortOrder: 9, riskFlag: true },
      { questionText: 'Key safe available?', sortOrder: 10 },
      { questionText: 'Access instructions required?', sortOrder: 11, carePlanTrigger: true },
      { questionText: 'Environmental risk assessment required?', sortOrder: 12, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 10,
    title: 'Flooring',
    carePlanArea: 'Environment',
    questions: [
      { questionText: 'Carpet flooring?', sortOrder: 1 },
      { questionText: 'Hard flooring?', sortOrder: 2 },
      { questionText: 'Rugs present?', sortOrder: 3, riskFlag: true },
      { questionText: 'Uneven flooring?', sortOrder: 4, riskFlag: true },
      { questionText: 'Slippery flooring?', sortOrder: 5, riskFlag: true },
      { questionText: 'Trip hazards?', sortOrder: 6, riskFlag: true },
      { questionText: 'Flooring risk identified?', sortOrder: 7, riskFlag: true, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 11,
    title: 'Equipment',
    carePlanArea: 'Equipment',
    questions: [
      { questionText: 'Hospital bed required?', sortOrder: 1, carePlanTrigger: true },
      { questionText: 'Pressure mattress required?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Hoist required?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Sling required?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'Wheelchair required?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'Walking frame required?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'Commode required?', sortOrder: 7, carePlanTrigger: true },
      { questionText: 'Shower chair required?', sortOrder: 8, carePlanTrigger: true },
      { questionText: 'Grab rails required?', sortOrder: 9, carePlanTrigger: true },
      { questionText: 'Bed rails required?', sortOrder: 10, carePlanTrigger: true },
      { questionText: 'Medication safe required?', sortOrder: 11, carePlanTrigger: true },
      { questionText: 'Equipment review needed?', sortOrder: 12, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 12,
    title: 'Transfer Requirements',
    carePlanArea: 'Mobility',
    questions: [
      { questionText: 'Independent transfers?', sortOrder: 1 },
      { questionText: 'Assistance of one?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Assistance of two?', sortOrder: 3, carePlanTrigger: true, riskFlag: true },
      { questionText: 'Hoist transfer?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'Slide sheet required?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'Transfer belt required?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'Transfer risk identified?', sortOrder: 7, riskFlag: true, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 13,
    title: 'Where is personal Care Completed?',
    carePlanArea: 'Personal Care',
    questions: [
      { questionText: 'Bedroom?', sortOrder: 1, carePlanTrigger: true },
      { questionText: 'Bathroom?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Shower room?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Other location?', sortOrder: 4, questionType: TEXT, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 14,
    title: 'Pets',
    carePlanArea: 'Environment',
    questions: [
      { questionText: 'Pets present?', sortOrder: 1 },
      { questionText: 'Pet care required?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Pet risk identified?', sortOrder: 3, riskFlag: true },
      { questionText: 'Pet notes required?', sortOrder: 4, questionType: TEXTAREA },
    ],
  },
  {
    sectionNumber: 15,
    title: 'Care Assistance Required',
    carePlanArea: 'Personal Care',
    questions: [
      { questionText: 'Personal care assistance required?', sortOrder: 1, carePlanTrigger: true },
      { questionText: 'Domestic assistance required?', sortOrder: 2, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 16,
    title: 'Cultural or Religious Implications',
    carePlanArea: 'Person Centred Care',
    questions: [
      { questionText: 'Cultural or religious needs to consider?', sortOrder: 1, questionType: TEXTAREA, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 17,
    title: 'Additional Risks',
    carePlanArea: 'Risk',
    questions: [
      { questionText: 'Safeguarding risk?', sortOrder: 1, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Self-neglect risk?', sortOrder: 2, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Fire risk?', sortOrder: 3, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Other risk?', sortOrder: 4, questionType: TEXTAREA, riskFlag: true, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 18,
    title: 'Breathing Difficulties',
    carePlanArea: 'Respiratory',
    questions: [
      { questionText: 'Shortness of breath?', sortOrder: 1, carePlanTrigger: true },
      { questionText: 'Oxygen therapy?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Inhaler use?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'COPD or respiratory condition?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'Breathlessness on exertion?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'Breathing difficulty at rest?', sortOrder: 6, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Requires positioning support?', sortOrder: 7, carePlanTrigger: true },
      { questionText: 'Emergency action plan required?', sortOrder: 8, riskFlag: true, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 19,
    title: 'Distress / Pain caused by physical state',
    carePlanArea: 'Pain Management',
    questions: [
      { questionText: 'Pain present?', sortOrder: 1, carePlanTrigger: true },
      { questionText: 'Distress due to pain?', sortOrder: 2, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Pain medication used?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Pain affects mobility?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'Pain affects sleep?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'Pain affects personal care?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'Pain review required?', sortOrder: 7, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 20,
    title: 'Swallowing',
    carePlanArea: 'Nutrition',
    questions: [
      { questionText: 'Swallowing difficulty?', sortOrder: 1, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Choking risk?', sortOrder: 2, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Pureed diet?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Thickened fluids?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'SALT involved?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'SALT referral required?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'Requires supervision when eating?', sortOrder: 7, carePlanTrigger: true },
      { questionText: 'Requires modified diet?', sortOrder: 8, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 21,
    title: 'Aids / Special equipment for eating or drinking',
    carePlanArea: 'Nutrition',
    questions: [
      { questionText: 'Plate guard required?', sortOrder: 1, carePlanTrigger: true },
      { questionText: 'Special cutlery required?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Beaker required?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Drinking aid required?', sortOrder: 4, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 22,
    title: 'Appetite',
    carePlanArea: 'Nutrition',
    questions: [
      { questionText: 'Good appetite?', sortOrder: 1 },
      { questionText: 'Poor appetite?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Variable appetite?', sortOrder: 3 },
      { questionText: 'Food refusal?', sortOrder: 4, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Supplements used?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'GP review required?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'Dietitian referral required?', sortOrder: 7, carePlanTrigger: true },
      { questionText: 'Appetite concerns?', sortOrder: 8, questionType: TEXTAREA, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 23,
    title: 'Hydration',
    carePlanArea: 'Nutrition',
    questions: [
      { questionText: 'Drinks enough fluids?', sortOrder: 1 },
      { questionText: 'At risk of dehydration?', sortOrder: 2, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Fluid monitoring required?', sortOrder: 3, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 24,
    title: 'Nutrition',
    carePlanArea: 'Nutrition',
    questions: [
      { questionText: 'Nutritional risk?', sortOrder: 1, riskFlag: true, carePlanTrigger: true },
      { questionText: 'MUST assessment required?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Malnutrition risk?', sortOrder: 3, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Severe malnutrition risk?', sortOrder: 4, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Obesity risk?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'Special diet?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'Diabetic diet?', sortOrder: 7, carePlanTrigger: true },
      { questionText: 'Dietitian involved?', sortOrder: 8, carePlanTrigger: true },
      { questionText: 'Nutrition comments required?', sortOrder: 9, questionType: TEXTAREA, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 25,
    title: 'Speech impairment',
    carePlanArea: 'Communication',
    questions: [
      { questionText: 'Speech normal?', sortOrder: 1 },
      { questionText: 'Difficulty speaking?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Unable to speak?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Communication board used?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'SALT involved?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'SALT referral required?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'Requires communication support?', sortOrder: 7, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 26,
    title: 'Medication',
    carePlanArea: 'Medication',
    questions: [
      { questionText: 'Taking prescribed medication?', sortOrder: 1 },
      { questionText: 'Knows why medication is taken?', sortOrder: 2 },
      { questionText: 'Knows when medication should be taken?', sortOrder: 3 },
      { questionText: 'Knows how medication should be taken?', sortOrder: 4 },
    ],
  },
  {
    sectionNumber: 27,
    title: 'Medication support level',
    carePlanArea: 'Medication',
    questions: [
      { questionText: 'Independent with self administration?', sortOrder: 1 },
      { questionText: 'Prompting required?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Supervision required?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Carer administration required?', sortOrder: 4, carePlanTrigger: true },
      { questionText: 'Family/friend supports medication?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'District Nurse administers medication?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'Medication removed from packaging by staff?', sortOrder: 7, carePlanTrigger: true },
      { questionText: 'Medication risk identified?', sortOrder: 8, riskFlag: true, carePlanTrigger: true },
    ],
  },
  {
    sectionNumber: 28,
    title: 'Emotional wellbeing',
    carePlanArea: 'Mental Health',
    questions: [
      { questionText: 'Appears content?', sortOrder: 1 },
      { questionText: 'Low mood?', sortOrder: 2, carePlanTrigger: true },
      { questionText: 'Sad?', sortOrder: 3, carePlanTrigger: true },
      { questionText: 'Depressed?', sortOrder: 4, riskFlag: true, carePlanTrigger: true },
      { questionText: 'Anxious?', sortOrder: 5, carePlanTrigger: true },
      { questionText: 'Isolated?', sortOrder: 6, carePlanTrigger: true },
      { questionText: 'GP referral made?', sortOrder: 7, carePlanTrigger: true },
      { questionText: 'Mental health support involved?', sortOrder: 8, carePlanTrigger: true },
      { questionText: 'Emotional wellbeing concerns?', sortOrder: 9, questionType: TEXTAREA, carePlanTrigger: true },
    ],
  },
];

const TEMPLATE_NAME = 'Initial Assessment Checklist';

export async function seedInitialAssessmentChecklist(prisma: PrismaClient): Promise<void> {
  let template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: TEMPLATE_NAME, deletedAt: null },
  });

  if (!template) {
    template = await prisma.initialAssessmentTemplate.create({
      data: {
        name: TEMPLATE_NAME,
        description:
          'Default initial assessment checklist for service user care needs, risks, equipment, environment, nutrition, medication, communication, and emotional wellbeing.',
        version: 1,
        isDefault: true,
        isActive: true,
      },
    });
  } else {
    await prisma.initialAssessmentTemplate.updateMany({
      where: { isDefault: true, id: { not: template.id }, deletedAt: null },
      data: { isDefault: false },
    });
    template = await prisma.initialAssessmentTemplate.update({
      where: { id: template.id },
      data: {
        description:
          'Default initial assessment checklist for service user care needs, risks, equipment, environment, nutrition, medication, communication, and emotional wellbeing.',
        version: 1,
        isDefault: true,
        isActive: true,
        deletedAt: null,
      },
    });
  }

  for (const section of DEFAULT_INITIAL_ASSESSMENT_SECTIONS) {
    const sectionRow = await prisma.initialAssessmentSection.upsert({
      where: {
        templateId_sectionNumber: {
          templateId: template.id,
          sectionNumber: section.sectionNumber,
        },
      },
      update: {
        title: section.title,
        carePlanArea: section.carePlanArea ?? null,
        sortOrder: section.sectionNumber,
        isActive: true,
        deletedAt: null,
      },
      create: {
        templateId: template.id,
        sectionNumber: section.sectionNumber,
        title: section.title,
        carePlanArea: section.carePlanArea ?? null,
        sortOrder: section.sectionNumber,
        isActive: true,
      },
    });

    for (const q of section.questions) {
      const existing = await prisma.initialAssessmentQuestion.findFirst({
        where: {
          sectionId: sectionRow.id,
          questionText: q.questionText,
          deletedAt: null,
        },
      });

      const data = {
        questionText: q.questionText,
        questionType: q.questionType ?? CHECKBOX,
        isRequired: q.isRequired ?? false,
        allowNotes: true,
        riskFlag: q.riskFlag ?? false,
        carePlanTrigger: q.carePlanTrigger ?? false,
        sortOrder: q.sortOrder,
        isActive: true,
        deletedAt: null as Date | null,
      };

      if (existing) {
        await prisma.initialAssessmentQuestion.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await prisma.initialAssessmentQuestion.create({
          data: { sectionId: sectionRow.id, ...data },
        });
      }
    }
  }

  console.log('Seeded Initial Assessment Checklist template with 28 sections');
}
