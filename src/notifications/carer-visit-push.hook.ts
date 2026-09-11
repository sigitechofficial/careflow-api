import { Injectable, Logger } from '@nestjs/common';
import {
  AllocationStatus,
  CarerVisitPushKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FcmPushService } from './fcm-push.service';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

export type CarerVisitPushParams = {
  employeeIds: string[];
  kind: CarerVisitPushKind;
  title: string;
  body: string;
  scheduledJobId: string;
  serviceUserId?: string | null;
  once?: boolean;
};

@Injectable()
export class CarerVisitPushHook {
  private readonly logger = new Logger(CarerVisitPushHook.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmPushService,
  ) {}

  async activeEmployeeIdsForJob(scheduledJobId: string): Promise<string[]> {
    const rows = await this.prisma.jobAllocation.findMany({
      where: {
        scheduledJobId,
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
      },
      select: { employeeId: true },
    });
    return [...new Set(rows.map((r) => r.employeeId))];
  }

  notify(params: CarerVisitPushParams): void {
    void this.notifySafe(params);
  }

  async notifySafe(params: CarerVisitPushParams): Promise<void> {
    try {
      await this.send(params);
    } catch (err) {
      this.logger.warn(
        `Carer visit push ${params.kind} failed for job ${params.scheduledJobId}: ${String(err)}`,
      );
    }
  }

  private async send(params: CarerVisitPushParams): Promise<void> {
    const employeeIds = [...new Set(params.employeeIds.filter(Boolean))];
    if (!employeeIds.length) return;

    let targets = employeeIds;
    if (params.once) {
      const claimed: string[] = [];
      for (const employeeId of employeeIds) {
        try {
          await this.prisma.carerVisitPushReceipt.create({
            data: {
              employeeId,
              scheduledJobId: params.scheduledJobId,
              kind: params.kind,
            },
          });
          claimed.push(employeeId);
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            continue;
          }
          throw err;
        }
      }
      targets = claimed;
    }
    if (!targets.length) return;

    await this.fcm.sendToEmployees(targets, {
      title: params.title,
      body: params.body,
      data: {
        type: params.kind,
        scheduledJobId: params.scheduledJobId,
        ...(params.serviceUserId ? { serviceUserId: params.serviceUserId } : {}),
      },
    });
  }
}
