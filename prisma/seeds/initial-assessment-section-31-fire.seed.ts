import { InitialAssessmentQuestionType, PrismaClient } from '@prisma/client';
import { ENTERPRISE_TEMPLATE_NAME } from './initial-assessment-enterprise.seed';
import { whenNo } from './initial-assessment-enterprise-metadata';

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

/** Home-manageability questions that stay in Environment §3. */
const SECTION_3_HOME_SAFETY_QUESTIONS: FireQuestionPatch[] = [
  {
    oldTexts: [
      'Can Service User manage home environment safely?',
      'Can client manage home environment safely?',
    ],
    questionText: 'Can client manage home environment safely?',
    questionType: YES_NO,
    isRequired: true,
    sortOrder: 5,
    metadata: { specRef: '3.3', fieldKey: 'manageHomeEnvironmentSafely' },
  },
  {
    oldTexts: ['Measures needed if home is unsafe', 'If no, what measure should be taken?'],
    questionText: 'If no, what measure should be taken?',
    questionType: TEXTAREA,
    sortOrder: 6,
    metadata: {
      specRef: '3.4',
      fieldKey: 'homeEnvironmentSafetyMeasures',
      ...whenNo('Can client manage home environment safely?'),
    },
  },
];

export const FIRE_SAFETY_REHOME_FIELD_KEYS = [
  'fireSafetyRisksIdentified',
  'fireSafetyRisksDetails',
  'londonFireBrigadeInformed',
  'londonFireBrigadeDetails',
  'smokeAlarmFittedWorking',
  'smokeCoFireAlarmReferral',
  'smokingInProperty',
] as const;

const FIRE_SAFETY_REHOME_BY_TEXT: Array<{
  texts: string[];
  fieldKey: string;
  specRefs?: string[];
  genericText?: string;
}> = [
  { texts: ['Any fire safety risks identified?'], fieldKey: 'fireSafetyRisksIdentified' },
  { texts: ['Any fire safety risks identified? (Please state)'], fieldKey: 'fireSafetyRisksDetails' },
  { texts: ['London Fire Brigade informed?'], fieldKey: 'londonFireBrigadeInformed' },
  {
    texts: [
      'London Fire Brigade contact details',
      'London Fire Brigade informed — details',
    ],
    fieldKey: 'londonFireBrigadeDetails',
    specRefs: ['3.2', '18.2'],
    genericText: 'Details',
  },
  { texts: ['Smoke alarm fitted and working?'], fieldKey: 'smokeAlarmFittedWorking' },
  {
    texts: ['Referral required for smoke, CO or fire alarm?'],
    fieldKey: 'smokeCoFireAlarmReferral',
  },
  { texts: ['Smoking in property?'], fieldKey: 'smokingInProperty' },
];

function metadataFieldKey(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const key = (metadata as Record<string, unknown>).fieldKey;
  return typeof key === 'string' ? key : null;
}

function metadataSpecRef(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const ref = (metadata as Record<string, unknown>).specRef;
  return typeof ref === 'string' ? ref : null;
}

/**
 * Move existing fire-safety questions from Environment §3 to Fire Safety §18 without changing UUIDs.
 */
export async function rehomeFireSafetyQuestionsToSection18(prisma: PrismaClient): Promise<number> {
  const template = await prisma.initialAssessmentTemplate.findFirst({
    where: { name: ENTERPRISE_TEMPLATE_NAME, deletedAt: null },
  });
  if (!template) return 0;

  const section3 = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 3, deletedAt: null },
  });
  const section18 = await prisma.initialAssessmentSection.findFirst({
    where: { templateId: template.id, sectionNumber: 18, deletedAt: null },
  });
  if (!section3 || !section18) return 0;

  const rows = await prisma.initialAssessmentQuestion.findMany({
    where: { sectionId: { in: [section3.id, section18.id] } },
    select: { id: true, questionText: true, metadata: true, sectionId: true },
  });

  const claimed = new Set<string>();
  let moved = 0;
  for (const spec of FIRE_SAFETY_REHOME_BY_TEXT) {
    const existing = rows.find((row) => {
      if (claimed.has(row.id)) return false;
      const key = metadataFieldKey(row.metadata);
      if (key && key === spec.fieldKey) return true;
      if (spec.texts.includes(row.questionText)) return true;
      if (
        spec.genericText &&
        row.questionText === spec.genericText &&
        spec.specRefs?.includes(metadataSpecRef(row.metadata) ?? '')
      ) {
        return true;
      }
      return false;
    });
    if (!existing) continue;
    claimed.add(existing.id);
    const prevMeta =
      existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
        ? { ...(existing.metadata as Record<string, unknown>) }
        : {};
    if (existing.sectionId !== section18.id) {
      await prisma.initialAssessmentQuestion.update({
        where: { id: existing.id },
        data: {
          sectionId: section18.id,
          metadata: { ...prevMeta, fieldKey: spec.fieldKey } as object,
          isActive: true,
          deletedAt: null,
        },
      });
      moved += 1;
    } else if (prevMeta.fieldKey !== spec.fieldKey) {
      await prisma.initialAssessmentQuestion.update({
        where: { id: existing.id },
        data: { metadata: { ...prevMeta, fieldKey: spec.fieldKey } as object },
      });
    }
  }

  return moved;
}

/** Align remaining Environment home-safety questions. Does not recreate Fire Safety rows in §3. */
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
  for (const patch of SECTION_3_HOME_SAFETY_QUESTIONS) {
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
