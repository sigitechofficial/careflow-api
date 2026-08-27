import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MedicationKind,
  MedicationPackMemberStatus,
  MedicationPackStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { assertServiceUserExists } from '../medications/medication.asserts';
import { CreateMedicationPackDto } from './dto/create-medication-pack.dto';
import { UpdateMedicationPackDto } from './dto/update-medication-pack.dto';
import { CreateMedicationPackItemDto } from './dto/create-medication-pack-item.dto';
import { UpdateMedicationPackItemDto } from './dto/update-medication-pack-item.dto';
import { LinkMedicationPackMemberDto } from './dto/link-medication-pack-member.dto';
import { EndMedicationPackMemberDto } from './dto/end-medication-pack-member.dto';
import { PublishMedicationPackDto } from './dto/publish-medication-pack.dto';
import { SupersedeMedicationPackDto } from './dto/supersede-medication-pack.dto';
import { EndMedicationPackDto } from './dto/end-medication-pack.dto';
import { CreateMedicationPackCompartmentDto } from './dto/create-medication-pack-compartment.dto';
import { UpdateMedicationPackCompartmentDto } from './dto/update-medication-pack-compartment.dto';
import type { MedicationPackManifestDto } from './dto/medication-pack-manifest-response.dto';
import { buildPackManifestPdf } from './medication-pack-manifest-pdf.util';
import {
  syncPackCompartmentsFromLinkedSchedules,
  syncPackMembersFromLinkedMedications,
} from './medication-pack-membership.util';

const PACK_TYPE_LABEL: Record<string, string> = {
  BLISTER: 'Blister pack',
  DOSSETTE: 'Dossette box',
  NOMAD: 'Nomad tray',
  OTHER: 'Other',
};

function formatPdfDate(value: Date | string | null): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const packInclude = {
  items: { where: { deletedAt: null, isActive: true }, orderBy: { sortOrder: 'asc' as const } },
} as const;

const memberMedicationInclude = {
  serviceUserMedication: {
    include: {
      route: true,
      schedules: {
        where: { deletedAt: null, isActive: true },
        select: { id: true, dueTime: true, dose: true, round: { select: { name: true } } },
      },
    },
  },
} as const;

type PackSetupPersist = {
  cycleDurationDays?: number;
  reviewDate?: Date | null;
  prescriptionChecked?: boolean;
  prescriptionCheckedBy?: string | null;
  prescriptionCheckedAt?: Date | null;
  generateAheadDays?: number;
  adminRules?: Prisma.InputJsonValue;
};

function packSetupFields(dto: Partial<CreateMedicationPackDto>): PackSetupPersist {
  const data: PackSetupPersist = {};
  if (dto.cycleDurationDays !== undefined) data.cycleDurationDays = dto.cycleDurationDays;
  if (dto.reviewDate !== undefined) {
    data.reviewDate = dto.reviewDate ? new Date(dto.reviewDate) : null;
  }
  if (dto.prescriptionChecked !== undefined) data.prescriptionChecked = dto.prescriptionChecked;
  if (dto.prescriptionCheckedBy !== undefined) data.prescriptionCheckedBy = dto.prescriptionCheckedBy;
  if (dto.prescriptionCheckedAt !== undefined) {
    data.prescriptionCheckedAt = dto.prescriptionCheckedAt
      ? new Date(dto.prescriptionCheckedAt)
      : null;
  }
  if (dto.generateAheadDays !== undefined) data.generateAheadDays = dto.generateAheadDays;
  if (dto.adminRules !== undefined) {
    data.adminRules = dto.adminRules as unknown as Prisma.InputJsonValue;
  }
  return data;
}

@Injectable()
export class MedicationPacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(serviceUserId: string) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const packs = await this.prisma.medicationPack.findMany({
      where: { serviceUserId, deletedAt: null, isActive: true },
      include: packInclude,
      orderBy: { updatedAt: 'desc' },
    });
    // Add-medication blister save used to set medicationPackId without members/slots.
    // Opening this tab backfills linked chart medicines into pack members and compartments.
    await Promise.all(
      packs.map(async (pack) => {
        await syncPackMembersFromLinkedMedications(this.prisma, pack.id);
        await syncPackCompartmentsFromLinkedSchedules(this.prisma, pack.id);
      }),
    );
    return packs;
  }

  async getOne(serviceUserId: string, packId: string) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const pack = await this.prisma.medicationPack.findFirst({
      where: { id: packId, serviceUserId, deletedAt: null },
      include: packInclude,
    });
    if (!pack) throw new NotFoundException('Medication pack not found');
    return pack;
  }

  async create(userId: string, serviceUserId: string, dto: CreateMedicationPackDto, meta: RequestAuditMeta) {
    await assertServiceUserExists(this.prisma, serviceUserId);
    const created = await this.prisma.medicationPack.create({
      data: {
        serviceUserId,
        name: dto.name,
        description: dto.description,
        packType: dto.packType ?? undefined,
        cycleNumber: dto.cycleNumber ?? undefined,
        roundLabel: dto.roundLabel,
        pharmacyName: dto.pharmacyName,
        pharmacyPhone: dto.pharmacyPhone,
        gpName: dto.gpName,
        gpSurgery: dto.gpSurgery,
        nhsNumber: dto.nhsNumber,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        ...packSetupFields(dto),
        createdById: userId,
        updatedById: userId,
      },
      include: packInclude,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_CREATED,
      recordType: 'MedicationPack',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: { serviceUserId },
      ...meta,
    });
    return created;
  }

  async update(userId: string, serviceUserId: string, packId: string, dto: UpdateMedicationPackDto, meta: RequestAuditMeta) {
    const existing = await this.prisma.medicationPack.findFirst({
      where: { id: packId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Medication pack not found');
    const updated = await this.prisma.medicationPack.update({
      where: { id: packId },
      data: {
        name: dto.name,
        description: dto.description,
        packType: dto.packType,
        cycleNumber: dto.cycleNumber,
        roundLabel: dto.roundLabel,
        pharmacyName: dto.pharmacyName,
        pharmacyPhone: dto.pharmacyPhone,
        gpName: dto.gpName,
        gpSurgery: dto.gpSurgery,
        nhsNumber: dto.nhsNumber,
        startDate: dto.startDate === undefined ? undefined : dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate === undefined ? undefined : dto.endDate ? new Date(dto.endDate) : null,
        ...packSetupFields(dto),
        updatedById: userId,
      },
      include: packInclude,
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_UPDATED,
      recordType: 'MedicationPack',
      recordId: packId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });
    return updated;
  }

  async remove(userId: string, serviceUserId: string, packId: string, meta: RequestAuditMeta) {
    const existing = await this.prisma.medicationPack.findFirst({
      where: { id: packId, serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Medication pack not found');
    const now = new Date();
    await this.prisma.medicationPack.update({
      where: { id: packId },
      data: { deletedAt: now, deletedById: userId, isActive: false, updatedById: userId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_DELETED,
      recordType: 'MedicationPack',
      recordId: packId,
      oldValues: auditSnapshot(existing),
      ...meta,
    });
    return { id: packId, deleted: true };
  }

  async addItem(
    userId: string,
    serviceUserId: string,
    packId: string,
    dto: CreateMedicationPackItemDto,
    meta: RequestAuditMeta,
  ) {
    await this.getOne(serviceUserId, packId);
    const item = await this.prisma.medicationPackItem.create({
      data: {
        medicationPackId: packId,
        medicationName: dto.medicationName,
        strength: dto.strength,
        notes: dto.notes,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_ITEM_ADDED,
      recordType: 'MedicationPackItem',
      recordId: item.id,
      newValues: auditSnapshot(item),
      metadata: { serviceUserId, packId },
      ...meta,
    });
    return item;
  }

  async updateItem(
    userId: string,
    serviceUserId: string,
    packId: string,
    itemId: string,
    dto: UpdateMedicationPackItemDto,
    meta: RequestAuditMeta,
  ) {
    await this.getOne(serviceUserId, packId);
    const existing = await this.prisma.medicationPackItem.findFirst({
      where: { id: itemId, medicationPackId: packId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Pack item not found');
    const updated = await this.prisma.medicationPackItem.update({
      where: { id: itemId },
      data: {
        medicationName: dto.medicationName,
        strength: dto.strength,
        notes: dto.notes,
        sortOrder: dto.sortOrder,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_ITEM_UPDATED,
      recordType: 'MedicationPackItem',
      recordId: itemId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });
    return updated;
  }

  async removeItem(userId: string, serviceUserId: string, packId: string, itemId: string, meta: RequestAuditMeta) {
    await this.getOne(serviceUserId, packId);
    const existing = await this.prisma.medicationPackItem.findFirst({
      where: { id: itemId, medicationPackId: packId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Pack item not found');
    await this.prisma.medicationPackItem.update({
      where: { id: itemId },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_ITEM_DELETED,
      recordType: 'MedicationPackItem',
      recordId: itemId,
      oldValues: auditSnapshot(existing),
      ...meta,
    });
    return { id: itemId, deleted: true };
  }

  // ---- Track E: canonical membership ------------------------------------

  private assertPackEditable(status: MedicationPackStatus) {
    if (status === MedicationPackStatus.SUPERSEDED || status === MedicationPackStatus.ENDED) {
      throw new ConflictException(`Pack is ${status.toLowerCase()} and can no longer be edited`);
    }
  }

  async listMembers(serviceUserId: string, packId: string) {
    await this.getOne(serviceUserId, packId);
    await syncPackMembersFromLinkedMedications(this.prisma, packId);
    return this.prisma.medicationPackMember.findMany({
      where: { medicationPackId: packId, deletedAt: null },
      include: memberMedicationInclude,
      orderBy: { linkedAt: 'asc' },
    });
  }

  async addMember(
    userId: string,
    serviceUserId: string,
    packId: string,
    dto: LinkMedicationPackMemberDto,
    meta: RequestAuditMeta,
  ) {
    const pack = await this.getOne(serviceUserId, packId);
    this.assertPackEditable(pack.status);

    const medication = await this.prisma.serviceUserMedication.findFirst({
      where: { id: dto.serviceUserMedicationId, serviceUserId, deletedAt: null },
    });
    if (!medication) throw new NotFoundException('Medication not found for this service user');

    // Guard rails (medication.md §35.2): blister packs hold scheduled, non-controlled meds only.
    if (medication.medicationKind === MedicationKind.PRN) {
      throw new BadRequestException('PRN medications cannot be added to a blister pack');
    }
    if (medication.isControlledMedication) {
      throw new BadRequestException('Controlled drugs cannot be added to a blister pack');
    }

    const existingActive = await this.prisma.medicationPackMember.findFirst({
      where: {
        serviceUserMedicationId: dto.serviceUserMedicationId,
        status: MedicationPackMemberStatus.ACTIVE,
        deletedAt: null,
      },
    });
    if (existingActive) {
      if (existingActive.medicationPackId === packId) {
        throw new ConflictException('Medication is already linked to this pack');
      }
      throw new ConflictException('Medication is already an active member of another pack');
    }

    const member = await this.prisma.$transaction(async (tx) => {
      const created = await tx.medicationPackMember.upsert({
        where: {
          medicationPackId_serviceUserMedicationId: {
            medicationPackId: packId,
            serviceUserMedicationId: dto.serviceUserMedicationId,
          },
        },
        create: {
          medicationPackId: packId,
          serviceUserMedicationId: dto.serviceUserMedicationId,
          status: MedicationPackMemberStatus.ACTIVE,
          linkedById: userId,
        },
        update: {
          status: MedicationPackMemberStatus.ACTIVE,
          linkedAt: new Date(),
          linkedById: userId,
          endedAt: null,
          endedById: null,
          deletedAt: null,
        },
        include: memberMedicationInclude,
      });
      await tx.serviceUserMedication.update({
        where: { id: dto.serviceUserMedicationId },
        data: { medicationPackId: packId, updatedById: userId },
      });
      return created;
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_MEMBER_LINKED,
      recordType: 'MedicationPackMember',
      recordId: member.id,
      newValues: auditSnapshot(member),
      metadata: { serviceUserId, packId, serviceUserMedicationId: dto.serviceUserMedicationId },
      ...meta,
    });
    return member;
  }

  async endMember(
    userId: string,
    serviceUserId: string,
    packId: string,
    memberId: string,
    dto: EndMedicationPackMemberDto,
    meta: RequestAuditMeta,
  ) {
    await this.getOne(serviceUserId, packId);
    const existing = await this.prisma.medicationPackMember.findFirst({
      where: { id: memberId, medicationPackId: packId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Pack member not found');
    if (existing.status === MedicationPackMemberStatus.ENDED) {
      throw new ConflictException('Pack member is already ended');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await tx.medicationPackMember.update({
        where: { id: memberId },
        data: { status: MedicationPackMemberStatus.ENDED, endedAt: new Date(), endedById: userId },
        include: memberMedicationInclude,
      });
      // Clear the denormalized cache only if it still points at this pack.
      await tx.serviceUserMedication.updateMany({
        where: { id: existing.serviceUserMedicationId, medicationPackId: packId },
        data: { medicationPackId: null, updatedById: userId },
      });
      return member;
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_MEMBER_ENDED,
      recordType: 'MedicationPackMember',
      recordId: memberId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      metadata: { serviceUserId, packId, reason: dto.reason },
      ...meta,
    });
    return updated;
  }

  // ---- Track E: publish / manifest / lifecycle --------------------------

  async publish(
    userId: string,
    serviceUserId: string,
    packId: string,
    dto: PublishMedicationPackDto,
    meta: RequestAuditMeta,
  ) {
    const pack = await this.getOne(serviceUserId, packId);
    this.assertPackEditable(pack.status);
    await syncPackMembersFromLinkedMedications(this.prisma, packId, userId);
    await syncPackCompartmentsFromLinkedSchedules(this.prisma, packId);

    const members = await this.prisma.medicationPackMember.findMany({
      where: { medicationPackId: packId, status: MedicationPackMemberStatus.ACTIVE, deletedAt: null },
      include: memberMedicationInclude,
      orderBy: { linkedAt: 'asc' },
    });
    if (members.length === 0) {
      throw new BadRequestException('Cannot publish a pack with no active medications');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const snapshot = await tx.medicationPackContentsSnapshot.create({
        data: {
          medicationPackId: packId,
          cycleNumber: pack.cycleNumber,
          packName: pack.name,
          packType: pack.packType,
          pharmacyName: pack.pharmacyName,
          pharmacyPhone: pack.pharmacyPhone,
          gpName: pack.gpName,
          gpSurgery: pack.gpSurgery,
          nhsNumber: pack.nhsNumber,
          startDate: pack.startDate,
          endDate: pack.endDate,
          publishedById: userId,
          lines: {
            create: members.map((m, index) => {
              const med = m.serviceUserMedication;
              return {
                serviceUserMedicationId: med.id,
                medicationName: med.medicationName,
                strength: med.strength ?? null,
                dose: med.dose ?? null,
                routeName: med.route?.name ?? null,
                instructions: med.instructions ?? null,
                roundLabels: pack.roundLabel ?? null,
                sortOrder: index,
              };
            }),
          },
        },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });

      const updatedPack = await tx.medicationPack.update({
        where: { id: packId },
        data: {
          status: MedicationPackStatus.ACTIVE,
          publishedAt: new Date(),
          publishedById: userId,
          updatedById: userId,
        },
        include: packInclude,
      });
      return { snapshot, updatedPack };
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_PUBLISHED,
      recordType: 'MedicationPack',
      recordId: packId,
      newValues: auditSnapshot(result.snapshot),
      metadata: { serviceUserId, cycleNumber: pack.cycleNumber, memberCount: members.length, notes: dto.notes },
      ...meta,
    });
    return result.snapshot;
  }

  async getManifest(serviceUserId: string, packId: string): Promise<MedicationPackManifestDto> {
    const pack = await this.getOne(serviceUserId, packId);

    const snapshot = await this.prisma.medicationPackContentsSnapshot.findFirst({
      where: { medicationPackId: packId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { publishedAt: 'desc' },
    });

    if (snapshot) {
      return {
        packId,
        snapshotId: snapshot.id,
        packName: snapshot.packName,
        packType: snapshot.packType,
        cycleNumber: snapshot.cycleNumber,
        source: 'PUBLISHED',
        pharmacyName: snapshot.pharmacyName,
        pharmacyPhone: snapshot.pharmacyPhone,
        gpName: snapshot.gpName,
        gpSurgery: snapshot.gpSurgery,
        nhsNumber: snapshot.nhsNumber,
        startDate: snapshot.startDate,
        endDate: snapshot.endDate,
        publishedAt: snapshot.publishedAt,
        lines: snapshot.lines.map((l) => ({
          id: l.id,
          serviceUserMedicationId: l.serviceUserMedicationId,
          medicationName: l.medicationName,
          strength: l.strength,
          dose: l.dose,
          routeName: l.routeName,
          instructions: l.instructions,
          roundLabels: l.roundLabels,
          tabletDescription: l.tabletDescription,
          sortOrder: l.sortOrder,
        })),
      };
    }

    const members = await this.prisma.medicationPackMember.findMany({
      where: { medicationPackId: packId, status: MedicationPackMemberStatus.ACTIVE, deletedAt: null },
      include: memberMedicationInclude,
      orderBy: { linkedAt: 'asc' },
    });

    return {
      packId,
      snapshotId: null,
      packName: pack.name,
      packType: pack.packType,
      cycleNumber: pack.cycleNumber,
      source: 'LIVE',
      pharmacyName: pack.pharmacyName,
      pharmacyPhone: pack.pharmacyPhone,
      gpName: pack.gpName,
      gpSurgery: pack.gpSurgery,
      nhsNumber: pack.nhsNumber,
      startDate: pack.startDate,
      endDate: pack.endDate,
      publishedAt: null,
      lines: members.map((m, index) => {
        const med = m.serviceUserMedication;
        return {
          id: m.id,
          serviceUserMedicationId: med.id,
          medicationName: med.medicationName,
          strength: med.strength ?? null,
          dose: med.dose ?? null,
          routeName: med.route?.name ?? null,
          instructions: med.instructions ?? null,
          roundLabels: pack.roundLabel ?? null,
          tabletDescription: null,
          sortOrder: index,
        };
      }),
    };
  }

  async getManifestPdf(serviceUserId: string, packId: string, generatedByName?: string): Promise<Buffer> {
    const manifest = await this.getManifest(serviceUserId, packId);
    const serviceUser = await this.prisma.serviceUser.findUnique({
      where: { id: serviceUserId },
      select: { firstName: true, lastName: true, preferredName: true, dateOfBirth: true },
    });
    const name = serviceUser
      ? [serviceUser.firstName, serviceUser.lastName].filter(Boolean).join(' ').trim() || 'Service user'
      : 'Service user';
    return buildPackManifestPdf({
      serviceUserName: name,
      dateOfBirth: formatPdfDate(serviceUser?.dateOfBirth ?? null),
      packName: manifest.packName,
      packTypeLabel: PACK_TYPE_LABEL[manifest.packType] ?? manifest.packType,
      cycleNumber: manifest.cycleNumber,
      source: manifest.source,
      pharmacyName: manifest.pharmacyName,
      pharmacyPhone: manifest.pharmacyPhone,
      gpName: manifest.gpName,
      gpSurgery: manifest.gpSurgery,
      nhsNumber: manifest.nhsNumber,
      startDate: formatPdfDate(manifest.startDate),
      endDate: formatPdfDate(manifest.endDate),
      publishedAt: formatPdfDate(manifest.publishedAt),
      generatedAt: formatPdfDate(new Date()),
      generatedBy: generatedByName,
      lines: manifest.lines.map((l) => ({
        medicationName: l.medicationName,
        strength: l.strength,
        dose: l.dose,
        routeName: l.routeName,
        roundLabels: l.roundLabels,
        instructions: l.instructions,
      })),
    });
  }

  async supersede(
    userId: string,
    serviceUserId: string,
    packId: string,
    dto: SupersedeMedicationPackDto,
    meta: RequestAuditMeta,
  ) {
    const pack = await this.getOne(serviceUserId, packId);
    if (pack.status !== MedicationPackStatus.ACTIVE) {
      throw new ConflictException('Only an ACTIVE pack can be superseded');
    }
    const carryMembers = dto.carryMembers ?? true;

    const activeMembers = carryMembers
      ? await this.prisma.medicationPackMember.findMany({
          where: { medicationPackId: packId, status: MedicationPackMemberStatus.ACTIVE, deletedAt: null },
        })
      : [];

    const newPack = await this.prisma.$transaction(async (tx) => {
      const created = await tx.medicationPack.create({
        data: {
          serviceUserId,
          name: dto.newPackName ?? pack.name,
          description: pack.description,
          packType: pack.packType,
          cycleNumber: pack.cycleNumber + 1,
          status: MedicationPackStatus.DRAFT,
          roundLabel: pack.roundLabel,
          pharmacyName: pack.pharmacyName,
          pharmacyPhone: pack.pharmacyPhone,
          gpName: pack.gpName,
          gpSurgery: pack.gpSurgery,
          nhsNumber: pack.nhsNumber,
          createdById: userId,
          updatedById: userId,
        },
        include: packInclude,
      });

      // Move active membership to the new draft pack so the cache stays consistent.
      for (const member of activeMembers) {
        await tx.medicationPackMember.update({
          where: { id: member.id },
          data: { status: MedicationPackMemberStatus.ENDED, endedAt: new Date(), endedById: userId },
        });
        await tx.medicationPackMember.create({
          data: {
            medicationPackId: created.id,
            serviceUserMedicationId: member.serviceUserMedicationId,
            status: MedicationPackMemberStatus.ACTIVE,
            linkedById: userId,
          },
        });
        await tx.serviceUserMedication.updateMany({
          where: { id: member.serviceUserMedicationId, medicationPackId: packId },
          data: { medicationPackId: created.id, updatedById: userId },
        });
      }

      await tx.medicationPack.update({
        where: { id: packId },
        data: {
          status: MedicationPackStatus.SUPERSEDED,
          supersededAt: new Date(),
          supersededById: userId,
          supersededByPackId: created.id,
          isActive: false,
          updatedById: userId,
        },
      });
      return created;
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_SUPERSEDED,
      recordType: 'MedicationPack',
      recordId: packId,
      newValues: auditSnapshot({ supersededByPackId: newPack.id, cycleNumber: newPack.cycleNumber }),
      metadata: { serviceUserId, newPackId: newPack.id, reason: dto.reason, carryMembers },
      ...meta,
    });
    return newPack;
  }

  async end(
    userId: string,
    serviceUserId: string,
    packId: string,
    dto: EndMedicationPackDto,
    meta: RequestAuditMeta,
  ) {
    const pack = await this.getOne(serviceUserId, packId);
    if (pack.status === MedicationPackStatus.ENDED) {
      throw new ConflictException('Pack is already ended');
    }

    const ended = await this.prisma.$transaction(async (tx) => {
      const members = await tx.medicationPackMember.findMany({
        where: { medicationPackId: packId, status: MedicationPackMemberStatus.ACTIVE, deletedAt: null },
      });
      const now = new Date();
      for (const member of members) {
        await tx.medicationPackMember.update({
          where: { id: member.id },
          data: { status: MedicationPackMemberStatus.ENDED, endedAt: now, endedById: userId },
        });
        await tx.serviceUserMedication.updateMany({
          where: { id: member.serviceUserMedicationId, medicationPackId: packId },
          data: { medicationPackId: null, updatedById: userId },
        });
      }
      return tx.medicationPack.update({
        where: { id: packId },
        data: {
          status: MedicationPackStatus.ENDED,
          endedAt: now,
          endedById: userId,
          isActive: false,
          updatedById: userId,
        },
        include: packInclude,
      });
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_ENDED,
      recordType: 'MedicationPack',
      recordId: packId,
      oldValues: auditSnapshot(pack),
      newValues: auditSnapshot(ended),
      metadata: { serviceUserId, reason: dto.reason },
      ...meta,
    });
    return ended;
  }

  // ---- Track E: compartments (tray time slots) --------------------------

  async listCompartments(serviceUserId: string, packId: string) {
    await this.getOne(serviceUserId, packId);
    await syncPackCompartmentsFromLinkedSchedules(this.prisma, packId);
    return this.prisma.medicationPackCompartment.findMany({
      where: { medicationPackId: packId, deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { dueTime: 'asc' }],
    });
  }

  async addCompartment(
    userId: string,
    serviceUserId: string,
    packId: string,
    dto: CreateMedicationPackCompartmentDto,
    meta: RequestAuditMeta,
  ) {
    await this.getOne(serviceUserId, packId);
    const created = await this.prisma.medicationPackCompartment.create({
      data: {
        medicationPackId: packId,
        label: dto.label,
        dueTime: dto.dueTime,
        windowStart: dto.windowStart,
        windowEnd: dto.windowEnd,
        lateThresholdMinutes: dto.lateThresholdMinutes ?? undefined,
        witnessRequired: dto.witnessRequired ?? undefined,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_COMPARTMENT_ADDED,
      recordType: 'MedicationPackCompartment',
      recordId: created.id,
      newValues: auditSnapshot(created),
      metadata: { serviceUserId, packId },
      ...meta,
    });
    return created;
  }

  async updateCompartment(
    userId: string,
    serviceUserId: string,
    packId: string,
    compartmentId: string,
    dto: UpdateMedicationPackCompartmentDto,
    meta: RequestAuditMeta,
  ) {
    await this.getOne(serviceUserId, packId);
    const existing = await this.prisma.medicationPackCompartment.findFirst({
      where: { id: compartmentId, medicationPackId: packId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Compartment not found');
    const updated = await this.prisma.medicationPackCompartment.update({
      where: { id: compartmentId },
      data: {
        label: dto.label,
        dueTime: dto.dueTime,
        windowStart: dto.windowStart,
        windowEnd: dto.windowEnd,
        lateThresholdMinutes: dto.lateThresholdMinutes,
        witnessRequired: dto.witnessRequired,
        sortOrder: dto.sortOrder,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_COMPARTMENT_UPDATED,
      recordType: 'MedicationPackCompartment',
      recordId: compartmentId,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ...meta,
    });
    return updated;
  }

  async removeCompartment(
    userId: string,
    serviceUserId: string,
    packId: string,
    compartmentId: string,
    meta: RequestAuditMeta,
  ) {
    await this.getOne(serviceUserId, packId);
    const existing = await this.prisma.medicationPackCompartment.findFirst({
      where: { id: compartmentId, medicationPackId: packId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Compartment not found');
    await this.prisma.medicationPackCompartment.update({
      where: { id: compartmentId },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_PACK_COMPARTMENT_REMOVED,
      recordType: 'MedicationPackCompartment',
      recordId: compartmentId,
      oldValues: auditSnapshot(existing),
      ...meta,
    });
    return { id: compartmentId, deleted: true };
  }
}
