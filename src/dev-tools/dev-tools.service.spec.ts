import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DevToolsService } from './dev-tools.service';
import type { IaApiAutofillService } from './ia-api-autofill.service';
import type { PrismaService } from '../prisma/prisma.service';

const QA_SU_ID = '11111111-1111-4111-8111-111111111111';
const REAL_SU_ID = '22222222-2222-4222-8222-222222222222';

const generated = {
  answers: [{ questionId: 'q1', textValue: 'generated' }],
  metadata: { waterlow: { score: 18 } },
  profilePatch: {},
};

function makeService(opts: {
  nodeEnv: string;
  findFirst?: jest.Mock;
  generateSection?: jest.Mock;
}) {
  const generateSection =
    opts.generateSection ?? jest.fn().mockResolvedValue(generated);
  const findFirst = opts.findFirst ?? jest.fn();
  const iaApiAutofill = { generateSection } as unknown as IaApiAutofillService;
  const prisma = {
    serviceUser: { findFirst },
    initialAssessmentAnswer: { create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    initialAssessmentSubmission: { create: jest.fn(), update: jest.fn() },
  } as unknown as PrismaService;
  const config = {
    get: (key: string) => (key === 'app.nodeEnv' ? opts.nodeEnv : undefined),
  } as unknown as ConfigService;
  return {
    service: new DevToolsService(iaApiAutofill, prisma, config),
    generateSection,
    findFirst,
    prisma,
  };
}

describe('DevToolsService.generateIaSection', () => {
  it('returns generated values without persisting IA answers (non-production)', async () => {
    const { service, generateSection, findFirst, prisma } = makeService({
      nodeEnv: 'test',
    });

    const result = await service.generateIaSection('critical', 10, ['q1'], null, QA_SU_ID);

    expect(result).toEqual(generated);
    expect(generateSection).toHaveBeenCalledWith('critical', 10, ['q1'], null);
    expect(findFirst).not.toHaveBeenCalled();
    expect(prisma.initialAssessmentAnswer.create).not.toHaveBeenCalled();
    expect(prisma.initialAssessmentAnswer.update).not.toHaveBeenCalled();
    expect(prisma.initialAssessmentAnswer.upsert).not.toHaveBeenCalled();
    expect(prisma.initialAssessmentSubmission.create).not.toHaveBeenCalled();
    expect(prisma.initialAssessmentSubmission.update).not.toHaveBeenCalled();
  });

  it('in production allows the designated QA Service User SU-1042', async () => {
    const { service, generateSection, findFirst } = makeService({
      nodeEnv: 'production',
      findFirst: jest.fn().mockResolvedValue({ serviceUserNumber: 'SU-1042' }),
    });

    await expect(
      service.generateIaSection('normal', 1, [], undefined, QA_SU_ID),
    ).resolves.toEqual(generated);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: QA_SU_ID, deletedAt: null },
      select: { serviceUserNumber: true },
    });
    expect(generateSection).toHaveBeenCalledTimes(1);
  });

  it('in production rejects a non-designated real Service User', async () => {
    const { service, generateSection, findFirst } = makeService({
      nodeEnv: 'production',
      findFirst: jest.fn().mockResolvedValue({ serviceUserNumber: 'SU-9999' }),
    });

    await expect(
      service.generateIaSection('critical', 10, ['q1'], null, REAL_SU_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).toHaveBeenCalled();
    expect(generateSection).not.toHaveBeenCalled();
  });

  it('in production rejects persona numbers that are not the designated QA SU', async () => {
    const { service, generateSection } = makeService({
      nodeEnv: 'production',
      findFirst: jest.fn().mockResolvedValue({ serviceUserNumber: 'SU-TEST-P01' }),
    });

    await expect(
      service.generateIaSection('low', 5, [], null, REAL_SU_ID),
    ).rejects.toThrow('QA Demo Data is only allowed for designated QA Service Users.');
    expect(generateSection).not.toHaveBeenCalled();
  });

  it('in production rejects a missing serviceUserId', async () => {
    const { service, generateSection, findFirst } = makeService({ nodeEnv: 'production' });

    await expect(service.generateIaSection('low', 5, [])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findFirst).not.toHaveBeenCalled();
    expect(generateSection).not.toHaveBeenCalled();
  });

  it('in production rejects an unknown Service User id', async () => {
    const { service, generateSection } = makeService({
      nodeEnv: 'production',
      findFirst: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.generateIaSection('critical', 10, [], null, REAL_SU_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(generateSection).not.toHaveBeenCalled();
  });
});
