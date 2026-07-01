import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { VisitPlanStatus, ScheduledVisitStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserPhotosService } from '../service-user-photos/service-user-photos.service';
import type { PatchPortalAboutMeDto, PatchPortalProfileDto, CreatePortalContactDto } from './dto/service-user-portal.dto';
import {
  PORTAL_PROFILE_REF,
  parsePortalProfileExtras,
} from './portal-profile-refs.util';
import {
  collectVisitPlanEmployeeIds,
  mapPortalVisitPlan,
  portalVisitPlanInclude,
} from './portal-visit-plans.util';
import { defaultVisitPlanSlotsFromRounds } from '../service-user-visit-plans/visit-plan-slot-defaults';
import {
  employeeDisplayName as portalEmployeeDisplayName,
  resolveVisitMedicationRoundCode,
} from './portal-dashboard.util';

const ABOUT_ME_REF_TYPE = 'SU_ABOUT_ME_V1';

const portalFullInclude = {
  title: true,
  gender: true,
  maritalStatus: true,
  status: true,
  careType: true,
  fundingType: true,
  riskLevel: true,
  location: true,
  keyWorker: { include: { personalDetail: true } },
  namedNurse: { include: { personalDetail: true } },
  address: true,
  references: { where: { deletedAt: null } },
  photos: {
    where: { deletedAt: null },
    orderBy: { uploadedAt: 'desc' as const },
  },
} satisfies Prisma.ServiceUserInclude;

type PortalUserRow = Prisma.ServiceUserGetPayload<{ include: typeof portalFullInclude }>;

@Injectable()
export class ServiceUserPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photosService: ServiceUserPhotosService,
  ) {}

  private async loadScopedUser(serviceUserId: string): Promise<PortalUserRow> {
    const user = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null, isActive: true },
      include: portalFullInclude,
    });
    if (!user) throw new NotFoundException('Service user not found');
    return user;
  }

  private mapLookup(l: { id: string; name: string } | null | undefined) {
    return l ? { id: l.id, name: l.name } : null;
  }

  private mapEmployeeBrief(
    e: { id: string; personalDetail: { firstName: string; lastName: string } | null } | null | undefined,
  ) {
    if (!e) return null;
    return {
      id: e.id,
      firstName: e.personalDetail?.firstName ?? null,
      lastName: e.personalDetail?.lastName ?? null,
    };
  }

  private mapPortalProfile(user: PortalUserRow) {
    const profilePhoto = user.photos.find(p => p.isProfilePhoto) ?? user.photos[0] ?? null;
    const profilePhotoUrl = profilePhoto?.fileUrl ?? user.profilePhotoUrl;
    const extras = parsePortalProfileExtras(user.references);

    return {
      serviceUserId: user.id,
      serviceUserNumber: user.serviceUserNumber,
      residentId: user.residentId,
      residentGuid: user.residentGuid,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      preferredName: user.preferredName,
      dateOfBirth: user.dateOfBirth?.toISOString() ?? null,
      email: user.email,
      phone: user.phone,
      mobile: user.mobile,
      nhsNumber: user.nhsNumber,
      nationalInsuranceNumber: user.nationalInsuranceNumber,
      socialServicesRef: user.socialServicesRef,
      serviceStartDate: user.serviceStartDate?.toISOString() ?? null,
      serviceEndDate: user.serviceEndDate?.toISOString() ?? null,
      profilePhotoUrl,
      title: this.mapLookup(user.title),
      gender: this.mapLookup(user.gender),
      maritalStatus: this.mapLookup(user.maritalStatus),
      status: this.mapLookup(user.status),
      careType: this.mapLookup(user.careType),
      fundingType: this.mapLookup(user.fundingType),
      riskLevel: user.riskLevel
        ? { id: user.riskLevel.id, name: user.riskLevel.name, color: user.riskLevel.color }
        : null,
      location: user.location ? { id: user.location.id, name: user.location.name } : null,
      keyWorker: this.mapEmployeeBrief(user.keyWorker),
      namedNurse: this.mapEmployeeBrief(user.namedNurse),
      profileExtras: extras,
      address: user.address
        ? {
            addressLine1: user.address.addressLine1,
            addressLine2: user.address.addressLine2,
            town: user.address.town,
            county: user.address.county,
            postcode: user.address.postcode,
            country: user.address.country,
            accessInstructions: user.address.accessInstructions,
            keySafeNumber: user.address.keySafeNumber,
          }
        : null,
      photos: user.photos.map(p => ({
        id: p.id,
        fileUrl: p.fileUrl,
        originalName: p.originalName,
        isProfilePhoto: p.isProfilePhoto,
        uploadedAt: p.uploadedAt.toISOString(),
      })),
    };
  }

  async getLookups() {
    const [titles, genders, maritalStatuses, relationshipTypes] = await Promise.all([
      this.prisma.serviceUserTitle.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.serviceUserGender.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.serviceUserMaritalStatus.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.relationshipType.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    return { data: { titles, genders, maritalStatuses, relationshipTypes } };
  }

  async getDashboard(serviceUserId: string) {
    const user = await this.loadScopedUser(serviceUserId);
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [allergiesCount, contacts, upcomingEvents, carePlanInstances, aboutMeRef, upcomingVisits] =
      await Promise.all([
      this.prisma.serviceUserAllergy.count({ where: { serviceUserId, deletedAt: null } }),
      this.prisma.serviceUserContact.findMany({
        where: { serviceUserId, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 5,
        include: { relationshipType: true },
      }),
      this.prisma.serviceUserCalendarEvent.findMany({
        where: { serviceUserId, deletedAt: null, startDateTime: { gte: now, lte: in30Days } },
        orderBy: { startDateTime: 'asc' },
        take: 5,
        include: { eventType: true },
      }),
      this.prisma.serviceUserCarePlanInstance.findMany({
        where: { serviceUserId },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          updatedAt: true,
          carePathwayForm: { select: { id: true, name: true } },
        },
      }),
      this.prisma.serviceUserReference.findFirst({
        where: { serviceUserId, referenceType: ABOUT_ME_REF_TYPE, deletedAt: null },
        select: { referenceValue: true },
      }),
      this.loadUpcomingVisitsForDashboard(serviceUserId, now, in30Days),
    ]);

    const mapped = this.mapPortalProfile(user);

    return {
      data: {
        profile: {
          serviceUserId: mapped.serviceUserId,
          firstName: mapped.firstName,
          lastName: mapped.lastName,
          preferredName: mapped.preferredName,
          dateOfBirth: mapped.dateOfBirth,
          profilePhotoUrl: mapped.profilePhotoUrl,
          careType: mapped.careType,
        },
        allergiesCount,
        contacts: contacts.map(c => ({
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(' '),
          relationship: c.relationshipType?.name ?? null,
          phone: c.phone,
          email: c.email,
          isPrimary: c.isPrimary,
        })),
        upcomingVisits,
        upcomingEvents: upcomingEvents.map(e => ({
          id: e.id,
          title: e.title,
          startAt: e.startDateTime.toISOString(),
          endAt: e.endDateTime?.toISOString() ?? null,
          status: e.status,
          eventType: e.eventType ? { id: e.eventType.id, name: e.eventType.name } : null,
        })),
        carePlans: carePlanInstances.map(cp => ({
          id: cp.id,
          status: cp.status,
          name: cp.carePathwayForm.name,
          updatedAt: cp.updatedAt.toISOString(),
        })),
        aboutMeConfigured: Boolean(aboutMeRef?.referenceValue?.trim()),
      },
    };
  }

  private async loadUpcomingVisitsForDashboard(serviceUserId: string, now: Date, until: Date) {
    const visits = await this.prisma.scheduledVisit.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        isActive: true,
        scheduledStartDateTime: { gte: now, lte: until },
        status: {
          in: [
            ScheduledVisitStatus.PLANNED,
            ScheduledVisitStatus.STARTED,
            ScheduledVisitStatus.NEEDS_ATTENTION,
          ],
        },
      },
      orderBy: { scheduledStartDateTime: 'asc' },
      take: 6,
      include: {
        visitPlanSlot: { select: { slotCode: true, medicationRoundCode: true } },
        allocations: {
          where: { deletedAt: null, isActive: true },
          include: { employee: { include: { personalDetail: true } } },
        },
        scheduledJob: {
          select: {
            id: true,
            allocations: {
              where: { deletedAt: null, isActive: true },
              include: { employee: { include: { personalDetail: true } } },
            },
          },
        },
      },
    });

    const roundCodes = [
      ...new Set(
        visits
          .map(v => resolveVisitMedicationRoundCode(v.visitPlanSlot))
          .filter((code): code is string => Boolean(code)),
      ),
    ];

    const [rounds, allAssignments] = await Promise.all([
      roundCodes.length
        ? this.prisma.medicationAdministrationRound.findMany({
            where: { code: { in: roundCodes }, deletedAt: null, isActive: true },
            select: { code: true, name: true },
          })
        : Promise.resolve([]),
      roundCodes.length
        ? this.prisma.serviceUserVisitTaskAssignment.findMany({
            where: {
              serviceUserId,
              medicationRoundCode: { in: roundCodes },
              deletedAt: null,
              isActive: true,
            },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            include: { task: { include: { category: true } } },
          })
        : Promise.resolve([]),
    ]);

    const roundNameByCode = new Map(rounds.map(r => [r.code.toUpperCase(), r.name]));
    const tasksByRound = new Map<string, typeof allAssignments>();
    for (const code of roundCodes) {
      tasksByRound.set(
        code,
        allAssignments.filter(a => a.medicationRoundCode.toUpperCase() === code),
      );
    }

    return visits.map(v => {
      const roundCode = resolveVisitMedicationRoundCode(v.visitPlanSlot);
      const allocations =
        v.allocations.length > 0 ? v.allocations : (v.scheduledJob.allocations ?? []);
      const carers = allocations.map(a => portalEmployeeDisplayName(a.employee.personalDetail));
      const assignments = roundCode ? (tasksByRound.get(roundCode) ?? []) : [];

      return {
        id: v.id,
        scheduledJobId: v.scheduledJobId,
        visitName: v.visitName,
        scheduledStartAt: v.scheduledStartDateTime.toISOString(),
        scheduledEndAt: v.scheduledEndDateTime?.toISOString() ?? null,
        status: v.status,
        carers,
        roundLabel: roundCode ? (roundNameByCode.get(roundCode) ?? roundCode) : null,
        tasks: assignments.map(a => ({
          id: a.id,
          name: a.task.name,
          categoryName: a.task.category.name,
          priority: a.priority,
        })),
      };
    });
  }

  async getProfile(serviceUserId: string) {
    const user = await this.loadScopedUser(serviceUserId);
    return { data: this.mapPortalProfile(user) };
  }

  private async syncProfileReferences(
    tx: Prisma.TransactionClient,
    serviceUserId: string,
    dto: PatchPortalProfileDto,
  ) {
    const refMap = {
      suffix: dto.suffix,
      maidenName: dto.maidenName,
      placeOfBirth: dto.placeOfBirth,
      religion: dto.religion,
      ethnicity: dto.ethnicity,
      sexualOrientation: dto.sexualOrientation,
      disability: dto.disability,
      maternity: dto.maternity,
      language: dto.language,
      preferredContactMethod: dto.preferredContactMethod,
      emailType: dto.emailType,
      otherContactMethod: dto.otherContactMethod,
    } as const;

    const typeByKey: Record<keyof typeof refMap, string> = {
      suffix: PORTAL_PROFILE_REF.suffix,
      maidenName: PORTAL_PROFILE_REF.maidenName,
      placeOfBirth: PORTAL_PROFILE_REF.placeOfBirth,
      religion: PORTAL_PROFILE_REF.religion,
      ethnicity: PORTAL_PROFILE_REF.ethnicity,
      sexualOrientation: PORTAL_PROFILE_REF.sexualOrientation,
      disability: PORTAL_PROFILE_REF.disability,
      maternity: PORTAL_PROFILE_REF.maternity,
      language: PORTAL_PROFILE_REF.language,
      preferredContactMethod: PORTAL_PROFILE_REF.preferredContactMethod,
      emailType: PORTAL_PROFILE_REF.emailType,
      otherContactMethod: PORTAL_PROFILE_REF.otherContactMethod,
    };

    const existing = await tx.serviceUserReference.findMany({
      where: { serviceUserId, deletedAt: null },
    });

    for (const [key, referenceType] of Object.entries(typeByKey) as Array<
      [keyof typeof refMap, string]
    >) {
      const patchValue = refMap[key];
      if (patchValue === undefined) continue;
      const value = patchValue.trim();
      const row = existing.find(r => r.referenceType === referenceType);
      if (!value) {
        if (row) {
          await tx.serviceUserReference.update({
            where: { id: row.id },
            data: { deletedAt: new Date() },
          });
        }
        continue;
      }
      if (row) {
        await tx.serviceUserReference.update({
          where: { id: row.id },
          data: { referenceValue: value, deletedAt: null },
        });
      } else {
        await tx.serviceUserReference.create({
          data: { serviceUserId, referenceType, referenceValue: value },
        });
      }
    }
  }

  async patchProfile(serviceUserId: string, dto: PatchPortalProfileDto) {
    await this.loadScopedUser(serviceUserId);

    await this.prisma.$transaction(async tx => {
      const data: Prisma.ServiceUserUpdateInput = {};
      if (dto.firstName !== undefined) data.firstName = dto.firstName;
      if (dto.lastName !== undefined) data.lastName = dto.lastName;
      if (dto.middleName !== undefined) data.middleName = dto.middleName;
      if (dto.preferredName !== undefined) data.preferredName = dto.preferredName;
      if (dto.email !== undefined) data.email = dto.email;
      if (dto.phone !== undefined) data.phone = dto.phone;
      if (dto.mobile !== undefined) data.mobile = dto.mobile;
      if (dto.dateOfBirth !== undefined) {
        data.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
      }
      if (dto.titleId !== undefined) {
        data.title = dto.titleId ? { connect: { id: dto.titleId } } : { disconnect: true };
      }
      if (dto.genderId !== undefined) {
        data.gender = dto.genderId ? { connect: { id: dto.genderId } } : { disconnect: true };
      }
      if (dto.maritalStatusId !== undefined) {
        data.maritalStatus = dto.maritalStatusId
          ? { connect: { id: dto.maritalStatusId } }
          : { disconnect: true };
      }

      if (Object.keys(data).length) {
        await tx.serviceUser.update({ where: { id: serviceUserId }, data });
      }

      const addressTouch =
        dto.addressLine1 !== undefined ||
        dto.addressLine2 !== undefined ||
        dto.town !== undefined ||
        dto.county !== undefined ||
        dto.postcode !== undefined ||
        dto.country !== undefined ||
        dto.accessInstructions !== undefined ||
        dto.keySafeNumber !== undefined;

      if (addressTouch) {
        const existing = await tx.serviceUserAddress.findFirst({
          where: { serviceUserId, deletedAt: null },
        });
        const addressData = {
          ...(dto.addressLine1 !== undefined ? { addressLine1: dto.addressLine1 } : {}),
          ...(dto.addressLine2 !== undefined ? { addressLine2: dto.addressLine2 } : {}),
          ...(dto.town !== undefined ? { town: dto.town } : {}),
          ...(dto.county !== undefined ? { county: dto.county } : {}),
          ...(dto.postcode !== undefined ? { postcode: dto.postcode } : {}),
          ...(dto.country !== undefined ? { country: dto.country } : {}),
          ...(dto.accessInstructions !== undefined ? { accessInstructions: dto.accessInstructions } : {}),
          ...(dto.keySafeNumber !== undefined ? { keySafeNumber: dto.keySafeNumber } : {}),
        };
        if (existing) {
          await tx.serviceUserAddress.update({ where: { id: existing.id }, data: addressData });
        } else {
          await tx.serviceUserAddress.create({ data: { serviceUserId, ...addressData } });
        }
      }

      await this.syncProfileReferences(tx, serviceUserId, dto);
    });

    const user = await this.loadScopedUser(serviceUserId);
    return { message: 'Profile updated', data: this.mapPortalProfile(user) };
  }

  async getAboutMe(serviceUserId: string) {
    await this.loadScopedUser(serviceUserId);
    const ref = await this.prisma.serviceUserReference.findFirst({
      where: { serviceUserId, referenceType: ABOUT_ME_REF_TYPE, deletedAt: null },
      select: { referenceValue: true },
    });
    let aboutMe: Record<string, unknown> | null = null;
    if (ref?.referenceValue) {
      try {
        aboutMe = JSON.parse(ref.referenceValue) as Record<string, unknown>;
      } catch {
        aboutMe = null;
      }
    }
    return { data: { aboutMe } };
  }

  async patchAboutMe(serviceUserId: string, dto: PatchPortalAboutMeDto) {
    await this.loadScopedUser(serviceUserId);
    if (!dto.aboutMe || typeof dto.aboutMe !== 'object') {
      throw new BadRequestException('aboutMe must be an object');
    }

    const refValue = JSON.stringify({ version: 1, ...dto.aboutMe });
    const existing = await this.prisma.serviceUserReference.findFirst({
      where: { serviceUserId, referenceType: ABOUT_ME_REF_TYPE, deletedAt: null },
    });

    if (existing) {
      await this.prisma.serviceUserReference.update({
        where: { id: existing.id },
        data: { referenceValue: refValue },
      });
    } else {
      await this.prisma.serviceUserReference.create({
        data: { serviceUserId, referenceType: ABOUT_ME_REF_TYPE, referenceValue: refValue },
      });
    }

    return { message: 'About Me saved', data: { aboutMe: JSON.parse(refValue) as Record<string, unknown> } };
  }

  async getContacts(serviceUserId: string) {
    await this.loadScopedUser(serviceUserId);
    const contacts = await this.prisma.serviceUserContact.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      include: { relationshipType: true },
    });
    return { data: contacts.map(c => this.mapPortalContact(c)) };
  }

  private mapPortalContact(
    c: Prisma.ServiceUserContactGetPayload<{ include: { relationshipType: true } }>,
  ) {
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      name: [c.firstName, c.lastName].filter(Boolean).join(' '),
      relationship: c.relationshipType?.name ?? null,
      relationshipTypeId: c.relationshipTypeId,
      phone: c.phone,
      mobile: c.mobile,
      email: c.email,
      address: c.address,
      isPrimary: c.isPrimary,
      isEmergencyContact: c.isEmergencyContact,
      canReceiveUpdates: c.canReceiveUpdates,
      notes: c.notes,
    };
  }

  async createContact(serviceUserId: string, dto: CreatePortalContactDto) {
    await this.loadScopedUser(serviceUserId);

    if (dto.relationshipTypeId) {
      const rel = await this.prisma.relationshipType.findFirst({
        where: { id: dto.relationshipTypeId, isActive: true },
      });
      if (!rel) throw new BadRequestException('Invalid relationship type');
    }

    const created = await this.prisma.$transaction(async tx => {
      if (dto.isPrimary) {
        await tx.serviceUserContact.updateMany({
          where: { serviceUserId, deletedAt: null, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      return tx.serviceUserContact.create({
        data: {
          serviceUserId,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName?.trim() || null,
          relationshipTypeId: dto.relationshipTypeId || null,
          phone: dto.phone?.trim() || null,
          mobile: dto.mobile?.trim() || null,
          email: dto.email?.trim() || null,
          address: dto.address?.trim() || null,
          isPrimary: dto.isPrimary ?? false,
          isEmergencyContact: dto.isEmergencyContact ?? false,
          canReceiveUpdates: dto.canReceiveUpdates ?? false,
          notes: dto.notes?.trim() || null,
        },
        include: { relationshipType: true },
      });
    });

    return { message: 'Contact added', data: this.mapPortalContact(created) };
  }

  async getAllergies(serviceUserId: string) {
    await this.loadScopedUser(serviceUserId);
    const rows = await this.prisma.serviceUserAllergy.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return {
      data: rows.map(a => ({
        id: a.id,
        allergyName: a.allergyName,
        comment: a.comment,
      })),
    };
  }

  async getCalendar(serviceUserId: string) {
    await this.loadScopedUser(serviceUserId);
    const now = new Date();
    const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const events = await this.prisma.serviceUserCalendarEvent.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        startDateTime: { gte: now, lte: in90Days },
      },
      orderBy: { startDateTime: 'asc' },
      take: 50,
      include: { eventType: true },
    });
    return {
      data: events.map(e => ({
        id: e.id,
        title: e.title,
        description: e.description,
        startAt: e.startDateTime.toISOString(),
        endAt: e.endDateTime?.toISOString() ?? null,
        status: e.status,
        location: e.location,
        eventType: e.eventType ? { id: e.eventType.id, name: e.eventType.name } : null,
      })),
    };
  }

  async getCompletedVisits(serviceUserId: string) {
    await this.loadScopedUser(serviceUserId);
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - 6);

    const rows = await this.prisma.scheduledVisit.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        isActive: true,
        status: { in: [ScheduledVisitStatus.COMPLETED, ScheduledVisitStatus.PARTIALLY_COMPLETED] },
        scheduledStartDateTime: { gte: since },
      },
      orderBy: { scheduledStartDateTime: 'desc' },
      take: 100,
      include: {
        allocations: {
          where: { deletedAt: null, isActive: true },
          include: { employee: { include: { personalDetail: true } } },
        },
        scheduledJob: {
          select: {
            allocations: {
              where: { deletedAt: null, isActive: true },
              include: { employee: { include: { personalDetail: true } } },
            },
          },
        },
      },
    });

    return {
      data: rows.map(v => {
        const allocations =
          v.allocations.length > 0 ? v.allocations : (v.scheduledJob.allocations ?? []);
        const carers = allocations.map(a => {
          const name = [a.employee.personalDetail?.firstName, a.employee.personalDetail?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim();
          return name || 'Carer';
        });

        return {
          id: v.id,
          visitName: v.visitName,
          scheduledStartAt: v.scheduledStartDateTime.toISOString(),
          scheduledEndAt: v.scheduledEndDateTime?.toISOString() ?? null,
          actualStartAt: v.actualStartDateTime?.toISOString() ?? null,
          actualEndAt: v.actualEndDateTime?.toISOString() ?? null,
          status: v.status,
          carers,
          notes: v.notes,
        };
      }),
    };
  }

  private async loadVisitPlanRoundNameMap(): Promise<Map<string, string>> {
    const rows = await this.prisma.medicationAdministrationRound.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (rows.length === 0) {
      return new Map(defaultVisitPlanSlotsFromRounds().map(s => [s.slotCode, s.slotCode]));
    }
    return new Map(rows.map(r => [r.code, r.name]));
  }

  private async loadEmployeeDisplayNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: { personalDetail: true },
    });
    return new Map(
      rows.map(e => {
        const name = [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ').trim();
        return [e.id, name || 'Carer'] as const;
      }),
    );
  }

  async getVisitPlans(serviceUserId: string) {
    await this.loadScopedUser(serviceUserId);
    const [roundNameByCode, rows] = await Promise.all([
      this.loadVisitPlanRoundNameMap(),
      this.prisma.serviceUserVisitPlan.findMany({
        where: {
          serviceUserId,
          deletedAt: null,
          isActive: true,
          status: { not: VisitPlanStatus.DRAFT },
        },
        include: portalVisitPlanInclude,
        orderBy: [{ effectiveFrom: 'desc' }],
      }),
    ]);

    const employeeNameById = await this.loadEmployeeDisplayNames(collectVisitPlanEmployeeIds(rows));
    const plans = rows.map(r => mapPortalVisitPlan(r, roundNameByCode, employeeNameById));
    const active = plans.find(p => p.status === VisitPlanStatus.ACTIVE) ?? null;

    return { data: { active, plans } };
  }

  async uploadPhoto(
    serviceUserId: string,
    file: Express.Multer.File,
    setAsProfile: boolean,
    meta?: RequestAuditMeta,
  ) {
    await this.loadScopedUser(serviceUserId);
    return this.photosService.upload(null, serviceUserId, file, { setAsProfile }, meta);
  }
}
