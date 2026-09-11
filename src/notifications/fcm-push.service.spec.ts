import { ConfigService } from '@nestjs/config'
import { DevicePushPlatform } from '@prisma/client'
import { FcmPushService } from './fcm-push.service'
import { PrismaService } from '../prisma/prisma.service'

describe('FcmPushService', () => {
  const prismaMock = {
    employeeDeviceToken: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  } as unknown as PrismaService

  const configMock = {
    get: jest.fn().mockReturnValue('/tmp/missing-service-account.json'),
  } as unknown as ConfigService

  let service: FcmPushService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new FcmPushService(configMock, prismaMock)
  })

  it('upsertToken moves a token onto the employee', async () => {
    ;(prismaMock.employeeDeviceToken.upsert as jest.Mock).mockResolvedValue({
      id: 't1',
      token: 'abc',
      platform: DevicePushPlatform.ANDROID,
    })
    const result = await service.upsertToken({
      employeeId: 'emp-1',
      token: ' abc ',
      platform: DevicePushPlatform.ANDROID,
    })
    expect(prismaMock.employeeDeviceToken.upsert).toHaveBeenCalledWith({
      where: { token: 'abc' },
      create: {
        employeeId: 'emp-1',
        token: 'abc',
        platform: DevicePushPlatform.ANDROID,
      },
      update: {
        employeeId: 'emp-1',
        platform: DevicePushPlatform.ANDROID,
      },
    })
    expect(result.token).toBe('abc')
  })

  it('sendToEmployees is a no-op when there are no tokens', async () => {
    ;(prismaMock.employeeDeviceToken.findMany as jest.Mock).mockResolvedValue([])
    const result = await service.sendToEmployees(['emp-1'], {
      title: 'T',
      body: 'B',
    })
    expect(result).toEqual({ sent: 0, skipped: 1 })
  })

  it('sendToEmployees skips when firebase is not initialised', async () => {
    ;(prismaMock.employeeDeviceToken.findMany as jest.Mock).mockResolvedValue([
      { id: 't1', token: 'abc' },
    ])
    const result = await service.sendToEmployees(['emp-1'], {
      title: 'T',
      body: 'B',
    })
    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
  })
})
