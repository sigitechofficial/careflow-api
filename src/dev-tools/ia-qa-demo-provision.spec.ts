import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import {
  IA_QA_DEMO_SERVICE_USER_NOTES,
  INITIAL_ASSESSMENT_DEMO_SU_NUMBER,
  seedInitialAssessmentDemoServiceUser,
} from '../../prisma/seeds/initial-assessment-demo-service-user.seed';

const EXISTING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATED_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOOKUP_IDS = {
  title: 'title-mrs',
  gender: 'gender-female',
  status: 'status-active',
  care: 'care-dom',
  daughter: 'rel-daughter',
};

function makePrisma(opts: {
  existing: { id: string } | null;
  daughter?: { id: string } | null;
  aboutRef?: { id: string } | null;
}) {
  const forbidden = jest.fn(() => {
    throw new Error('IA QA Demo provision must not call this Prisma method');
  });

  const prisma = {
    serviceUserTitle: {
      findUnique: jest.fn().mockResolvedValue({ id: LOOKUP_IDS.title }),
    },
    serviceUserGender: {
      findUnique: jest.fn().mockResolvedValue({ id: LOOKUP_IDS.gender }),
    },
    serviceUserStatus: {
      findUnique: jest.fn().mockResolvedValue({ id: LOOKUP_IDS.status }),
    },
    serviceUserCareType: {
      findUnique: jest.fn().mockResolvedValue({ id: LOOKUP_IDS.care }),
    },
    relationshipType: {
      findUnique: jest.fn().mockResolvedValue({ id: LOOKUP_IDS.daughter }),
    },
    serviceUser: {
      findFirst: jest.fn().mockResolvedValue(opts.existing),
      findMany: forbidden,
      create: jest.fn().mockResolvedValue({ id: CREATED_ID }),
      update: jest.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id }),
      ),
      delete: forbidden,
      deleteMany: forbidden,
    },
    serviceUserAddress: {
      upsert: jest.fn().mockResolvedValue({}),
      delete: forbidden,
      deleteMany: forbidden,
    },
    serviceUserContact: {
      findFirst: jest.fn().mockResolvedValue(opts.daughter ?? null),
      create: jest.fn().mockResolvedValue({ id: 'contact-1' }),
      delete: forbidden,
      deleteMany: forbidden,
    },
    serviceUserDomCare: {
      upsert: jest.fn().mockResolvedValue({}),
      delete: forbidden,
      deleteMany: forbidden,
    },
    serviceUserReference: {
      findFirst: jest.fn().mockResolvedValue(opts.aboutRef ?? null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: forbidden,
      deleteMany: forbidden,
    },
    bodyMapRecord: { deleteMany: forbidden, create: forbidden, createMany: forbidden },
    bodyMapAlert: { deleteMany: forbidden, create: forbidden },
    serviceUserPersona: { create: forbidden },
  };

  return prisma as unknown as PrismaClient & typeof prisma;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function scriptSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../../prisma/scripts/provision-ia-qa-demo-user.ts'),
    'utf8',
  );
}

function helperSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../../prisma/seeds/initial-assessment-demo-service-user.seed.ts'),
    'utf8',
  );
}

describe('IA QA Demo SU-1042 provision', () => {
  const previousSeedDemo = process.env.SEED_DEMO_DATA;

  afterEach(() => {
    if (previousSeedDemo === undefined) delete process.env.SEED_DEMO_DATA;
    else process.env.SEED_DEMO_DATA = previousSeedDemo;
  });

  it('targets only the designated Service User number SU-1042', () => {
    expect(INITIAL_ASSESSMENT_DEMO_SU_NUMBER).toBe('SU-1042');
    expect(IA_QA_DEMO_SERVICE_USER_NOTES).toMatch(/QA\/demo/i);
  });

  it('does not require SEED_DEMO_DATA', async () => {
    delete process.env.SEED_DEMO_DATA;
    const prisma = makePrisma({ existing: null });
    await expect(seedInitialAssessmentDemoServiceUser(prisma)).resolves.toBe(CREATED_ID);
  });

  it('creates SU-1042 when none exists and never selects another Service User', async () => {
    const prisma = makePrisma({ existing: null });
    const id = await seedInitialAssessmentDemoServiceUser(prisma);

    expect(id).toBe(CREATED_ID);
    expect(prisma.serviceUser.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.serviceUser.findFirst).toHaveBeenCalledWith({
      where: { serviceUserNumber: 'SU-1042' },
    });
    expect(prisma.serviceUser.findMany).not.toHaveBeenCalled();
    expect(prisma.serviceUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serviceUserNumber: 'SU-1042',
        firstName: 'Margaret',
        lastName: 'Hughes',
        notes: IA_QA_DEMO_SERVICE_USER_NOTES,
        email: 'margaret.hughes.demo@careflow.local',
      }),
    });
    const createWhere = (prisma.serviceUser.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(createWhere).not.toHaveProperty('id');
    expect(JSON.stringify(createWhere)).not.toMatch(/orderBy|createdAt|oldest/i);
  });

  it('updates an existing SU-1042 idempotently without creating a second user', async () => {
    const prisma = makePrisma({
      existing: { id: EXISTING_ID },
      daughter: { id: 'contact-existing' },
      aboutRef: { id: 'about-existing' },
    });

    const id = await seedInitialAssessmentDemoServiceUser(prisma);

    expect(id).toBe(EXISTING_ID);
    expect(prisma.serviceUser.create).not.toHaveBeenCalled();
    expect(prisma.serviceUser.update).toHaveBeenCalledWith({
      where: { id: EXISTING_ID },
      data: expect.objectContaining({
        notes: IA_QA_DEMO_SERVICE_USER_NOTES,
        deletedAt: null,
        isActive: true,
      }),
    });
    expect(prisma.serviceUserAddress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serviceUserId: EXISTING_ID } }),
    );
    expect(prisma.serviceUserContact.create).not.toHaveBeenCalled();
    expect(prisma.serviceUserReference.update).toHaveBeenCalledWith({
      where: { id: 'about-existing' },
      data: expect.objectContaining({ referenceValue: expect.any(String) }),
    });
  });

  it('never deletes a Service User', async () => {
    const prisma = makePrisma({ existing: { id: EXISTING_ID } });
    await seedInitialAssessmentDemoServiceUser(prisma);
    expect(prisma.serviceUser.delete).not.toHaveBeenCalled();
    expect(prisma.serviceUser.deleteMany).not.toHaveBeenCalled();
  });

  it('does not reset body-map data', async () => {
    const prisma = makePrisma({ existing: { id: EXISTING_ID } });
    await seedInitialAssessmentDemoServiceUser(prisma);
    expect(prisma.bodyMapRecord.deleteMany).not.toHaveBeenCalled();
    expect(prisma.bodyMapRecord.create).not.toHaveBeenCalled();
    expect(prisma.bodyMapAlert.deleteMany).not.toHaveBeenCalled();
  });

  it('provision script only calls the SU-1042 helper and cannot touch personas, overlay, or body-map', () => {
    const src = stripComments(scriptSource());
    expect(src).toContain('seedInitialAssessmentDemoServiceUser');
    expect(src).not.toMatch(/process\.env\.SEED_DEMO_DATA/);
    expect(src).not.toMatch(/applyCarePlanIaDemoOverlay/);
    expect(src).not.toMatch(/seedServiceUserPersonas/);
    expect(src).not.toMatch(/seedPersonaSchedule/);
    expect(src).not.toMatch(/resetAndSeedBodyMapDemo/);
    expect(src).not.toMatch(/seedDemoServiceUserData/);
    expect(src).not.toMatch(/prisma db seed/);
  });

  it('helper does not call overlay, personas, or oldest-SU fallbacks', () => {
    const src = stripComments(helperSource());
    expect(src).toContain('serviceUserNumber: INITIAL_ASSESSMENT_DEMO_SU_NUMBER');
    expect(src).not.toMatch(/applyCarePlanIaDemoOverlay/);
    expect(src).not.toMatch(/seedServiceUserPersonas/);
    expect(src).not.toMatch(/seedPersonaSchedule/);
    expect(src).not.toMatch(/resetAndSeedBodyMapDemo/);
    expect(src).not.toMatch(/orderBy:\s*\{\s*createdAt/);
    expect(src).not.toMatch(/process\.env\.SEED_DEMO_DATA/);
  });
});
