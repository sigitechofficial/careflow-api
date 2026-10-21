import { BadRequestException, Injectable } from '@nestjs/common';
import { VisitPlanStatus } from '@prisma/client';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { BulkGenerateVisitPlanScheduleDto } from './dto/bulk-generate-visit-plan-schedule.dto';
import { BulkVisitPlanScheduleCandidatesQueryDto } from './dto/bulk-visit-plan-schedule-query.dto';
import { ServiceUserVisitPlansService } from './service-user-visit-plans.service';
import {
  type ScheduleAreaBranchLookup,
  loadScheduleAreaByLocationMap,
  resolveServiceUserBranch,
} from '../location-management/service-user-branch.util';
import { assessVisitPlanReadiness, type VisitPlanSlotReadinessInput } from './visit-plan-readiness.util';

const BULK_READINESS_OPTIONS = { requireCarers: false } as const;

export type BulkVisitPlanScheduleLocationSummary = {
  locationId: string;
  locationName: string;
  zoneName: string;
  branchName: string;
  branchLayers: string[];
  displayLabel: string;
  totalCount: number;
  readyCount: number;
};

export type BulkVisitPlanScheduleCandidate = {
  serviceUserId: string;
  planId: string;
  serviceUserLabel: string;
  serviceUserNumber: string | null;
  locationId: string | null;
  locationName: string | null;
  zoneName: string | null;
  branchName: string | null;
  branchLayers: string[];
  displayLabel: string;
  enabledSlotCount: number;
  ready: boolean;
  readinessIssues: string[];
  respectWorkingPatternOnSync: boolean;
};

export type BulkVisitPlanScheduleResultItem = {
  serviceUserId: string;
  planId: string;
  serviceUserLabel: string;
  status: 'success' | 'failed' | 'skipped';
  visitsCreated?: number;
  visitsSkipped?: number;
  visitsWithPatternWarnings?: number;
  visitsWithRotaConflicts?: number;
  patternWarnings?: string[];
  rotaConflictWarnings?: string[];
  error?: string;
  skipReason?: string;
};

function serviceUserMatchesLocationFilter(
  su: {
    locationId: string | null;
    assignments?: Array<{ locationId: string | null }>;
  },
  locationId: string,
): boolean {
  if (su.locationId === locationId) return true;
  return su.assignments?.some((row) => row.locationId === locationId) ?? false;
}

function mapPlanToCandidate(
  plan: {
    id: string;
    serviceUserId: string;
    serviceUser: {
      serviceUserNumber: string | null;
      firstName: string;
      lastName: string;
      preferredName: string | null;
      locationId: string | null;
      location: { name: string } | null;
      assignments?: Array<{
        locationId: string | null;
        location?: { name: string } | null;
      }>;
    };
    slots: VisitPlanSlotReadinessInput[];
    respectWorkingPatternOnSync: boolean;
  },
  roundNameByCode: Map<string, string>,
  scheduleAreaByLocation: Map<string, ScheduleAreaBranchLookup>,
): BulkVisitPlanScheduleCandidate {
  const readiness = assessVisitPlanReadiness(
    plan.slots as VisitPlanSlotReadinessInput[],
    roundNameByCode,
    BULK_READINESS_OPTIONS,
  );
  const su = plan.serviceUser;
  const branch = resolveServiceUserBranch(su, scheduleAreaByLocation);
  return {
    serviceUserId: plan.serviceUserId,
    planId: plan.id,
    serviceUserLabel: serviceUserDisplayName(su),
    serviceUserNumber: su.serviceUserNumber,
    locationId: branch.locationId,
    locationName: branch.locationName,
    zoneName: branch.zoneName,
    branchName: branch.branchName,
    branchLayers: branch.branchLayers,
    displayLabel: branch.displayLabel,
    enabledSlotCount: readiness.enabledSlotCount,
    ready: readiness.ready,
    readinessIssues: readiness.issues,
    respectWorkingPatternOnSync: plan.respectWorkingPatternOnSync,
  };
}

function buildLocationSummaries(
  candidates: BulkVisitPlanScheduleCandidate[],
): BulkVisitPlanScheduleLocationSummary[] {
  const map = new Map<string, BulkVisitPlanScheduleLocationSummary>();

  for (const row of candidates) {
    if (!row.locationId) continue;
    const existing =
      map.get(row.locationId) ??
      ({
        locationId: row.locationId,
        locationName: row.locationName ?? '',
        zoneName: row.zoneName ?? '',
        branchName: row.branchName ?? '',
        branchLayers: row.branchLayers ?? [],
        displayLabel: row.displayLabel ?? '',
        totalCount: 0,
        readyCount: 0,
      } satisfies BulkVisitPlanScheduleLocationSummary);
    existing.totalCount += 1;
    if (row.ready) existing.readyCount += 1;
    map.set(row.locationId, existing);
  }

  return [...map.values()].sort((a, b) => {
    const labelCmp = a.displayLabel.localeCompare(b.displayLabel);
    if (labelCmp !== 0) return labelCmp;
    return a.branchName.localeCompare(b.branchName);
  });
}

function serviceUserDisplayName(input: {
  preferredName?: string | null;
  firstName: string;
  lastName: string;
  serviceUserNumber?: string | null;
}): string {
  const legal = [input.firstName, input.lastName].filter(Boolean).join(' ').trim();
  if (input.preferredName?.trim()) {
    return legal ? `${legal} (${input.preferredName.trim()})` : input.preferredName.trim();
  }
  if (legal) return legal;
  return input.serviceUserNumber?.trim() || 'Service user';
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

  private async loadScheduleAreaByLocationMap() {
    return loadScheduleAreaByLocationMap(this.prisma);
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
          ...(locationId
            ? {
                OR: [
                  { locationId },
                  { assignments: { some: { deletedAt: null, locationId } } },
                ],
              }
            : {}),
        },
      },
      include: {
        serviceUser: {
          include: {
            location: true,
            assignments: {
              where: { deletedAt: null },
              orderBy: { updatedAt: 'desc' },
              take: 1,
              include: { location: true },
            },
          },
        },
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
    const scheduleAreaByLocation = await this.loadScheduleAreaByLocationMap();
    const allPlans = await this.loadActivePlans();

    const allCandidates = allPlans.map((plan) =>
      mapPlanToCandidate(plan, roundNameByCode, scheduleAreaByLocation),
    );
    const locationSummaries = buildLocationSummaries(allCandidates);

    const scopedPlans = query.locationId
      ? allPlans.filter((plan) =>
          serviceUserMatchesLocationFilter(plan.serviceUser, query.locationId!),
        )
      : allPlans;
    const scopedCandidates = scopedPlans.map((plan) =>
      mapPlanToCandidate(plan, roundNameByCode, scheduleAreaByLocation),
    );

    const filtered = query.readyOnly
      ? scopedCandidates.filter((row) => row.ready)
      : scopedCandidates;

    return {
      data: {
        candidates: filtered,
        summary: {
          totalActivePlans: scopedCandidates.length,
          allActivePlans: allCandidates.length,
          readyCount: scopedCandidates.filter((row) => row.ready).length,
          notReadyCount: scopedCandidates.filter((row) => !row.ready).length,
          unassignedCount: scopedCandidates.filter((row) => !row.locationId).length,
          returned: filtered.length,
          locationSummaries,
        },
      },
    };
  }

  async bulkGenerate(
    userId: string,
    dto: BulkGenerateVisitPlanScheduleDto,
    meta?: RequestAuditMeta,
    options?: { restoreDeletedJobs?: boolean },
  ) {
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

    const generateParamsBase = {
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      scheduleAreaId: dto.scheduleAreaId,
      backfillDays: dto.backfillDays,
    };

    const results: BulkVisitPlanScheduleResultItem[] = [];
    let visitsCreated = 0;
    let visitsSkipped = 0;
    let visitsWithPatternWarnings = 0;
    let visitsWithRotaConflicts = 0;
    const patternWarnings: string[] = [];
    const rotaConflictWarnings: string[] = [];
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
        const respectWorkingPatternOnSync =
          dto.respectWorkingPatternOnSync ?? plan.respectWorkingPatternOnSync;
        const response = await this.visitPlans.generateSchedule(
          userId,
          plan.serviceUserId,
          plan.id,
          {
            ...generateParamsBase,
            respectWorkingPatternOnSync,
          },
          meta,
          { restoreDeletedJobs: options?.restoreDeletedJobs },
        );
        const data = response.data;
        visitsCreated += data.visitsCreated;
        visitsSkipped += data.visitsSkipped;
        visitsWithPatternWarnings += data.visitsWithPatternWarnings ?? 0;
        visitsWithRotaConflicts += data.visitsWithRotaConflicts ?? 0;
        if (data.patternWarnings?.length) {
          patternWarnings.push(...data.patternWarnings);
        }
        if (data.rotaConflictWarnings?.length) {
          rotaConflictWarnings.push(...data.rotaConflictWarnings);
        }
        succeeded += 1;
        results.push({
          serviceUserId: plan.serviceUserId,
          planId: plan.id,
          serviceUserLabel: label,
          status: 'success',
          visitsCreated: data.visitsCreated,
          visitsSkipped: data.visitsSkipped,
          visitsWithPatternWarnings: data.visitsWithPatternWarnings ?? 0,
          visitsWithRotaConflicts: data.visitsWithRotaConflicts ?? 0,
          patternWarnings: data.patternWarnings ?? [],
          rotaConflictWarnings: data.rotaConflictWarnings ?? [],
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
          visitsWithPatternWarnings,
          visitsWithRotaConflicts,
          patternWarnings: [...new Set(patternWarnings)],
          rotaConflictWarnings: [...new Set(rotaConflictWarnings)],
        },
        results,
      },
    };
  }
}
