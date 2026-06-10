import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMedicationAdministrationRoundDto } from './dto/create-medication-administration-round.dto';
import { UpdateMedicationAdministrationRoundDto } from './dto/update-medication-administration-round.dto';

function slugRoundCode(name: string): string {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'CUSTOM';
}

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

  async create(dto: CreateMedicationAdministrationRoundDto) {
    const baseCode = dto.code?.trim() || slugRoundCode(dto.name);
    let code = baseCode;
    let suffix = 0;
    while (
      await this.prisma.medicationAdministrationRound.findFirst({
        where: { code },
      })
    ) {
      suffix += 1;
      code = `${baseCode}_${suffix}`;
      if (suffix > 99) {
        throw new ConflictException('Could not generate a unique time slot code');
      }
    }

    const maxSort = await this.prisma.medicationAdministrationRound.aggregate({
      where: { deletedAt: null },
      _max: { sortOrder: true },
    });

    const row = await this.prisma.medicationAdministrationRound.create({
      data: {
        name: dto.name.trim(),
        code,
        time: dto.time,
        windowStart: dto.windowStart ?? null,
        windowEnd: dto.windowEnd ?? null,
        sortOrder: dto.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        isActive: true,
      },
    });
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
