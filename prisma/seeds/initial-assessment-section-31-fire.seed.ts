import { InitialAssessmentQuestionType, PrismaClient } from '@prisma/client';
import { ENTERPRISE_TEMPLATE_NAME } from './initial-assessment-enterprise.seed';
import { whenNo, whenYes } from './initial-assessment-enterprise-metadata';

const TEXTAREA = InitialAssessmentQuestionType.TEXTAREA;
const YES_NO = InitialAssessmentQuestionType.YES_NO;

type FireQuestionPatch = {
  oldTexts: string[];
  questionText: string;
  questionType: InitialAssessmentQuestionType;
  isRequired?: boolean;
  riskFlag?: boolean;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

const SECTION_31_FIRE_QUESTIONS: FireQuestionPatch[] = [
  {
    oldTexts: ['Any fire safety risks identified?', 'Any fire safety risks identified? (Please state)'],
    questionText: 'Any fire safety risks identified? (Please state)',
    questionType: TEXTAREA,
    isRequired: true,
    riskFlag: true,
    sortOrder: 1,
    metadata: { specRef: '3.1', fieldKey: 'fireSafetyRisks' },
  },
  {
    oldTexts: ['London Fire Brigade informed?'],
    questionText: 'London Fire Brigade informed?',
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 2,
    metadata: { specRef: '3.2', fieldKey: 'londonFireBrigadeInformed' },
  },
  {
    oldTexts: [
      'London Fire Brigade contact details',
      'London Fire Brigade informed — details',
    ],
    questionText: 'Details',
    questionType: TEXTAREA,
    sortOrder: 3,
    metadata: {
      specRef: '3.2',
      fieldKey: 'londonFireBrigadeDetails',
    },
  },
  {
    oldTexts: [
      'Can Service User manage home environment safely?',
      'Can client manage home environment safely?',
    ],
    questionText: 'Can client manage home environment safely?',
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 4,
    metadata: { specRef: '3.3', fieldKey: 'manageHomeEnvironmentSafely' },
  },
  {
    oldTexts: ['Measures needed if home is unsafe', 'If no, what measure should be taken?'],
    questionText: 'If no, what measure should be taken?',
    questionType: TEXTAREA,
    sortOrder: 5,
    metadata: {
      specRef: '3.4',
      fieldKey: 'homeEnvironmentSafetyMeasures',
      ...whenNo('Can client manage home environment safely?'),
    },
  },
];

/** Align §3.1–3.4 fire / home-safety questions with the paper holistic form. */
export async function migrateSection31FireQuestions(prisma: PrismaClient): Promise<number> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) return 0;

  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 3, deletedAt: null },
  });
  if (!section) return 0;

  const rows = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: section.id },
    select: { id: true, questionText: true, metadata: true },
  });

  let updated = 0;
  for (const patch of SECTION_31_FIRE_QUESTIONS) {
    const fieldKey =
      patch.metadata && typeof patch.metadata.fieldKey === 'string' ? patch.metadata.fieldKey : null;
    const existing = rows.find((row) => {
      if (patch.oldTexts.includes(row.questionText)) return true;
      if (!fieldKey || !row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) {
        return false;
      }
      return (row.metadata as Record<string, unknown>).fieldKey === fieldKey;
    });

    const data = {
      questionText: patch.questionText,
      questionType: patch.questionType,
      isRequired: patch.isRequired ?? false,
      riskFlag: patch.riskFlag ?? false,
      sortOrder: patch.sortOrder,
      metadata: patch.metadata as object,
      isActive: true,
      deletedAt: null,
    };

    if (existing) {
      await prisma.initialAssessmentQuestion.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.initialAssessmentQuestion.create({
        data: { sectionId: section.id, ...data },
      });
    }
    updated += 1;
  }

  return updated;
}
