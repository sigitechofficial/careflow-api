import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FormSelectionService } from './form-selection.service';

const CARE_PLAN = '11111111-1111-4111-8111-111111111111';
const BED_RAIL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHOKING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function setup(
  opts: {
    carePlan?: boolean;
    assessmentIds?: string[];
    before?: string[];
  } = {},
) {
  const tx = {
    carePlanRequiredAssessment: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (opts.before ?? []).map((assessmentFormId) => ({ assessmentFormId })),
        ),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    carePathwayForm: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.carePlan === false ? null : { id: CARE_PLAN, name: 'Falls' },
        ),
      findMany: jest
        .fn()
        .mockResolvedValue((opts.assessmentIds ?? []).map((id) => ({ id }))),
    },
    carePlanRequiredAssessment: {
      findMany: jest.fn().mockResolvedValue([
        { carePlanFormId: CARE_PLAN, assessmentFormId: BED_RAIL },
        { carePlanFormId: CARE_PLAN, assessmentFormId: CHOKING },
      ]),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { logAudit: jest.fn().mockResolvedValue(undefined) };
  const service = new FormSelectionService(prisma as never, audit as never);
  return { service, prisma, tx, audit };
}

describe('care plan required assessments (Care pathway settings)', () => {
  it('groups the configured assessments by care plan', async () => {
    const { service } = setup();
    await expect(service.getCarePlanRequiredAssessments()).resolves.toEqual({
      data: [
        { carePlanFormId: CARE_PLAN, assessmentFormIds: [BED_RAIL, CHOKING] },
      ],
    });
  });

  it('replaces the list for one care plan and audits the change', async () => {
    const { service, tx, audit } = setup({
      assessmentIds: [BED_RAIL, CHOKING],
      before: [BED_RAIL],
    });
    const result = await service.setCarePlanRequiredAssessments(
      'user-1',
      CARE_PLAN,
      {
        assessmentFormIds: [BED_RAIL, CHOKING, BED_RAIL],
      },
    );
    expect(tx.carePlanRequiredAssessment.deleteMany).toHaveBeenCalledWith({
      where: {
        carePlanFormId: CARE_PLAN,
        assessmentFormId: { notIn: [BED_RAIL, CHOKING] },
      },
    });
    expect(tx.carePlanRequiredAssessment.createMany).toHaveBeenCalledWith({
      data: [
        {
          carePlanFormId: CARE_PLAN,
          assessmentFormId: BED_RAIL,
          createdById: 'user-1',
        },
        {
          carePlanFormId: CARE_PLAN,
          assessmentFormId: CHOKING,
          createdById: 'user-1',
        },
      ],
      skipDuplicates: true,
    });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'care_plan_required_assessments_updated',
        recordId: CARE_PLAN,
        oldValues: { assessmentFormIds: [BED_RAIL] },
        newValues: { assessmentFormIds: [BED_RAIL, CHOKING] },
      }),
    );
    expect(result.data).toEqual({
      carePlanFormId: CARE_PLAN,
      assessmentFormIds: [BED_RAIL, CHOKING],
    });
  });

  it('clears the list with an empty array', async () => {
    const { service, tx } = setup({ before: [BED_RAIL] });
    await service.setCarePlanRequiredAssessments('user-1', CARE_PLAN, {
      assessmentFormIds: [],
    });
    expect(tx.carePlanRequiredAssessment.deleteMany).toHaveBeenCalledWith({
      where: { carePlanFormId: CARE_PLAN, assessmentFormId: { notIn: [] } },
    });
    expect(tx.carePlanRequiredAssessment.createMany).not.toHaveBeenCalled();
  });

  it('rejects an unknown care plan and forms that are not assessments', async () => {
    await expect(
      setup({ carePlan: false }).service.setCarePlanRequiredAssessments(
        'u',
        CARE_PLAN,
        { assessmentFormIds: [] },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Only one of the two ids is an active ASSESSMENT form.
    const { service, prisma } = setup({ assessmentIds: [BED_RAIL] });
    await expect(
      service.setCarePlanRequiredAssessments('u', CARE_PLAN, {
        assessmentFormIds: [BED_RAIL, CHOKING],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
