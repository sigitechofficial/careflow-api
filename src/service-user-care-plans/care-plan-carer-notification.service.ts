import { Injectable, Logger } from '@nestjs/common';
import {
  AllocationStatus,
  Prisma,
  ScheduledJobStatus,
  ServiceUserCarePlanInstanceStatus,
  ServiceUserCarePlanLifecycleStatus as LifecycleStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FcmPushService } from '../notifications/fcm-push.service';

/** Same allocation / visit rules the carer app uses for "clients on my round". */
const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];
const EXCLUDED_JOB_STATUSES: ScheduledJobStatus[] = [
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
  ScheduledJobStatus.DRAFT,
];
export const CARE_PLAN_NOTIFY_HORIZON_DAYS = 14;
export const CARE_PLAN_UPDATED_PUSH_TYPE = 'CARE_PLAN_UPDATED';

export type CarePlanCarerNotifyResult = {
  notified: string[];
  alreadyNotified: string[];
  skipped?: 'NOT_ACTIVE_PUBLISHED' | 'NO_CARERS';
  error?: string;
};

/** Initials and service-user number only: no clinical content leaves in a push payload. */
export function carePlanPushReference(su: {
  firstName: string | null;
  lastName: string | null;
  serviceUserNumber: string | null;
}): string {
  const initials = [su.firstName, su.lastName]
    .map((n) => n?.trim()?.[0]?.toUpperCase() ?? '')
    .join('');
  return [
    initials || 'Service user',
    su.serviceUserNumber ? `(${su.serviceUserNumber})` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Phase 4B: tells carers on the service user's upcoming visits that a care plan they work to has a
 * new published version. Each carer is notified once per version (the acknowledgement row is the
 * claim), only for ACTIVE published plans, and failures never undo the publication.
 */
@Injectable()
export class CarePlanCarerNotificationService {
  private readonly logger = new Logger(CarePlanCarerNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmPushService,
  ) {}

  /** Never throws: notification problems are logged and reported, not raised. */
  async notifyCurrentVersion(
    carePlanInstanceId: string,
    now = new Date(),
  ): Promise<CarePlanCarerNotifyResult> {
    try {
      return await this.send(carePlanInstanceId, now);
    } catch (error) {
      this.logger.warn(
        `Care plan carer notification failed for instance ${carePlanInstanceId}: ${String(error)}`,
      );
      return { notified: [], alreadyNotified: [], error: String(error) };
    }
  }

  /** Carers allocated to the service user's visits from now until the horizon. */
  async upcomingCarerIds(
    serviceUserId: string,
    now = new Date(),
  ): Promise<string[]> {
    const end = new Date(
      now.getTime() + CARE_PLAN_NOTIFY_HORIZON_DAYS * 24 * 60 * 60 * 1000,
    );
    const rows = await this.prisma.jobAllocation.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { in: ACTIVE_ALLOCATION },
        scheduledJob: {
          serviceUserId,
          deletedAt: null,
          isActive: true,
          scheduledStartDateTime: { gte: now, lte: end },
          status: { notIn: EXCLUDED_JOB_STATUSES },
        },
      },
      select: { employeeId: true },
    });
    return [...new Set(rows.map((r) => r.employeeId))];
  }

  private async send(
    carePlanInstanceId: string,
    now: Date,
  ): Promise<CarePlanCarerNotifyResult> {
    const instance = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: { id: carePlanInstanceId },
      select: {
        id: true,
        serviceUserId: true,
        status: true,
        lifecycleStatus: true,
        carePathwayForm: { select: { name: true } },
        serviceUser: {
          select: { firstName: true, lastName: true, serviceUserNumber: true },
        },
        publishedVersions: {
          where: { supersededAt: null },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { id: true, versionNumber: true },
        },
      },
    });
    const version = instance?.publishedVersions[0];
    // Drafts, plans awaiting approval, approved-but-unpublished, suspended and archived plans: never.
    if (
      !instance ||
      !version ||
      instance.status !== ServiceUserCarePlanInstanceStatus.PUBLISHED ||
      instance.lifecycleStatus !== LifecycleStatus.ACTIVE
    ) {
      return {
        notified: [],
        alreadyNotified: [],
        skipped: 'NOT_ACTIVE_PUBLISHED',
      };
    }

    const carerIds = await this.upcomingCarerIds(instance.serviceUserId, now);
    if (!carerIds.length)
      return { notified: [], alreadyNotified: [], skipped: 'NO_CARERS' };

    // Claim one row per carer for this version; an existing row means already notified.
    const notified: string[] = [];
    const alreadyNotified: string[] = [];
    for (const employeeId of carerIds) {
      try {
        await this.prisma.carePlanVersionAcknowledgement.create({
          data: {
            publishedVersionId: version.id,
            carePlanInstanceId: instance.id,
            serviceUserId: instance.serviceUserId,
            employeeId,
          },
        });
        notified.push(employeeId);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          alreadyNotified.push(employeeId);
          continue;
        }
        throw error;
      }
    }
    if (!notified.length) return { notified, alreadyNotified };

    const report = await this.fcm.sendToEmployees(notified, {
      title: 'Care plan updated',
      body: `${instance.carePathwayForm.name} (version ${version.versionNumber}) for ${carePlanPushReference(instance.serviceUser)}. Open the app to read and acknowledge it.`,
      data: {
        type: CARE_PLAN_UPDATED_PUSH_TYPE,
        serviceUserId: instance.serviceUserId,
        carePlanInstanceId: instance.id,
        publishedVersionId: version.id,
        versionNumber: String(version.versionNumber),
      },
    }, 'care-plans');
    await this.prisma.carePlanVersionAcknowledgement.updateMany({
      where: {
        publishedVersionId: version.id,
        employeeId: { in: notified },
        notifiedAt: null,
      },
      data: { notifiedAt: now },
    });
    if (report.reason !== 'SENT' && report.sent === 0) {
      this.logger.warn(
        `Care plan ${instance.id} v${version.versionNumber}: push not delivered (${report.reason}); carers still see it to acknowledge in the app.`,
      );
    }
    return { notified, alreadyNotified };
  }
}
