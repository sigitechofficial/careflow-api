import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_JOB_TITLES } from './default-job-titles';
import {
  parseLookupManageableResource,
  type LookupManageableResource,
} from './lookup-manageable-resources';

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

  private upsertByName(
    rawName: string,
    upsert: (name: string) => Promise<{ id: string; name: string }>,
  ) {
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Name is required');
    return upsert(name);
  }

  /** Create or revive a job title (unique on `name`). */
  upsertJobTitle(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.jobTitle.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
  }

  upsertSkillType(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.skillType.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
  }

  upsertWorkArea(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.workArea.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
  }

  upsertGrade(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.grade.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
  }

  upsertContractType(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.contractType.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
  }

  upsertCertificationType(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.certificationType.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
  }

  upsertNonCoreActivityReason(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.nonCoreActivityReason.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
  }

  upsertLeavingReason(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.leavingReason.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
  }

  upsertReviewType(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.reviewType.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
  }

  upsertLocation(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.location.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
  }

  upsertZone(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.zone.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
  }

  upsertTravelPaymentType(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.travelPaymentType.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
        select: { id: true, name: true },
      }),
    );
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

  private parseManageableResource(resource: string): LookupManageableResource {
    try {
      return parseLookupManageableResource(resource);
    } catch {
      throw new BadRequestException(`Unknown lookup resource: ${resource}`);
    }
  }

  private async updateLookupRow(
    id: string,
    name: string,
    find: () => Promise<{ id: string } | null>,
    update: (name: string) => Promise<{ id: string; name: string }>,
  ) {
    const existing = await find();
    if (!existing) throw new NotFoundException('Lookup item not found');
    try {
      return await update(name);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An item with this name already exists');
      }
      throw e;
    }
  }

  private async softDeleteLookupRow(
    id: string,
    find: () => Promise<{ id: string } | null>,
    remove: () => Promise<void>,
  ) {
    const existing = await find();
    if (!existing) throw new NotFoundException('Lookup item not found');
    await remove();
  }

  async updateNamedLookup(resourceRaw: string, id: string, rawName: string) {
    const resource = this.parseManageableResource(resourceRaw);
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Name is required');

    switch (resource) {
      case 'job-titles':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.jobTitle.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.jobTitle.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      case 'skill-types':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.skillType.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.skillType.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      case 'work-areas':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.workArea.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.workArea.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      case 'grades':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.grade.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.grade.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      case 'contract-types':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.contractType.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.contractType.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      case 'certification-types':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.certificationType.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.certificationType.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      case 'non-core-activity-reasons':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.nonCoreActivityReason.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.nonCoreActivityReason.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      case 'leaving-reasons':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.leavingReason.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.leavingReason.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      case 'review-types':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.reviewType.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.reviewType.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      case 'locations':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.location.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.location.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      case 'zones':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.zone.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.zone.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      case 'travel-payment-types':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.travelPaymentType.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.travelPaymentType.update({
              where: { id },
              data: { name: n },
              select: { id: true, name: true },
            }),
        );
      default:
        throw new BadRequestException(`Unknown lookup resource: ${resource}`);
    }
  }

  async deleteNamedLookup(resourceRaw: string, id: string) {
    const resource = this.parseManageableResource(resourceRaw);
    const soft = { deletedAt: new Date(), isActive: false };

    switch (resource) {
      case 'job-titles':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.jobTitle.findFirst({ where: { id, deletedAt: null } }),
          () => this.prisma.jobTitle.update({ where: { id }, data: soft }).then(() => undefined),
        );
      case 'skill-types':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.skillType.findFirst({ where: { id, deletedAt: null } }),
          () => this.prisma.skillType.update({ where: { id }, data: soft }).then(() => undefined),
        );
      case 'work-areas':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.workArea.findFirst({ where: { id, deletedAt: null } }),
          () => this.prisma.workArea.update({ where: { id }, data: soft }).then(() => undefined),
        );
      case 'grades':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.grade.findFirst({ where: { id, deletedAt: null } }),
          () => this.prisma.grade.update({ where: { id }, data: soft }).then(() => undefined),
        );
      case 'contract-types':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.contractType.findFirst({ where: { id, deletedAt: null } }),
          () => this.prisma.contractType.update({ where: { id }, data: soft }).then(() => undefined),
        );
      case 'certification-types':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.certificationType.findFirst({ where: { id, deletedAt: null } }),
          () =>
            this.prisma.certificationType.update({ where: { id }, data: soft }).then(() => undefined),
        );
      case 'non-core-activity-reasons':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.nonCoreActivityReason.findFirst({ where: { id, deletedAt: null } }),
          () =>
            this.prisma.nonCoreActivityReason.update({ where: { id }, data: soft }).then(() => undefined),
        );
      case 'leaving-reasons':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.leavingReason.findFirst({ where: { id, deletedAt: null } }),
          () => this.prisma.leavingReason.update({ where: { id }, data: soft }).then(() => undefined),
        );
      case 'review-types':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.reviewType.findFirst({ where: { id, deletedAt: null } }),
          () => this.prisma.reviewType.update({ where: { id }, data: soft }).then(() => undefined),
        );
      case 'locations':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.location.findFirst({ where: { id, deletedAt: null } }),
          () => this.prisma.location.update({ where: { id }, data: soft }).then(() => undefined),
        );
      case 'zones':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.zone.findFirst({ where: { id, deletedAt: null } }),
          () => this.prisma.zone.update({ where: { id }, data: soft }).then(() => undefined),
        );
      case 'travel-payment-types':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.travelPaymentType.findFirst({ where: { id, deletedAt: null } }),
          () =>
            this.prisma.travelPaymentType.update({ where: { id }, data: soft }).then(() => undefined),
        );
      default:
        throw new BadRequestException(`Unknown lookup resource: ${resource}`);
    }
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

