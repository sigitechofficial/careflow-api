import { Prisma } from '@prisma/client';

type QuestionRow = {
  id: string;
  metadata: Prisma.JsonValue;
};

function specRefOf(q: { metadata: Prisma.JsonValue }): string | undefined {
  if (!q.metadata || typeof q.metadata !== 'object' || Array.isArray(q.metadata)) return undefined;
  const ref = (q.metadata as Record<string, unknown>).specRef;
  return typeof ref === 'string' ? ref : undefined;
}

/** If profile has emergency contacts, ensure §13.3 answer reflects that before validation. */
export async function syncEmergencyContactAnswerFromProfile(
  prisma: {
    serviceUserContact: {
      count: (args: {
        where: { serviceUserId: string; deletedAt: null; isEmergencyContact?: boolean };
      }) => Promise<number>;
    };
    initialAssessmentAnswer: {
      upsert: (args: {
        where: { submissionId_questionId: { submissionId: string; questionId: string } };
        create: {
          submissionId: string;
          questionId: string;
          checked: boolean;
          booleanValue: boolean;
        };
        update: { checked: boolean; booleanValue: boolean };
      }) => Promise<unknown>;
    };
  },
  params: {
    serviceUserId: string;
    submissionId: string;
    questions: QuestionRow[];
  },
): Promise<boolean> {
  const emergencyQ = params.questions.find((q) => specRefOf(q) === '13.3');
  if (!emergencyQ) return false;

  const emergencyCount = await prisma.serviceUserContact.count({
    where: {
      serviceUserId: params.serviceUserId,
      deletedAt: null,
      isEmergencyContact: true,
    },
  });
  const anyContactCount =
    emergencyCount > 0
      ? emergencyCount
      : await prisma.serviceUserContact.count({
          where: { serviceUserId: params.serviceUserId, deletedAt: null },
        });

  if (anyContactCount === 0) return false;

  await prisma.initialAssessmentAnswer.upsert({
    where: {
      submissionId_questionId: { submissionId: params.submissionId, questionId: emergencyQ.id },
    },
    create: {
      submissionId: params.submissionId,
      questionId: emergencyQ.id,
      checked: true,
      booleanValue: true,
    },
    update: { checked: true, booleanValue: true },
  });

  return true;
}
