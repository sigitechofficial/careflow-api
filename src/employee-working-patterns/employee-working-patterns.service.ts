import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BulkReplaceWorkingPatternsDto } from './dto/bulk-replace-working-patterns.dto';
import { CreateWorkingPatternDto } from './dto/create-working-pattern.dto';
import { UpdateWorkingPatternDto } from './dto/update-working-pattern.dto';
import { parseIsoDateOnly } from './working-pattern-cycle.util';

@Injectable()
export class EmployeeWorkingPatternsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(employeeId: string) {
    const [items, employment] = await Promise.all([
      this.prisma.employeeWorkingPattern.findMany({
        where: { employeeId, deletedAt: null },
        orderBy: [{ weekInCycle: 'asc' }, { dayOfWeek: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.employeeEmployment.findFirst({
        where: { employeeId, deletedAt: null },
        select: {
          workingPatternCycleWeeks: true,
          workingPatternCycleAnchorDate: true,
          startDate: true,
        },
      }),
    ]);
    return {
      data: items,
      meta: {
        cycleWeeks: employment?.workingPatternCycleWeeks ?? 1,
        cycleAnchorDate: employment?.workingPatternCycleAnchorDate
          ? employment.workingPatternCycleAnchorDate.toISOString().slice(0, 10)
          : employment?.startDate
            ? employment.startDate.toISOString().slice(0, 10)
            : null,
      },
    };
  }

  async create(userId: string, employeeId: string, dto: CreateWorkingPatternDto) {
    await this.ensureEmployee(employeeId);
    const created = await this.prisma.employeeWorkingPattern.create({
      data: {
        employeeId,
        weekInCycle: dto.weekInCycle ?? 1,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        isAvailable: dto.isAvailable ?? true,
        notes: dto.notes,
        createdById: userId,
      },
    });
    return { message: 'Working pattern created', data: created };
  }

  async update(userId: string, employeeId: string, patternId: string, dto: UpdateWorkingPatternDto) {
    await this.ensureEmployee(employeeId);
    const existing = await this.prisma.employeeWorkingPattern.findFirst({
      where: { id: patternId, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Working pattern not found');
    const updated = await this.prisma.employeeWorkingPattern.update({
      where: { id: patternId },
      data: { ...dto, updatedById: userId },
    });
    return { message: 'Working pattern updated', data: updated };
  }

  async remove(userId: string, employeeId: string, patternId: string) {
    await this.ensureEmployee(employeeId);
    const existing = await this.prisma.employeeWorkingPattern.findFirst({
      where: { id: patternId, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Working pattern not found');
    await this.prisma.employeeWorkingPattern.update({
      where: { id: patternId },
      data: { deletedAt: new Date(), deletedById: userId, isActive: false },
    });
    return { message: 'Working pattern deleted', data: {} };
  }

  async bulkReplace(userId: string, employeeId: string, dto: BulkReplaceWorkingPatternsDto) {
    await this.ensureEmployee(employeeId);

    const cycleWeeks = dto.cycleWeeks ?? 1;
    if (cycleWeeks !== 1 && cycleWeeks !== 2) {
      throw new BadRequestException('cycleWeeks must be 1 or 2');
    }

    let anchorDate: Date | undefined;
    if (dto.cycleAnchorDate) {
      const parsed = parseIsoDateOnly(dto.cycleAnchorDate);
      if (!parsed) throw new BadRequestException('cycleAnchorDate must be YYYY-MM-DD');
      anchorDate = parsed;
    }

    for (const w of dto.weeks) {
      if (w.weekInCycle < 1 || w.weekInCycle > cycleWeeks) {
        throw new BadRequestException(
          `weekInCycle ${w.weekInCycle} is invalid for cycleWeeks ${cycleWeeks}`,
        );
      }
    }

    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.employeeWorkingPattern.updateMany({
        where: { employeeId, deletedAt: null },
        data: { deletedAt: now, deletedById: userId, isActive: false },
      });

      const employmentUpdate: {
        workingPatternCycleWeeks: number;
        workingPatternCycleAnchorDate?: Date | null;
        updatedById: string;
      } = {
        workingPatternCycleWeeks: cycleWeeks,
        updatedById: userId,
      };
      if (dto.cycleAnchorDate !== undefined) {
        employmentUpdate.workingPatternCycleAnchorDate = anchorDate ?? null;
      }

      await tx.employeeEmployment.updateMany({
        where: { employeeId, deletedAt: null },
        data: employmentUpdate,
      });

      const rows = [];
      for (const w of dto.weeks) {
        if (w.isAvailable === false && !w.startTime?.trim() && !w.endTime?.trim()) {
          // persist explicit unavailable day
        } else if (w.isAvailable !== false && !w.startTime?.trim() && !w.endTime?.trim()) {
          continue;
        }
        const row = await tx.employeeWorkingPattern.create({
          data: {
            employeeId,
            weekInCycle: w.weekInCycle,
            dayOfWeek: w.dayOfWeek,
            startTime: w.startTime?.trim() || null,
            endTime: w.endTime?.trim() || null,
            isAvailable: w.isAvailable ?? true,
            notes: w.notes ?? null,
            createdById: userId,
          },
        });
        rows.push(row);
      }
      return rows;
    });

    return { message: 'Working patterns replaced', data: created };
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
