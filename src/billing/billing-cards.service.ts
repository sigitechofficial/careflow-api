import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  AssignChargeCardMatchingDto,
  AssignPayCardMatchingDto,
  BillingCardQueryDto,
  ChargeCardRuleDto,
  CreateChargeCardDto,
  CreatePayCardDto,
  PayCardRuleDto,
  UpdateChargeCardDto,
  UpdatePayCardDto,
} from './dto/billing-cards.dto';
import {
  buildEmploymentWhereForPayCard,
  normalizePayCardAssignmentInput,
  payCardListInclude,
  pickBestMatchingPayCard,
  resolveAssignmentLabel,
} from './pay-card-assignment.util';
import {
  buildChargeCardBulkAssignTarget,
  chargeCardListInclude,
  normalizeChargeCardAssignmentInput,
  pickBestMatchingChargeCard,
  resolveChargeAssignmentLabel,
} from './charge-card-assignment.util';

function parseDateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

async function buildPayCardAssignmentData(
  tx: Prisma.TransactionClient,
  input: {
    assignmentLevel?: CreatePayCardDto['assignmentLevel'];
    assignmentTargetId?: string | null;
    assignmentTargetKey?: string | null;
    assignmentLabel?: string;
  },
) {
  const assignmentLevel = input.assignmentLevel ?? 'ORGANISATION_DEFAULT';
  const targets = normalizePayCardAssignmentInput({
    assignmentLevel,
    assignmentTargetId: input.assignmentTargetId,
    assignmentTargetKey: input.assignmentTargetKey,
  });
  const assignmentLabel =
    input.assignmentLabel?.trim() ||
    (await resolveAssignmentLabel(
      tx,
      assignmentLevel,
      targets.assignmentTargetId,
      targets.assignmentTargetKey,
    ));
  return {
    assignmentLevel,
    assignmentTargetId: targets.assignmentTargetId,
    assignmentTargetKey: targets.assignmentTargetKey,
    assignmentLabel: assignmentLabel?.trim() || null,
  };
}

async function buildChargeCardAssignmentData(
  tx: Prisma.TransactionClient,
  input: {
    assignmentLevel?: CreateChargeCardDto['assignmentLevel'];
    assignmentTargetId?: string | null;
    assignmentTargetKey?: string | null;
    assignmentLabel?: string;
  },
) {
  const assignmentLevel = input.assignmentLevel ?? 'ORGANISATION_DEFAULT';
  const targets = normalizeChargeCardAssignmentInput({
    assignmentLevel,
    assignmentTargetId: input.assignmentTargetId,
    assignmentTargetKey: input.assignmentTargetKey,
  });
  const assignmentLabel =
    input.assignmentLabel?.trim() ||
    (await resolveChargeAssignmentLabel(
      tx,
      assignmentLevel,
      targets.assignmentTargetId,
      targets.assignmentTargetKey,
    ));
  return {
    assignmentLevel,
    assignmentTargetId: targets.assignmentTargetId,
    assignmentTargetKey: targets.assignmentTargetKey,
    assignmentLabel: assignmentLabel?.trim() || null,
  };
}

function mapPayRules(rules?: PayCardRuleDto[]) {
  return (rules ?? []).map((rule, index) => ({
    label: rule.label?.trim() || null,
    serviceType: rule.serviceType?.trim() || null,
    dayType: rule.dayType ?? 'ANY',
    startTime: rule.startTime?.trim() || null,
    endTime: rule.endTime?.trim() || null,
    rateType: rule.rateType ?? 'HOURLY',
    amount: rule.amount,
    multiplier: rule.multiplier ?? null,
    minimumMinutes: rule.minimumMinutes ?? null,
    roundingRule: rule.roundingRule?.trim() || null,
    priority: rule.priority ?? 0,
    sortOrder: rule.sortOrder ?? index,
  }));
}

function mapChargeRules(rules?: ChargeCardRuleDto[]) {
  return (rules ?? []).map((rule, index) => ({
    label: rule.label?.trim() || null,
    serviceType: rule.serviceType?.trim() || null,
    dayType: rule.dayType ?? 'ANY',
    startTime: rule.startTime?.trim() || null,
    endTime: rule.endTime?.trim() || null,
    chargeMethod: rule.chargeMethod ?? 'HOURLY_PRO_RATA',
    rateType: rule.rateType ?? 'HOURLY',
    amount: rule.amount,
    multiplier: rule.multiplier ?? null,
    minimumMinutes: rule.minimumMinutes ?? null,
    roundingRule: rule.roundingRule?.trim() || null,
    chargeableFlag: rule.chargeableFlag ?? true,
    priority: rule.priority ?? 0,
    sortOrder: rule.sortOrder ?? index,
  }));
}

@Injectable()
export class PayCardsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: BillingCardQueryDto) {
    const where: Prisma.PayCardWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s, mode: 'insensitive' } },
        { assignmentLabel: { contains: s, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.payCard.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: payCardListInclude,
    });
    return { data: rows };
  }

  async getById(id: string) {
    const row = await this.prisma.payCard.findFirst({
      where: { id, deletedAt: null },
      include: payCardListInclude,
    });
    if (!row) throw new NotFoundException('Pay card not found');
    return { data: row };
  }

  async create(userId: string, dto: CreatePayCardDto, _meta?: RequestAuditMeta) {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const assignment = await buildPayCardAssignmentData(tx, dto);
        return tx.payCard.create({
          data: {
            name: dto.name.trim(),
            code: dto.code.trim().toUpperCase(),
            ...assignment,
            currency: dto.currency?.trim() || 'GBP',
            status: dto.status ?? 'DRAFT',
            effectiveFrom: parseDateOnly(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null,
            notes: dto.notes?.trim() || null,
            createdById: userId,
            rules: { create: mapPayRules(dto.rules) },
          },
          include: payCardListInclude,
        });
      });
      return { message: 'Pay card created', data: created };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A pay card with this code already exists');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdatePayCardDto, _meta?: RequestAuditMeta) {
    const existing = await this.prisma.payCard.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Pay card not found');
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.rules) {
          await tx.payCardRule.deleteMany({ where: { payCardId: id } });
        }

        const assignmentTouched =
          dto.assignmentLevel !== undefined ||
          dto.assignmentTargetId !== undefined ||
          dto.assignmentTargetKey !== undefined ||
          dto.assignmentLabel !== undefined;

        const assignment = assignmentTouched
          ? await buildPayCardAssignmentData(tx, {
              assignmentLevel: dto.assignmentLevel ?? existing.assignmentLevel,
              assignmentTargetId:
                dto.assignmentTargetId !== undefined
                  ? dto.assignmentTargetId
                  : existing.assignmentTargetId,
              assignmentTargetKey:
                dto.assignmentTargetKey !== undefined
                  ? dto.assignmentTargetKey
                  : existing.assignmentTargetKey,
              assignmentLabel: dto.assignmentLabel ?? existing.assignmentLabel ?? undefined,
            })
          : null;

        return tx.payCard.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
            ...(assignment ?? {}),
            ...(dto.currency !== undefined ? { currency: dto.currency.trim() } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            ...(dto.effectiveFrom !== undefined ? { effectiveFrom: parseDateOnly(dto.effectiveFrom) } : {}),
            ...(dto.effectiveTo !== undefined
              ? { effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
            updatedById: userId,
            ...(dto.rules ? { rules: { create: mapPayRules(dto.rules) } } : {}),
          },
          include: payCardListInclude,
        });
      });
      return { message: 'Pay card updated', data: updated };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A pay card with this code already exists');
      }
      throw e;
    }
  }

  async getAssignmentPreview(id: string) {
    const card = await this.prisma.payCard.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw new NotFoundException('Pay card not found');
    const where = buildEmploymentWhereForPayCard(card);
    const [matchingCount, unassignedCount, assignedCount] = await Promise.all([
      this.prisma.employeeEmployment.count({ where }),
      this.prisma.employeeEmployment.count({
        where: { ...where, defaultPayCardId: null },
      }),
      this.prisma.employeeEmployment.count({
        where: { ...where, defaultPayCardId: id },
      }),
    ]);
    return {
      data: {
        matchingCount,
        unassignedCount,
        assignedCount,
      },
    };
  }

  async assignToMatchingEmployees(
    userId: string,
    id: string,
    dto: AssignPayCardMatchingDto,
    _meta?: RequestAuditMeta,
  ) {
    const card = await this.prisma.payCard.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw new NotFoundException('Pay card not found');
    const onlyUnassigned = dto.onlyUnassigned ?? true;
    const where = buildEmploymentWhereForPayCard(card);
    if (onlyUnassigned) {
      where.defaultPayCardId = null;
    }
    const result = await this.prisma.employeeEmployment.updateMany({
      where,
      data: { defaultPayCardId: id, updatedById: userId },
    });
    return {
      message: `Assigned pay card to ${result.count} carer${result.count === 1 ? '' : 's'}`,
      data: { assignedCount: result.count },
    };
  }

  async resolveForEmployee(employeeId: string) {
    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId, deletedAt: null, employee: { deletedAt: null } },
      include: {
        defaultPayCard: { include: payCardListInclude },
      },
    });
    if (!employment) throw new NotFoundException('Employee employment record not found');

    if (employment.defaultPayCard) {
      return {
        data: {
          source: 'EXPLICIT' as const,
          payCard: employment.defaultPayCard,
          matchedLevel: null,
        },
      };
    }

    const cards = await this.prisma.payCard.findMany({
      where: { deletedAt: null },
      include: payCardListInclude,
    });
    const matched = pickBestMatchingPayCard(
      {
        roleId: employment.roleId,
        locationId: employment.locationId,
        baseLocationId: employment.baseLocationId,
        contractTypeId: employment.contractTypeId,
        isAgencyStaff: employment.isAgencyStaff,
        isBankStaff: employment.isBankStaff,
      },
      cards,
    );

    if (!matched) {
      return {
        data: {
          source: 'NONE' as const,
          payCard: null,
          matchedLevel: null,
        },
      };
    }

    return {
      data: {
        source: 'MATCHED' as const,
        payCard: matched,
        matchedLevel: matched.assignmentLevel,
      },
    };
  }

  async remove(userId: string, id: string, _meta?: RequestAuditMeta) {
    const existing = await this.prisma.payCard.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Pay card not found');
    await this.prisma.payCard.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
    });
    return { message: 'Pay card deleted' };
  }
}

@Injectable()
export class ChargeCardsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: BillingCardQueryDto) {
    const where: Prisma.ChargeCardWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s, mode: 'insensitive' } },
        { assignmentLabel: { contains: s, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.chargeCard.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: chargeCardListInclude,
    });
    return { data: rows };
  }

  async getById(id: string) {
    const row = await this.prisma.chargeCard.findFirst({
      where: { id, deletedAt: null },
      include: chargeCardListInclude,
    });
    if (!row) throw new NotFoundException('Charge card not found');
    return { data: row };
  }

  async create(userId: string, dto: CreateChargeCardDto, _meta?: RequestAuditMeta) {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const assignment = await buildChargeCardAssignmentData(tx, dto);
        return tx.chargeCard.create({
          data: {
            name: dto.name.trim(),
            code: dto.code.trim().toUpperCase(),
            ...assignment,
            currency: dto.currency?.trim() || 'GBP',
            billingFrequency: dto.billingFrequency ?? 'WEEKLY',
            paymentTerms: dto.paymentTerms?.trim() || null,
            taxTreatment: dto.taxTreatment?.trim() || null,
            invoiceGroupingRule: dto.invoiceGroupingRule?.trim() || null,
            defaultChargeMethod: dto.defaultChargeMethod ?? 'HOURLY_PRO_RATA',
            status: dto.status ?? 'DRAFT',
            effectiveFrom: parseDateOnly(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null,
            notes: dto.notes?.trim() || null,
            createdById: userId,
            rules: { create: mapChargeRules(dto.rules) },
          },
          include: chargeCardListInclude,
        });
      });
      return { message: 'Charge card created', data: created };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A charge card with this code already exists');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateChargeCardDto, _meta?: RequestAuditMeta) {
    const existing = await this.prisma.chargeCard.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Charge card not found');
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.rules) {
          await tx.chargeCardRule.deleteMany({ where: { chargeCardId: id } });
        }

        const assignmentTouched =
          dto.assignmentLevel !== undefined ||
          dto.assignmentTargetId !== undefined ||
          dto.assignmentTargetKey !== undefined ||
          dto.assignmentLabel !== undefined;

        const assignment = assignmentTouched
          ? await buildChargeCardAssignmentData(tx, {
              assignmentLevel: dto.assignmentLevel ?? existing.assignmentLevel,
              assignmentTargetId:
                dto.assignmentTargetId !== undefined
                  ? dto.assignmentTargetId
                  : existing.assignmentTargetId,
              assignmentTargetKey:
                dto.assignmentTargetKey !== undefined
                  ? dto.assignmentTargetKey
                  : existing.assignmentTargetKey,
              assignmentLabel: dto.assignmentLabel ?? existing.assignmentLabel ?? undefined,
            })
          : null;

        return tx.chargeCard.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
            ...(assignment ?? {}),
            ...(dto.currency !== undefined ? { currency: dto.currency.trim() } : {}),
            ...(dto.billingFrequency !== undefined ? { billingFrequency: dto.billingFrequency } : {}),
            ...(dto.paymentTerms !== undefined ? { paymentTerms: dto.paymentTerms?.trim() || null } : {}),
            ...(dto.taxTreatment !== undefined ? { taxTreatment: dto.taxTreatment?.trim() || null } : {}),
            ...(dto.invoiceGroupingRule !== undefined
              ? { invoiceGroupingRule: dto.invoiceGroupingRule?.trim() || null }
              : {}),
            ...(dto.defaultChargeMethod !== undefined ? { defaultChargeMethod: dto.defaultChargeMethod } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            ...(dto.effectiveFrom !== undefined ? { effectiveFrom: parseDateOnly(dto.effectiveFrom) } : {}),
            ...(dto.effectiveTo !== undefined
              ? { effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
            updatedById: userId,
            ...(dto.rules ? { rules: { create: mapChargeRules(dto.rules) } } : {}),
          },
          include: chargeCardListInclude,
        });
      });
      return { message: 'Charge card updated', data: updated };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A charge card with this code already exists');
      }
      throw e;
    }
  }

  async getAssignmentPreview(id: string) {
    const card = await this.prisma.chargeCard.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw new NotFoundException('Charge card not found');
    const target = buildChargeCardBulkAssignTarget(card);
    if (target.entity === 'none') {
      return { data: { matchingCount: 0, unassignedCount: 0, assignedCount: 0 } };
    }

    const assignedField = { defaultChargeCardId: id };
    const unassignedField = { defaultChargeCardId: null };

    if (target.entity === 'funder') {
      const [matchingCount, unassignedCount, assignedCount] = await Promise.all([
        this.prisma.funder.count({ where: target.where }),
        this.prisma.funder.count({ where: { ...target.where, ...unassignedField } }),
        this.prisma.funder.count({ where: { ...target.where, ...assignedField } }),
      ]);
      return { data: { matchingCount, unassignedCount, assignedCount } };
    }

    if (target.entity === 'serviceUserFunding') {
      const [matchingCount, unassignedCount, assignedCount] = await Promise.all([
        this.prisma.serviceUserFunding.count({ where: target.where }),
        this.prisma.serviceUserFunding.count({ where: { ...target.where, ...unassignedField } }),
        this.prisma.serviceUserFunding.count({ where: { ...target.where, ...assignedField } }),
      ]);
      return { data: { matchingCount, unassignedCount, assignedCount } };
    }

    const [matchingCount, unassignedCount, assignedCount] = await Promise.all([
      this.prisma.serviceUser.count({ where: target.where }),
      this.prisma.serviceUser.count({ where: { ...target.where, ...unassignedField } }),
      this.prisma.serviceUser.count({ where: { ...target.where, ...assignedField } }),
    ]);
    return { data: { matchingCount, unassignedCount, assignedCount } };
  }

  async assignToMatching(
    userId: string,
    id: string,
    dto: AssignChargeCardMatchingDto,
    _meta?: RequestAuditMeta,
  ) {
    const card = await this.prisma.chargeCard.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw new NotFoundException('Charge card not found');
    const onlyUnassigned = dto.onlyUnassigned ?? true;
    const target = buildChargeCardBulkAssignTarget(card);
    if (target.entity === 'none') {
      return { message: 'This attach-to level cannot be bulk-assigned', data: { assignedCount: 0 } };
    }

    const where = { ...target.where } as Record<string, unknown>;
    if (onlyUnassigned) where.defaultChargeCardId = null;

    let assignedCount = 0;
    if (target.entity === 'funder') {
      const result = await this.prisma.funder.updateMany({
        where: where as Prisma.FunderWhereInput,
        data: { defaultChargeCardId: id, updatedById: userId },
      });
      assignedCount = result.count;
    } else if (target.entity === 'serviceUserFunding') {
      const result = await this.prisma.serviceUserFunding.updateMany({
        where: where as Prisma.ServiceUserFundingWhereInput,
        data: { defaultChargeCardId: id, updatedById: userId },
      });
      assignedCount = result.count;
    } else {
      const result = await this.prisma.serviceUser.updateMany({
        where: where as Prisma.ServiceUserWhereInput,
        data: { defaultChargeCardId: id, updatedById: userId },
      });
      assignedCount = result.count;
    }

    const label =
      target.entity === 'funder'
        ? 'funder'
        : target.entity === 'serviceUserFunding'
          ? 'funding contract'
          : 'service user';
    return {
      message: `Assigned charge card to ${assignedCount} ${label}${assignedCount === 1 ? '' : 's'}`,
      data: { assignedCount },
    };
  }

  async resolveForServiceUser(serviceUserId: string) {
    const serviceUser = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      include: {
        defaultChargeCard: { include: chargeCardListInclude },
        currentFunding: {
          include: {
            defaultChargeCard: { include: chargeCardListInclude },
            funder: {
              include: {
                defaultChargeCard: { include: chargeCardListInclude },
              },
            },
          },
        },
      },
    });
    if (!serviceUser) throw new NotFoundException('Service user not found');

    if (serviceUser.currentFunding?.defaultChargeCard) {
      return {
        data: {
          source: 'EXPLICIT_FUNDING' as const,
          chargeCard: serviceUser.currentFunding.defaultChargeCard,
          matchedLevel: null,
        },
      };
    }

    if (serviceUser.defaultChargeCard) {
      return {
        data: {
          source: 'EXPLICIT_SERVICE_USER' as const,
          chargeCard: serviceUser.defaultChargeCard,
          matchedLevel: null,
        },
      };
    }

    if (serviceUser.currentFunding?.funder?.defaultChargeCard) {
      return {
        data: {
          source: 'EXPLICIT_FUNDER' as const,
          chargeCard: serviceUser.currentFunding.funder.defaultChargeCard,
          matchedLevel: null,
        },
      };
    }

    const cards = await this.prisma.chargeCard.findMany({
      where: { deletedAt: null },
      include: chargeCardListInclude,
    });
    const matched = pickBestMatchingChargeCard(
      {
        serviceUserId: serviceUser.id,
        locationId: serviceUser.locationId,
        fundingId: serviceUser.currentFunding?.id ?? null,
        funderId: serviceUser.currentFunding?.funderId ?? null,
        packageName: serviceUser.currentFunding?.packageName ?? null,
        householdKey: null,
        serviceTypeKey: null,
      },
      cards,
    );

    if (!matched) {
      return {
        data: {
          source: 'NONE' as const,
          chargeCard: null,
          matchedLevel: null,
        },
      };
    }

    return {
      data: {
        source: 'MATCHED' as const,
        chargeCard: matched,
        matchedLevel: matched.assignmentLevel,
      },
    };
  }

  async remove(userId: string, id: string, _meta?: RequestAuditMeta) {
    const existing = await this.prisma.chargeCard.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Charge card not found');
    await this.prisma.chargeCard.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
    });
    return { message: 'Charge card deleted' };
  }
}
