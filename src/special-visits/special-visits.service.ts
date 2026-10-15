import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSpecialVisitDto } from './dto/special-visit.dto';

/** Allocation statuses that count as the carer actually being booked. */
const ACTIVE_ALLOCATION_STATUSES = ['PENDING_CONFIRMATION', 'ALLOCATED', 'CONFIRMED'] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A week is [weekStart 00:00 UTC, +7 days). */
function weekBounds(weekStartIso: string): { start: Date; end: Date } {
  const start = new Date(`${weekStartIso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new BadRequestException('Invalid weekStart date');
  return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

type SpecialVisitRow = {
  id: string;
  employeeId: string;
  visitDate: Date;
  durationMinutes: number;
  title: string;
  notes: string | null;
  createdAt: Date;
};

function serialize(row: SpecialVisitRow) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    visitDate: row.visitDate.toISOString().slice(0, 10),
    durationMinutes: row.durationMinutes,
    hours: round2(row.durationMinutes / 60),
    title: row.title,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class SpecialVisitsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(employeeId: string, weekStartIso: string) {
    const { start, end } = weekBounds(weekStartIso);
    const rows = await this.prisma.specialVisit.findMany({
      where: { employeeId, deletedAt: null, visitDate: { gte: start, lt: end } },
      orderBy: { visitDate: 'asc' },
    });
    return { data: rows.map(serialize) };
  }

  async create(userId: string, dto: CreateSpecialVisitDto) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const row = await this.prisma.specialVisit.create({
      data: {
        employeeId: dto.employeeId,
        visitDate: new Date(`${dto.visitDate.slice(0, 10)}T00:00:00.000Z`),
        durationMinutes: dto.durationMinutes,
        title: dto.title.trim(),
        notes: dto.notes?.trim() || null,
        createdById: userId,
        updatedById: userId,
      },
    });
    return { data: serialize(row) };
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.specialVisit.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Special visit not found');
    await this.prisma.specialVisit.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId, isActive: false },
    });
    return { data: { id } };
  }

  /** Contracted vs booked (visits) vs special-visit hours for the carer that week. */
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
        scheduledJob: {
          deletedAt: null,
          scheduledStartDateTime: { gte: start, lt: end },
        },
      },
      include: {
        scheduledJob: {
          select: {
            scheduledStartDateTime: true,
            scheduledEndDateTime: true,
            estimatedDurationMinutes: true,
          },
        },
      },
    });
    let bookedMinutes = 0;
    for (const a of allocations) {
      const j = a.scheduledJob;
      if (!j) continue;
      if (j.estimatedDurationMinutes && j.estimatedDurationMinutes > 0) {
        bookedMinutes += j.estimatedDurationMinutes;
      } else if (j.scheduledEndDateTime) {
        bookedMinutes += Math.max(
          0,
          (j.scheduledEndDateTime.getTime() - j.scheduledStartDateTime.getTime()) / 60_000,
        );
      }
    }

    const specials = await this.prisma.specialVisit.findMany({
      where: { employeeId, deletedAt: null, visitDate: { gte: start, lt: end } },
      select: { durationMinutes: true },
    });
    const specialMinutes = specials.reduce((s, r) => s + r.durationMinutes, 0);

    const bookedHours = round2(bookedMinutes / 60);
    const specialHours = round2(specialMinutes / 60);
    const usedHours = round2(bookedHours + specialHours);
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
