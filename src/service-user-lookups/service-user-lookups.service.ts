import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ServiceUserLookupsService {
  constructor(private readonly prisma: PrismaService) {}

  async all() {
    const [
      statuses,
      titles,
      genders,
      maritalStatuses,
      careTypes,
      fundingTypes,
      riskLevels,
      relationshipTypes,
      allergies,
      absenceReasons,
    ] = await Promise.all([
      this.prisma.serviceUserStatus.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.serviceUserTitle.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.serviceUserGender.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.serviceUserMaritalStatus.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.serviceUserCareType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.serviceUserFundingType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.serviceUserRiskLevel.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.relationshipType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.allergyCatalog.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      (this.prisma as unknown as { absenceReasonCatalog: { findMany: (args: object) => Promise<unknown[]> } }).absenceReasonCatalog.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);
    return {
      data: {
        statuses,
        titles,
        genders,
        maritalStatuses,
        careTypes,
        fundingTypes,
        riskLevels,
        relationshipTypes,
        allergies,
        absenceReasons,
      },
    };
  }

  statuses() {
    return this.prisma.serviceUserStatus.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }
  titles() {
    return this.prisma.serviceUserTitle.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }
  genders() {
    return this.prisma.serviceUserGender.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }
  maritalStatuses() {
    return this.prisma.serviceUserMaritalStatus.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }
  careTypes() {
    return this.prisma.serviceUserCareType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }
  fundingTypes() {
    return this.prisma.serviceUserFundingType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }
  riskLevels() {
    return this.prisma.serviceUserRiskLevel.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }
  relationshipTypes() {
    return this.prisma.relationshipType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  allergies() {
    return this.prisma.allergyCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  absenceReasons() {
    return (this.prisma as unknown as { absenceReasonCatalog: { findMany: (args: object) => Promise<unknown[]> } }).absenceReasonCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }
}
