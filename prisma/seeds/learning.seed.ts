import {
  LearningAssignmentPriority,
  LearningAssignmentStatus,
  LearningAssignmentType,
  LearningCompletionRule,
  LearningCourseStatus,
  LearningProgressStatus,
  LearningQuestionType,
  PrismaClient,
} from '@prisma/client';
import {
  LEARNING_CATEGORY_CATALOG,
  LEARNING_COMPETENCY_CATALOG,
  LEARNING_COURSE_CATALOG,
} from '../seed-data/learning-catalog';

/**
 * Seeds care-sector learning categories, published courses (Nourish/Birdie style),
 * competencies and default learning settings. Idempotent by stable `code`.
 * Does not assign training to employees.
 */
export async function seedLearningCatalog(prisma: PrismaClient) {
  // Default organisation learning settings (singleton-style first row)
  const existingSettings = await prisma.learningSettings.findFirst();
  if (!existingSettings) {
    await prisma.learningSettings.create({
      data: {
        defaultExpiryWarningDays: 30,
        defaultAssignmentDueDays: 14,
        allowEmployeeExternalTrainingSubmission: true,
        requireManagerApprovalForExternalTraining: true,
        automaticRefresherAssignment: true,
        automaticOverdueEscalation: true,
        defaultCertificateValidityDays: 365,
        allowCourseAccessAfterExpiry: false,
        allowCourseRetakeAfterPass: false,
        complianceCalculationMode: 'DERIVED',
      },
    });
  }

  const categoryIds = new Map<string, string>();

  for (const cat of LEARNING_CATEGORY_CATALOG) {
    const row = await prisma.learningCategory.upsert({
      where: { code: cat.code },
      update: {
        name: cat.name,
        description: cat.description,
        displayOrder: cat.displayOrder,
        isActive: true,
        deletedAt: null,
      },
      create: {
        code: cat.code,
        name: cat.name,
        description: cat.description,
        displayOrder: cat.displayOrder,
        isActive: true,
      },
    });
    categoryIds.set(cat.code, row.id);
  }

  for (const courseDef of LEARNING_COURSE_CATALOG) {
    const categoryId = categoryIds.get(courseDef.categoryCode);
    if (!categoryId) continue;

    const existing = await prisma.learningCourse.findUnique({
      where: { code: courseDef.code },
      include: { versions: { orderBy: { versionNumber: 'asc' }, take: 1 } },
    });

    if (existing) {
      await prisma.learningCourse.update({
        where: { id: existing.id },
        data: {
          categoryId,
          title: courseDef.title,
          shortDescription: courseDef.shortDescription,
          description: courseDef.description,
          courseType: courseDef.courseType,
          deliveryMethod: courseDef.deliveryMethod,
          difficultyLevel: courseDef.difficultyLevel,
          estimatedDurationMinutes: courseDef.estimatedDurationMinutes,
          cpdMinutes: courseDef.cpdMinutes,
          isMandatory: courseDef.isMandatory,
          requiresAssessment: courseDef.requiresAssessment,
          requiresPracticalAssessment: courseDef.requiresPracticalAssessment,
          requiresManagerApproval: courseDef.requiresManagerApproval,
          requiresTrainingEvent: courseDef.requiresTrainingEvent,
          passingScore: courseDef.passingScore,
          maximumAttempts: courseDef.maximumAttempts,
          certificateEnabled: courseDef.certificateEnabled,
          certificateValidityDays: courseDef.certificateValidityDays,
          refresherFrequencyDays: courseDef.refresherFrequencyDays,
          deletedAt: null,
          archivedAt: null,
        },
      });
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const course = await tx.learningCourse.create({
        data: {
          categoryId,
          code: courseDef.code,
          title: courseDef.title,
          shortDescription: courseDef.shortDescription,
          description: courseDef.description,
          courseType: courseDef.courseType,
          deliveryMethod: courseDef.deliveryMethod,
          difficultyLevel: courseDef.difficultyLevel,
          estimatedDurationMinutes: courseDef.estimatedDurationMinutes,
          cpdMinutes: courseDef.cpdMinutes,
          isMandatory: courseDef.isMandatory,
          requiresAssessment: courseDef.requiresAssessment,
          requiresPracticalAssessment: courseDef.requiresPracticalAssessment,
          requiresManagerApproval: courseDef.requiresManagerApproval,
          requiresTrainingEvent: courseDef.requiresTrainingEvent,
          passingScore: courseDef.passingScore,
          maximumAttempts: courseDef.maximumAttempts,
          certificateEnabled: courseDef.certificateEnabled,
          certificateValidityDays: courseDef.certificateValidityDays,
          refresherFrequencyDays: courseDef.refresherFrequencyDays,
          effectiveFrom: new Date(),
          status: LearningCourseStatus.PUBLISHED,
        },
      });

      const version = await tx.learningCourseVersion.create({
        data: {
          courseId: course.id,
          versionNumber: 1,
          versionLabel: 'v1',
          titleSnapshot: courseDef.title,
          descriptionSnapshot: courseDef.description,
          passingScore: courseDef.passingScore,
          maximumAttempts: courseDef.maximumAttempts,
          estimatedDurationMinutes: courseDef.estimatedDurationMinutes,
          cpdMinutes: courseDef.cpdMinutes,
          certificateValidityDays: courseDef.certificateValidityDays,
          refresherFrequencyDays: courseDef.refresherFrequencyDays,
          status: LearningCourseStatus.PUBLISHED,
          publishedAt: new Date(),
          changeSummary: 'Initial care-sector catalogue seed',
        },
      });

      const section = await tx.learningCourseSection.create({
        data: {
          courseVersionId: version.id,
          title: courseDef.sectionTitle,
          description: 'Seeded core learning content',
          displayOrder: 1,
          isRequired: true,
          estimatedDurationMinutes: Math.min(courseDef.estimatedDurationMinutes, 30),
        },
      });

      await tx.learningContentItem.create({
        data: {
          courseSectionId: section.id,
          contentType: courseDef.contentType,
          title: courseDef.contentTitle,
          description: courseDef.shortDescription,
          contentBody: courseDef.contentBody,
          displayOrder: 1,
          estimatedDurationMinutes: Math.min(courseDef.estimatedDurationMinutes, 30),
          isRequired: true,
          completionRule:
            courseDef.contentType === 'ACKNOWLEDGEMENT'
              ? LearningCompletionRule.ACKNOWLEDGE
              : LearningCompletionRule.VIEW,
        },
      });

      if (courseDef.requiresAssessment) {
        const assessment = await tx.learningAssessment.create({
          data: {
            courseVersionId: version.id,
            title: `${courseDef.title} knowledge check`,
            instructions: 'Answer all questions. You need to meet the pass mark to complete this course.',
            passingScore: courseDef.passingScore,
            maximumAttempts: courseDef.maximumAttempts,
            randomiseQuestions: false,
            randomiseAnswers: false,
            showCorrectAnswers: true,
            allowReview: true,
            isRequired: true,
          },
        });

        const question = await tx.learningAssessmentQuestion.create({
          data: {
            assessmentId: assessment.id,
            questionType: LearningQuestionType.TRUE_FALSE,
            questionText: `I understand my responsibilities relating to: ${courseDef.title}.`,
            explanation: 'Staff must understand and apply this training in practice.',
            points: 1,
            displayOrder: 1,
            isRequired: true,
          },
        });

        await tx.learningAssessmentOption.createMany({
          data: [
            {
              questionId: question.id,
              optionText: 'True',
              isCorrect: true,
              displayOrder: 1,
            },
            {
              questionId: question.id,
              optionText: 'False',
              isCorrect: false,
              displayOrder: 2,
            },
          ],
        });
      }

      await tx.learningCourse.update({
        where: { id: course.id },
        data: { currentVersionId: version.id },
      });
    });
  }

  for (const comp of LEARNING_COMPETENCY_CATALOG) {
    const categoryId = categoryIds.get(comp.categoryCode) ?? null;
    await prisma.learningCompetency.upsert({
      where: { code: comp.code },
      update: {
        name: comp.name,
        description: comp.description,
        categoryId,
        validityDays: comp.validityDays,
        assessmentCriteria: comp.assessmentCriteria,
        isActive: true,
        deletedAt: null,
      },
      create: {
        code: comp.code,
        name: comp.name,
        description: comp.description,
        categoryId,
        validityDays: comp.validityDays,
        assessmentCriteria: comp.assessmentCriteria,
        isActive: true,
      },
    });
  }

  await seedLearningDemoAssignments(prisma);

  // eslint-disable-next-line no-console
  console.log(
    `Learning catalogue seeded: ${LEARNING_CATEGORY_CATALOG.length} categories, ${LEARNING_COURSE_CATALOG.length} courses, ${LEARNING_COMPETENCY_CATALOG.length} competencies.`,
  );
}

const DEMO_ASSIGNMENT_COURSE_CODES = [
  'SAFEGUARDING_ADULTS',
  'MOVING_HANDLING',
  'MEDICATION_AWARENESS',
  'INFECTION_CONTROL',
  'FIRE_SAFETY',
  'FOOD_HYGIENE',
  'EQUALITY_DIVERSITY',
  'GDPR_INFO_GOV',
  'BASIC_LIFE_SUPPORT',
  'CARE_CERT_OVERVIEW',
  'CODE_OF_CONDUCT',
  'LONE_WORKING',
  'DEMENTIA_AWARENESS',
  'INDUCTION_ORIENTATION',
] as const;

/**
 * Assigns a realistic mix of mandatory courses to active employees for admin demos.
 * Idempotent: skips employee+course pairs that already have an active assignment.
 */
export async function seedLearningDemoAssignments(prisma: PrismaClient) {
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null, isActive: true },
    take: 12,
    orderBy: { createdAt: 'asc' },
    include: {
      employment: { select: { roleId: true, locationId: true, workAreaId: true } },
    },
  });

  if (employees.length === 0) {
    // eslint-disable-next-line no-console
    console.log('Learning demo assignments skipped: no active employees.');
    return;
  }

  const courses = await prisma.learningCourse.findMany({
    where: {
      deletedAt: null,
      status: LearningCourseStatus.PUBLISHED,
      code: { in: [...DEMO_ASSIGNMENT_COURSE_CODES] },
      currentVersionId: { not: null },
    },
    select: {
      id: true,
      code: true,
      title: true,
      currentVersionId: true,
      isMandatory: true,
    },
  });

  if (courses.length === 0) {
    // eslint-disable-next-line no-console
    console.log('Learning demo assignments skipped: no published catalogue courses.');
    return;
  }

  const activeStatuses = [
    LearningAssignmentStatus.ASSIGNED,
    LearningAssignmentStatus.NOT_STARTED,
    LearningAssignmentStatus.IN_PROGRESS,
    LearningAssignmentStatus.AWAITING_ASSESSMENT,
    LearningAssignmentStatus.AWAITING_APPROVAL,
    LearningAssignmentStatus.OVERDUE,
  ] as const;

  const now = Date.now();
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < employees.length; i += 1) {
    const employee = employees[i];
    // Give each employee 3–5 courses from the catalogue, rotated by index.
    const courseSlice = [
      courses[i % courses.length],
      courses[(i + 2) % courses.length],
      courses[(i + 4) % courses.length],
      courses[(i + 6) % courses.length],
    ].filter(Boolean);

    for (let c = 0; c < courseSlice.length; c += 1) {
      const course = courseSlice[c];
      if (!course.currentVersionId) continue;

      const existing = await prisma.learningAssignment.findFirst({
        where: {
          employeeId: employee.id,
          courseId: course.id,
          status: { in: [...activeStatuses] },
        },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      // Mix due dates: overdue / due soon / future.
      const dueOffsetDays = c === 0 ? -5 : c === 1 ? 7 : c === 2 ? 21 : 45;
      const dueAt = new Date(now + dueOffsetDays * 86_400_000);
      const status =
        dueOffsetDays < 0
          ? LearningAssignmentStatus.OVERDUE
          : c === 1
            ? LearningAssignmentStatus.IN_PROGRESS
            : LearningAssignmentStatus.ASSIGNED;

      await prisma.$transaction(async (tx) => {
        const assignment = await tx.learningAssignment.create({
          data: {
            assignmentType: LearningAssignmentType.BULK,
            courseId: course.id,
            courseVersionId: course.currentVersionId!,
            employeeId: employee.id,
            roleId: employee.employment?.roleId ?? null,
            locationId: employee.employment?.locationId ?? null,
            workAreaId: employee.employment?.workAreaId ?? null,
            assignedAt: new Date(now - (c + 1) * 2 * 86_400_000),
            availableFrom: new Date(now - (c + 1) * 2 * 86_400_000),
            dueAt,
            priority:
              course.isMandatory && dueOffsetDays < 0
                ? LearningAssignmentPriority.HIGH
                : LearningAssignmentPriority.NORMAL,
            isMandatory: course.isMandatory,
            assignmentReason: 'Demo seed — mandatory care training allocation',
            status,
          },
        });

        await tx.learningEmployeeProgress.create({
          data: {
            assignmentId: assignment.id,
            employeeId: employee.id,
            courseVersionId: course.currentVersionId!,
            progressPercentage: status === LearningAssignmentStatus.IN_PROGRESS ? 35 : 0,
            startedAt: status === LearningAssignmentStatus.IN_PROGRESS ? new Date(now - 86_400_000) : null,
            lastAccessedAt:
              status === LearningAssignmentStatus.IN_PROGRESS ? new Date(now - 3_600_000) : null,
            completedContentItems: 0,
            totalRequiredContentItems: 1,
            courseCompletionStatus:
              status === LearningAssignmentStatus.IN_PROGRESS
                ? LearningProgressStatus.IN_PROGRESS
                : LearningProgressStatus.NOT_STARTED,
          },
        });

        await tx.learningComplianceSnapshot.upsert({
          where: {
            employeeId_courseId: {
              employeeId: employee.id,
              courseId: course.id,
            },
          },
          update: {
            assignmentId: assignment.id,
            courseVersionId: course.currentVersionId!,
            dueAt,
            complianceStatus:
              status === LearningAssignmentStatus.OVERDUE
                ? 'OVERDUE'
                : status === LearningAssignmentStatus.IN_PROGRESS
                  ? 'IN_PROGRESS'
                  : 'ASSIGNED',
            lastCalculatedAt: new Date(),
          },
          create: {
            employeeId: employee.id,
            courseId: course.id,
            assignmentId: assignment.id,
            courseVersionId: course.currentVersionId!,
            dueAt,
            complianceStatus:
              status === LearningAssignmentStatus.OVERDUE
                ? 'OVERDUE'
                : status === LearningAssignmentStatus.IN_PROGRESS
                  ? 'IN_PROGRESS'
                  : 'ASSIGNED',
          },
        });
      });

      created += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Learning demo assignments: created ${created}, skipped ${skipped}.`);
}
