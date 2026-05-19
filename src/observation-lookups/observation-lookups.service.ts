import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ObservationLookupsService {
  constructor(private readonly prisma: PrismaService) {}

  async listTypes() {
    const rows = await this.prisma.observationType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        sortOrder: r.sortOrder,
        valueKind: r.valueKind,
        usesNews2: r.usesNews2,
        unitLabel: r.unitLabel,
      })),
    };
  }

  async listShareTargets() {
    const rows = await this.prisma.observationShareTarget.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        sortOrder: r.sortOrder,
      })),
    };
  }

  async getWellbeingScale() {
    const dimensions = await this.prisma.wellbeingDimension.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        levelLabels: { orderBy: { level: 'asc' } },
      },
    });
    return {
      data: dimensions.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        sortOrder: d.sortOrder,
        levels: d.levelLabels.map((l) => ({
          level: l.level,
          label: l.label,
        })),
      })),
    };
  }
}
