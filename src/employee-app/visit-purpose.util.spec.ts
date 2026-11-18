import { visitPurposeForJob } from './visit-purpose.util';

function prismaWith(job: unknown, exception: unknown = null) {
  return {
    scheduledJob: { findFirst: jest.fn().mockResolvedValue(job) },
    visitPlanSlotException: { findFirst: jest.fn().mockResolvedValue(exception) },
  } as never;
}

describe('visitPurposeForJob', () => {
  it('a regular visit shows what the plan says it is for', async () => {
    const prisma = prismaWith({ metadata: { visitPlanId: 'p' }, visits: [{ visitPlanSlot: { notes: '  Weekly shopping trip ' } }] });
    await expect(visitPurposeForJob(prisma, 'j')).resolves.toEqual({ text: 'Weekly shopping trip', source: 'regular' });
  });

  it('an extra visit shows the reason it was added', async () => {
    const prisma = prismaWith(
      { metadata: { visitPlanExtra: true, visitPlanExceptionId: 'e' }, visits: [{ visitPlanSlot: { notes: 'Morning call' } }] },
      { notes: 'Escort to hospital appointment' },
    );
    await expect(visitPurposeForJob(prisma, 'j')).resolves.toEqual({ text: 'Escort to hospital appointment', source: 'extra' });
  });

  it('nothing written, or not a plan visit: null', async () => {
    await expect(visitPurposeForJob(prismaWith({ metadata: {}, visits: [{ visitPlanSlot: { notes: '' } }] }), 'j')).resolves.toBeNull();
    await expect(visitPurposeForJob(prismaWith({ metadata: null, visits: [] }), 'j')).resolves.toBeNull();
    await expect(visitPurposeForJob(prismaWith(null), 'j')).resolves.toBeNull();
  });
});
