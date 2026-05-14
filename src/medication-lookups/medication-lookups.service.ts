import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MedicationLookupsService {
  constructor(private readonly prisma: PrismaService) {}

  private active<T extends { deletedAt: Date | null; isActive: boolean }>(extra?: object) {
    return { deletedAt: null, isActive: true, ...extra };
  }

  async bundle() {
    const [types, routes, categories, frequencies, rounds, notGivenReasons] = await Promise.all([
      this.prisma.medicationType.findMany({ where: this.active(), orderBy: { name: 'asc' } }),
      this.prisma.medicationRoute.findMany({ where: this.active(), orderBy: { name: 'asc' } }),
      this.prisma.medicationCategory.findMany({ where: this.active(), orderBy: { name: 'asc' } }),
      this.prisma.medicationFrequency.findMany({ where: this.active(), orderBy: { name: 'asc' } }),
      this.prisma.medicationAdministrationRound.findMany({
        where: this.active(),
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.medicationNotGivenReason.findMany({ where: this.active(), orderBy: { name: 'asc' } }),
    ]);
    return { types, routes, categories, frequencies, rounds, notGivenReasons };
  }

  types() {
    return this.prisma.medicationType.findMany({ where: this.active(), orderBy: { name: 'asc' } });
  }

  routes() {
    return this.prisma.medicationRoute.findMany({ where: this.active(), orderBy: { name: 'asc' } });
  }

  categories() {
    return this.prisma.medicationCategory.findMany({ where: this.active(), orderBy: { name: 'asc' } });
  }

  frequencies() {
    return this.prisma.medicationFrequency.findMany({ where: this.active(), orderBy: { name: 'asc' } });
  }

  rounds() {
    return this.prisma.medicationAdministrationRound.findMany({
      where: this.active(),
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  notGivenReasons() {
    return this.prisma.medicationNotGivenReason.findMany({ where: this.active(), orderBy: { name: 'asc' } });
  }
}
