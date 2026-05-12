import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_JOB_TITLES } from './default-job-titles';

@Injectable()
export class LookupsService implements OnModuleInit {
  private readonly logger = new Logger(LookupsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Ensures job titles exist even if `prisma db seed` was never run for this DB. */
  async onModuleInit() {
    try {
      for (const name of DEFAULT_JOB_TITLES) {
        await this.prisma.jobTitle.upsert({
          where: { name },
          update: { isActive: true, deletedAt: null },
          create: { name, isActive: true },
        });
      }
      this.logger.log(`Job title lookups ensured (${DEFAULT_JOB_TITLES.length} titles).`);
    } catch (e) {
      this.logger.error('Failed to seed default job titles', e instanceof Error ? e.stack : e);
    }
  }

  titles() {
    return this.prisma.title.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  genders() {
    return this.prisma.gender.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  nationalities() {
    return this.prisma.nationality.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  workAreas() {
    return this.prisma.workArea.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  jobTitles() {
    return this.prisma.jobTitle.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }

  /** Create or revive a job title (unique on `name`). */
  async upsertJobTitle(rawName: string) {
    const name = rawName.trim();
    return this.prisma.jobTitle.upsert({
      where: { name },
      update: { isActive: true, deletedAt: null },
      create: { name, isActive: true },
      select: { id: true, name: true },
    });
  }
  rbacLevels() {
    return this.prisma.rBACLevel.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  grades() {
    return this.prisma.grade.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  contractTypes() {
    return this.prisma.contractType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  travelPaymentTypes() {
    return this.prisma.travelPaymentType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  locations() {
    return this.prisma.location.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  zones() {
    return this.prisma.zone.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  leavingReasons() {
    return this.prisma.leavingReason.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  skillTypes() {
    return this.prisma.skillType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  certificationTypes() {
    return this.prisma.certificationType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  complianceTypes() {
    return this.prisma.complianceType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  reviewTypes() {
    return this.prisma.reviewType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } });
  }
  nonCoreActivityReasons() {
    return this.prisma.nonCoreActivityReason.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async employeeLookups() {
    const [
      titles,
      genders,
      nationalities,
      workAreas,
      jobTitles,
      rbacLevels,
      grades,
      contractTypes,
      travelPaymentTypes,
      locations,
      zones,
      leavingReasons,
      skillTypes,
      certificationTypes,
      complianceTypes,
      reviewTypes,
      nonCoreActivityReasons,
      employeeStatuses,
      roles,
    ] = await this.prisma.$transaction([
      this.prisma.title.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.gender.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.nationality.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.workArea.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.jobTitle.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.rBACLevel.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.grade.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.contractType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.travelPaymentType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.location.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.zone.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.leavingReason.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.skillType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.certificationType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.complianceType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.reviewType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.nonCoreActivityReason.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.employeeStatus.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.employeeRoleLookup.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
    ]);

    return {
      data: {
        titles,
        genders,
        nationalities,
        employeeStatuses,
        workAreas,
        roles,
        jobTitles,
        rbacLevels,
        grades,
        contractTypes,
        travelPaymentTypes,
        locations,
        zones,
        leavingReasons,
        skillTypes,
        certificationTypes,
        complianceTypes,
        reviewTypes,
        nonCoreActivityReasons,
      },
    };
  }
}

