import { Prisma, VisitPlanNightDuty } from '@prisma/client';
import { syncVisitPlanSlotNightDutyToScheduledJobs } from './visit-plan-night-duty-sync.util';
import { VISIT_PLAN_EXTRA_JOB_METADATA_KEY } from './visit-plan-extra-visit.util';

describe('syncVisitPlanSlotNightDutyToScheduledJobs', () => {
  const visits = [
    { scheduledJob: { id: 'job-waking', metadata: { visitPlanId: 'p', nightDuty: 'WAKING_NIGHT' } } },
    { scheduledJob: { id: 'job-none', metadata: { visitPlanId: 'p', nightDuty: 'NONE' } } },
    { scheduledJob: { id: 'job-old', metadata: { visitPlanId: 'p' } } },
    { scheduledJob: { id: 'job-extra', metadata: { nightDuty: 'WAKING_NIGHT', [VISIT_PLAN_EXTRA_JOB_METADATA_KEY]: true } } },
  ];

  function makeTx() {
    return {
      scheduledVisit: { findMany: jest.fn().mockResolvedValue(visits) },
      scheduledJob: { update: jest.fn().mockResolvedValue({}) },
    };
  }

  it('updates not-started regular visits only, and only when the night type differs', async () => {
    const tx = makeTx();
    const from = new Date('2026-10-14T00:00:00Z');
    const updated = await syncVisitPlanSlotNightDutyToScheduledJobs(tx as unknown as Prisma.TransactionClient, {
      visitPlanSlotId: 'slot-1',
      nightDuty: VisitPlanNightDuty.NONE,
      fromDateTime: from,
    });
    expect(updated).toBe(1);
    expect(tx.scheduledJob.update).toHaveBeenCalledTimes(1);
    expect(tx.scheduledJob.update).toHaveBeenCalledWith({
      where: { id: 'job-waking' },
      data: { metadata: { visitPlanId: 'p', nightDuty: 'NONE' } },
    });
    const where = tx.scheduledVisit.findMany.mock.calls[0][0].where;
    expect(where.visitPlanSlotId).toBe('slot-1');
    expect(where.scheduledStartDateTime).toEqual({ gte: from });
    expect(where.status).toEqual({ in: ['PLANNED', 'NEEDS_ATTENTION'] });
  });

  it('sets a new waking night on visits that had none, but leaves extra visits alone', async () => {
    const tx = makeTx();
    const updated = await syncVisitPlanSlotNightDutyToScheduledJobs(tx as unknown as Prisma.TransactionClient, {
      visitPlanSlotId: 'slot-1',
      nightDuty: VisitPlanNightDuty.WAKING_NIGHT,
      fromDateTime: new Date(),
    });
    expect(updated).toBe(2);
    expect(tx.scheduledJob.update.mock.calls.map((c) => c[0].where.id)).toEqual(['job-none', 'job-old']);
  });
});
