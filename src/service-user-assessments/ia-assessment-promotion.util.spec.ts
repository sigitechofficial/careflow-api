import type { Prisma } from '@prisma/client';
import { promoteIaAssessmentsOnSubmit } from './ia-assessment-promotion.util';

describe('ia-assessment-promotion.util', () => {
  it('skips promotion when promotionKey already exists', async () => {
    const tx = {
      organisationGeneralSettings: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      serviceUserAssessment: {
        upsert: jest.fn().mockResolvedValue({ id: 'assessment-1' }),
      },
      serviceUserAssessmentCompletion: {
        findFirst: jest.fn().mockResolvedValue({ id: 'completion-1' }),
        create: jest.fn(),
      },
    } as unknown as Prisma.TransactionClient;

    const audit = {
      logAudit: jest.fn(),
    } as any;

    await promoteIaAssessmentsOnSubmit(tx, {
      audit,
      serviceUserId: 'service-user-1',
      submissionId: 'submission-1',
      submittedById: 'user-1',
      submittedAt: new Date('2026-06-13T00:00:00.000Z'),
      metadata: {
        must: {
          bmiOptionId: 'gt20',
          weightLossOptionId: 'lt5',
          acuteDiseaseOptionId: 'no',
        },
      },
      questions: [],
      answers: [],
    });

    expect(tx.serviceUserAssessment.upsert).toHaveBeenCalledTimes(1);
    expect(tx.serviceUserAssessmentCompletion.create).not.toHaveBeenCalled();
    expect(audit.logAudit).not.toHaveBeenCalled();
  });
});
