import { VisitReconciliationStatus } from '@prisma/client';
import { VisitReconciliationsService } from './visit-reconciliations.service';

/**
 * Mileage and travel time are filled from the carer's previous visit that day, in the order the
 * visits were actually done; values filled that way follow the day when it changes, and values a
 * person entered are kept.
 */
describe('VisitReconciliationsService — travel filled from the previous visit', () => {
  type Row = {
    id: string;
    visitRef: string;
    employeeId: string;
    serviceUserId: string;
    status: VisitReconciliationStatus;
    plannedStartDateTime: Date;
    actualStartDateTime: Date | null;
    travelMiles: number | null;
    travelMinutes: number | null;
  };
  type Log = { recordId: string; action: string; description?: string; oldValues?: unknown; newValues?: unknown; createdAt: Date };

  const at = (hm: string) => new Date(`2026-10-28T${hm}:00.000Z`);
  const visit = (id: string, serviceUserId: string, planned: string, actual: string | null): Row => ({
    id,
    visitRef: `VIS-${id}`,
    employeeId: 'carer',
    serviceUserId,
    status: VisitReconciliationStatus.APPROVED_FOR_BOTH,
    plannedStartDateTime: at(planned),
    actualStartDateTime: actual ? at(actual) : null,
    travelMiles: null,
    travelMinutes: null,
  });

  function build(rows: Row[]) {
    const logs: Log[] = [];
    let clock = 0;
    const db = {
      visitReconciliation: {
        // Copies, like Prisma: the row read before an update keeps its old values.
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
          const row = rows.find((r) => r.id === where.id);
          return row ? { ...row } : null;
        }),
        findMany: jest.fn(async ({ where }: { where: { employeeId: string; id: { not: string } } }) =>
          rows.filter(
            (r) =>
              r.employeeId === where.employeeId &&
              r.id !== where.id.not &&
              r.actualStartDateTime != null &&
              r.status !== VisitReconciliationStatus.REJECTED_FOR_PAY,
          ),
        ),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
          const row = rows.find((r) => r.id === where.id)!;
          Object.assign(row, data);
          return { ...row };
        }),
      },
      serviceUserAddress: {
        findMany: jest.fn(async () => [
          { serviceUserId: 'enid', latitude: '51.632', longitude: '0.001' },
          { serviceUserId: 'samuel', latitude: '51.4851', longitude: '0.0412' },
        ]),
      },
      auditLog: {
        findMany: jest.fn(async ({ where }: { where: { recordId: string; action: string } }) =>
          logs
            .filter((l) => l.recordId === where.recordId && l.action === where.action)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        ),
      },
    };
    const auditLogs = {
      logAudit: jest.fn(async (entry: Omit<Log, 'createdAt'>) => {
        logs.push({ ...entry, createdAt: new Date(++clock) });
      }),
    };
    const orgSettings = { getOperationalTimezone: jest.fn(async () => 'Europe/London') };
    // Google: Enid → Samuel 28.51 km (17.7 mi), 40 min.
    const drivingTravel = { between: jest.fn(async () => ({ km: 28.51, minutes: 39.9, source: 'GOOGLE' as const })) };
    const service = new VisitReconciliationsService(
      db as never,
      {} as never,
      {} as never,
      orgSettings as never,
      auditLogs as never,
      {} as never,
      drivingTravel as never,
    );
    const fill = (id: string) =>
      (service as unknown as { fillTravelFromDistance: (db: unknown, id: string) => Promise<void> }).fillTravelFromDistance(db, id);
    return { fill, logs };
  }

  it('gives no travel to a visit done first when the earlier planned visit is still open', async () => {
    const morning = visit('am', 'enid', '07:00', null);
    const late = visit('late', 'samuel', '11:00', '11:00');
    const { fill } = build([morning, late]);
    await fill('late');
    expect(late).toMatchObject({ travelMiles: null, travelMinutes: null });
  });

  it("fills the Google route from the carer's previous visit, also when that visit is done later", async () => {
    const morning = visit('am', 'enid', '07:00', '07:00');
    const late = visit('late', 'samuel', '11:00', '11:00');
    const { fill } = build([morning, late]);
    await fill('am'); // fills the next visit too
    expect(morning).toMatchObject({ travelMiles: null, travelMinutes: null });
    expect(late).toMatchObject({ travelMiles: 17.7, travelMinutes: 40 });
  });

  it('clears travel it filled once the visit becomes the first of the day', async () => {
    const morning = visit('am', 'enid', '07:00', '07:00');
    const late = visit('late', 'samuel', '11:00', '11:00');
    const { fill, logs } = build([morning, late]);
    await fill('late');
    expect(late.travelMiles).toBe(17.7);

    morning.status = VisitReconciliationStatus.REJECTED_FOR_PAY;
    await fill('late');
    expect(late).toMatchObject({ travelMiles: null, travelMinutes: null });
    expect(logs.at(-1)?.description).toContain("first visit of the carer's day");
  });

  it('keeps travel a person entered', async () => {
    const late = visit('late', 'samuel', '11:00', '11:00');
    late.travelMiles = 5;
    late.travelMinutes = 12;
    const { fill, logs } = build([late]);
    logs.push({
      recordId: 'late',
      action: 'visit_reconciliation_updated',
      oldValues: { travelMiles: null, travelMinutes: null },
      newValues: { travelMiles: '5', travelMinutes: 12 },
      createdAt: new Date(0),
    });
    await fill('late');
    expect(late).toMatchObject({ travelMiles: 5, travelMinutes: 12 });
  });
});
