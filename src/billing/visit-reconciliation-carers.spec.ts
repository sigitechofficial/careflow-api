import { AllocationStatus } from '@prisma/client';
import { VisitReconciliationsService } from './visit-reconciliations.service';

type Alloc = {
  id: string;
  employeeId: string;
  scheduledJobId: string;
  scheduledVisitId: string | null;
  status: AllocationStatus;
  isLeadCarer: boolean;
  allocatedAt: Date;
};

type Where = {
  OR?: Array<Partial<Pick<Alloc, 'scheduledJobId' | 'scheduledVisitId'>>>;
  scheduledVisitId?: string | null;
  scheduledJobId?: string;
  status?: { in?: AllocationStatus[]; notIn?: AllocationStatus[] };
};

const matches = (a: Alloc, part: Partial<Alloc>) =>
  Object.entries(part).every(([k, v]) => a[k as keyof Alloc] === v);

/** In-memory jobAllocation.findMany that understands the filters the lookup uses. */
function dbWith(allocations: Alloc[]) {
  return {
    jobAllocation: {
      findMany: jest.fn(async ({ where }: { where: Where }) =>
        allocations
          .filter((a) => (where.OR ? where.OR.some((part) => matches(a, part)) : true))
          .filter((a) => (where.scheduledVisitId !== undefined ? a.scheduledVisitId === where.scheduledVisitId : true))
          .filter((a) => (where.scheduledJobId !== undefined ? a.scheduledJobId === where.scheduledJobId : true))
          .filter((a) => (where.status?.in ? where.status.in.includes(a.status) : true))
          .filter((a) => (where.status?.notIn ? !where.status.notIn.includes(a.status) : true))
          .sort((x, y) => Number(y.isLeadCarer) - Number(x.isLeadCarer) || x.allocatedAt.getTime() - y.allocatedAt.getTime()),
      ),
    },
  };
}

const alloc = (id: string, scheduledVisitId: string | null, extra: Partial<Alloc> = {}): Alloc => ({
  id,
  employeeId: `emp-${id}`,
  scheduledJobId: 'job-1',
  scheduledVisitId,
  status: AllocationStatus.CONFIRMED,
  isLeadCarer: false,
  allocatedAt: new Date(`2026-10-26T09:0${id.length}:00Z`),
  ...extra,
});

describe('carers of a visit for visit reconciliation', () => {
  const service = Object.create(VisitReconciliationsService.prototype) as {
    resolveAllAllocations: (db: unknown, jobId: string, visitId: string) => Promise<Array<{ id: string }>>;
  };

  it('includes a carer dragged onto the job (no visit) next to the carer linked to the visit', async () => {
    const db = dbWith([alloc('lead', 'visit-1', { isLeadCarer: true }), alloc('second', null)]);
    const carers = await service.resolveAllAllocations(db, 'job-1', 'visit-1');
    expect(carers.map((c) => c.id)).toEqual(['lead', 'second']);
  });

  it('leaves out carers linked to another visit of the job, and cancelled carers', async () => {
    const db = dbWith([
      alloc('mine', 'visit-1'),
      alloc('other', 'visit-2'),
      alloc('gone', null, { status: AllocationStatus.CANCELLED }),
    ]);
    const carers = await service.resolveAllAllocations(db, 'job-1', 'visit-1');
    expect(carers.map((c) => c.id)).toEqual(['mine']);
  });
});
