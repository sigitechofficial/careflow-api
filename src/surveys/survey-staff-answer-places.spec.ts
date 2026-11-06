import { employeeForWebUser, staffAnswerPlaces } from './survey-staff-answer-places';

describe('where staff answer without a personal link', () => {
  const prisma: any = {
    employeePortalAccount: { findMany: jest.fn(async () => [{ employeeId: 'e1' }]) },
    employeePersonalDetail: {
      findMany: jest.fn(async () => [
        { employeeId: 'e1', email: 'carer@example.com' },
        { employeeId: 'e2', email: 'Office@Example.com' },
        { employeeId: 'e3', email: null },
      ]),
    },
    user: { findMany: jest.fn(async () => [{ email: 'office@example.com' }]) },
  };

  it('carer app for an enabled app account, My surveys for a CareFlow login with the same email', async () => {
    const places = await staffAnswerPlaces(prisma, ['e1', 'e2', 'e3']);
    expect(places.get('e1')).toEqual({ app: true, web: false });
    expect(places.get('e2')).toEqual({ app: false, web: true });
    expect(places.get('e3')).toEqual({ app: false, web: false });
  });

  it('falls back to nothing known (carer app wording) when the lookup fails', async () => {
    const broken: any = { ...prisma, employeePortalAccount: { findMany: jest.fn(async () => { throw new Error('db'); }) } };
    expect((await staffAnswerPlaces(broken, ['e1'])).size).toBe(0);
  });

  it('a web login maps to one staff record only (none, or more than one with that email: none)', async () => {
    const one: any = { employeePersonalDetail: { findMany: jest.fn(async () => [{ employeeId: 'e2' }]) } };
    expect(await employeeForWebUser(one, 'office@example.com')).toBe('e2');
    const two: any = { employeePersonalDetail: { findMany: jest.fn(async () => [{ employeeId: 'e2' }, { employeeId: 'e5' }]) } };
    expect(await employeeForWebUser(two, 'office@example.com')).toBeNull();
    expect(await employeeForWebUser(one, '')).toBeNull();
  });
});
