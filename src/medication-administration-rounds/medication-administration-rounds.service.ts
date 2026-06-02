import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateMedicationAdministrationRoundDto } from './dto/update-medication-administration-round.dto';

@Injectable()
export class MedicationAdministrationRoundsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForAdmin() {
    const rows = await this.prisma.medicationAdministrationRound.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return { data: rows };
  }

  async getById(id: string) {
    const row = await this.prisma.medicationAdministrationRound.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Medication time slot not found');
    return { data: row };
  }

  async update(id: string, dto: UpdateMedicationAdministrationRoundDto) {
    await this.getById(id);
    const row = await this.prisma.medicationAdministrationRound.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.time !== undefined ? { time: dto.time } : {}),
        ...(dto.windowStart !== undefined ? { windowStart: dto.windowStart } : {}),
        ...(dto.windowEnd !== undefined ? { windowEnd: dto.windowEnd } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return { data: row };
  }
}
