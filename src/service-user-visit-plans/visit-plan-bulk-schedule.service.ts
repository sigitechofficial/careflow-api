import { BadRequestException, Injectable } from '@nestjs/common';
import { VisitPlanStatus } from '@prisma/client';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { BulkGenerateVisitPlanScheduleDto } from './dto/bulk-generate-visit-plan-schedule.dto';
import { BulkVisitPlanScheduleCandidatesQueryDto } from './dto/bulk-visit-plan-schedule-query.dto';
import { ServiceUserVisitPlansService } from './service-user-visit-plans.service';
import { assessVisitPlanReadiness, type VisitPlanSlotReadinessInput } from './visit-plan-readiness.util';

const BULK_READINESS_OPTIONS = { requireCarers: false } as const;

export type BulkVisitPlanScheduleCandidate = {
  serviceUserId: string;
  planId: string;
  serviceUserLabel: string;
  serviceUserNumber: string | null;
  locationId: string | null;
  locationName: string | null;
  enabledSlotCount: number;
  ready: boolean;
  readinessIssues: string[];
};

export type BulkVisitPlanScheduleResultItem = {
  serviceUserId: string;
  planId: string;
  serviceUserLabel: string;
  status: 'success' | 'failed' | 'skipped';
  visitsCreated?: number;
  visitsSkipped?: number;
  error?: string;
  skipReason?: string;
};

function serviceUserDisplayName(input: {
  preferredName?: string | null;
  firstName: string;
  lastName: string;
  serviceUserNumber?: string | null;
}): string {
  const name =
    input.preferredName?.trim() ||
    [input.firstName, input.lastName].filter(Boolean).join(' ').trim() ||
    'Service user';
  const num = input.serviceUserNumber?.trim();
  return num ? `${name} (${num})` : name;
}

@Injectable()
export class VisitPlanBulkScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visitPlans: ServiceUserVisitPlansService,
  ) {}

  private async loadRoundNameMap(): Promise<Map<string, string>> {
    const rounds = await this.prisma.medicationAdministrationRound.findMany({
      where: { deletedAt: null, isActive: true },
      select: { code: true, name: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return new Map(rounds.map((row) => [row.code, row.name]));
  }

  private async loadActivePlans(locationId?: string, planIds?: string[]) {
    return this.prisma.serviceUserVisitPlan.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: VisitPlanStatus.ACTIVE,
        ...(planIds?.length ? { id: { in: planIds } } : {}),
        serviceUser: {
          deletedAt: null,
          isActive: true,
          ...(locationId ? { locationId } : {}),
        },
      },
      include: {
        serviceUser: { include: { location: true } },
        slots: {
          where: { isActive: true },
          include: { carerAssignments: { select: { employeeId: true } } },
        },
      },
      orderBy: [{ serviceUser: { lastName: 'asc' } }, { serviceUser: { firstName: 'asc' } }],
    });
  }

  async listCandidates(query: BulkVisitPlanScheduleCandidatesQueryDto) {
    const roundNameByCode = await this.loadRoundNameMap();
    const plans = await this.loadActivePlans(query.locationId);

    const candidates: BulkVisitPlanScheduleCandidate[] = plans.map((plan) => {
      const readiness = assessVisitPlanReadiness(
        plan.slots as VisitPlanSlotReadinessInput[],
        roundNameByCode,
        BULK_READINESS_OPTIONS,
      );
      const su = plan.serviceUser;
      return {
        serviceUserId: plan.serviceUserId,
        planId: plan.id,
        serviceUserLabel: serviceUserDisplayName(su),
        serviceUserNumber: su.serviceUserNumber,
        locationId: su.locationId,
        locationName: su.location?.name ?? null,
        enabledSlotCount: readiness.enabledSlotCount,
        ready: readiness.ready,
        readinessIssues: readiness.issues,
      };
    });

    const filtered = query.readyOnly ? candidates.filter((row) => row.ready) : candidates;

    return {
      data: {
        candidates: filtered,
        summary: {
          totalActivePlans: candidates.length,
          readyCount: candidates.filter((row) => row.ready).length,
          notReadyCount: candidates.filter((row) => !row.ready).length,
          returned: filtered.length,
        },
      },
    };
  }

  async bulkGenerate(userId: string, dto: BulkGenerateVisitPlanScheduleDto, meta?: RequestAuditMeta) {
    if (dto.planIds?.length) {
      const plans = await this.loadActivePlans(dto.locationId, dto.planIds);
      if (plans.length !== dto.planIds.length) {
        throw new BadRequestException(
          'One or more visit plans are not active or do not match the selected filters',
        );
      }
    }

    const readyOnly = dto.readyOnly !== false;
    const roundNameByCode = await this.loadRoundNameMap();
    const plans = await this.loadActivePlans(dto.locationId, dto.planIds);

    if (!plans.length) {
      throw new BadRequestException('No active visit plans match the selected scope');
    }

    const generateParams = {
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      scheduleAreaId: dto.scheduleAreaId,
      backfillDays: dto.backfillDays,
    };

    const results: BulkVisitPlanScheduleResultItem[] = [];
    let visitsCreated = 0;
    let visitsSkipped = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const plan of plans) {
      const label = serviceUserDisplayName(plan.serviceUser);
      const readiness = assessVisitPlanReadiness(
        plan.slots as VisitPlanSlotReadinessInput[],
        roundNameByCode,
        BULK_READINESS_OPTIONS,
      );

      if (readyOnly && !readiness.ready) {
        skipped += 1;
        results.push({
          serviceUserId: plan.serviceUserId,
          planId: plan.id,
          serviceUserLabel: label,
          status: 'skipped',
          skipReason: readiness.issues[0] ?? 'Visit plan is not ready',
        });
        continue;
      }

      try {
        const response = await this.visitPlans.generateSchedule(
          userId,
          plan.serviceUserId,
          plan.id,
          generateParams,
          meta,
          { assignCarers: false },
        );
        const data = response.data;
        visitsCreated += data.visitsCreated;
        visitsSkipped += data.visitsSkipped;
        succeeded += 1;
        results.push({
          serviceUserId: plan.serviceUserId,
          planId: plan.id,
          serviceUserLabel: label,
          status: 'success',
          visitsCreated: data.visitsCreated,
          visitsSkipped: data.visitsSkipped,
        });
      } catch (error) {
        failed += 1;
        const message =
          error instanceof BadRequestException
            ? (error.message as string)
            : error instanceof Error
              ? error.message
              : 'Could not generate schedule';
        results.push({
          serviceUserId: plan.serviceUserId,
          planId: plan.id,
          serviceUserLabel: label,
          status: 'failed',
          error: message,
        });
      }
    }

    return {
      message: 'Bulk schedule generation complete',
      data: {
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        backfillDays: dto.backfillDays ?? 0,
        totals: {
          processed: results.length,
          succeeded,
          failed,
          skipped,
          visitsCreated,
          visitsSkipped,
        },
        results,
      },
    };
  }
}
