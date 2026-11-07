/**
 * Seed sample employee surveys (with questions).
 *
 * Idempotent: skips a survey when one with the same title already exists
 * (non-deleted). Safe to re-run.
 *
 * Usage: npm run seed:surveys
 */
import {
  PrismaClient,
  Prisma,
  SurveyQuestionType,
  SurveyTargetKind,
} from '@prisma/client';

const prisma = new PrismaClient();

type QuestionSeed = {
  questionText: string;
  questionType: SurveyQuestionType;
  helpText?: string;
  options?: string[];
  config?: Record<string, unknown>;
  isRequired?: boolean;
};

type SurveySeed = {
  title: string;
  description: string;
  isAnonymous: boolean;
  questions: QuestionSeed[];
};

const LIKERT = ['Strongly agree', 'Agree', 'Neither agree nor disagree', 'Disagree', 'Strongly disagree'];

const SURVEYS: SurveySeed[] = [
  {
    title: 'Staff Satisfaction Survey 2026',
    description:
      'Annual anonymous staff satisfaction survey. Your honest feedback helps us improve how we support you.',
    isAnonymous: true,
    questions: [
      {
        questionText: 'I feel supported by my line manager.',
        questionType: SurveyQuestionType.LIKERT,
        options: LIKERT,
        isRequired: true,
      },
      {
        questionText: 'I have the training and equipment I need to do my job well.',
        questionType: SurveyQuestionType.LIKERT,
        options: LIKERT,
        isRequired: true,
      },
      {
        questionText: 'How likely are you to recommend us as a place to work?',
        questionType: SurveyQuestionType.RATING,
        helpText: '0 = not at all likely, 10 = extremely likely',
        config: { min: 0, max: 10 },
        isRequired: true,
      },
      {
        questionText: 'What is the one thing we could do to improve your working life?',
        questionType: SurveyQuestionType.TEXTAREA,
      },
    ],
  },
  {
    title: 'New Starter Onboarding Feedback',
    description:
      'Help us improve induction for new carers. Please complete after your first month.',
    isAnonymous: false,
    questions: [
      {
        questionText: 'Was your induction well organised?',
        questionType: SurveyQuestionType.YES_NO,
        isRequired: true,
      },
      {
        questionText: 'Which areas of induction were most useful?',
        questionType: SurveyQuestionType.MULTI_SELECT,
        options: ['Shadowing', 'E-learning', 'Policies & procedures', 'Medication training', 'Manual handling'],
      },
      {
        questionText: 'How confident do you feel in your role so far?',
        questionType: SurveyQuestionType.RATING,
        config: { min: 0, max: 10 },
        isRequired: true,
      },
      {
        questionText: 'Any comments on how we could improve onboarding?',
        questionType: SurveyQuestionType.TEXTAREA,
      },
    ],
  },
  {
    title: 'Health & Wellbeing Check-in',
    description: 'A short quarterly wellbeing check-in to make sure you are supported at work.',
    isAnonymous: true,
    questions: [
      {
        questionText: 'How would you rate your work-related stress this quarter?',
        questionType: SurveyQuestionType.RATING,
        helpText: '0 = none, 10 = very high',
        config: { min: 0, max: 10 },
        isRequired: true,
      },
      {
        questionText: 'Do you feel your workload is manageable?',
        questionType: SurveyQuestionType.SINGLE_SELECT,
        options: ['Always', 'Usually', 'Sometimes', 'Rarely', 'Never'],
        isRequired: true,
      },
      {
        questionText: 'Would you like a wellbeing conversation with your manager?',
        questionType: SurveyQuestionType.YES_NO,
      },
      {
        questionText: 'Anything else you would like to share?',
        questionType: SurveyQuestionType.TEXTAREA,
      },
    ],
  },
];

async function main() {
  // Attribute the seed to a Super Admin user when one exists (createdById is optional).
  const admin = await prisma.user.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const createdById = admin?.id ?? null;

  let created = 0;
  let skipped = 0;

  for (const seed of SURVEYS) {
    const existing = await prisma.survey.findFirst({
      where: { title: seed.title, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      console.log(`  • Skipped (exists): ${seed.title}`);
      continue;
    }

    await prisma.survey.create({
      data: {
        title: seed.title,
        description: seed.description,
        targetKind: SurveyTargetKind.EMPLOYEE,
        isAnonymous: seed.isAnonymous,
        createdById,
        updatedById: createdById,
        questions: {
          create: seed.questions.map((q, idx) => ({
            questionText: q.questionText,
            helpText: q.helpText ?? null,
            questionType: q.questionType,
            options: (q.options as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            config: (q.config as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            isRequired: q.isRequired ?? false,
            sortOrder: idx,
          })),
        },
      },
    });
    created += 1;
    console.log(`  • Created: ${seed.title} (${seed.questions.length} questions)`);
  }

  console.log(`\nSurveys seeded — created ${created}, skipped ${skipped}.`);
  if (!createdById) {
    console.log('  Note: no user found, surveys created without an author.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
