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
import { syncMedicationVisitOutcomesFromStatusCodes } from './visit-outcome-medication.util';
import { DEFAULT_JOB_TITLES } from './default-job-titles';
import {
  parseLookupManageableResource,
  type LookupManageableResource,
} from './lookup-manageable-resources';
import { CreateServiceUserCareTypeDto } from './dto/create-service-user-care-type.dto';
import { CreateServiceUserFundingTypeDto } from './dto/create-service-user-funding-type.dto';
import { UpdateServiceUserCareTypeDto } from './dto/update-service-user-care-type.dto';
import { UpdateServiceUserFundingTypeDto } from './dto/update-service-user-funding-type.dto';
import { CreateBodyMapRecordTypeDto } from './dto/create-body-map-record-type.dto';
import { UpdateBodyMapRecordTypeDto } from './dto/update-body-map-record-type.dto';
import { CreateWelfareOutcomeDto } from './dto/create-welfare-outcome.dto';
import { UpdateWelfareOutcomeDto } from './dto/update-welfare-outcome.dto';
import { CreateClockInArrivalReasonDto } from './dto/create-clock-in-arrival-reason.dto';
import { UpdateClockInArrivalReasonDto } from './dto/update-clock-in-arrival-reason.dto';
import { CreateClockOutEndReasonDto } from './dto/create-clock-out-end-reason.dto';
import { UpdateClockOutEndReasonDto } from './dto/update-clock-out-end-reason.dto';
import { CreateVisitOutcomeReasonDto } from './dto/create-visit-outcome-reason.dto';
import { UpdateVisitOutcomeReasonDto } from './dto/update-visit-outcome-reason.dto';
import { CreateAllergyCatalogDto } from './dto/create-allergy-catalog.dto';
import { UpdateAllergyCatalogDto } from './dto/update-allergy-catalog.dto';
import { UpdateVitalAcceptedRangeDto } from './dto/update-vital-accepted-range.dto';
import { VITAL_ACCEPTED_RANGE_DEFAULTS } from './vital-accepted-ranges.defaults';
import { CreateEmergencyProtocolDto } from './dto/create-emergency-protocol.dto';
import { UpdateEmergencyProtocolDto } from './dto/update-emergency-protocol.dto';
import { DEFAULT_EMERGENCY_PROTOCOLS } from './emergency-protocols.defaults';
import { CreateManualAuthorisationReasonDto } from './dto/create-manual-authorisation-reason.dto';
import { UpdateManualAuthorisationReasonDto } from './dto/update-manual-authorisation-reason.dto';
import {
  DEFAULT_MANUAL_AUTHORISATION_REASONS,
  OTHER_MANUAL_AUTHORISATION_REASON_CODE,
} from './manual-authorisation-reasons.defaults';
import {
  DEFAULT_LEFT_AREA_ALLOW_REASONS,
  OTHER_LEFT_AREA_ALLOW_REASON_CODE,
} from './left-area-allow-reasons.defaults';

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
      for (const row of VITAL_ACCEPTED_RANGE_DEFAULTS) {
        await this.prisma.vitalAcceptedRangeCatalog.upsert({
          where: { fieldKey: row.fieldKey },
          update: {
            label: row.label,
            unit: row.unit,
            min: row.min,
            max: row.max,
            sortOrder: row.sortOrder,
            column: row.column,
            isActive: true,
          },
          create: { ...row },
        });
      }
      this.logger.log(`Vital accepted range lookups ensured (${VITAL_ACCEPTED_RANGE_DEFAULTS.length} rows).`);
      await this.ensureEmergencyProtocols();
      await this.ensureManualAuthorisationReasons();
      await this.ensureLeftAreaAllowReasons();
    } catch (e) {
      this.logger.error('Failed to seed default lookups', e instanceof Error ? e.stack : e);
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

  upsertVisitStatusReason(rawName: string) {
    return this.upsertByName(rawName, (name) =>
      this.prisma.visitStatusReason.upsert({
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
  visitStatusReasons() {
    return this.prisma.visitStatusReason.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
    });
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
      case 'visit-status-reasons':
        return this.updateLookupRow(
          id,
          name,
          () => this.prisma.visitStatusReason.findFirst({ where: { id, deletedAt: null } }),
          (n) =>
            this.prisma.visitStatusReason.update({
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

  /**
   * Default interval for review, skill and certification types (Settings → Workforce lookups).
   * Returns the updated row, or null when the request carries no interval.
   */
  async updateLookupInterval(
    resourceRaw: string,
    id: string,
    dto: {
      defaultIntervalDays?: number | null;
      defaultRefreshMonths?: number | null;
      defaultValidityMonths?: number | null;
    },
  ) {
    const resource = this.parseManageableResource(resourceRaw);
    const fields = (
      [
        ['defaultIntervalDays', 'review-types'],
        ['defaultRefreshMonths', 'skill-types'],
        ['defaultValidityMonths', 'certification-types'],
      ] as const
    ).filter(([field]) => dto[field] !== undefined);
    if (!fields.length) return null;
    const wrong = fields.find(([, owner]) => owner !== resource);
    if (wrong) {
      throw new BadRequestException(`${wrong[0]} cannot be set on ${resource}`);
    }
    const value = dto[fields[0][0]] ?? null;
    switch (resource) {
      case 'review-types':
        return this.prisma.reviewType.update({ where: { id }, data: { defaultIntervalDays: value } });
      case 'skill-types':
        return this.prisma.skillType.update({ where: { id }, data: { defaultRefreshMonths: value } });
      case 'certification-types':
        return this.prisma.certificationType.update({ where: { id }, data: { defaultValidityMonths: value } });
      default:
        return null;
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
      case 'visit-status-reasons':
        return this.softDeleteLookupRow(
          id,
          () => this.prisma.visitStatusReason.findFirst({ where: { id, deletedAt: null } }),
          () =>
            this.prisma.visitStatusReason.update({ where: { id }, data: soft }).then(() => undefined),
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

  private normalizeLookupCode(raw: string): string {
    return raw.trim().toUpperCase().replace(/\s+/g, '_');
  }

  private normalizeMarkerColorHex(raw: string | undefined | null): string | null {
    if (raw == null) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (!/^#[0-9A-Fa-f]{6}$/.test(withHash)) {
      throw new BadRequestException('Pin colour must be a valid hex code (e.g. #dc2626)');
    }
    return withHash.toLowerCase();
  }

  private handleUniqueViolation(e: unknown, message: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException(message);
    }
    throw e;
  }

  async listServiceUserCareTypes() {
    return this.prisma.serviceUserCareType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, isActive: true },
    });
  }

  async createServiceUserCareType(dto: CreateServiceUserCareTypeDto) {
    const name = dto.name.trim();
    const code = this.normalizeLookupCode(dto.code);
    if (!name || !code) throw new BadRequestException('Name and code are required');
    try {
      return await this.prisma.serviceUserCareType.create({
        data: { name, code, isActive: true },
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A care type with this code already exists');
    }
  }

  async updateServiceUserCareType(id: string, dto: UpdateServiceUserCareTypeDto) {
    const existing = await this.prisma.serviceUserCareType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Care type not found');
    const data: Prisma.ServiceUserCareTypeUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      data.name = name;
    }
    if (dto.code !== undefined) {
      const code = this.normalizeLookupCode(dto.code);
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.serviceUserCareType.update({
        where: { id },
        data,
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A care type with this code already exists');
    }
  }

  async deleteServiceUserCareType(id: string) {
    const existing = await this.prisma.serviceUserCareType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Care type not found');
    const inUse = await this.prisma.serviceUser.count({ where: { careTypeId: id } });
    if (inUse > 0) {
      throw new ConflictException('Care type is assigned to service users and cannot be deleted');
    }
    await this.prisma.serviceUserCareType.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listServiceUserFundingTypes() {
    return this.prisma.serviceUserFundingType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, isActive: true },
    });
  }

  async createServiceUserFundingType(dto: CreateServiceUserFundingTypeDto) {
    const name = dto.name.trim();
    const code = this.normalizeLookupCode(dto.code);
    if (!name || !code) throw new BadRequestException('Name and code are required');
    try {
      return await this.prisma.serviceUserFundingType.create({
        data: { name, code, isActive: true },
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A funding type with this code already exists');
    }
  }

  async updateServiceUserFundingType(id: string, dto: UpdateServiceUserFundingTypeDto) {
    const existing = await this.prisma.serviceUserFundingType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Funding type not found');
    const data: Prisma.ServiceUserFundingTypeUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      data.name = name;
    }
    if (dto.code !== undefined) {
      const code = this.normalizeLookupCode(dto.code);
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.serviceUserFundingType.update({
        where: { id },
        data,
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A funding type with this code already exists');
    }
  }

  async deleteServiceUserFundingType(id: string) {
    const existing = await this.prisma.serviceUserFundingType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Funding type not found');
    const inUse = await this.prisma.serviceUser.count({ where: { fundingTypeId: id } });
    if (inUse > 0) {
      throw new ConflictException('Funding type is assigned to service users and cannot be deleted');
    }
    await this.prisma.serviceUserFundingType.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listServiceUserEthnicities() {
    return this.prisma.serviceUserEthnicity.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, isActive: true },
    });
  }

  async createServiceUserEthnicity(dto: CreateServiceUserFundingTypeDto) {
    const name = dto.name.trim();
    const code = this.normalizeLookupCode(dto.code);
    if (!name || !code) throw new BadRequestException('Name and code are required');
    try {
      return await this.prisma.serviceUserEthnicity.create({
        data: { name, code, isActive: true },
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'An ethnicity with this code already exists');
    }
  }

  async updateServiceUserEthnicity(id: string, dto: UpdateServiceUserFundingTypeDto) {
    const existing = await this.prisma.serviceUserEthnicity.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ethnicity not found');
    const data: Prisma.ServiceUserEthnicityUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      data.name = name;
    }
    if (dto.code !== undefined) {
      const code = this.normalizeLookupCode(dto.code);
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.serviceUserEthnicity.update({
        where: { id },
        data,
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'An ethnicity with this code already exists');
    }
  }

  async deleteServiceUserEthnicity(id: string) {
    const existing = await this.prisma.serviceUserEthnicity.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ethnicity not found');
    await this.prisma.serviceUserEthnicity.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listServiceUserLanguages() {
    return this.prisma.serviceUserLanguage.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, isActive: true },
    });
  }

  async createServiceUserLanguage(dto: CreateServiceUserFundingTypeDto) {
    const name = dto.name.trim();
    const code = this.normalizeLookupCode(dto.code);
    if (!name || !code) throw new BadRequestException('Name and code are required');
    try {
      return await this.prisma.serviceUserLanguage.create({
        data: { name, code, isActive: true },
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A language with this code already exists');
    }
  }

  async updateServiceUserLanguage(id: string, dto: UpdateServiceUserFundingTypeDto) {
    const existing = await this.prisma.serviceUserLanguage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Language not found');
    const data: Prisma.ServiceUserLanguageUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      data.name = name;
    }
    if (dto.code !== undefined) {
      const code = this.normalizeLookupCode(dto.code);
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.serviceUserLanguage.update({
        where: { id },
        data,
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A language with this code already exists');
    }
  }

  async deleteServiceUserLanguage(id: string) {
    const existing = await this.prisma.serviceUserLanguage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Language not found');
    await this.prisma.serviceUserLanguage.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listServiceUserGenders() {
    return this.prisma.serviceUserGender.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, isActive: true },
    });
  }

  async createServiceUserGender(dto: CreateServiceUserFundingTypeDto) {
    const name = dto.name.trim();
    const code = this.normalizeLookupCode(dto.code);
    if (!name || !code) throw new BadRequestException('Name and code are required');
    try {
      return await this.prisma.serviceUserGender.create({
        data: { name, code, isActive: true },
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A gender with this code already exists');
    }
  }

  async updateServiceUserGender(id: string, dto: UpdateServiceUserFundingTypeDto) {
    const existing = await this.prisma.serviceUserGender.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Gender not found');
    const data: Prisma.ServiceUserGenderUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      data.name = name;
    }
    if (dto.code !== undefined) {
      const code = this.normalizeLookupCode(dto.code);
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.serviceUserGender.update({
        where: { id },
        data,
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A gender with this code already exists');
    }
  }

  async deleteServiceUserGender(id: string) {
    const existing = await this.prisma.serviceUserGender.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Gender not found');
    await this.prisma.serviceUserGender.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listServiceUserSexes() {
    return this.prisma.serviceUserSex.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, isActive: true },
    });
  }

  async createServiceUserSex(dto: CreateServiceUserFundingTypeDto) {
    const name = dto.name.trim();
    const code = this.normalizeLookupCode(dto.code);
    if (!name || !code) throw new BadRequestException('Name and code are required');
    try {
      return await this.prisma.serviceUserSex.create({
        data: { name, code, isActive: true },
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A sex option with this code already exists');
    }
  }

  async updateServiceUserSex(id: string, dto: UpdateServiceUserFundingTypeDto) {
    const existing = await this.prisma.serviceUserSex.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sex option not found');
    const data: Prisma.ServiceUserSexUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      data.name = name;
    }
    if (dto.code !== undefined) {
      const code = this.normalizeLookupCode(dto.code);
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.serviceUserSex.update({
        where: { id },
        data,
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A sex option with this code already exists');
    }
  }

  async deleteServiceUserSex(id: string) {
    const existing = await this.prisma.serviceUserSex.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sex option not found');
    await this.prisma.serviceUserSex.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listServiceUserSexualOrientations() {
    return this.prisma.serviceUserSexualOrientation.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, isActive: true },
    });
  }

  async createServiceUserSexualOrientation(dto: CreateServiceUserFundingTypeDto) {
    const name = dto.name.trim();
    const code = this.normalizeLookupCode(dto.code);
    if (!name || !code) throw new BadRequestException('Name and code are required');
    try {
      return await this.prisma.serviceUserSexualOrientation.create({
        data: { name, code, isActive: true },
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A sexual orientation with this code already exists');
    }
  }

  async updateServiceUserSexualOrientation(id: string, dto: UpdateServiceUserFundingTypeDto) {
    const existing = await this.prisma.serviceUserSexualOrientation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sexual orientation not found');
    const data: Prisma.ServiceUserSexualOrientationUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      data.name = name;
    }
    if (dto.code !== undefined) {
      const code = this.normalizeLookupCode(dto.code);
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.serviceUserSexualOrientation.update({
        where: { id },
        data,
        select: { id: true, name: true, code: true, isActive: true },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A sexual orientation with this code already exists');
    }
  }

  async deleteServiceUserSexualOrientation(id: string) {
    const existing = await this.prisma.serviceUserSexualOrientation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sexual orientation not found');
    await this.prisma.serviceUserSexualOrientation.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listAllergyCatalog() {
    return this.prisma.allergyCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        code: true,
        category: true,
        sortOrder: true,
        isActive: true,
      },
    });
  }

  async createAllergyCatalog(dto: CreateAllergyCatalogDto) {
    const name = dto.name.trim();
    const code = this.normalizeLookupCode(dto.code);
    if (!name || !code) throw new BadRequestException('Name and code are required');
    const maxSort = await this.prisma.allergyCatalog.aggregate({ _max: { sortOrder: true } });
    const sortOrder = dto.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1;
    try {
      return await this.prisma.allergyCatalog.create({
        data: {
          name,
          code,
          category: dto.category ?? 'OTHER',
          sortOrder,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          code: true,
          category: true,
          sortOrder: true,
          isActive: true,
        },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'An allergy with this code already exists');
    }
  }

  async updateAllergyCatalog(id: string, dto: UpdateAllergyCatalogDto) {
    const existing = await this.prisma.allergyCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Allergy not found');
    const data: Prisma.AllergyCatalogUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      data.name = name;
    }
    if (dto.code !== undefined) {
      const code = this.normalizeLookupCode(dto.code);
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.allergyCatalog.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          code: true,
          category: true,
          sortOrder: true,
          isActive: true,
        },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'An allergy with this code already exists');
    }
  }

  async deleteAllergyCatalog(id: string) {
    const existing = await this.prisma.allergyCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Allergy not found');
    await this.prisma.allergyCatalog.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listBodyMapRecordTypes() {
    return this.prisma.bodyMapRecordTypeCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        code: true,
        parentId: true,
        sortOrder: true,
        isActive: true,
        initialAssessmentWoundType: true,
        markerColorHex: true,
      },
    });
  }

  async createBodyMapRecordType(dto: CreateBodyMapRecordTypeDto) {
    const name = dto.name.trim();
    const code = this.normalizeLookupCode(dto.code);
    if (!name || !code) throw new BadRequestException('Name and code are required');
    if (dto.parentId) {
      const parent = await this.prisma.bodyMapRecordTypeCatalog.findFirst({
        where: { id: dto.parentId, isActive: true, parentId: null },
      });
      if (!parent) throw new BadRequestException('Parent record type not found');
    }
    try {
      return await this.prisma.bodyMapRecordTypeCatalog.create({
        data: {
          name,
          code,
          parentId: dto.parentId ?? null,
          sortOrder: dto.sortOrder ?? 0,
          initialAssessmentWoundType: dto.initialAssessmentWoundType ?? false,
          markerColorHex: this.normalizeMarkerColorHex(dto.markerColorHex),
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          code: true,
          parentId: true,
          sortOrder: true,
          isActive: true,
          initialAssessmentWoundType: true,
          markerColorHex: true,
        },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A record type with this code already exists');
    }
  }

  async updateBodyMapRecordType(id: string, dto: UpdateBodyMapRecordTypeDto) {
    const existing = await this.prisma.bodyMapRecordTypeCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Record type not found');
    const data: Prisma.BodyMapRecordTypeCatalogUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      data.name = name;
    }
    if (dto.code !== undefined) {
      const code = this.normalizeLookupCode(dto.code);
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.initialAssessmentWoundType !== undefined) {
      data.initialAssessmentWoundType = dto.initialAssessmentWoundType;
    }
    if (dto.markerColorHex !== undefined) {
      data.markerColorHex = this.normalizeMarkerColorHex(dto.markerColorHex);
    }
    try {
      return await this.prisma.bodyMapRecordTypeCatalog.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          code: true,
          parentId: true,
          sortOrder: true,
          isActive: true,
          initialAssessmentWoundType: true,
          markerColorHex: true,
        },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A record type with this code already exists');
    }
  }

  async deleteBodyMapRecordType(id: string) {
    const existing = await this.prisma.bodyMapRecordTypeCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Record type not found');
    const childIds = await this.prisma.bodyMapRecordTypeCatalog.findMany({
      where: { parentId: id, isActive: true },
      select: { id: true },
    });
    const ids = [id, ...childIds.map((row) => row.id)];
    await this.prisma.bodyMapRecordTypeCatalog.updateMany({
      where: { id: { in: ids } },
      data: { isActive: false },
    });
  }

  // ─── On-entry welfare outcomes (carer-app clock-in) ───────────────────────

  private readonly welfareSelect = {
    id: true,
    code: true,
    label: true,
    tone: true,
    sortOrder: true,
    isActive: true,
  } as const;

  private readonly arrivalReasonSelect = {
    id: true,
    kind: true,
    label: true,
    requiresNotes: true,
    sortOrder: true,
    isActive: true,
  } as const;

  async listClockInArrivalReasons() {
    return this.prisma.visitClockInArrivalReasonCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
      select: this.arrivalReasonSelect,
    });
  }

  async createClockInArrivalReason(dto: CreateClockInArrivalReasonDto) {
    const label = dto.label.trim();
    if (!label) throw new BadRequestException('Label is required');

    const existing = await this.prisma.visitClockInArrivalReasonCatalog.findFirst({
      where: { kind: dto.kind, label },
    });
    if (existing?.isActive) {
      throw new BadRequestException('This reason is already in the list');
    }
    if (existing) {
      return this.prisma.visitClockInArrivalReasonCatalog.update({
        where: { id: existing.id },
        data: {
          requiresNotes: dto.requiresNotes ?? existing.requiresNotes,
          sortOrder: dto.sortOrder ?? existing.sortOrder,
          isActive: true,
        },
        select: this.arrivalReasonSelect,
      });
    }

    try {
      return await this.prisma.visitClockInArrivalReasonCatalog.create({
        data: {
          kind: dto.kind,
          label,
          requiresNotes: dto.requiresNotes ?? false,
          sortOrder: dto.sortOrder ?? 0,
          isActive: true,
        },
        select: this.arrivalReasonSelect,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'This reason is already in the list');
    }
  }

  async updateClockInArrivalReason(id: string, dto: UpdateClockInArrivalReasonDto) {
    const existing = await this.prisma.visitClockInArrivalReasonCatalog.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Arrival reason not found');
    const data: Prisma.VisitClockInArrivalReasonCatalogUpdateInput = {};
    if (dto.label !== undefined) {
      const label = dto.label.trim();
      if (!label) throw new BadRequestException('Label is required');
      data.label = label;
    }
    if (dto.requiresNotes !== undefined) data.requiresNotes = dto.requiresNotes;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.visitClockInArrivalReasonCatalog.update({
        where: { id },
        data,
        select: this.arrivalReasonSelect,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'This reason is already in the list');
    }
  }

  async deleteClockInArrivalReason(id: string) {
    const existing = await this.prisma.visitClockInArrivalReasonCatalog.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Arrival reason not found');
    await this.prisma.visitClockInArrivalReasonCatalog.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private readonly manualAuthorisationReasonSelect = {
    id: true,
    code: true,
    label: true,
    requiresNotes: true,
    sortOrder: true,
    isActive: true,
  } as const;

  async listManualAuthorisationReasons() {
    return this.prisma.visitManualAuthorisationReasonCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: this.manualAuthorisationReasonSelect,
    });
  }

  async createManualAuthorisationReason(dto: CreateManualAuthorisationReasonDto) {
    const label = dto.label.trim();
    if (!label) throw new BadRequestException('Label is required');

    const existing = await this.prisma.visitManualAuthorisationReasonCatalog.findFirst({
      where: { label },
    });
    if (existing?.isActive) {
      throw new BadRequestException('This reason is already in the list');
    }
    if (existing) {
      return this.prisma.visitManualAuthorisationReasonCatalog.update({
        where: { id: existing.id },
        data: {
          requiresNotes:
            existing.code === OTHER_MANUAL_AUTHORISATION_REASON_CODE
              ? true
              : (dto.requiresNotes ?? existing.requiresNotes),
          sortOrder: dto.sortOrder ?? existing.sortOrder,
          isActive: true,
        },
        select: this.manualAuthorisationReasonSelect,
      });
    }

    try {
      return await this.prisma.visitManualAuthorisationReasonCatalog.create({
        data: {
          code: await this.nextManualAuthorisationReasonCode(label),
          label,
          requiresNotes: dto.requiresNotes ?? false,
          sortOrder: dto.sortOrder ?? (await this.nextManualAuthorisationSortOrder()),
          isActive: true,
        },
        select: this.manualAuthorisationReasonSelect,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'This reason is already in the list');
    }
  }

  async updateManualAuthorisationReason(id: string, dto: UpdateManualAuthorisationReasonDto) {
    const existing = await this.prisma.visitManualAuthorisationReasonCatalog.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Authorisation reason not found');
    const isOther = existing.code === OTHER_MANUAL_AUTHORISATION_REASON_CODE;
    if (isOther && dto.isActive === false) {
      throw new BadRequestException('Other reason cannot be removed');
    }
    const data: Prisma.VisitManualAuthorisationReasonCatalogUpdateInput = {};
    if (dto.label !== undefined) {
      const label = dto.label.trim();
      if (!label) throw new BadRequestException('Label is required');
      data.label = label;
    }
    if (dto.requiresNotes !== undefined) {
      data.requiresNotes = isOther ? true : dto.requiresNotes;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.visitManualAuthorisationReasonCatalog.update({
        where: { id },
        data,
        select: this.manualAuthorisationReasonSelect,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'This reason is already in the list');
    }
  }

  async deleteManualAuthorisationReason(id: string) {
    const existing = await this.prisma.visitManualAuthorisationReasonCatalog.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Authorisation reason not found');
    if (existing.code === OTHER_MANUAL_AUTHORISATION_REASON_CODE) {
      throw new BadRequestException('Other reason cannot be removed');
    }
    await this.prisma.visitManualAuthorisationReasonCatalog.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async nextManualAuthorisationSortOrder() {
    const last = await this.prisma.visitManualAuthorisationReasonCatalog.findFirst({
      where: {
        isActive: true,
        code: { not: OTHER_MANUAL_AUTHORISATION_REASON_CODE },
      },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? 0) + 10;
  }

  private async nextManualAuthorisationReasonCode(label: string) {
    const base =
      label
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40) || 'REASON';
    let code = base;
    let n = 2;
    while (
      await this.prisma.visitManualAuthorisationReasonCatalog.findUnique({
        where: { code },
        select: { id: true },
      })
    ) {
      code = `${base}_${n}`.slice(0, 48);
      n += 1;
    }
    return code;
  }

  async listLeftAreaAllowReasons() {
    return this.prisma.visitLeftAreaAllowReasonCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: this.manualAuthorisationReasonSelect,
    });
  }

  async createLeftAreaAllowReason(dto: CreateManualAuthorisationReasonDto) {
    const label = dto.label.trim();
    if (!label) throw new BadRequestException('Label is required');

    const existing = await this.prisma.visitLeftAreaAllowReasonCatalog.findFirst({
      where: { label },
    });
    if (existing?.isActive) {
      throw new BadRequestException('This reason is already in the list');
    }
    if (existing) {
      return this.prisma.visitLeftAreaAllowReasonCatalog.update({
        where: { id: existing.id },
        data: {
          requiresNotes:
            existing.code === OTHER_LEFT_AREA_ALLOW_REASON_CODE
              ? true
              : (dto.requiresNotes ?? existing.requiresNotes),
          sortOrder: dto.sortOrder ?? existing.sortOrder,
          isActive: true,
        },
        select: this.manualAuthorisationReasonSelect,
      });
    }

    try {
      return await this.prisma.visitLeftAreaAllowReasonCatalog.create({
        data: {
          code: await this.nextLeftAreaAllowReasonCode(label),
          label,
          requiresNotes: dto.requiresNotes ?? false,
          sortOrder: dto.sortOrder ?? (await this.nextLeftAreaAllowSortOrder()),
          isActive: true,
        },
        select: this.manualAuthorisationReasonSelect,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'This reason is already in the list');
    }
  }

  async updateLeftAreaAllowReason(id: string, dto: UpdateManualAuthorisationReasonDto) {
    const existing = await this.prisma.visitLeftAreaAllowReasonCatalog.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Allow reason not found');
    const isOther = existing.code === OTHER_LEFT_AREA_ALLOW_REASON_CODE;
    if (isOther && dto.isActive === false) {
      throw new BadRequestException('Other reason cannot be removed');
    }
    const data: Prisma.VisitLeftAreaAllowReasonCatalogUpdateInput = {};
    if (dto.label !== undefined) {
      const label = dto.label.trim();
      if (!label) throw new BadRequestException('Label is required');
      data.label = label;
    }
    if (dto.requiresNotes !== undefined) {
      data.requiresNotes = isOther ? true : dto.requiresNotes;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.visitLeftAreaAllowReasonCatalog.update({
        where: { id },
        data,
        select: this.manualAuthorisationReasonSelect,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'This reason is already in the list');
    }
  }

  async deleteLeftAreaAllowReason(id: string) {
    const existing = await this.prisma.visitLeftAreaAllowReasonCatalog.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Allow reason not found');
    if (existing.code === OTHER_LEFT_AREA_ALLOW_REASON_CODE) {
      throw new BadRequestException('Other reason cannot be removed');
    }
    await this.prisma.visitLeftAreaAllowReasonCatalog.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async nextLeftAreaAllowSortOrder() {
    const last = await this.prisma.visitLeftAreaAllowReasonCatalog.findFirst({
      where: {
        isActive: true,
        code: { not: OTHER_LEFT_AREA_ALLOW_REASON_CODE },
      },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? 0) + 10;
  }

  private async nextLeftAreaAllowReasonCode(label: string) {
    const base =
      label
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40) || 'REASON';
    let code = base;
    let n = 2;
    while (
      await this.prisma.visitLeftAreaAllowReasonCatalog.findUnique({
        where: { code },
        select: { id: true },
      })
    ) {
      code = `${base}_${n}`.slice(0, 48);
      n += 1;
    }
    return code;
  }

  async listClockOutEndReasons() {
    return this.prisma.visitClockOutEndReasonCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
      select: this.arrivalReasonSelect,
    });
  }

  async createClockOutEndReason(dto: CreateClockOutEndReasonDto) {
    const label = dto.label.trim();
    if (!label) throw new BadRequestException('Label is required');

    const existing = await this.prisma.visitClockOutEndReasonCatalog.findFirst({
      where: { kind: dto.kind, label },
    });
    if (existing?.isActive) {
      throw new BadRequestException('This reason is already in the list');
    }
    if (existing) {
      return this.prisma.visitClockOutEndReasonCatalog.update({
        where: { id: existing.id },
        data: {
          requiresNotes: dto.requiresNotes ?? existing.requiresNotes,
          sortOrder: dto.sortOrder ?? existing.sortOrder,
          isActive: true,
        },
        select: this.arrivalReasonSelect,
      });
    }

    try {
      return await this.prisma.visitClockOutEndReasonCatalog.create({
        data: {
          kind: dto.kind,
          label,
          requiresNotes: dto.requiresNotes ?? false,
          sortOrder: dto.sortOrder ?? 0,
          isActive: true,
        },
        select: this.arrivalReasonSelect,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'This reason is already in the list');
    }
  }

  async updateClockOutEndReason(id: string, dto: UpdateClockOutEndReasonDto) {
    const existing = await this.prisma.visitClockOutEndReasonCatalog.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Clock-out reason not found');
    const data: Prisma.VisitClockOutEndReasonCatalogUpdateInput = {};
    if (dto.label !== undefined) {
      const label = dto.label.trim();
      if (!label) throw new BadRequestException('Label is required');
      data.label = label;
    }
    if (dto.requiresNotes !== undefined) data.requiresNotes = dto.requiresNotes;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.visitClockOutEndReasonCatalog.update({
        where: { id },
        data,
        select: this.arrivalReasonSelect,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'This reason is already in the list');
    }
  }

  async deleteClockOutEndReason(id: string) {
    const existing = await this.prisma.visitClockOutEndReasonCatalog.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Clock-out reason not found');
    await this.prisma.visitClockOutEndReasonCatalog.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listVisitOutcomes() {
    try {
      await syncMedicationVisitOutcomesFromStatusCodes(this.prisma);
    } catch (err) {
      // Keep the admin list readable if MAR sync is unavailable.
      this.logger.warn(
        `Could not sync medication outcomes from MAR status codes: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return this.prisma.visitOutcomeCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ area: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
      select: {
        id: true,
        area: true,
        code: true,
        label: true,
        allowsReasons: true,
        sortOrder: true,
        isActive: true,
        reasons: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
          select: {
            id: true,
            label: true,
            requiresNotes: true,
            sortOrder: true,
            isActive: true,
          },
        },
      },
    });
  }

  async createVisitOutcomeReason(outcomeId: string, dto: CreateVisitOutcomeReasonDto) {
    const outcome = await this.prisma.visitOutcomeCatalog.findUnique({
      where: { id: outcomeId },
    });
    if (!outcome?.isActive) throw new NotFoundException('Outcome not found');
    if (!outcome.allowsReasons) {
      throw new BadRequestException('This outcome does not use a reason list');
    }
    const label = dto.label.trim();
    if (!label) throw new BadRequestException('Label is required');

    const existing = await this.prisma.visitOutcomeReasonCatalog.findFirst({
      where: { outcomeId, label },
    });
    if (existing?.isActive) {
      throw new BadRequestException('This reason is already in the list');
    }
    if (existing) {
      return this.prisma.visitOutcomeReasonCatalog.update({
        where: { id: existing.id },
        data: {
          requiresNotes: dto.requiresNotes ?? existing.requiresNotes,
          sortOrder: dto.sortOrder ?? existing.sortOrder,
          isActive: true,
        },
      });
    }

    try {
      return await this.prisma.visitOutcomeReasonCatalog.create({
        data: {
          outcomeId,
          label,
          requiresNotes: dto.requiresNotes ?? false,
          sortOrder: dto.sortOrder ?? 0,
          isActive: true,
        },
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'This reason is already in the list');
    }
  }

  async updateVisitOutcomeReason(id: string, dto: UpdateVisitOutcomeReasonDto) {
    const existing = await this.prisma.visitOutcomeReasonCatalog.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Outcome reason not found');
    const data: Prisma.VisitOutcomeReasonCatalogUpdateInput = {};
    if (dto.label !== undefined) {
      const label = dto.label.trim();
      if (!label) throw new BadRequestException('Label is required');
      data.label = label;
    }
    if (dto.requiresNotes !== undefined) data.requiresNotes = dto.requiresNotes;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.visitOutcomeReasonCatalog.update({
        where: { id },
        data,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'This reason is already in the list');
    }
  }

  async deleteVisitOutcomeReason(id: string) {
    const existing = await this.prisma.visitOutcomeReasonCatalog.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Outcome reason not found');
    await this.prisma.visitOutcomeReasonCatalog.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listWelfareOutcomes() {
    return this.prisma.visitWelfareOutcomeCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: this.welfareSelect,
    });
  }

  async createWelfareOutcome(dto: CreateWelfareOutcomeDto) {
    const label = dto.label.trim();
    const code = dto.code.trim().toLowerCase().replace(/\s+/g, '-');
    if (!label || !code) throw new BadRequestException('Label and code are required');
    try {
      return await this.prisma.visitWelfareOutcomeCatalog.create({
        data: {
          code,
          label,
          tone: dto.tone ?? 'ok',
          sortOrder: dto.sortOrder ?? 0,
          isActive: true,
        },
        select: this.welfareSelect,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A welfare outcome with this code already exists');
    }
  }

  async updateWelfareOutcome(id: string, dto: UpdateWelfareOutcomeDto) {
    const existing = await this.prisma.visitWelfareOutcomeCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Welfare outcome not found');
    const data: Prisma.VisitWelfareOutcomeCatalogUpdateInput = {};
    if (dto.label !== undefined) {
      const label = dto.label.trim();
      if (!label) throw new BadRequestException('Label is required');
      data.label = label;
    }
    if (dto.code !== undefined) {
      const code = dto.code.trim().toLowerCase().replace(/\s+/g, '-');
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.tone !== undefined) data.tone = dto.tone;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.visitWelfareOutcomeCatalog.update({
        where: { id },
        data,
        select: this.welfareSelect,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A welfare outcome with this code already exists');
    }
  }

  async deleteWelfareOutcome(id: string) {
    const existing = await this.prisma.visitWelfareOutcomeCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Welfare outcome not found');
    await this.prisma.visitWelfareOutcomeCatalog.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ─── Emergency protocols (carer-app runner) ───────────────────────────────

  private readonly emergencyProtocolSelect = {
    id: true,
    code: true,
    title: true,
    subtitle: true,
    version: true,
    iconKey: true,
    sortOrder: true,
    isActive: true,
    steps: {
      orderBy: [
        { sortOrder: 'asc' },
        { action: 'asc' },
      ] as Prisma.EmergencyProtocolStepOrderByWithRelationInput[],
      select: { id: true, action: true, detail: true, sortOrder: true },
    },
  };

  /** Create missing seed rows only — never overwrite admin-edited protocols. */
  private async ensureEmergencyProtocols() {
    try {
      const existing = await this.prisma.emergencyProtocolCatalog.findMany({
        select: { code: true },
      });
      const have = new Set(existing.map((r) => r.code));
      const missing = DEFAULT_EMERGENCY_PROTOCOLS.filter((p) => !have.has(p.code));
      for (const seed of missing) {
        await this.prisma.emergencyProtocolCatalog.create({
          data: {
            code: seed.code,
            title: seed.title,
            subtitle: seed.subtitle,
            version: seed.version,
            iconKey: seed.iconKey,
            sortOrder: seed.sortOrder,
            isActive: true,
            steps: {
              create: seed.steps.map((step, i) => ({
                action: step.action,
                detail: step.detail,
                sortOrder: (i + 1) * 10,
              })),
            },
          },
        });
      }
      if (missing.length > 0) {
        this.logger.log(`Emergency protocols seeded (${missing.length} new).`);
      }
    } catch (e) {
      this.logger.error(
        'Failed to seed emergency protocols',
        e instanceof Error ? e.stack : e,
      );
    }
  }

  private async ensureManualAuthorisationReasons() {
    try {
      const existing = await this.prisma.visitManualAuthorisationReasonCatalog.findMany({
        select: { code: true },
      });
      const have = new Set(existing.map((r) => r.code));
      const missing = DEFAULT_MANUAL_AUTHORISATION_REASONS.filter((r) => !have.has(r.code));
      for (const seed of missing) {
        await this.prisma.visitManualAuthorisationReasonCatalog.create({
          data: {
            code: seed.code,
            label: seed.label,
            requiresNotes: seed.requiresNotes,
            sortOrder: seed.sortOrder,
            isActive: true,
          },
        });
      }
      if (missing.length > 0) {
        this.logger.log(`Manual authorisation reasons seeded (${missing.length} new).`);
      }
    } catch (e) {
      this.logger.error(
        'Failed to seed manual authorisation reasons',
        e instanceof Error ? e.stack : e,
      );
    }
  }

  private async ensureLeftAreaAllowReasons() {
    try {
      const existing = await this.prisma.visitLeftAreaAllowReasonCatalog.findMany({
        select: { code: true },
      });
      const have = new Set(existing.map((r) => r.code));
      const missing = DEFAULT_LEFT_AREA_ALLOW_REASONS.filter((r) => !have.has(r.code));
      for (const seed of missing) {
        await this.prisma.visitLeftAreaAllowReasonCatalog.create({
          data: {
            code: seed.code,
            label: seed.label,
            requiresNotes: seed.requiresNotes,
            sortOrder: seed.sortOrder,
            isActive: true,
          },
        });
      }
      if (missing.length > 0) {
        this.logger.log(`Left-area allow reasons seeded (${missing.length} new).`);
      }
    } catch (e) {
      this.logger.error(
        'Failed to seed left-area allow reasons',
        e instanceof Error ? e.stack : e,
      );
    }
  }

  async listEmergencyProtocols() {
    return this.prisma.emergencyProtocolCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: this.emergencyProtocolSelect,
    });
  }

  async createEmergencyProtocol(dto: CreateEmergencyProtocolDto) {
    const title = dto.title.trim();
    const code = dto.code.trim().toLowerCase().replace(/\s+/g, '-');
    if (!title || !code) throw new BadRequestException('Title and code are required');
    const steps = this.normalizeProtocolSteps(dto.steps);
    try {
      return await this.prisma.emergencyProtocolCatalog.create({
        data: {
          code,
          title,
          subtitle: dto.subtitle?.trim() ?? '',
          version: dto.version?.trim() ?? '',
          iconKey: dto.iconKey ?? 'alert',
          sortOrder: dto.sortOrder ?? 0,
          isActive: true,
          steps: { create: steps },
        },
        select: this.emergencyProtocolSelect,
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A protocol with this code already exists');
    }
  }

  async updateEmergencyProtocol(id: string, dto: UpdateEmergencyProtocolDto) {
    const existing = await this.prisma.emergencyProtocolCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Emergency protocol not found');
    const data: Prisma.EmergencyProtocolCatalogUpdateInput = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('Title is required');
      data.title = title;
    }
    if (dto.code !== undefined) {
      const code = dto.code.trim().toLowerCase().replace(/\s+/g, '-');
      if (!code) throw new BadRequestException('Code is required');
      data.code = code;
    }
    if (dto.subtitle !== undefined) data.subtitle = dto.subtitle.trim();
    if (dto.version !== undefined) data.version = dto.version.trim();
    if (dto.iconKey !== undefined) data.iconKey = dto.iconKey;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.steps) {
          const steps = this.normalizeProtocolSteps(dto.steps);
          await tx.emergencyProtocolStep.deleteMany({ where: { protocolId: id } });
          await tx.emergencyProtocolStep.createMany({
            data: steps.map((s) => ({ ...s, protocolId: id })),
          });
        }
        return tx.emergencyProtocolCatalog.update({
          where: { id },
          data,
          select: this.emergencyProtocolSelect,
        });
      });
    } catch (e) {
      this.handleUniqueViolation(e, 'A protocol with this code already exists');
    }
  }

  async deleteEmergencyProtocol(id: string) {
    const existing = await this.prisma.emergencyProtocolCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Emergency protocol not found');
    await this.prisma.emergencyProtocolCatalog.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private normalizeProtocolSteps(steps: { action: string; detail?: string }[]) {
    const cleaned = steps
      .map((s, i) => ({
        action: s.action.trim(),
        detail: (s.detail ?? '').trim(),
        sortOrder: (i + 1) * 10,
      }))
      .filter((s) => s.action.length > 0);
    if (cleaned.length === 0) {
      throw new BadRequestException('At least one protocol step is required');
    }
    return cleaned;
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
      ethnicities,
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
      this.prisma.serviceUserEthnicity.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
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
        ethnicities,
      },
    };
  }

  async listVitalAcceptedRanges() {
    return this.prisma.vitalAcceptedRangeCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async updateVitalAcceptedRange(id: string, dto: UpdateVitalAcceptedRangeDto) {
    const existing = await this.prisma.vitalAcceptedRangeCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Vital accepted range not found');

    const min = dto.min ?? existing.min;
    const max = dto.max ?? existing.max;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      throw new BadRequestException('Min must be lower than max');
    }

    return this.prisma.vitalAcceptedRangeCatalog.update({
      where: { id },
      data: { min, max },
    });
  }
}

