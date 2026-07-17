import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleLifecycleImpactService } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.service';
import type { ScheduleImpactResult } from '../schedule-lifecycle-impact/schedule-lifecycle-impact.util';
import { CreateEmployeeHolidayDto } from './dto/create-employee-holiday.dto';
import { UpdateEmployeeHolidayDto } from './dto/update-employee-holiday.dto';

/**
 * Whole-day holiday bookings map to an absence span of
 * start date 00:00 UTC → end date 23:55 UTC (absence tracker convention).
 */
function holidayAbsenceSpan(startDate: Date, endDate: Date): { from: Date; to: Date } {
  const from = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()),
  );
  const to = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), 23, 55),
  );
  return { from, to };
}

@Injectable()
export class EmployeeHolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleImpact: ScheduleLifecycleImpactService,
  ) {}

  /**
   * Upserts the UKVI absence-tracker record linked to a holiday booking so annual
   * leave only needs to be entered once. Only booking-derived fields (span, notes)
   * are overwritten on sync; compliance fields edited on the tracker are preserved.
   */
  private async syncAbsenceRecord(
    tx: Prisma.TransactionClient,
    userId: string,
    holiday: { id: string; employeeId: string; startDate: Date; endDate: Date; notes: string | null },
  ) {
    const { from, to } = holidayAbsenceSpan(holiday.startDate, holiday.endDate);
    const existing = await tx.employeeAbsenceRecord.findUnique({
      where: { holidayId: holiday.id },
      select: { id: true, deletedAt: true },
    });
    if (existing) {
      await tx.employeeAbsenceRecord.update({
        where: { id: existing.id },
        data: {
          fromDateTime: from,
          toDateTime: to,
          notes: holiday.notes?.trim() || null,
          // Restore the record if the holiday is re-edited after tracker-side deletion.
          deletedAt: null,
          isActive: true,
          updatedById: userId,
        },
      });
      return;
    }
    await tx.employeeAbsenceRecord.create({
      data: {
        employeeId: holiday.employeeId,
        holidayId: holiday.id,
        absenceType: 'Holiday',
        fromDateTime: from,
        toDateTime: to,
        notes: holiday.notes?.trim() || null,
        permissionStatus: 'Authorised',
        evidenceTypeRequired: 'Approved annual leave record',
        evidenceHeld: true,
        evidenceReceivedDate: from,
        evidenceNotesStatus: 'Notes Received',
        managerAction: 'No action unless required',
        responsiblePerson: 'HR / Compliance',
        createdById: userId,
        updatedById: userId,
      },
    });
  }

  async list(employeeId: string) {
    const items = await this.prisma.employeeHoliday.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: { startDate: 'desc' },
    });
    return { data: items };
  }

  async create(userId: string, employeeId: string, dto: CreateEmployeeHolidayDto) {
    await this.ensureEmployee(employeeId);
    if (dto.endDate.getTime() < dto.startDate.getTime()) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
    const { applyToSchedule, ...holidayData } = dto;
    const created = await this.prisma.$transaction(async (tx) => {
      const holiday = await tx.employeeHoliday.create({
        data: { employeeId, ...holidayData, createdById: userId },
      });
      await this.syncAbsenceRecord(tx, userId, holiday);
      return holiday;
    });

    let scheduleImpact: ScheduleImpactResult | undefined;
    if (applyToSchedule !== false) {
      scheduleImpact = await this.scheduleImpact.unallocateEmployeeJobsInRange(userId, {
        employeeId,
        fromDate: dto.startDate,
        toDate: dto.endDate,
        reason: dto.notes?.trim() ? `Employee holiday: ${dto.notes.trim()}` : 'Employee holiday',
        source: 'employee_holiday',
      });
    }

    return {
      message: 'Holiday created',
      data: created,
      ...(scheduleImpact ? { scheduleImpact } : {}),
    };
  }

  async update(userId: string, employeeId: string, holidayId: string, dto: UpdateEmployeeHolidayDto) {
    await this.ensureEmployee(employeeId);
    const existing = await this.prisma.employeeHoliday.findFirst({
      where: { id: holidayId, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Holiday not found');

    const startDate = dto.startDate ?? existing.startDate;
    const endDate = dto.endDate ?? existing.endDate;
    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('endDate must be on or after startDate');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const holiday = await tx.employeeHoliday.update({
        where: { id: holidayId },
        data: { ...dto, updatedById: userId },
      });
      await this.syncAbsenceRecord(tx, userId, holiday);
      return holiday;
    });
    return { message: 'Holiday updated', data: updated };
  }

  async remove(userId: string, employeeId: string, holidayId: string) {
    await this.ensureEmployee(employeeId);
    const existing = await this.prisma.employeeHoliday.findFirst({
      where: { id: holidayId, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Holiday not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeHoliday.update({
        where: { id: holidayId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });
      await tx.employeeAbsenceRecord.updateMany({
        where: { holidayId, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false, updatedById: userId },
      });
    });
    return { message: 'Holiday deleted', data: {} };
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}

