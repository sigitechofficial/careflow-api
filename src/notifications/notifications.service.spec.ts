import { NotificationsService } from './notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { NotificationsGateway } from './notifications.gateway'
import {
  NotificationModule,
  NotificationSeverity,
  NotificationType,
} from '@prisma/client'

describe('NotificationsService', () => {
  const prismaMock = {
    user: { findMany: jest.fn() },
    notification: { create: jest.fn() },
    notificationRecipient: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    notificationPreference: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as unknown as PrismaService

  const gatewayMock = {
    emitNotificationNew: jest.fn(),
    emitUnreadCount: jest.fn(),
    emitNotificationRead: jest.fn(),
    emitNotificationReadAll: jest.fn(),
    emitNotificationDismissed: jest.fn(),
  } as unknown as NotificationsGateway

  const auditMock = {
    logAudit: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogsService

  let service: NotificationsService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new NotificationsService(prismaMock, auditMock, gatewayMock)
  })

  it('notifyUsers creates notification and emits to recipients', async () => {
    const uid = '00000000-0000-4000-8000-000000000001'
    ;(prismaMock.user.findMany as jest.Mock).mockResolvedValue([{ id: uid }])
    ;(prismaMock.notificationPreference.findUnique as jest.Mock).mockResolvedValue(null)
    const recipientRow = { id: 'r1', userId: uid, readAt: null, dismissedAt: null }
    const notif = {
      id: 'n1',
      type: NotificationType.SYSTEM_MESSAGE,
      title: 'T',
      message: 'M',
      module: NotificationModule.SYSTEM,
      severity: NotificationSeverity.INFO,
      recordType: null,
      recordId: null,
      metadata: null,
      createdById: null,
      createdAt: new Date(),
      recipients: [recipientRow],
    }
    ;(prismaMock.notification.create as jest.Mock).mockResolvedValue(notif)
    ;(prismaMock.notificationRecipient.update as jest.Mock).mockResolvedValue({})
    ;(prismaMock.notificationRecipient.count as jest.Mock).mockResolvedValue(1)

    const result = await service.notifyUsers({
      recipientUserIds: [uid],
      type: NotificationType.SYSTEM_MESSAGE,
      title: 'T',
      message: 'M',
      module: NotificationModule.SYSTEM,
    })

    expect(result.id).toBe('n1')
    expect(gatewayMock.emitNotificationNew).toHaveBeenCalled()
    expect(gatewayMock.emitUnreadCount).toHaveBeenCalledWith(uid, 1)
  })

  it('getUnreadCount delegates to prisma count', async () => {
    const uid = '00000000-0000-4000-8000-000000000002'
    ;(prismaMock.notificationRecipient.count as jest.Mock).mockResolvedValue(3)
    await expect(service.getUnreadCount(uid)).resolves.toBe(3)
  })
})
