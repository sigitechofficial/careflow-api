import { syncObservationFromCompletedVisitTask } from './visit-task-obs-sync.util';

describe('syncObservationFromCompletedVisitTask', () => {
  it('creates an observation for Obs-linked completed task (admin user path)', async () => {
    const create = jest.fn().mockResolvedValue({});
    const findFirstType = jest.fn().mockResolvedValue({
      id: 'type-1',
      unitLabel: 'mmol/L',
      code: 'BLOOD_SUGAR',
    });
    const findFirstObs = jest.fn().mockResolvedValue(null);
    const prisma = {
      observationType: { findFirst: findFirstType },
      serviceUserObservation: {
        findFirst: findFirstObs,
        update: jest.fn(),
        create,
      },
    };

    const result = await syncObservationFromCompletedVisitTask(prisma, {
      serviceUserId: 'su-1',
      jobId: 'job-1',
      visitId: 'visit-1',
      taskName: 'Blood glucose reading',
      recordedValue: '6.2',
      notes: null,
      recordedByUserId: 'user-1',
    });

    expect(result).toEqual({ synced: true, observationTypeCode: 'BLOOD_SUGAR' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serviceUserId: 'su-1',
          recordedByUserId: 'user-1',
          numericValue: 6.2,
          payload: expect.objectContaining({
            source: 'visit_task',
            scheduledJobId: 'job-1',
            definitionId: 'blood_glucose',
          }),
        }),
      }),
    );
  });

  it('skips non Obs-linked tasks', async () => {
    const prisma = {
      observationType: { findFirst: jest.fn() },
      serviceUserObservation: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };

    const result = await syncObservationFromCompletedVisitTask(prisma, {
      serviceUserId: 'su-1',
      jobId: 'job-1',
      visitId: 'visit-1',
      taskName: 'Encourage conversation',
      recordedValue: 'ok',
      recordedByUserId: 'user-1',
    });

    expect(result).toEqual({ synced: false });
    expect(prisma.observationType.findFirst).not.toHaveBeenCalled();
  });
});
