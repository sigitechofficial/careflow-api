import { ScheduleLifecycleImpactService } from './schedule-lifecycle-impact.service';

/** Impact ranges are calendar days in the organisation timezone (OrganisationGeneralSettings.timezone). */
describe('ScheduleLifecycleImpactService — organisation timezone', () => {
  const label = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  function build(timeZone: string, jobs: Array<{ id: string; scheduledStartDateTime: Date }>) {
    const findMany = jest.fn().mockResolvedValue(jobs);
    const prisma = { scheduledJob: { findMany } };
    const orgSettings = { getOperationalTimezone: jest.fn().mockResolvedValue(timeZone) };
    const service = new ScheduleLifecycleImpactService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      orgSettings as never,
    );
    return { service, findMany };
  }

  it('London BST: skip preview for 2026-07-15 queries 23:00Z on the 14th → 22:59:59.999Z on the 15th', async () => {
    const { service, findMany } = build('Europe/London', []);
    await service.previewCancelScopedServiceUserJobs({
      serviceUserId: 'su-1',
      fromDate: label('2026-07-15'),
      toDate: label('2026-07-15'),
      scope: { visitPlanSlotId: 'slot-1' },
    });
    const where = findMany.mock.calls[0][0].where;
    expect(where.scheduledStartDateTime).toEqual({
      gte: new Date('2026-07-14T23:00:00.000Z'),
      lte: new Date('2026-07-15T22:59:59.999Z'),
    });
  });

  it('Asia/Karachi: the same label maps to Karachi midnight (19:00Z previous day)', async () => {
    const { service, findMany } = build('Asia/Karachi', []);
    await service.previewCancelServiceUserJobsInRange({
      serviceUserId: 'su-1',
      fromDate: label('2026-07-15'),
      toDate: label('2026-07-15'),
    });
    expect(findMany.mock.calls[0][0].where.scheduledStartDateTime).toEqual({
      gte: new Date('2026-07-14T19:00:00.000Z'),
      lte: new Date('2026-07-15T18:59:59.999Z'),
    });
  });

  it('removed-weekday preview filters by the London weekday (00:30 BST Tue = 23:30Z Mon)', async () => {
    const { service } = build('Europe/London', [
      { id: 'mon-2330', scheduledStartDateTime: new Date('2026-07-13T22:30:00.000Z') },
      { id: 'tue-0030', scheduledStartDateTime: new Date('2026-07-13T23:30:00.000Z') },
    ]);
    const result = await service.previewCancelScopedServiceUserJobs({
      serviceUserId: 'su-1',
      fromDate: label('2026-07-13'),
      scope: { visitPlanSlotId: 'slot-1', weekdays: [2] },
    });
    expect(result.jobIds).toEqual(['tue-0030']);
  });
});
