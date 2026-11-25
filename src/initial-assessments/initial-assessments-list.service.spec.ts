import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { InitialAssessmentsListService } from './initial-assessments-list.service';
import { bucketForStatus, countBuckets, rowMatchesView } from './initial-assessment-list.util';

const ROLES: Record<string, string[]> = { u1: ['Manager', 'QA-SCH Role RO'], u2: ['Care Coordinator'] };
const person = (id: string, firstName: string) => ({
  id,
  firstName,
  lastName: 'Office',
  email: `${id}@x.test`,
  userRoles: (ROLES[id] ?? []).map((name) => ({ role: { name } })),
});

function su(
  id: string,
  opts: { active?: boolean; status?: string; overdue?: number; updatedAt?: string; startedBy?: string } = {},
) {
  return {
    id,
    firstName: id,
    lastName: 'Test',
    preferredName: null,
    serviceUserNumber: `SU-${id}`,
    isActive: opts.active ?? true,
    location: { id: 'loc-1', name: 'Greenwich' },
    initialAssessmentSubmissions: opts.status
      ? [
          {
            id: `ia-${id}`,
            status: opts.status,
            startedAt: null,
            submittedAt: null,
            reviewedAt: null,
            createdAt: new Date('2026-11-01T10:00:00Z'),
            updatedAt: new Date(opts.updatedAt ?? '2026-11-10T10:00:00Z'),
            createdBy: person(opts.startedBy ?? 'u1', 'Ann'),
            submittedBy: null,
            reviewedBy: null,
            _count: { actions: opts.overdue ?? 0 },
          },
        ]
      : [],
  };
}

function build(serviceUsers: unknown[]) {
  const findMany = jest.fn().mockResolvedValue(serviceUsers);
  const prisma = { serviceUser: { findMany } };
  const audit = { logAudit: jest.fn().mockResolvedValue(undefined) };
  const service = new InitialAssessmentsListService(
    prisma as never,
    new OrgScopeService({} as never),
    audit as never,
  );
  return { service, findMany, audit };
}

const admin = { id: 'admin', roles: ['Admin'], permissions: [] } as unknown as RequestUser;
const branchManager = {
  id: 'mgr',
  roles: ['Manager'],
  permissions: [],
  assignedLocationIds: ['loc-1'],
} as unknown as RequestUser;
const noBranchManager = {
  id: 'mgr2',
  roles: ['Manager'],
  permissions: [],
  assignedLocationIds: [],
} as unknown as RequestUser;

describe('initial assessment list buckets', () => {
  it('maps every status to one bucket', () => {
    expect(bucketForStatus('DRAFT')).toBe('in_progress');
    expect(bucketForStatus('IN_PROGRESS')).toBe('in_progress');
    expect(bucketForStatus('SUBMITTED')).toBe('waiting_review');
    expect(bucketForStatus('REVIEWED')).toBe('reviewed');
    expect(bucketForStatus('ARCHIVED')).toBe('archived');
    expect(bucketForStatus('CANCELLED')).toBe('cancelled');
    expect(bucketForStatus(null)).toBe('no_ia');
  });

  it('"all" hides archived and cancelled; overdue_actions matches any bucket with overdue actions', () => {
    expect(rowMatchesView({ bucket: 'archived', overdueActionCount: 0 }, 'all')).toBe(false);
    expect(rowMatchesView({ bucket: 'cancelled', overdueActionCount: 0 }, 'all')).toBe(false);
    expect(rowMatchesView({ bucket: 'reviewed', overdueActionCount: 0 }, 'all')).toBe(true);
    expect(rowMatchesView({ bucket: 'reviewed', overdueActionCount: 2 }, 'overdue_actions')).toBe(true);
    expect(rowMatchesView({ bucket: 'reviewed', overdueActionCount: 0 }, 'overdue_actions')).toBe(false);
  });

  it('counts cards', () => {
    expect(
      countBuckets([
        { bucket: 'in_progress', overdueActionCount: 0 },
        { bucket: 'waiting_review', overdueActionCount: 1 },
        { bucket: 'reviewed', overdueActionCount: 0 },
        { bucket: 'no_ia', overdueActionCount: 0 },
        { bucket: 'archived', overdueActionCount: 0 },
      ]),
    ).toEqual({ in_progress: 1, waiting_review: 1, reviewed: 1, overdue_actions: 1, no_ia: 1 });
  });
});

describe('InitialAssessmentsListService.list', () => {
  it('shows active service users with no IA, hides inactive ones with no IA, keeps inactive ones with an IA', async () => {
    const { service } = build([
      su('a', { status: 'IN_PROGRESS' }),
      su('b'),
      su('c', { active: false }),
      su('d', { active: false, status: 'REVIEWED' }),
    ]);
    const res = await service.list(admin, {});
    const ids = res.data.rows.map((r) => r.serviceUser.id).sort();
    expect(ids).toEqual(['a', 'b', 'd']);
    expect(res.data.counts).toEqual({ in_progress: 1, waiting_review: 0, reviewed: 1, overdue_actions: 0, no_ia: 1 });
  });

  it('filters by view and starter, newest IA first, and pages', async () => {
    const { service } = build([
      su('a', { status: 'SUBMITTED', updatedAt: '2026-11-05T00:00:00Z', startedBy: 'u1' }),
      su('b', { status: 'SUBMITTED', updatedAt: '2026-11-20T00:00:00Z', startedBy: 'u2' }),
      su('c', { status: 'REVIEWED', overdue: 2, startedBy: 'u1' }),
    ]);
    const waiting = await service.list(admin, { view: 'waiting_review' });
    expect(waiting.data.rows.map((r) => r.serviceUser.id)).toEqual(['b', 'a']);
    const overdue = await service.list(admin, { view: 'overdue_actions' });
    expect(overdue.data.rows.map((r) => r.serviceUser.id)).toEqual(['c']);
    const managers = await service.list(admin, { startedByRole: 'Manager' });
    expect(managers.data.rows.map((r) => r.serviceUser.id).sort()).toEqual(['a', 'c']);
    // Only real roles of people who started an IA; QA test roles are left out.
    expect(managers.data.startedByRoles).toEqual(['Care Coordinator', 'Manager']);
    expect(managers.data.counts.waiting_review).toBe(1);
    const page2 = await service.list(admin, { limit: 2, page: 2 });
    expect(page2.data.rows).toHaveLength(1);
    expect(page2.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it('sorts by last updated (default), started, or name; rows with no IA come last for date sorts', async () => {
    const rows = [
      { ...su('zed', { status: 'IN_PROGRESS', updatedAt: '2026-11-05T00:00:00Z' }), lastName: 'Zed' },
      { ...su('amy', { status: 'SUBMITTED', updatedAt: '2026-11-20T00:00:00Z' }), lastName: 'Amy' },
      { ...su('bob'), lastName: 'Bob' },
    ];
    rows[0].initialAssessmentSubmissions[0].startedAt = new Date('2026-11-15T00:00:00Z') as never;
    rows[1].initialAssessmentSubmissions[0].startedAt = new Date('2026-11-01T00:00:00Z') as never;
    const { service } = build(rows);
    const ids = async (sort?: 'updated' | 'started' | 'name') =>
      (await service.list(admin, sort ? { sort } : {})).data.rows.map((r) => r.serviceUser.id);
    expect(await ids()).toEqual(['amy', 'zed', 'bob']);
    expect(await ids('started')).toEqual(['zed', 'amy', 'bob']);
    expect(await ids('name')).toEqual(['amy', 'bob', 'zed']);
  });

  it('limits a branch manager to their branches', async () => {
    const { service, findMany } = build([]);
    await service.list(branchManager, {});
    const where = findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"loc-1"');
  });

  it('does not let a branch manager widen scope to another branch', async () => {
    const { service, findMany } = build([]);
    const res = await service.list(branchManager, { locationId: '00000000-0000-0000-0000-000000000009' });
    expect(findMany).not.toHaveBeenCalled();
    expect(res.data.rows).toEqual([]);
  });

  it('returns nothing for a branch-scoped user with no branches', async () => {
    const { service, findMany } = build([su('a', { status: 'DRAFT' })]);
    const res = await service.list(noBranchManager, {});
    expect(findMany).not.toHaveBeenCalled();
    expect(res.meta.total).toBe(0);
  });

  it('writes a view audit row', async () => {
    const { service, audit } = build([]);
    await service.list(admin, {});
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ recordType: 'InitialAssessmentList', userId: 'admin' }),
    );
  });
});
