import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeHolidayDto } from './dto/create-employee-holiday.dto';
import { UpdateEmployeeHolidayDto } from './dto/update-employee-holiday.dto';

@Injectable()
export class EmployeeHolidaysService {
  constructor(private readonly prisma: PrismaService) {}

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
    const created = await this.prisma.employeeHoliday.create({
      data: { employeeId, ...dto, createdById: userId },
    });
    return { message: 'Holiday created', data: created };
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

    const updated = await this.prisma.employeeHoliday.update({
      where: { id: holidayId },
      data: { ...dto, updatedById: userId },
    });
    return { message: 'Holiday updated', data: updated };
  }

  async remove(userId: string, employeeId: string, holidayId: string) {
    await this.ensureEmployee(employeeId);
    const existing = await this.prisma.employeeHoliday.findFirst({
      where: { id: holidayId, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Holiday not found');

    await this.prisma.employeeHoliday.update({
      where: { id: holidayId },
      data: { deletedAt: new Date(), deletedById: userId, isActive: false },
    });
    return { message: 'Holiday deleted', data: {} };
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}

