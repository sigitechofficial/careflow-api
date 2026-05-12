import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeLeavingRecordDto } from './dto/create-employee-leaving-record.dto';
import { UpdateEmployeeLeavingRecordDto } from './dto/update-employee-leaving-record.dto';

@Injectable()
export class EmployeeLeavingRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(employeeId: string) {
    const items = await this.prisma.employeeLeavingRecord.findMany({
      where: { employeeId, deletedAt: null },
      include: { leavingReason: true },
      orderBy: { leavingDate: 'desc' },
    });
    return { data: items };
  }

  async create(userId: string, employeeId: string, dto: CreateEmployeeLeavingRecordDto) {
    await this.ensureEmployee(employeeId);
    const created = await this.prisma.employeeLeavingRecord.create({
      data: { employeeId, ...dto, createdById: userId },
    });
    return { message: 'Leaving record created', data: created };
  }

  async update(
    userId: string,
    employeeId: string,
    recordId: string,
    dto: UpdateEmployeeLeavingRecordDto,
  ) {
    await this.ensureEmployee(employeeId);
    const existing = await this.prisma.employeeLeavingRecord.findFirst({
      where: { id: recordId, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Leaving record not found');
    const updated = await this.prisma.employeeLeavingRecord.update({
      where: { id: recordId },
      data: { ...dto, updatedById: userId },
    });
    return { message: 'Leaving record updated', data: updated };
  }

  async remove(userId: string, employeeId: string, recordId: string) {
    await this.ensureEmployee(employeeId);
    const existing = await this.prisma.employeeLeavingRecord.findFirst({
      where: { id: recordId, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Leaving record not found');
    await this.prisma.employeeLeavingRecord.update({
      where: { id: recordId },
      data: { deletedAt: new Date(), deletedById: userId, isActive: false },
    });
    return { message: 'Leaving record deleted', data: {} };
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}

