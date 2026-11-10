import { MedicationAllergiesService, medicationAllergyComment } from './medication-allergies.service';

describe('medicine allergies use the one allergy list', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    serviceUserId: 'su1',
    allergyCatalogId: 'cat-pen',
    allergyName: 'Penicillin',
    comment: 'Rash',
    isActive: true,
    deletedAt: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    allergyCatalog: { category: 'MEDICATION' },
    ...over,
  });

  function setup(existing: unknown = null) {
    const prisma = {
      serviceUser: { findFirst: jest.fn(async () => ({ id: 'su1' })) },
      allergyCatalog: {
        findMany: jest.fn(async () => [{ name: 'Penicillin' }]),
        findFirst: jest.fn(async () => ({ id: 'cat-pen', name: 'Penicillin' })),
      },
      serviceUserAllergy: {
        findMany: jest.fn(async () => [row()]),
        findFirst: jest.fn(async () => existing),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => row({ ...data, id: 'new' })),
        update: jest.fn(async () => row()),
      },
    };
    const audit = { logAudit: jest.fn(async () => undefined) };
    return { prisma, audit, service: new MedicationAllergiesService(prisma as never, audit as never) };
  }

  it('lists medicine allergies from the profile allergy list', async () => {
    const { service, prisma } = setup();
    const rows = await service.list('su1');
    expect(rows).toEqual([expect.objectContaining({ id: 'a1', allergyName: 'Penicillin', notes: 'Rash' })]);
    expect(prisma.serviceUserAllergy.findMany).toHaveBeenCalled();
  });

  it('adds to the profile allergy list, linked to the catalogue', async () => {
    const { service, prisma } = setup();
    await service.create('u1', 'su1', { allergyName: 'penicillin', reaction: 'Swelling' }, {});
    expect(prisma.serviceUserAllergy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ allergyCatalogId: 'cat-pen', allergyName: 'Penicillin', comment: 'Reaction: Swelling' }),
      }),
    );
  });

  it('does not add the same allergy twice', async () => {
    const { service, prisma } = setup(row());
    const out = await service.create('u1', 'su1', { allergyName: 'Penicillin' }, {});
    expect(out.id).toBe('a1');
    expect(prisma.serviceUserAllergy.create).not.toHaveBeenCalled();
  });

  it('builds a readable comment', () => {
    expect(medicationAllergyComment({ reaction: 'Rash', severity: 'Severe', notes: 'Seen by GP' })).toBe(
      'Reaction: Rash. Severity: Severe. Seen by GP',
    );
    expect(medicationAllergyComment({})).toBe('Recorded from the Meds tab');
  });
});
