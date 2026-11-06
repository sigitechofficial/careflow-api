import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PolicyStatus } from '@prisma/client';
import { PolicyLibraryService } from './policy-library.service';

const user = { id: 'u1', roles: ['Admin'] } as never;

const catalogueDoc = {
  id: 'lib-1',
  title: 'Safeguarding Adults Policy',
  description: 'Summary',
  documentType: 'POLICY',
  primaryCategoryId: 'cat-1',
  currentVersionId: 'lib-v1',
  primaryCategory: { id: 'cat-1', name: 'Safeguarding', code: 'SAFEGUARDING', displayOrder: 10 },
};

const libraryVersion = (revision: number) => ({
  contentHtml: '<p>{{organisation}} protects people.</p>',
  contentJson: {
    type: 'library',
    version: 2,
    researchedOn: '2026-11-05',
    wordCount: 5000,
    policy: {
      reference: 'POL-SG-001',
      revision,
      revisionNote: revision > 1 ? 'Updated for the new CQC framework' : undefined,
      title: 'Safeguarding Adults Policy',
      summary: 'Summary',
      keyPoints: { intro: 'In brief', points: [] },
      reviewFrequencyMonths: 12,
      acknowledgementRequired: true,
      audience: ['ALL_EMPLOYEES'],
      moduleLinks: ['SAFEGUARDING'],
      relatedReferences: [],
      regulatoryBasis: [],
      sections: [],
    },
  },
});

function setup(opts: { revision: number; adoptedRevision: number | null; inProgress?: PolicyStatus | null }) {
  const prisma = {
    policyDocument: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; isCatalogue: boolean } }) =>
        where.isCatalogue
          ? catalogueDoc
          : { id: where.id, libraryDocumentId: 'lib-1', libraryRevision: opts.adoptedRevision },
      ),
      update: jest.fn(async () => ({})),
    },
    policyVersion: {
      findUnique: jest.fn(async () => libraryVersion(opts.revision)),
      findFirst: jest.fn(async () => (opts.inProgress ? { status: opts.inProgress } : null)),
    },
    companyProfile: { findFirst: jest.fn(async () => ({ companyName: 'Allfor Care & Co' })) },
  };
  const policies = { createVersion: jest.fn(async () => ({})), update: jest.fn(async () => ({})) };
  const service = new PolicyLibraryService(prisma as never, policies as never);
  return { service, prisma, policies };
}

describe('PolicyLibraryService updates', () => {
  it('reports an update when the library revision is newer than the adopted one', async () => {
    const { service } = setup({ revision: 2, adoptedRevision: 1 });
    const { data } = await service.forPolicy('p1');
    expect(data).toMatchObject({ adoptedRevision: 1, currentRevision: 2, updateAvailable: true, revisionNote: 'Updated for the new CQC framework' });
  });

  it('reports no update when the policy is on the latest revision', async () => {
    const { service } = setup({ revision: 2, adoptedRevision: 2 });
    expect((await service.forPolicy('p1')).data).toMatchObject({ updateAvailable: false });
  });

  it('starts a new major version, fills in the organisation and records the revision', async () => {
    const { service, policies, prisma } = setup({ revision: 2, adoptedRevision: 1 });
    await service.applyUpdate(user, 'p1');
    expect(policies.createVersion).toHaveBeenCalledWith(user, 'p1', expect.objectContaining({ bump: 'major' }), undefined);
    expect(policies.update).toHaveBeenCalledWith(
      user,
      'p1',
      expect.objectContaining({ contentHtml: '<p>Allfor Care &amp; Co protects people.</p>' }),
      undefined,
    );
    expect(prisma.policyDocument.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { libraryRevision: 2 } });
  });

  it('puts the update into an existing draft without creating another version', async () => {
    const { service, policies } = setup({ revision: 2, adoptedRevision: 1, inProgress: PolicyStatus.DRAFT });
    await service.applyUpdate(user, 'p1');
    expect(policies.createVersion).not.toHaveBeenCalled();
    expect(policies.update).toHaveBeenCalled();
  });

  it('refuses while a version is in review, and when already up to date', async () => {
    await expect(setup({ revision: 2, adoptedRevision: 1, inProgress: PolicyStatus.IN_REVIEW }).service.applyUpdate(user, 'p1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(setup({ revision: 1, adoptedRevision: 1 }).service.applyUpdate(user, 'p1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a policy that was not adopted from the library', async () => {
    const { service, prisma } = setup({ revision: 2, adoptedRevision: 1 });
    prisma.policyDocument.findFirst.mockResolvedValueOnce({ id: 'p1', libraryDocumentId: null, libraryRevision: null } as never);
    await expect(service.applyUpdate(user, 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
