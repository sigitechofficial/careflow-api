import { usersWithResultsAccess } from './survey-office-recipients';

jest.mock('./survey-access', () => ({
  ACCESS_SELECT: {},
  surveyAccessFor: jest.fn(async () => ({ results: true })),
}));

/** Notices about a survey's answers reach only people who could see its results, branches included. */
describe('usersWithResultsAccess', () => {
  const user = (id: string, roles: string[], locations: string[] = []) => ({
    id,
    email: `${id}@example.org`,
    userRoles: roles.map((name) => ({ role: { name } })),
    userLocations: locations.map((locationId) => ({ locationId })),
  });

  function db(survey: { locationIds: string[] }, employment: Record<string, string | null>) {
    return {
      survey: { findUnique: jest.fn(async () => ({ id: 's1', isTemplate: false, ...survey })) },
      user: {
        findMany: jest.fn(async ({ where }: any) =>
          [user('admin', ['Super Admin']), user('given-a', ['Manager'], ['branch-a']), user('employed-b', ['Manager']), user('no-branch', ['Care Coordinator'])].filter((u) =>
            where.id.in.includes(u.id),
          ),
        ),
      },
      employeePersonalDetail: {
        findFirst: jest.fn(async ({ where }: any) => {
          const loc = employment[where.email.equals];
          return loc === undefined ? null : { employee: { employment: { locationId: loc, baseLocationId: null, floorLocations: [] } } };
        }),
      },
    } as any;
  }

  it('a user limited to branches by their employment (no branches on the account) is not told about other branches', async () => {
    const out = await usersWithResultsAccess(db({ locationIds: ['branch-a'] }, { 'employed-b@example.org': 'branch-b' }), 's1', ['admin', 'given-a', 'employed-b', 'no-branch']);
    expect(out.sort()).toEqual(['admin', 'given-a']);
  });

  it('a survey for every branch reaches only people who see every branch', async () => {
    const out = await usersWithResultsAccess(db({ locationIds: [] }, { 'employed-b@example.org': 'branch-b' }), 's1', ['admin', 'given-a', 'employed-b', 'no-branch']);
    expect(out).toEqual(['admin']);
  });

  it("a user employed in the survey's branch is told", async () => {
    const out = await usersWithResultsAccess(db({ locationIds: ['branch-b'] }, { 'employed-b@example.org': 'branch-b' }), 's1', ['employed-b']);
    expect(out).toEqual(['employed-b']);
  });
});
