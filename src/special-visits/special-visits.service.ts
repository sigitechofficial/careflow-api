import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSpecialVisitDto } from './dto/special-visit.dto';
import {
  CarerWeeklyHoursService,
  carerNoContractedHoursError,
  carerOverMaxApprovalMessage,
  carerOverMaxError,
  carerOverMaxMessage,
  overMaxAllowed,
  visitsNeedApproval,
} from '../employee-hours-approvals/carer-weekly-hours.service';
import { VisitPlanWeeklyHoursService } from '../service-user-visit-plans/visit-plan-weekly-hours.service';

/** Allocation statuses that count as the carer actually being booked. */
const ACTIVE_ALLOCATION_STATUSES = ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'] as const;

/** Prisma JSON filter: scheduled jobs flagged as special visits. */
const SPECIAL_JOB_METADATA: Prisma.JsonFilter = { path: ['special'], equals: true };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function weekBounds(weekStartIso: string): { start: Date; end: Date } {
  const start = new Date(`${weekStartIso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new BadRequestException('Invalid weekStart date');
  return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

/** Minutes a job occupies, preferring the estimate, then the start/end span. */
function jobMinutes(job: {
  scheduledStartDateTime: Date;
  scheduledEndDateTime: Date | null;
  estimatedDurationMinutes: number | null;
}): number {
  if (job.estimatedDurationMinutes && job.estimatedDurationMinutes > 0) {
    return job.estimatedDurationMinutes;
  }
  if (job.scheduledEndDateTime) {
    return Math.max(
      0,
      (job.scheduledEndDateTime.getTime() - job.scheduledStartDateTime.getTime()) / 60_000,
    );
  }
  return 0;
}

@Injectable()
export class SpecialVisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly weeklyHours: VisitPlanWeeklyHoursService,
    private readonly carerHours: CarerWeeklyHoursService,
  ) {}

  /** Day (UTC midnight) a Date falls on, used as the ScheduleBatch.scheduleDate. */
  private static dayOf(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  /** Reuse the day's schedule batch, or make one for ad-hoc special visits. */
  private async batchForDate(date: Date): Promise<string> {
    const day = SpecialVisitsService.dayOf(date);
    const existing = await this.prisma.scheduleBatch.findFirst({
      where: { scheduleDate: day, deletedAt: null, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.scheduleBatch.create({
      data: { scheduleDate: day, name: 'Special visits', status: 'BUILT' },
      select: { id: true },
    });
    return created.id;
  }

  async create(userId: string, dto: CreateSpecialVisitDto) {
    const [employee, serviceUser] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: dto.employeeId, deletedAt: null }, select: { id: true } }),
      this.prisma.serviceUser.findFirst({ where: { id: dto.serviceUserId, deletedAt: null }, select: { id: true } }),
    ]);
    if (!employee) throw new NotFoundException('Employee not found');
    if (!serviceUser) throw new NotFoundException('Service user not found');

    const start = new Date(dto.startDateTime);
    const end = new Date(dto.endDateTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid start/end date');
    }
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('End time must be after start time');
    }
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    // Service user's weekly contracted hours (Settings → Dom Rules): block, or create with a warning.
    const hours = await this.weeklyHours.checkSpecialVisit({ serviceUserId: dto.serviceUserId, start, end });
    if (hours?.blocked) {
      throw new BadRequestException(`${hours.message}. The special visit was not created (Settings → Dom Rules).`);
    }
    // The carer's weekly hours (Settings → Dom Rules "Carer weekly hours limit").
    const carerRule = await this.carerHours.rule();
    const maxCheck = await this.carerHours.checkNewVisits(this.prisma, dto.employeeId, [
      { start, end, serviceUserId: dto.serviceUserId },
    ]);
    if (maxCheck.noContractedHours) throw carerNoContractedHoursError(dto.employeeId);
    const weekMinutes = maxCheck.weeks[0]?.minutes ?? 0;
    // Above the carer's maximum: refused unless Settings → Dom Rules allows going over it.
    if (maxCheck.overMax.length && !overMaxAllowed(carerRule)) {
      throw carerOverMaxError(
        dto.employeeId,
        `${carerOverMaxMessage(weekMinutes, maxCheck.maxMinutes)}. The special visit was not created — choose another carer.`,
      );
    }
    const hoursLabel = (m: number) => `${Math.round((m / 60) * 10) / 10}h`;
    const carerMessage = maxCheck.overMax.length
      ? visitsNeedApproval(carerRule)
        ? carerOverMaxApprovalMessage(weekMinutes, maxCheck.maxMinutes)
        : carerOverMaxMessage(weekMinutes, maxCheck.maxMinutes)
      : maxCheck.over.length && maxCheck.limitMinutes != null
        ? `The carer would go over their contracted weekly hours (that week ${hoursLabel(weekMinutes)} of ${hoursLabel(maxCheck.limitMinutes)})`
        : null;
    const waitForManager = Boolean(carerMessage) && visitsNeedApproval(carerRule);
    const scheduleBatchId = await this.batchForDate(start);

    const job = await this.prisma.$transaction(async (tx) => {
      const createdJob = await tx.scheduledJob.create({
        data: {
          scheduleBatchId,
          serviceUserId: dto.serviceUserId,
          jobName: dto.title.trim(),
          scheduledStartDateTime: start,
          scheduledEndDateTime: end,
          estimatedDurationMinutes: durationMinutes,
          requiredCarers: 1,
          // Waiting for a manager: the carer goes on it once approved.
          status: waitForManager ? 'UNALLOCATED' : 'ALLOCATED',
          notes: dto.notes?.trim() || null,
          metadata: { special: true },
        },
      });
      if (!waitForManager) {
        await tx.jobAllocation.create({
          data: {
            scheduledJobId: createdJob.id,
            employeeId: dto.employeeId,
            // Over the weekly hours with "request confirmation": on the visit, to be confirmed.
            status: carerMessage ? 'PENDING_CONFIRMATION' : 'CONFIRMED',
            requiresConfirmation: Boolean(carerMessage),
            ...(carerMessage ? { warningTypes: ['CAPACITY_EXCEEDED'], warningMessages: [carerMessage] } : {}),
            isLeadCarer: true,
            scheduledStartDateTime: start,
            scheduledEndDateTime: end,
            durationMinutes,
            allocatedAt: new Date(),
          },
        });
      }
      return createdJob;
    });
    if (waitForManager) {
      await this.carerHours.requestRotaVisitApproval(this.prisma, {
        employeeId: dto.employeeId,
        scheduledJobId: job.id,
        serviceUserId: dto.serviceUserId,
        requestedById: userId,
        start,
        end,
        weekStart: maxCheck.weeks[0]?.weekStart ?? (await this.carerHours.weekStartOf(start)),
        weekMinutes: maxCheck.weeks[0]?.minutes ?? 0,
        limitMinutes: maxCheck.limitMinutes ?? 0,
        source: 'SPECIAL_VISIT',
        allocation: { isLeadCarer: true },
      });
    }

    return {
      data: {
        id: job.id,
        ...(hours ? { weeklyHoursWarning: hours.message } : {}),
        ...(carerMessage
          ? waitForManager
            ? { carerHoursApprovalRequested: `${carerMessage} — sent to a manager; the carer is put on it once approved.` }
            : { carerHoursWarning: `${carerMessage} — needs confirmation on the rota.` }
          : {}),
      },
    };
  }

  async list(employeeId: string, weekStartIso: string) {
    const { start, end } = weekBounds(weekStartIso);
    const allocations = await this.prisma.jobAllocation.findMany({
      where: {
        employeeId,
        deletedAt: null,
        isActive: true,
        scheduledJob: {
          deletedAt: null,
          metadata: SPECIAL_JOB_METADATA,
          scheduledStartDateTime: { gte: start, lt: end },
        },
      },
      include: {
        scheduledJob: {
          include: {
            serviceUser: { select: { firstName: true, lastName: true, preferredName: true } },
          },
        },
      },
      orderBy: { scheduledStartDateTime: 'asc' },
    });

    const rows = allocations
      .filter((a) => a.scheduledJob)
      .map((a) => {
        const j = a.scheduledJob!;
        const su = j.serviceUser;
        const minutes = jobMinutes(j);
        return {
          id: j.id,
          serviceUserId: j.serviceUserId,
          serviceUserName: su
            ? `${su.firstName} ${su.lastName}`.trim() + (su.preferredName ? ` (${su.preferredName})` : '')
            : 'Unknown',
          title: j.jobName,
          notes: j.notes,
          startDateTime: j.scheduledStartDateTime.toISOString(),
          endDateTime: j.scheduledEndDateTime ? j.scheduledEndDateTime.toISOString() : null,
          durationMinutes: minutes,
          hours: round2(minutes / 60),
        };
      });
    return { data: rows };
  }

  async remove(userId: string, jobId: string) {
    const job = await this.prisma.scheduledJob.findFirst({
      where: { id: jobId, deletedAt: null, metadata: SPECIAL_JOB_METADATA },
      select: { id: true },
    });
    if (!job) throw new NotFoundException('Special visit not found');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.jobAllocation.updateMany({
        where: { scheduledJobId: jobId, deletedAt: null },
        data: { deletedAt: now, isActive: false, unallocatedAt: now, unallocationReason: 'Special visit removed' },
      }),
      this.prisma.scheduledJob.update({
        where: { id: jobId },
        data: { deletedAt: now, isActive: false, status: 'CANCELLED' },
      }),
    ]);
    return { data: { id: jobId } };
  }

  /** Contracted vs booked (regular visits) vs special-visit hours for the carer that week. */
  async summary(employeeId: string, weekStartIso: string) {
    const { start, end } = weekBounds(weekStartIso);

    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId, deletedAt: null },
      select: { contractedWeeklyHours: true, guaranteedWeeklyHours: true },
    });
    const contractedHours =
      employment?.contractedWeeklyHours ?? employment?.guaranteedWeeklyHours ?? 0;

    const allocations = await this.prisma.jobAllocation.findMany({
      where: {
        employeeId,
        deletedAt: null,
        isActive: true,
        status: { in: [...ACTIVE_ALLOCATION_STATUSES] },
        scheduledJob: { deletedAt: null, scheduledStartDateTime: { gte: start, lt: end } },
      },
      include: {
        scheduledJob: {
          select: {
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            estimatedDurationMinutes: true,
            metadata: true,
          },
        },
      },
    });

    let totalMinutes = 0;
    let specialMinutes = 0;
    for (const a of allocations) {
      const j = a.scheduledJob;
      if (!j) continue;
      const minutes = jobMinutes(j);
      totalMinutes += minutes;
      const meta = j.metadata as { special?: boolean } | null;
      if (meta?.special === true) specialMinutes += minutes;
    }

    const specialHours = round2(specialMinutes / 60);
    const bookedHours = round2((totalMinutes - specialMinutes) / 60); // regular visits only
    const usedHours = round2(totalMinutes / 60);
    const remainingHours = round2(contractedHours - usedHours);

    return {
      data: {
        contractedHours: round2(contractedHours),
        bookedHours,
        specialHours,
        usedHours,
        remainingHours,
      },
    };
  }
}
