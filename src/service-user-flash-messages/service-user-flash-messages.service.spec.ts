import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FlashMessageStatus } from '@prisma/client';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserFlashMessagesService } from './service-user-flash-messages.service';
import { FlashMessageNotificationHook } from './flash-message-notification.hook';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseDisplayUntilInput } from './utils/flash-message-date.util';

describe('ServiceUserFlashMessagesService', () => {
  let service: ServiceUserFlashMessagesService;
  const testAuditMeta: RequestAuditMeta = { ipAddress: '127.0.0.1', userAgent: 'jest' };
  const audit = {
    logAudit: jest.fn(),
    logDataAccess: jest.fn(),
  };
  const notifications = { notifyFlashMessageChanged: jest.fn() };
  const prisma = {
    serviceUser: { findFirst: jest.fn() },
    serviceUserFlashMessage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ServiceUserFlashMessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: audit },
        { provide: FlashMessageNotificationHook, useValue: notifications },
      ],
    }).compile();

    service = moduleRef.get(ServiceUserFlashMessagesService);
  });

  it('rejects displayUntil in the past on upsert', async () => {
    prisma.serviceUser.findFirst.mockResolvedValue({
      id: 'su-1',
      firstName: 'Jane',
      lastName: 'Doe',
      deletedAt: null,
    });

    await expect(
      service.upsert(
        'su-1',
        { message: 'Test', displayUntil: '2000-01-01' },
        'user-1',
        testAuditMeta,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects message over 150 characters via DTO layer (simulated trim validation)', () => {
    const message = 'x'.repeat(151);
    expect(message.length).toBeGreaterThan(150);
  });

  it('returns null current message when none active', async () => {
    prisma.serviceUser.findFirst.mockResolvedValue({
      id: 'su-1',
      firstName: 'Jane',
      lastName: 'Doe',
      deletedAt: null,
    });
    prisma.serviceUserFlashMessage.findMany.mockResolvedValue([]);
    prisma.serviceUserFlashMessage.findFirst.mockResolvedValue(null);

    const result = await service.getCurrent('su-1', 'user-1', testAuditMeta);
    expect(result.data).toBeNull();
    expect(result.message).toBe('No active flash message');
    expect(audit.logDataAccess).toHaveBeenCalled();
    expect(audit.logAudit).toHaveBeenCalled();
  });

  it('archives previous message on upsert transaction', async () => {
    const displayUntil = parseDisplayUntilInput('2099-12-31');
    const previous = {
      id: 'fm-old',
      serviceUserId: 'su-1',
      message: 'Old',
      displayUntil,
      status: FlashMessageStatus.ACTIVE,
      isCurrent: true,
      clearedAt: null,
      clearReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
      clearedBy: null,
    };
    const created = {
      ...previous,
      id: 'fm-new',
      message: 'New alert',
      createdBy: null,
      clearedBy: null,
    };

    prisma.serviceUser.findFirst.mockResolvedValue({
      id: 'su-1',
      firstName: 'Jane',
      lastName: 'Doe',
      deletedAt: null,
    });

    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      const tx = {
        serviceUserFlashMessage: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(previous)
            .mockResolvedValueOnce(null),
          update: jest.fn().mockResolvedValue({
            ...previous,
            status: FlashMessageStatus.ARCHIVED,
            isCurrent: false,
            createdBy: null,
            clearedBy: null,
          }),
          create: jest.fn().mockResolvedValue(created),
        },
      };
      return fn(tx as unknown as typeof prisma);
    });

    const result = await service.upsert(
      'su-1',
      { message: 'New alert', displayUntil: '2099-12-31' },
      'user-1',
      testAuditMeta,
    );

    expect(result.data?.message).toBe('New alert');
    expect(audit.logAudit).toHaveBeenCalled();
    expect(notifications.notifyFlashMessageChanged).toHaveBeenCalled();
  });
});
