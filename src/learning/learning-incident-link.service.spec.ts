import { LearningIncidentLinkService } from './learning-incident-link.service';

function setup(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    learningAssignment: {
      findUnique: jest.fn().mockResolvedValue({
        sourceEntityType: 'Incident',
        sourceEntityId: 'inc-1',
        isMandatory: true,
        completedAt: new Date('2026-11-17T10:00:00Z'),
      }),
      update: jest.fn().mockReturnValue('assignment-update'),
    },
    incidentCarerCourseRecommendation: {
      findFirst: jest.fn().mockResolvedValue({ id: 'rec-1' }),
      updateMany: jest.fn().mockReturnValue('rec-update'),
    },
    incidentAction: {
      findFirst: jest.fn().mockResolvedValue({ id: 'act-1', title: 'Course: X for Y', status: 'NOT_STARTED', incidentId: 'inc-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    learningAssessmentAttempt: { findFirst: jest.fn().mockResolvedValue({ percentage: 90 }) },
    learningCertificate: { findFirst: jest.fn().mockResolvedValue({ certificateNumber: 'LC-1' }) },
    $transaction: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  const audit = { logAudit: jest.fn().mockResolvedValue(undefined) };
  return { prisma, audit, service: new LearningIncidentLinkService(prisma, audit as any) };
}

describe('LearningIncidentLinkService', () => {
  it('completes the open incident measure when the course is passed', async () => {
    const { prisma, audit, service } = setup();
    await service.onAssignmentCompleted('a-1');
    expect(prisma.incidentAction.update).toHaveBeenCalledWith({
      where: { id: 'act-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        completionNotes:
          'Course passed on 17 Nov 2026 · quiz 90% · certificate LC-1. Completed automatically from Learning.',
      }),
    });
    expect(audit.logAudit).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a course not given from an incident', async () => {
    const { prisma, service } = setup();
    prisma.learningAssignment.findUnique.mockResolvedValue({ sourceEntityType: null, completedAt: null });
    await service.onAssignmentCompleted('a-1');
    expect(prisma.incidentAction.update).not.toHaveBeenCalled();
  });

  it('leaves a completed or cancelled measure alone', async () => {
    const { prisma, service } = setup();
    prisma.incidentAction.findFirst.mockResolvedValue(null);
    await service.onAssignmentCompleted('a-1');
    expect(prisma.incidentAction.update).not.toHaveBeenCalled();
  });

  it('never throws when the update fails', async () => {
    const { prisma, service } = setup();
    prisma.incidentAction.update.mockRejectedValue(new Error('db down'));
    await expect(service.onAssignmentCompleted('a-1')).resolves.toBeUndefined();
  });

  it('a course given again keeps the incident source and the measure follows it', async () => {
    const { prisma, service } = setup();
    await service.carrySource('old', 'new');
    expect(prisma.learningAssignment.update).toHaveBeenCalledWith({
      where: { id: 'new' },
      data: { sourceEntityType: 'Incident', sourceEntityId: 'inc-1', isMandatory: true },
    });
    expect(prisma.incidentCarerCourseRecommendation.updateMany).toHaveBeenCalledWith({
      where: { learningAssignmentId: 'old' },
      data: { learningAssignmentId: 'new' },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(['assignment-update', 'rec-update']);
  });

  it('does not carry anything for a course not from an incident', async () => {
    const { prisma, service } = setup();
    prisma.learningAssignment.findUnique.mockResolvedValue({ sourceEntityType: null });
    await service.carrySource('old', 'new');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
