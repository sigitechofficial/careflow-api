import { BadRequestException, Injectable } from '@nestjs/common';
import { CarerMessageAudience, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FcmPushService } from '../notifications/fcm-push.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { CarerMessageAudienceDto, SendCarerMessageDto } from './dto/send-carer-message.dto';

/** Push data `type` the carer app receives. Unknown to the visit router, so a tap just opens the app. */
export const CARER_MESSAGE_PUSH_TYPE = 'OFFICE_MESSAGE';

type AuditMeta = ReturnType<typeof import("../common/utils/request-audit-meta.util").getRequestAuditMeta>;

/**
 * Who gets a carer message:
 * - only employees that are active and not deleted (explicit picks are filtered too);
 * - ALL: every such employee; BRANCHES: their employment branch is one of the picked branches;
 *   EMPLOYEES: the picked employees.
 * Only employees with the carer app signed in (a saved device token) actually receive the push.
 */
export function carerMessageRecipientWhere(dto: CarerMessageAudienceDto): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = { deletedAt: null, isActive: true };
  if (dto.audience === CarerMessageAudience.BRANCHES) {
    const ids = [...new Set(dto.locationIds ?? [])];
    if (!ids.length) throw new BadRequestException('Choose at least one branch');
    where.employment = { locationId: { in: ids } };
  } else if (dto.audience === CarerMessageAudience.EMPLOYEES) {
    const ids = [...new Set(dto.employeeIds ?? [])];
    if (!ids.length) throw new BadRequestException('Choose at least one carer');
    where.id = { in: ids };
  }
  return where;
}

@Injectable()
export class CarerMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: FcmPushService,
    private readonly audit: AuditLogsService,
  ) {}

  private async resolve(dto: CarerMessageAudienceDto) {
    const employees = await this.prisma.employee.findMany({
      where: carerMessageRecipientWhere(dto),
      select: { id: true },
    });
    const ids = employees.map((e) => e.id);
    const tokens = ids.length
      ? await this.prisma.employeeDeviceToken.findMany({
          where: { employeeId: { in: ids } },
          select: { employeeId: true },
          distinct: ['employeeId'],
        })
      : [];
    const withApp = new Set(tokens.map((t) => t.employeeId));
    return { ids, withApp };
  }

  /** Counts shown before sending. */
  async preview(dto: CarerMessageAudienceDto) {
    const { ids, withApp } = await this.resolve(dto);
    return { data: { recipientCount: ids.length, withAppCount: withApp.size } };
  }

  async send(userId: string, dto: SendCarerMessageDto, meta: AuditMeta) {
    const { ids, withApp } = await this.resolve(dto);
    if (!ids.length) throw new BadRequestException('No active carers match this choice');

    const message = await this.prisma.carerMessage.create({
      data: {
        title: dto.title,
        body: dto.body,
        audience: dto.audience,
        locationIds: dto.audience === CarerMessageAudience.BRANCHES ? [...new Set(dto.locationIds ?? [])] : [],
        employeeIds: dto.audience === CarerMessageAudience.EMPLOYEES ? [...new Set(dto.employeeIds ?? [])] : [],
        recipientCount: ids.length,
        withAppCount: withApp.size,
        sentById: userId,
        recipients: {
          createMany: { data: ids.map((employeeId) => ({ employeeId, hadDevice: withApp.has(employeeId) })) },
        },
      },
    });

    const report = await this.push.sendToEmployees(ids, {
      title: dto.title,
      body: dto.body,
      data: { type: CARER_MESSAGE_PUSH_TYPE, messageId: message.id },
    });
    const delivered = report.sent ?? 0;
    await this.prisma.carerMessage.update({ where: { id: message.id }, data: { deliveredCount: delivered } });

    await this.audit.logAudit({
      userId,
      module: AuditModule.NOTIFICATION,
      action: AuditAction.CARER_MESSAGE_SENT,
      recordType: 'CarerMessage',
      recordId: message.id,
      newValues: {
        title: dto.title,
        audience: dto.audience,
        recipientCount: ids.length,
        withAppCount: withApp.size,
        deliveredCount: delivered,
      },
      ...meta,
    });

    return {
      message: delivered > 0 ? 'Notification sent' : 'Notification saved, but no phone received it',
      data: {
        id: message.id,
        recipientCount: ids.length,
        withAppCount: withApp.size,
        deliveredCount: delivered,
        pushReady: report.ready,
      },
    };
  }

  /** Most recent first, with the sender's name and the branch names. */
  async list(limit = 50) {
    const rows = await this.prisma.carerMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    const userIds = [...new Set(rows.map((r) => r.sentById).filter((x): x is string => !!x))];
    const locationIds = [...new Set(rows.flatMap((r) => r.locationIds))];
    const [users, locations] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
        : [],
      locationIds.length
        ? this.prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } })
        : [],
    ]);
    const userName = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email]));
    const locName = new Map(locations.map((l) => [l.id, l.name]));
    return {
      data: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        audience: r.audience,
        branchNames: r.locationIds.map((id) => locName.get(id) ?? 'Unknown branch'),
        pickedCount: r.employeeIds.length,
        recipientCount: r.recipientCount,
        withAppCount: r.withAppCount,
        deliveredCount: r.deliveredCount,
        sentBy: r.sentById ? (userName.get(r.sentById) ?? null) : null,
        createdAt: r.createdAt,
      })),
    };
  }
}
