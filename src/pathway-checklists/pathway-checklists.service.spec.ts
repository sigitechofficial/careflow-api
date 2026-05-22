import { PathwayChecklistsService } from './pathway-checklists.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

describe('PathwayChecklistsService', () => {
  const auditMock = {
    logAudit: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogsService;

  let service: PathwayChecklistsService;
  let checklistCreate: jest.Mock;

  beforeEach(() => {
    checklistCreate = jest.fn().mockResolvedValue({
      id: 'cl-1',
      name: 'Morning',
      icon: null,
      carePlanId: null,
      analysisGroupId: null,
      observationEnabled: false,
      recordPhoto: false,
      familyShare: false,
      groupAction: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
    });

    const tx = {
      pathwayChecklist: {
        create: checklistCreate,
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'cl-1',
          name: 'Morning',
          icon: null,
          carePlanId: null,
          analysisGroupId: null,
          observationEnabled: false,
          recordPhoto: false,
          familyShare: false,
          groupAction: false,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [],
        }),
      },
      pathwayChecklistItem: { createMany: jest.fn() },
    };

    const prismaMock = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      pathwayChecklist: { findFirst: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    } as unknown as PrismaService;

    service = new PathwayChecklistsService(prismaMock, auditMock);
    jest.clearAllMocks();
  });

  it('clears recordPhoto when observation is disabled', async () => {
    await service.create('user-1', {
      name: 'Morning routine',
      recordPhoto: true,
      observationEnabled: false,
    });

    expect(checklistCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          observationEnabled: false,
          recordPhoto: false,
        }),
      }),
    );
    expect(auditMock.logAudit).toHaveBeenCalled();
  });
});
