import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkingPatternDto } from './dto/create-working-pattern.dto';
import { UpdateWorkingPatternDto } from './dto/update-working-pattern.dto';

@Injectable()
export class EmployeeWorkingPatternsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(employeeId: string) {
    const items = await this.prisma.employeeWorkingPattern.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return { data: items };
  }

  async create(userId: string, employeeId: string, dto: CreateWorkingPatternDto) {
    await this.ensureEmployee(employeeId);
    const created = await this.prisma.employeeWorkingPattern.create({
      data: { employeeId, ...dto, createdById: userId },
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

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}

