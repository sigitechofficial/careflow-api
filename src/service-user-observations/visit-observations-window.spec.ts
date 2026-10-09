import { VisitObservationsCatalogService } from './visit-observations-catalog.service';

/** Minimal Prisma stand-in: answers the two queries the visit count makes. */
function serviceWith(
  rows: Array<{ id: string; recordedAt: Date; payload: unknown }>,
) {
  const svc = Object.create(
    VisitObservationsCatalogService.prototype,
  ) as VisitObservationsCatalogService;
  (svc as unknown as { prisma: unknown }).prisma = {
    serviceUserObservation: {
      findMany: async (args: {
        where: {
          payload?: { equals: string };
          recordedAt?: { gte: Date; lte?: Date };
        };
      }) => {
        const { payload, recordedAt } = args.where;
        if (payload) {
          return rows.filter(
            (r) =>
              (r.payload as { scheduledJobId?: string } | null)
                ?.scheduledJobId === payload.equals,
          );
        }
        return rows.filter(
          (r) =>
            r.recordedAt >= recordedAt!.gte &&
            (!recordedAt!.lte || r.recordedAt <= recordedAt!.lte),
        );
      },
    },
  };
  return svc;
}

const start = new Date('2026-10-07T08:00:00Z');
const end = new Date('2026-10-07T09:00:00Z');

describe('countVisitObservations (visit readings only)', () => {
  const rows = [
    // This visit's readings — counted however many there are.
    ...Array.from({ length: 25 }, (_, i) => ({
      id: `mine-${i}`,
      recordedAt: new Date(start.getTime() + i * 60_000),
      payload: { scheduledJobId: 'job-1' },
    })),
    // Later visits — never counted on job-1.
    ...Array.from({ length: 30 }, (_, i) => ({
      id: `later-${i}`,
      recordedAt: new Date(end.getTime() + (i + 1) * 3_600_000),
      payload: { scheduledJobId: 'job-2' },
    })),
    // Unstamped: one inside the visit window (legacy), one a week later.
    {
      id: 'legacy-in',
      recordedAt: new Date('2026-10-07T08:30:00Z'),
      payload: {},
    },
    {
      id: 'su-page-later',
      recordedAt: new Date('2026-10-14T10:00:00Z'),
      payload: null,
    },
  ];

  it('counts all of this visit, legacy readings in its window, nothing else', async () => {
    const svc = serviceWith(rows);
    expect(await svc.countVisitObservations('su-1', start, 'job-1', end)).toBe(
      26,
    );
  });

  it('while the visit is still open, unstamped readings since it started count', async () => {
    const svc = serviceWith(rows);
    expect(await svc.countVisitObservations('su-1', start, 'job-1', null)).toBe(
      27,
    );
  });
});
