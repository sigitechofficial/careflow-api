import { managerCopyTeamProblem, managerCopyTeamProblemFor, readManagerCopy } from './survey-manager-copy-team';

const counts = (o: Record<string, number>) => new Map(Object.entries(o));

describe('a copy made for each manager: its team is checked again at send or open', () => {
  it('a manager’s own copy is refused once fewer than its minimum team are still named under them', () => {
    const own = { managerUserIds: ['sam'], pooled: false, minTeam: 10 };
    expect(managerCopyTeamProblem(own, counts({ sam: 10 }))).toBeNull();
    expect(managerCopyTeamProblem(own, counts({ sam: 9 }))).toMatch(/^Fewer than 10 of this manager’s staff are still named under them.*Make the copies again/);
    // Never below 5, whatever is stored.
    expect(managerCopyTeamProblem(readManagerCopy({ managerUserIds: ['sam'], minTeam: 2 })!, counts({ sam: 4 }))).toMatch(/^Fewer than 5/);
  });

  it('the pooled copy follows the pool rules: 3+ managers with staff, the minimum in all, none over half', () => {
    const pool = { managerUserIds: ['a', 'b', 'c'], pooled: true, minTeam: 5 };
    expect(managerCopyTeamProblem(pool, counts({ a: 2, b: 2, c: 2 }))).toBeNull();
    expect(managerCopyTeamProblem(pool, counts({ a: 3, b: 2, c: 0 }))).toMatch(/fewer than 3 managers/);
    expect(managerCopyTeamProblem(pool, counts({ a: 2, b: 1, c: 1 }))).toMatch(/fewer than 5 people/);
    expect(managerCopyTeamProblem(pool, counts({ a: 4, b: 1, c: 1 }))).toMatch(/more than half/);
  });

  it('reads the copy’s record; every other survey is never checked', async () => {
    expect(readManagerCopy(null)).toBeNull();
    expect(readManagerCopy({ managerUserIds: [] })).toBeNull();
    const db: any = {
      survey: { findUnique: jest.fn(async () => ({ managerCopy: null, audienceEmployeeIds: ['e1'] })) },
      employeeEmployment: { findMany: jest.fn() },
    };
    expect(await managerCopyTeamProblemFor(db, 's1')).toBeNull();
    expect(db.employeeEmployment.findMany).not.toHaveBeenCalled();
  });

  it('counts only the copy’s staff who are still active and still named under the rated manager', async () => {
    const db: any = {
      survey: {
        findUnique: jest.fn(async () => ({ managerCopy: { managerUserIds: ['sam'], pooled: false, minTeam: 5 }, audienceEmployeeIds: ['e1', 'e2', 'e3', 'e4', 'e5'] })),
      },
      // One has left (or moved to another manager): only 4 are found.
      employeeEmployment: { findMany: jest.fn(async () => [1, 2, 3, 4].map(() => ({ supervisorUserId: 'sam' }))) },
    };
    expect(await managerCopyTeamProblemFor(db, 's1')).toMatch(/^Fewer than 5/);
    expect(db.employeeEmployment.findMany.mock.calls[0][0].where).toEqual({
      employeeId: { in: ['e1', 'e2', 'e3', 'e4', 'e5'] },
      supervisorUserId: { in: ['sam'] },
      employee: { deletedAt: null, isActive: true },
    });
  });

  it('a send to a few chosen people is checked on who it actually reaches, not the saved list', async () => {
    const db: any = {
      survey: {
        findUnique: jest.fn(async () => ({ managerCopy: { managerUserIds: ['sam'], pooled: false, minTeam: 5 }, audienceEmployeeIds: ['e1', 'e2', 'e3', 'e4', 'e5'] })),
      },
      employeeEmployment: { findMany: jest.fn(async ({ where }: any) => where.employeeId.in.map(() => ({ supervisorUserId: 'sam' }))) },
    };
    expect(await managerCopyTeamProblemFor(db, 's1')).toBeNull();
    expect(await managerCopyTeamProblemFor(db, 's1', ['e1', 'e2'])).toMatch(/^Fewer than 5/);
    expect(db.employeeEmployment.findMany.mock.calls[1][0].where.employeeId).toEqual({ in: ['e1', 'e2'] });
  });
});
