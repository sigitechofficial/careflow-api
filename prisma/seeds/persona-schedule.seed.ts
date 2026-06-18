/**
 * Generate scheduled jobs + visits from persona visit plans (SU-TEST-P*).
 * Mirrors ServiceUserVisitPlansService.generateSchedule for batch seeding.
 */

import {
  AllocationStatus,
  Prisma,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitPlanStatus,
  type PrismaClient,
} from '@prisma/client';
import { buildVisitPlanOccurrence } from '../../src/service-user-visit-plans/visit-plan-generate-occurrence.util';
import { slotLabel } from '../../src/service-user-visit-plans/visit-plan-slot-defaults';

const DAY_MS = 86400000;
const PERSONA_PREFIX = 'SU-TEST-';

export type SeedPersonaScheduleOptions = {
  fromDate?: string;
  toDate?: string;
  /** Assign sample carers to unallocated persona jobs across the full date range */
  sampleAllocations?: boolean;
  /** Create carer ScheduleRun rows and link allocated jobs */
  scheduleRuns?: boolean;
  scheduleAreaCode?: string;
};

function parseDateOnly(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Invalid date (YYYY-MM-DD): ${value}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}


function defaultDateRange(): { fromDate: string; toDate: string } {
  const today = new Date();
  const utc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const from = utc;
  const to = new Date(utc.getTime() + 6 * DAY_MS);
  return { fromDate: formatDateOnly(from), toDate: formatDateOnly(to) };
}

async function loadRoundNameMap(prisma: PrismaClient): Promise<Map<string, string>> {
  const rows = await prisma.medicationAdministrationRound.findMany({
    where: { deletedAt: null, isActive: true },
    select: { code: true, name: true },
  });
  return new Map(rows.map((r) => [r.code, r.name]));
}

async function resolveSeedUserId(prisma: PrismaClient): Promise<string | null> {
  const user =
    (await prisma.user.findFirst({ where: { email: 'admin@careadmin.local', isActive: true } })) ??
    (await prisma.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }));
  return user?.id ?? null;
}

async function finalizeScheduleBatch(
  prisma: PrismaClient,
  batchId: string,
  userId: string | null,
): Promise<void> {
  const areas = await prisma.scheduleArea.findMany({
    where: { deletedAt: null, isActive: true },
  });
  const now = new Date();
  for (const area of areas) {
    await prisma.scheduleAreaStatus.upsert({
      where: {
        scheduleBatchId_scheduleAreaId: { scheduleBatchId: batchId, scheduleAreaId: area.id },
      },
      create: {
        scheduleBatchId: batchId,
        scheduleAreaId: area.id,
        status: 'BUILT',
        builtAt: now,
        builtById: userId,
        metadata: { personaSeed: true } as Prisma.InputJsonValue,
      },
      update: {
        status: 'BUILT',
        builtAt: now,
        builtById: userId,
        deletedAt: null,
        isActive: true,
      },
    });
  }
  await prisma.scheduleBatch.update({
    where: { id: batchId },
    data: {
      status: 'BUILT',
      builtAt: now,
      builtById: userId,
      metadata: { personaSeed: true, finalized: true } as Prisma.InputJsonValue,
    },
  });
}

async function generatePlanSchedule(
  prisma: PrismaClient,
  userId: string | null,
  serviceUserId: string,
  planId: string,
  from: Date,
  to: Date,
  scheduleAreaId: string | null,
  roundNameByCode: Map<string, string>,
): Promise<{ visitsCreated: number; visitsSkipped: number; batchIds: Set<string> }> {
  const plan = await prisma.serviceUserVisitPlan.findFirst({
    where: { id: planId, serviceUserId, deletedAt: null, isActive: true, status: VisitPlanStatus.ACTIVE },
    include: {
      slots: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          carerAssignments: { orderBy: { sortOrder: 'asc' } },
          exceptions: true,
        },
      },
    },
  });
  if (!plan) return { visitsCreated: 0, visitsSkipped: 0, batchIds: new Set() };

  const enabledSlots = plan.slots.filter((s) => s.isEnabled);
  if (!enabledSlots.length) return { visitsCreated: 0, visitsSkipped: 0, batchIds: new Set() };

  const su = await prisma.serviceUser.findFirst({
    where: { id: serviceUserId },
    include: { address: true },
  });

  let visitsCreated = 0;
  let visitsSkipped = 0;
  const batchIds = new Set<string>();
  const scheduleAnchor = plan.effectiveFrom;

  await prisma.$transaction(async (tx) => {
    for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
      const day = new Date(t);
      const dateStr = formatDateOnly(day);

      let batch = await tx.scheduleBatch.findFirst({
        where: { scheduleDate: day, deletedAt: null, isActive: true },
      });
      if (!batch) {
        batch = await tx.scheduleBatch.create({
          data: {
            scheduleDate: day,
            status: 'BUILDING',
            buildSource: 'MANUAL',
            metadata: { personaSeed: true, visitPlanId: planId } as Prisma.InputJsonValue,
            createdById: userId,
          },
        });
      }
      batchIds.add(batch.id);

      for (const slot of enabledSlots) {
        const occurrence = buildVisitPlanOccurrence(slot, day, scheduleAnchor, plan.effectiveTo);
        if (!occurrence) continue;

        const { start, end, requiredCarers, carerWindows, durationMinutes, isOvernight } = occurrence;

        const existingVisit = await tx.scheduledVisit.findFirst({
          where: {
            visitPlanSlotId: slot.id,
            deletedAt: null,
            scheduledStartDateTime: start,
          },
        });
        if (existingVisit) {
          visitsSkipped += 1;
          continue;
        }

        const label = slotLabel(slot.medicationRoundCode ?? slot.slotCode, roundNameByCode);
        const clientName = su?.preferredName ?? su?.firstName ?? 'Client';

        const job = await tx.scheduledJob.create({
          data: {
            scheduleBatchId: batch.id,
            scheduleAreaId,
            serviceUserId,
            jobName: `${label} — ${clientName}`,
            scheduledStartDateTime: start,
            scheduledEndDateTime: end,
            estimatedDurationMinutes: durationMinutes,
            requiredCarers,
            status: ScheduledJobStatus.UNALLOCATED,
            postcode: su?.address?.postcode ?? null,
            address: su?.address
              ? [su.address.addressLine1, su.address.addressLine2, su.address.town, su.address.postcode]
                  .filter(Boolean)
                  .join(', ')
              : null,
            metadata: {
              personaSeed: true,
              visitPlanId: planId,
              visitPlanSlotId: slot.id,
              date: dateStr,
              serviceUserNumber: su?.serviceUserNumber,
              isOvernight,
            } as Prisma.InputJsonValue,
            createdById: userId,
          },
        });

        const visit = await tx.scheduledVisit.create({
          data: {
            scheduledJobId: job.id,
            serviceUserId,
            visitName: label,
            scheduledStartDateTime: start,
            scheduledEndDateTime: end,
            requiredCarers,
            status: ScheduledVisitStatus.PLANNED,
            medicationRequired: Boolean(slot.medicationRoundCode),
            notesRequired: slot.notesRequired,
            photoRequired: slot.photoAllowed,
            visitPlanSlotId: slot.id,
            createdById: userId,
          },
        });

        const allocations = carerWindows.length
          ? carerWindows
          : (slot.assignedEmployeeIds ?? []).slice(0, requiredCarers).map((employeeId, index) => ({
              employeeId,
              start,
              end,
              durationMinutes,
              isLeadCarer: index === 0,
            }));

        if (allocations.length > 0) {
          for (const carer of allocations) {
            await tx.jobAllocation.create({
              data: {
                scheduledJobId: job.id,
                scheduledVisitId: visit.id,
                employeeId: carer.employeeId,
                status: AllocationStatus.CONFIRMED,
                requiresConfirmation: false,
                allocatedById: userId,
                scheduledStartDateTime: carer.start,
                scheduledEndDateTime: carer.end,
                durationMinutes: carer.durationMinutes,
                isLeadCarer: carer.isLeadCarer,
              },
            });
          }
        }

        const jobStatus =
          allocations.length >= requiredCarers
            ? ScheduledJobStatus.ALLOCATED
            : ScheduledJobStatus.UNALLOCATED;

        await tx.scheduledJob.update({
          where: { id: job.id },
          data: { status: jobStatus },
        });

        if (jobStatus === ScheduledJobStatus.ALLOCATED) {
          await tx.scheduledVisit.update({
            where: { id: visit.id },
            data: { status: ScheduledVisitStatus.ALLOCATED },
          });
        }

        visitsCreated += 1;
      }
    }
  });

  return { visitsCreated, visitsSkipped, batchIds };
}

async function applySampleAllocations(
  prisma: PrismaClient,
  userId: string | null,
  fromDate: string,
): Promise<number> {
  const dayStart = parseDateOnly(fromDate);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS - 1);

  const employees = await prisma.employee.findMany({
    where: { deletedAt: null, personalDetail: { is: { deletedAt: null } } },
    take: 20,
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!employees.length) return 0;

  const jobs = await prisma.scheduledJob.findMany({
    where: {
      deletedAt: null,
      scheduledStartDateTime: { gte: dayStart, lte: dayEnd },
      serviceUser: { serviceUserNumber: { startsWith: PERSONA_PREFIX } },
      status: { in: [ScheduledJobStatus.UNALLOCATED, ScheduledJobStatus.NEEDS_ATTENTION] },
    },
    orderBy: { scheduledStartDateTime: 'asc' },
    include: { visits: { where: { deletedAt: null }, take: 1 } },
  });

  let allocated = 0;
  let employeeIdx = 0;

  for (const job of jobs) {
    const existingCount = await prisma.jobAllocation.count({
      where: { scheduledJobId: job.id, deletedAt: null },
    });
    if (existingCount >= job.requiredCarers) continue;

    const needed = job.requiredCarers - existingCount;
    const visit = job.visits[0];

    for (let i = 0; i < needed; i++) {
      const employee = employees[employeeIdx % employees.length];
      employeeIdx += 1;

      await prisma.jobAllocation.create({
        data: {
          scheduledJobId: job.id,
          scheduledVisitId: visit?.id ?? null,
          employeeId: employee.id,
          status: AllocationStatus.CONFIRMED,
          requiresConfirmation: false,
          allocatedById: userId,
        },
      });
      allocated += 1;
    }

    const totalAlloc = await prisma.jobAllocation.count({
      where: { scheduledJobId: job.id, deletedAt: null },
    });
    const newStatus =
      totalAlloc >= job.requiredCarers
        ? ScheduledJobStatus.ALLOCATED
        : ScheduledJobStatus.NEEDS_ATTENTION;

    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: { status: newStatus },
    });
    if (visit && newStatus === ScheduledJobStatus.ALLOCATED) {
      await prisma.scheduledVisit.update({
        where: { id: visit.id },
        data: { status: ScheduledVisitStatus.ALLOCATED },
      });
    }
  }

  return allocated;
}

function hmFromDate(d: Date): string {
  return d.toISOString().slice(11, 16);
}

/** One ScheduleRun per carer per day; jobs assigned to the primary (first) carer on each job. */
export async function seedPersonaScheduleRuns(
  prisma: PrismaClient,
  from: Date,
  to: Date,
  userId: string | null,
): Promise<{ runsCreated: number; jobsLinked: number }> {
  let runsCreated = 0;
  let jobsLinked = 0;

  const defaultArea = await prisma.scheduleArea.findFirst({
    where: { deletedAt: null, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const day = new Date(t);
    const dateStr = formatDateOnly(day);
    const dayStart = day;
    const dayEnd = new Date(day.getTime() + DAY_MS - 1);

    const batch = await prisma.scheduleBatch.findFirst({
      where: { scheduleDate: day, deletedAt: null, isActive: true },
    });
    if (!batch) continue;

    const jobs = await prisma.scheduledJob.findMany({
      where: {
        deletedAt: null,
        scheduleBatchId: batch.id,
        serviceUser: { serviceUserNumber: { startsWith: PERSONA_PREFIX } },
        scheduledStartDateTime: { gte: dayStart, lte: dayEnd },
        allocations: { some: { deletedAt: null, isActive: true } },
      },
      orderBy: { scheduledStartDateTime: 'asc' },
      include: {
        allocations: {
          where: { deletedAt: null, isActive: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
          include: {
            employee: {
              select: {
                id: true,
                personalDetail: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    const byEmployee = new Map<
      string,
      {
        employee: { firstName: string; lastName: string };
        jobs: typeof jobs;
      }
    >();

    for (const job of jobs) {
      const primary = job.allocations[0];
      if (!primary) continue;
      const empId = primary.employeeId;
      const pd = primary.employee?.personalDetail;
      const label = {
        firstName: pd?.firstName?.trim() || 'Carer',
        lastName: pd?.lastName?.trim() || '',
      };
      if (!byEmployee.has(empId)) {
        byEmployee.set(empId, { employee: label, jobs: [] });
      }
      byEmployee.get(empId)!.jobs.push(job);
    }

    let sortOrder = 0;
    for (const [employeeId, bucket] of byEmployee) {
      const runJobs = bucket.jobs.sort(
        (a, b) => a.scheduledStartDateTime.getTime() - b.scheduledStartDateTime.getTime(),
      );
      if (!runJobs.length) continue;

      const first = runJobs[0]!;
      const last = runJobs[runJobs.length - 1]!;
      const runName = `${bucket.employee.firstName} ${bucket.employee.lastName}`.trim();
      const marker = `PERSONA_RUN:${employeeId}`;

      let run = await prisma.scheduleRun.findFirst({
        where: {
          scheduleBatchId: batch.id,
          deletedAt: null,
          description: marker,
        },
      });

      if (!run) {
        run = await prisma.scheduleRun.create({
          data: {
            scheduleBatchId: batch.id,
            scheduleAreaId: first.scheduleAreaId ?? defaultArea?.id ?? null,
            name: runName,
            description: marker,
            runDate: day,
            startTime: hmFromDate(first.scheduledStartDateTime),
            endTime: hmFromDate(last.scheduledEndDateTime ?? last.scheduledStartDateTime),
            sortOrder,
            createdById: userId,
          },
        });
        runsCreated += 1;
      } else {
        await prisma.scheduleRun.update({
          where: { id: run.id },
          data: {
            name: runName,
            startTime: hmFromDate(first.scheduledStartDateTime),
            endTime: hmFromDate(last.scheduledEndDateTime ?? last.scheduledStartDateTime),
            sortOrder,
            scheduleAreaId: first.scheduleAreaId ?? defaultArea?.id ?? null,
            isActive: true,
            deletedAt: null,
          },
        });
      }
      sortOrder += 1;

      for (const job of runJobs) {
        if (job.scheduleRunId === run.id) continue;
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { scheduleRunId: run.id },
        });
        jobsLinked += 1;
      }
    }
  }

  return { runsCreated, jobsLinked };
}

async function applySampleAllocationsForRange(
  prisma: PrismaClient,
  userId: string | null,
  from: Date,
  to: Date,
): Promise<number> {
  let total = 0;
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    total += await applySampleAllocations(prisma, userId, formatDateOnly(new Date(t)));
  }
  return total;
}

export async function seedPersonaSchedule(
  prisma: PrismaClient,
  options: SeedPersonaScheduleOptions = {},
): Promise<void> {
  const range = defaultDateRange();
  const fromDate = options.fromDate ?? process.env.SCHEDULE_FROM_DATE ?? range.fromDate;
  const toDate = options.toDate ?? process.env.SCHEDULE_TO_DATE ?? range.toDate;
  const from = parseDateOnly(fromDate);
  const to = parseDateOnly(toDate);
  if (to.getTime() < from.getTime()) {
    throw new Error('toDate must be on or after fromDate');
  }
  if (to.getTime() - from.getTime() > 31 * DAY_MS) {
    throw new Error('Date range cannot exceed 31 days');
  }

  const userId = await resolveSeedUserId(prisma);
  const roundNameByCode = await loadRoundNameMap(prisma);

  let scheduleAreaId: string | null = null;
  if (options.scheduleAreaCode) {
    const area = await prisma.scheduleArea.findFirst({
      where: { code: options.scheduleAreaCode, deletedAt: null, isActive: true },
    });
    scheduleAreaId = area?.id ?? null;
  }

  const personas = await prisma.serviceUser.findMany({
    where: {
      serviceUserNumber: { startsWith: PERSONA_PREFIX },
      deletedAt: null,
      status: { code: { notIn: ['PRE_ADMISSION', 'DISCHARGED', 'DECEASED'] } },
    },
    include: {
      visitPlans: {
        where: { status: VisitPlanStatus.ACTIVE, deletedAt: null, isActive: true },
        take: 1,
      },
    },
    orderBy: { serviceUserNumber: 'asc' },
  });

  console.log(`[seed] Persona schedule: ${fromDate} → ${toDate} for ${personas.length} service user(s)`);

  let totalCreated = 0;
  let totalSkipped = 0;
  const allBatchIds = new Set<string>();

  for (const su of personas) {
    const plan = su.visitPlans[0];
    if (!plan) {
      console.log(`  ⊘ ${su.serviceUserNumber} — no active visit plan`);
      continue;
    }

    const result = await generatePlanSchedule(
      prisma,
      userId,
      su.id,
      plan.id,
      from,
      to,
      scheduleAreaId,
      roundNameByCode,
    );
    totalCreated += result.visitsCreated;
    totalSkipped += result.visitsSkipped;
    result.batchIds.forEach((id) => allBatchIds.add(id));
    console.log(
      `  ✓ ${su.serviceUserNumber} ${su.firstName} ${su.lastName}: +${result.visitsCreated} visits (${result.visitsSkipped} skipped)`,
    );
  }

  for (const batchId of allBatchIds) {
    await finalizeScheduleBatch(prisma, batchId, userId);
  }

  let allocations = 0;
  if (options.sampleAllocations !== false) {
    allocations = await applySampleAllocationsForRange(prisma, userId, from, to);
  }

  let runsCreated = 0;
  let jobsLinked = 0;
  if (options.scheduleRuns !== false) {
    const runResult = await seedPersonaScheduleRuns(prisma, from, to, userId);
    runsCreated = runResult.runsCreated;
    jobsLinked = runResult.jobsLinked;
  }

  const jobCount = await prisma.scheduledJob.count({
    where: {
      deletedAt: null,
      serviceUser: { serviceUserNumber: { startsWith: PERSONA_PREFIX } },
      scheduledStartDateTime: { gte: from, lte: new Date(to.getTime() + DAY_MS - 1) },
    },
  });

  console.log(
    `[seed] Persona schedule complete — ${totalCreated} visits created (${totalSkipped} skipped), ${jobCount} jobs in range, ${allBatchIds.size} batch(es), ${allocations} allocation(s), ${runsCreated} carer run(s), ${jobsLinked} job(s) linked to runs`,
  );
}
