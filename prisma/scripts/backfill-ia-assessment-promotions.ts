/**
 * Backfill service-user assessment promotions from existing SUBMITTED IA submissions.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/backfill-ia-assessment-promotions.ts
 *   npx ts-node --transpile-only prisma/scripts/backfill-ia-assessment-promotions.ts --service-user-id=<uuid>
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { promoteIaAssessmentsOnSubmit } from '../../src/service-user-assessments/ia-assessment-promotion.util';
import type { AuditLogsService } from '../../src/audit-logs/audit-logs.service';

const prisma = new PrismaClient();
const audit = { logAudit: async () => undefined } as unknown as AuditLogsService;

function parseServiceUserIdArg(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith('--service-user-id='));
  return arg?.split('=')[1]?.trim() || undefined;
}

async function main() {
  const serviceUserId = parseServiceUserIdArg();

  const submissions = await prisma.initialAssessmentSubmission.findMany({
    where: {
      status: 'SUBMITTED',
      deletedAt: null,
      ...(serviceUserId ? { serviceUserId } : {}),
    },
    orderBy: { submittedAt: 'asc' },
    include: {
      answers: true,
      template: {
        include: {
          sections: {
            where: { deletedAt: null },
            include: {
              questions: {
                where: { deletedAt: null },
                include: { section: { select: { sectionNumber: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (submissions.length === 0) {
    console.log('[backfill-ia-assessments] no SUBMITTED submissions found');
    return;
  }

  let promoted = 0;
  for (const submission of submissions) {
    const questions = submission.template.sections.flatMap((section) =>
      section.questions.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        metadata: q.metadata,
        section: { sectionNumber: q.section.sectionNumber },
      })),
    );

    await prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserAssessmentCompletion.count({
        where: { sourceSubmissionId: submission.id },
      });

      await promoteIaAssessmentsOnSubmit(tx, {
        audit,
        serviceUserId: submission.serviceUserId,
        submissionId: submission.id,
        submittedById: submission.submittedById ?? submission.updatedById ?? submission.createdById ?? '',
        submittedAt: submission.submittedAt ?? submission.updatedAt,
        metadata: submission.metadata as Prisma.JsonValue,
        questions,
        answers: submission.answers.map((a) => ({
          questionId: a.questionId,
          checked: a.checked,
          booleanValue: a.booleanValue,
          textValue: a.textValue,
          numberValue: a.numberValue,
          dateValue: a.dateValue,
          timeValue: a.timeValue,
          selectedOptions: a.selectedOptions,
        })),
      });

      const after = await tx.serviceUserAssessmentCompletion.count({
        where: { sourceSubmissionId: submission.id },
      });
      const added = after - before;
      console.log(
        `[backfill-ia-assessments] submission ${submission.id} — ${added} new promotion(s), ${after} total`,
      );
    });

    promoted += 1;
  }

  console.log(`[backfill-ia-assessments] done — processed ${promoted} submission(s)`);
}

void main()
  .catch((err) => {
    console.error('[backfill-ia-assessments] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
