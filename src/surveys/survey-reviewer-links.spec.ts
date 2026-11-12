import { findReviewerLinks } from './survey-reviewer-links';

function prisma(rows: { staff?: unknown[]; people?: unknown[]; contacts?: unknown[]; outside?: unknown[] }) {
  return {
    employeePersonalDetail: { findMany: jest.fn().mockResolvedValue(rows.staff ?? []) },
    serviceUser: { findMany: jest.fn().mockResolvedValue(rows.people ?? []) },
    serviceUserContact: { findMany: jest.fn().mockResolvedValue(rows.contacts ?? []) },
    surveyExternalContact: { findMany: jest.fn().mockResolvedValue(rows.outside ?? []) },
  } as never;
}

const person = { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' };

describe('reviewer links (previously involved with us)', () => {
  it('finds nothing for someone new', async () => {
    expect(await findReviewerLinks(prisma({}), person)).toEqual([]);
  });

  it('names former staff, a family contact and an outside contact, and how each matched', async () => {
    const links = await findReviewerLinks(
      prisma({
        staff: [{ employeeId: 'e1', firstName: 'Jane', lastName: 'Doe', email: 'old@allforcare.co.uk', employee: { isActive: false } }],
        contacts: [{ serviceUserId: 'su1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', serviceUser: { firstName: 'Mary', lastName: 'Smith' } }],
        outside: [{ id: 'x1', kind: 'PROFESSIONAL', name: 'Jane Doe', role: 'Social worker', email: null, serviceUserId: null }],
      }),
      person,
    );
    expect(links).toEqual([
      { kind: 'FORMER_STAFF', label: 'Former member of staff: Jane Doe', match: 'NAME', serviceUserIds: [], employeeIds: ['e1'] },
      { kind: 'FAMILY_CONTACT', label: 'Family or contact of Mary Smith', match: 'EMAIL', serviceUserIds: ['su1'], employeeIds: [] },
      { kind: 'OUTSIDE_CONTACT', label: 'Outside contact on our surveys: Jane Doe (Social worker)', match: 'NAME', serviceUserIds: [], employeeIds: [] },
    ]);
  });

  it('marks someone we support (or did) and ties them to their own record', async () => {
    const [link] = await findReviewerLinks(prisma({ people: [{ id: 'su9', firstName: 'Jane', lastName: 'Doe', email: null }] }), person);
    expect(link).toMatchObject({ kind: 'SERVICE_USER', serviceUserIds: ['su9'], match: 'NAME' });
  });
});
