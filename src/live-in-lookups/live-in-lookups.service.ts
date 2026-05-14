import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LiveInLookupsService {
  constructor(private readonly prisma: PrismaService) {}

  private async serviceTypes() {
    return this.prisma.liveInServiceType.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  private async levels() {
    return this.prisma.liveInLevelOfCare.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  private async scanTypes() {
    return this.prisma.liveInScanType.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async bundle() {
    const [serviceTypes, levelsOfCare, scanTypes] = await Promise.all([
      this.serviceTypes(),
      this.levels(),
      this.scanTypes(),
    ]);
    return { data: { serviceTypes, levelsOfCare, scanTypes } };
  }

  async listServiceTypes() {
    return { data: await this.serviceTypes() };
  }

  async listLevelsOfCare() {
    return { data: await this.levels() };
  }

  async listScanTypes() {
    return { data: await this.scanTypes() };
  }
}
