import { rotaApprovedAfterRejection } from './rota-approval-override.util';

/** A rota approval for a visit a plan request rejected earlier keeps the carer on that visit. */
describe('rotaApprovedAfterRejection', () => {
  const rejectedAt = new Date('2026-10-27T05:47:00.000Z');
  const rejected = [
    {
      employeeId: 'john',
      decidedAt: rejectedAt,
      requestPayload: {
        kind: 'PLAN',
        withheld: ['slot-am|2026-11-11', 'slot-am|2026-11-18'],
      },
    },
  ];

  function build(approvedAt: Date) {
    return {
      employeeHoursApproval: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              employeeId: 'john',
              decidedAt: approvedAt,
              requestPayload: { scheduledJobId: 'job-11' },
            },
          ]),
      },
      scheduledJob: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              id: 'job-11',
              metadata: { visitPlanSlotId: 'slot-am', date: '2026-11-11' },
            },
          ]),
      },
    };
  }

  it('keeps the carer on a rejected visit approved later on the rota', async () => {
    const client = build(new Date('2026-10-27T05:49:00.000Z'));
    const out = await rotaApprovedAfterRejection(client as never, rejected);
    expect([...out]).toEqual(['john|slot-am|2026-11-11']);
  });

  it('lets a rejection made after the rota approval win', async () => {
    const client = build(new Date('2026-10-27T05:40:00.000Z'));
    const out = await rotaApprovedAfterRejection(client as never, rejected);
    expect(out.size).toBe(0);
  });
});
