import { PolicyStatus } from '@prisma/client';
import { catalogueReference, loadPolicyLibrary } from '../../prisma/seed-lib/policy-library';
import { catalogueRemoved, seedPolicyLibrary } from '../../prisma/seeds/policy-library.seed';

/**
 * The policy library seed runs on every deploy: it must create missing catalogue documents and refresh the ones still
 * in use, and never bring back (or change) one that was deleted, made inactive or archived.
 */
type Doc = {
  id: string;
  reference: string;
  isCatalogue: boolean;
  currentVersionId: string | null;
  deletedAt: Date | null;
  isActive: boolean;
  status: PolicyStatus;
  title: string;
};

function fakeDb(docs: Doc[]) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const versionUpdates: string[] = [];
  const created: string[] = [];
  const db: any = {
    policyCategory: {
      findFirst: jest.fn(async () => ({ id: 'cat-1' })),
      create: jest.fn(),
    },
    policyDocument: {
      findFirst: jest.fn(async ({ where }: any) => docs.find((d) => d.reference === where.reference) ?? null),
      create: jest.fn(async ({ data }: any) => {
        created.push(data.reference);
        return { id: `new-${data.reference}` };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        updates.push({ id: where.id, data });
        return {};
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    policyVersion: {
      create: jest.fn(async () => ({ id: 'v-new' })),
      update: jest.fn(async ({ where }: any) => {
        versionUpdates.push(where.id);
        return {};
      }),
    },
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  return { db, updates, versionUpdates, created };
}

describe('policy library seed: removed documents stay removed', () => {
  const [first] = loadPolicyLibrary();
  const documents = first!.documents.slice(0, 5);
  const files = [{ ...first!, documents }];
  const ref = (i: number) => catalogueReference(documents[i]!.reference);
  const doc = (i: number, over: Partial<Doc> = {}): Doc => ({
    id: `d${i}`,
    reference: ref(i),
    isCatalogue: true,
    currentVersionId: `v${i}`,
    deletedAt: null,
    isActive: true,
    status: PolicyStatus.APPROVED,
    title: 'Old title',
    ...over,
  });

  it('creates what is missing, refreshes what is in use, and leaves deleted, inactive and archived ones exactly as they are', async () => {
    expect(documents.length).toBe(5);
    const { db, updates, versionUpdates, created } = fakeDb([
      doc(0),
      doc(1, { deletedAt: new Date('2026-10-01T00:00:00Z'), isActive: false }),
      doc(2, { isActive: false }),
      doc(3, { status: PolicyStatus.ARCHIVED, isActive: false }),
      // doc 4 is missing
    ]);
    const res = await seedPolicyLibrary(db, files);
    expect(res).toMatchObject({ created: 1, updated: 1, keptRemoved: 3 });
    expect(created).toEqual([ref(4)]);
    // Only the document in use is refreshed: its content, never its deleted / active state.
    // (The new document's own update is its current version being set.)
    expect(updates.map((u) => u.id)).toEqual(['d0', `new-${ref(4)}`]);
    const refresh = updates.find((u) => u.id === 'd0')!.data;
    expect(refresh).toMatchObject({ title: documents[0]!.title });
    expect(refresh).not.toHaveProperty('deletedAt');
    expect(refresh).not.toHaveProperty('isActive');
    expect(versionUpdates).toEqual(['v0']);
    for (const id of ['d1', 'd2', 'd3']) expect(updates.some((u) => u.id === id)).toBe(false);
  });

  it('a second deploy changes nothing about the removed ones either', async () => {
    const removed = doc(1, { deletedAt: new Date('2026-10-01T00:00:00Z'), isActive: false });
    const { db, updates } = fakeDb([doc(0), removed, doc(2), doc(3), doc(4)]);
    await seedPolicyLibrary(db, files);
    await seedPolicyLibrary(db, files);
    expect(updates.some((u) => u.id === 'd1')).toBe(false);
    expect(removed).toMatchObject({ isActive: false });
    expect(removed.deletedAt).toEqual(new Date('2026-10-01T00:00:00Z'));
  });

  it('never touches an organisation’s own document with the same reference', async () => {
    const { db, updates, created } = fakeDb([doc(0, { isCatalogue: false })]);
    await seedPolicyLibrary(db, [{ ...first!, documents: documents.slice(0, 1) }]);
    expect(updates).toEqual([]);
    expect(created).toEqual([]);
  });

  it('retires only catalogue documents no longer in the library that are still in use', async () => {
    const { db } = fakeDb([]);
    await seedPolicyLibrary(db, files);
    expect(db.policyDocument.updateMany).toHaveBeenCalledWith({
      where: { isCatalogue: true, deletedAt: null, reference: { notIn: documents.map((d) => catalogueReference(d.reference)) } },
      data: { isActive: false, deletedAt: expect.any(Date) },
    });
  });

  it('an empty library (its folder missing from the deploy) retires nothing, as nothing retired comes back', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { db } = fakeDb([doc(0)]);
    const res = await seedPolicyLibrary(db, []);
    expect(res.retired).toBe(0);
    expect(db.policyDocument.updateMany).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('the rule', () => {
    expect(catalogueRemoved({ deletedAt: null, isActive: true, status: PolicyStatus.APPROVED })).toBe(false);
    expect(catalogueRemoved({ deletedAt: new Date(), isActive: true, status: PolicyStatus.APPROVED })).toBe(true);
    expect(catalogueRemoved({ deletedAt: null, isActive: false, status: PolicyStatus.APPROVED })).toBe(true);
    expect(catalogueRemoved({ deletedAt: null, isActive: true, status: PolicyStatus.ARCHIVED })).toBe(true);
  });
});
