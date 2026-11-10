import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReasonableAdjustmentType,
  ServiceUserMedicalConditionStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { MedicalConditionsService } from './medical-conditions.service';
import { MedicalHistoryService } from './medical-history.service';
import { MedicalSafetySummaryService } from './medical-safety-summary.service';
import { MonitoringConfigService } from './monitoring-config.service';
import { ReasonableAdjustmentsService } from './reasonable-adjustments.service';
import { UsualParametersService } from './usual-parameters.service';
import { SERVICE_USER_MONITORING_CONFIG_KEYS } from './medical-clinical.constants';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    email: 'manager@test',
    roles: ['Manager'],
    permissions: [
      'service_users.read',
      'service_users.medical_conditions.read',
      'service_users.medical_conditions.create',
      'service_users.medical_conditions.update',
      'service_users.medical_conditions.delete',
      'service_users.medical_adjustments.read',
      'service_users.medical_adjustments.create',
      'service_users.medical_adjustments.update',
      'service_users.medical_adjustments.delete',
      'service_users.medical_history.read',
      'service_users.medical_history.create',
      'service_users.medical_history.update',
      'service_users.medical_history.delete',
      'service_users.medical_monitoring.read',
      'service_users.medical_monitoring.update',
      'service_users.medical_usual_parameters.read',
      'service_users.medical_usual_parameters.update',
      'service_users.allergies.read',
    ],
    accountKind: 'user',
    assignedLocationIds: null,
    ...overrides,
  };
}

describe('Service Users Medical Phase 3', () => {
  const suId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const locA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const locB = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const conditionId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const obsTypeId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  let prisma: any;
  let orgScope: { fromRequestUser: jest.Mock; assertServiceUserInScope: jest.Mock };
  let audit: { logAudit: jest.Mock; getChangedFields: jest.Mock };
  let alertCreates: number;
  let observationMutations: number;

  let conditions: MedicalConditionsService;
  let adjustments: ReasonableAdjustmentsService;
  let history: MedicalHistoryService;
  let monitoring: MonitoringConfigService;
  let usual: UsualParametersService;
  let summary: MedicalSafetySummaryService;

  beforeEach(() => {
    alertCreates = 0;
    observationMutations = 0;

    const conditionRows = new Map<string, any>();
    const adjustmentRows = new Map<string, any>();
    const historyRows = new Map<string, any>();
    const monitoringRows = new Map<string, any>();
    const usualRows = new Map<string, any>();

    orgScope = {
      fromRequestUser: jest.fn((u: RequestUser) => ({
        assignedLocationIds: u.assignedLocationIds,
      })),
      assertServiceUserInScope: jest.fn(async (_scope, serviceUserId: string) => {
        if (serviceUserId === 'out-of-scope') {
          throw new NotFoundException('Service user not found');
        }
      }),
    };

    audit = {
      logAudit: jest.fn(async () => undefined),
      getChangedFields: jest.fn(() => []),
    };

    prisma = {
      serviceUser: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.id === 'missing') return null;
          if (where.id === 'out-of-scope') return null;
          return { id: where.id ?? suId, locationId: locA, deletedAt: null };
        }),
      },
      medicalConditionCatalog: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === conditionId
            ? { id: conditionId, code: 'DIABETES', name: 'Diabetes', isActive: true }
            : null,
        ),
        findMany: jest.fn(async () => [
          {
            id: conditionId,
            code: 'DIABETES',
            name: 'Diabetes',
            category: 'ENDOCRINE_METABOLIC',
            description: null,
            sortOrder: 1,
            isActive: true,
          },
        ]),
      },
      observationType: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === obsTypeId
            ? { id: obsTypeId, code: 'WEIGHT', name: 'Weight', isActive: true }
            : null,
        ),
      },
      serviceUserObservation: {
        create: jest.fn(async () => {
          observationMutations += 1;
          return {};
        }),
        update: jest.fn(async () => {
          observationMutations += 1;
          return {};
        }),
        updateMany: jest.fn(async () => {
          observationMutations += 1;
          return { count: 0 };
        }),
      },
      alert: {
        create: jest.fn(async () => {
          alertCreates += 1;
          return {};
        }),
        findMany: jest.fn(async () => []),
      },
      serviceUserMedicalCondition: {
        findMany: jest.fn(async () => [...conditionRows.values()].filter((r) => !r.deletedAt)),
        findFirst: jest.fn(async ({ where }: any) => {
          return (
            [...conditionRows.values()].find((r) => {
              if (r.deletedAt) return false;
              if (where.id && r.id !== where.id) return false;
              if (where.serviceUserId && r.serviceUserId !== where.serviceUserId) return false;
              if (where.conditionId && r.conditionId !== where.conditionId) return false;
              return true;
            }) ?? null
          );
        }),
        create: jest.fn(async ({ data }: any) => {
          if (
            [...conditionRows.values()].some(
              (r) =>
                r.serviceUserId === data.serviceUserId &&
                r.conditionId === data.conditionId,
            )
          ) {
            throw new Prisma.PrismaClientKnownRequestError('Unique', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
          const row = {
            id: randomUUID(),
            ...data,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            condition: {
              id: conditionId,
              code: 'DIABETES',
              name: 'Diabetes',
              category: 'ENDOCRINE_METABOLIC',
            },
          };
          conditionRows.set(row.id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = conditionRows.get(where.id);
          Object.assign(row, data, { updatedAt: new Date() });
          return {
            ...row,
            condition: {
              id: conditionId,
              code: 'DIABETES',
              name: 'Diabetes',
              category: 'ENDOCRINE_METABOLIC',
            },
          };
        }),
      },
      serviceUserReasonableAdjustment: {
        findMany: jest.fn(async () => [...adjustmentRows.values()].filter((r) => !r.deletedAt)),
        findFirst: jest.fn(async ({ where }: any) => {
          const row = adjustmentRows.get(where.id);
          if (!row || row.serviceUserId !== where.serviceUserId || row.deletedAt) return null;
          return row;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: randomUUID(),
            isActive: true,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          adjustmentRows.set(row.id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = adjustmentRows.get(where.id);
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        }),
      },
      serviceUserMedicalHistoryEvent: {
        findMany: jest.fn(async ({ orderBy }: any) => {
          const rows = [...historyRows.values()].filter((r) => !r.deletedAt);
          rows.sort((a, b) => {
            const ad = a.eventDate?.getTime?.() ?? 0;
            const bd = b.eventDate?.getTime?.() ?? 0;
            return bd - ad;
          });
          void orderBy;
          return rows;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const row = historyRows.get(where.id);
          if (!row || row.serviceUserId !== where.serviceUserId || row.deletedAt) return null;
          return row;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: randomUUID(),
            isActive: true,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          historyRows.set(row.id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = historyRows.get(where.id);
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        }),
      },
      serviceUserMonitoringConfig: {
        findMany: jest.fn(async () => [...monitoringRows.values()]),
        findUnique: jest.fn(async ({ where }: any) => {
          const key = where.serviceUserId_configKey;
          return (
            [...monitoringRows.values()].find(
              (r) => r.serviceUserId === key.serviceUserId && r.configKey === key.configKey,
            ) ?? null
          );
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: randomUUID(),
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          monitoringRows.set(row.id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = monitoringRows.get(where.id);
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        }),
      },
      serviceUserUsualParameter: {
        findMany: jest.fn(async () => [...usualRows.values()]),
        findUnique: jest.fn(async ({ where }: any) => {
          const key = where.serviceUserId_observationTypeId;
          return (
            [...usualRows.values()].find(
              (r) =>
                r.serviceUserId === key.serviceUserId &&
                r.observationTypeId === key.observationTypeId,
            ) ?? null
          );
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const row = usualRows.get(where.id);
          if (!row || row.serviceUserId !== where.serviceUserId) return null;
          return {
            ...row,
            observationType: { id: obsTypeId, code: 'WEIGHT', name: 'Weight' },
          };
        }),
        create: jest.fn(async ({ data }: any) => {
          if (
            [...usualRows.values()].some(
              (r) =>
                r.serviceUserId === data.serviceUserId &&
                r.observationTypeId === data.observationTypeId,
            )
          ) {
            throw new Prisma.PrismaClientKnownRequestError('Unique', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
          const row = {
            id: randomUUID(),
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            observationType: { id: obsTypeId, code: 'WEIGHT', name: 'Weight' },
          };
          usualRows.set(row.id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = usualRows.get(where.id);
          Object.assign(row, data, { updatedAt: new Date() });
          return {
            ...row,
            observationType: { id: obsTypeId, code: 'WEIGHT', name: 'Weight' },
          };
        }),
      },
      serviceUserAllergy: { findMany: jest.fn(async () => [{ id: 'alg-1', allergyName: 'Nuts', comment: 'Severe' }]) },
      medicationAllergy: { findMany: jest.fn(async () => []) },
      serviceUserFlashMessage: { findFirst: jest.fn(async () => null) },
      serviceUserLegalDocument: { findUnique: jest.fn(async () => null) },
      initialAssessmentRiskRecord: { findMany: jest.fn(async () => []) },
      bodyMapAlert: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    conditions = new MedicalConditionsService(
      prisma as PrismaService,
      audit as any,
      orgScope as unknown as OrgScopeService,
    );
    adjustments = new ReasonableAdjustmentsService(
      prisma as PrismaService,
      audit as any,
      orgScope as unknown as OrgScopeService,
    );
    history = new MedicalHistoryService(
      prisma as PrismaService,
      audit as any,
      orgScope as unknown as OrgScopeService,
    );
    monitoring = new MonitoringConfigService(
      prisma as PrismaService,
      audit as any,
      orgScope as unknown as OrgScopeService,
    );
    usual = new UsualParametersService(
      prisma as PrismaService,
      audit as any,
      orgScope as unknown as OrgScopeService,
    );
    summary = new MedicalSafetySummaryService(
      prisma as PrismaService,
      orgScope as unknown as OrgScopeService,
    );
  });

  describe('medical conditions', () => {
    it('1 create', async () => {
      const res = await conditions.create(makeUser(), suId, { conditionId });
      expect(res.data.conditionId).toBe(conditionId);
      expect(res.data.status).toBe(ServiceUserMedicalConditionStatus.ACTIVE);
      expect(alertCreates).toBe(0);
    });

    it('2 list', async () => {
      await conditions.create(makeUser(), suId, { conditionId });
      const list = await conditions.list(makeUser(), suId);
      expect(list.data.length).toBe(1);
    });

    it('3 update', async () => {
      const created = await conditions.create(makeUser(), suId, { conditionId });
      const updated = await conditions.update(makeUser(), suId, created.data.id, {
        notes: 'Reviewed',
      });
      expect(updated.data.notes).toBe('Reviewed');
    });

    it('4 discontinue/deactivate', async () => {
      const created = await conditions.create(makeUser(), suId, { conditionId });
      const disc = await conditions.discontinue(makeUser(), suId, created.data.id);
      expect(disc.data.status).toBe(ServiceUserMedicalConditionStatus.DISCONTINUED);
      expect(alertCreates).toBe(0);
    });

    it('5 duplicate → 409', async () => {
      await conditions.create(makeUser(), suId, { conditionId });
      await expect(conditions.create(makeUser(), suId, { conditionId })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('5b re-create after discontinue reactivates the same row', async () => {
      const created = await conditions.create(makeUser(), suId, { conditionId });
      await conditions.discontinue(makeUser(), suId, created.data.id);
      const again = await conditions.create(makeUser(), suId, { conditionId });
      expect(again.data.id).toBe(created.data.id);
      expect(again.data.status).toBe(ServiceUserMedicalConditionStatus.ACTIVE);
      expect(again.data.isActive).toBe(true);
      const list = await conditions.list(makeUser(), suId);
      expect(list.data).toHaveLength(1);
    });

    it('6 branch ACL', async () => {
      orgScope.assertServiceUserInScope.mockImplementation(async () => {
        throw new ForbiddenException('Out of scope');
      });
      await expect(conditions.list(makeUser({ assignedLocationIds: [locB] }), suId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('7 inaccessible SU', async () => {
      await expect(conditions.list(makeUser(), 'out-of-scope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('8 permission denied is enforced at controller/guard layer (service still requires ACL)', async () => {
      // Service layer always applies OrgScope; permission keys are guard-level.
      // Ensure missing SU still 404 even with empty permissions array.
      await expect(
        conditions.list(makeUser({ permissions: [] }), 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reasonable adjustments', () => {
    it('9 create', async () => {
      const res = await adjustments.create(makeUser(), suId, {
        type: ReasonableAdjustmentType.PHYSICAL_ACCESS,
        description: 'Ramp at the back door',
      });
      expect(res.data.type).toBe(ReasonableAdjustmentType.PHYSICAL_ACCESS);
      expect(alertCreates).toBe(0);
    });

    it('9b refuses communication and sensory adjustments (recorded in Privacy → Communication needs)', async () => {
      for (const type of [ReasonableAdjustmentType.COMMUNICATION, ReasonableAdjustmentType.SENSORY]) {
        await expect(adjustments.create(makeUser(), suId, { type, description: 'Large print' })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
    });

    it('10 update', async () => {
      const created = await adjustments.create(makeUser(), suId, {
        type: ReasonableAdjustmentType.OTHER,
        description: 'Quiet space',
      });
      const updated = await adjustments.update(makeUser(), suId, created.data.id, {
        description: 'Quiet room',
      });
      expect(updated.data.description).toBe('Quiet room');
    });

    it('11 list', async () => {
      await adjustments.create(makeUser(), suId, {
        type: ReasonableAdjustmentType.ROUTINE_TIMING,
        description: 'Visits after 9am',
      });
      const list = await adjustments.list(makeUser(), suId);
      expect(list.data.length).toBe(1);
    });

    it('12 ACL', async () => {
      orgScope.assertServiceUserInScope.mockRejectedValueOnce(new NotFoundException('Service user not found'));
      await expect(adjustments.list(makeUser(), suId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('medical history', () => {
    it('13 create', async () => {
      const res = await history.create(makeUser(), suId, {
        title: 'Hip replacement',
        eventDate: '2020-05-01',
      });
      expect(res.data.title).toBe('Hip replacement');
      expect(alertCreates).toBe(0);
    });

    it('14 list ordered correctly', async () => {
      await history.create(makeUser(), suId, { title: 'Older', eventDate: '2018-01-01' });
      await history.create(makeUser(), suId, { title: 'Newer', eventDate: '2022-01-01' });
      const list = await history.list(makeUser(), suId);
      expect(list.data[0].title).toBe('Newer');
      expect(list.data[1].title).toBe('Older');
    });

    it('15 update', async () => {
      const created = await history.create(makeUser(), suId, { title: 'Event' });
      const updated = await history.update(makeUser(), suId, created.data.id, {
        title: 'Updated event',
      });
      expect(updated.data.title).toBe('Updated event');
    });

    it('16 deactivate', async () => {
      const created = await history.create(makeUser(), suId, { title: 'Event' });
      const deactivated = await history.deactivate(makeUser(), suId, created.data.id);
      expect(deactivated.data.isActive).toBe(false);
    });

    it('17 ACL', async () => {
      orgScope.assertServiceUserInScope.mockRejectedValueOnce(new NotFoundException('Service user not found'));
      await expect(history.list(makeUser(), suId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('monitoring', () => {
    it('18 valid weight threshold', async () => {
      const res = await monitoring.upsert(makeUser(), suId, {
        configKey: SERVICE_USER_MONITORING_CONFIG_KEYS.WEIGHT_CHANGE_THRESHOLD_KG,
        numericValue: 2.5,
      });
      expect(res.data.numericValue).toBe(2.5);
      expect(alertCreates).toBe(0);
    });

    it('19 invalid threshold rejected', async () => {
      await expect(
        monitoring.upsert(makeUser(), suId, {
          configKey: SERVICE_USER_MONITORING_CONFIG_KEYS.WEIGHT_CHANGE_THRESHOLD_KG,
          numericValue: -1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('20 fluid target config', async () => {
      const res = await monitoring.upsert(makeUser(), suId, {
        configKey: SERVICE_USER_MONITORING_CONFIG_KEYS.FLUID_TARGET_REQUIRED,
        booleanValue: true,
      });
      expect(res.data.booleanValue).toBe(true);
    });

    it('21 unknown config key rejected', async () => {
      await expect(
        monitoring.upsert(makeUser(), suId, {
          configKey: 'MADE_UP_KEY',
          numericValue: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('21b medical alert YES/NO persists via textValue', async () => {
      const res = await monitoring.upsert(makeUser(), suId, {
        configKey: SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_CHOKING,
        textValue: 'YES',
      });
      expect(res.data.textValue).toBe('YES');
      expect(res.data.configKey).toBe('MEDICAL_ALERT_CHOKING');
      expect(alertCreates).toBe(0);
      const again = await monitoring.upsert(makeUser(), suId, {
        configKey: SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_CHOKING,
        textValue: 'NO',
      });
      expect(again.data.id).toBe(res.data.id);
      expect(again.data.textValue).toBe('NO');
    });

    it('21c medical alert rejects invalid textValue', async () => {
      await expect(
        monitoring.upsert(makeUser(), suId, {
          configKey: SERVICE_USER_MONITORING_CONFIG_KEYS.MEDICAL_ALERT_FALLS,
          textValue: 'MAYBE',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('22 no Alert generated', async () => {
      await monitoring.upsert(makeUser(), suId, {
        configKey: SERVICE_USER_MONITORING_CONFIG_KEYS.WEIGHT_CHANGE_THRESHOLD_KG,
        numericValue: 1,
      });
      expect(prisma.alert.create).not.toHaveBeenCalled();
      expect(alertCreates).toBe(0);
    });
  });

  describe('usual parameters', () => {
    it('23 create/upsert', async () => {
      const res = await usual.upsert(makeUser(), suId, {
        observationTypeId: obsTypeId,
        usualNumericValue: 70,
      });
      expect(res.data.usualNumericValue).toBe(70);
    });

    it('24 duplicate behaviour (upsert updates; strict create → 409)', async () => {
      await usual.upsert(makeUser(), suId, {
        observationTypeId: obsTypeId,
        usualNumericValue: 70,
      });
      const again = await usual.upsert(makeUser(), suId, {
        observationTypeId: obsTypeId,
        usualNumericValue: 72,
      });
      expect(again.data.usualNumericValue).toBe(72);
      await expect(
        usual.createStrict(makeUser(), suId, {
          observationTypeId: obsTypeId,
          usualNumericValue: 73,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('25 invalid ObservationType rejected', async () => {
      await expect(
        usual.upsert(makeUser(), suId, {
          observationTypeId: randomUUID(),
          usualNumericValue: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('26 update', async () => {
      const created = await usual.upsert(makeUser(), suId, {
        observationTypeId: obsTypeId,
        usualNumericValue: 70,
      });
      const updated = await usual.update(makeUser(), suId, created.data.id, {
        usualNumericValue: 71,
        lowerBand: 60,
        upperBand: 80,
      });
      expect(updated.data.usualNumericValue).toBe(71);
    });

    it('27 no Observation mutation', async () => {
      await usual.upsert(makeUser(), suId, {
        observationTypeId: obsTypeId,
        usualNumericValue: 70,
      });
      expect(observationMutations).toBe(0);
      expect(prisma.serviceUserObservation.create).not.toHaveBeenCalled();
    });

    it('28 no Alert generated', async () => {
      await usual.upsert(makeUser(), suId, {
        observationTypeId: obsTypeId,
        usualNumericValue: 70,
      });
      expect(prisma.alert.create).not.toHaveBeenCalled();
    });
  });

  describe('combined medical summary', () => {
    it('29 sources are composed correctly', async () => {
      await conditions.create(makeUser(), suId, { conditionId });
      const res = await summary.getSummary(makeUser(), suId);
      expect(res.data.medicalConditions?.length).toBe(1);
      expect(res.data.allergies?.length).toBe(1);
      expect(res.data.meta.sourcesIncluded).toContain('medicalConditions');
      expect(res.data.meta.sourcesIncluded).toContain('allergies');
    });

    it('30 inaccessible source is not leaked', async () => {
      await conditions.create(makeUser(), suId, { conditionId });
      const limited = makeUser({
        permissions: ['service_users.read', 'service_users.allergies.read'],
      });
      const res = await summary.getSummary(limited, suId);
      expect(res.data.medicalConditions).toBeUndefined();
      expect(res.data.allergies?.length).toBe(1);
      expect(res.data.meta.sourcesOmitted).toContain('medicalConditions');
    });

    it('31 partial source failure does not expose unauthorized data', async () => {
      const limited = makeUser({
        permissions: ['service_users.medical_conditions.read'],
      });
      const res = await summary.getSummary(limited, suId);
      expect(res.data.allergies).toBeUndefined();
      expect(res.data.meta.sourcesOmitted).toContain('allergies');
    });

    it('32 operational Alert data is not written/copied into clinical tables', async () => {
      await conditions.create(makeUser(), suId, { conditionId });
      await monitoring.upsert(makeUser(), suId, {
        configKey: SERVICE_USER_MONITORING_CONFIG_KEYS.FLUID_TARGET_REQUIRED,
        booleanValue: true,
      });
      await summary.getSummary(makeUser(), suId);
      expect(prisma.alert.create).not.toHaveBeenCalled();
      expect(alertCreates).toBe(0);
    });
  });
});
