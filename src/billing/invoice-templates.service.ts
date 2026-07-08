import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceTemplateScope,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  CreateInvoiceTemplateDto,
  InvoiceTemplatesQueryDto,
  UpdateInvoiceTemplateDto,
} from './dto/invoice-templates.dto';
import {
  INVOICE_TEMPLATE_SYSTEM_FIELDS,
  isValidSystemFieldKey,
  pickOrganisationDefaultTemplate,
  systemFieldLabel,
  validateInvoiceTemplateFields,
  type InvoiceTemplateResolveSource,
} from './invoice-template.util';

function parseDateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

const templateInclude = {
  funder: { select: { id: true, name: true, code: true } },
  serviceUserFunding: {
    select: {
      id: true,
      packageName: true,
      fundingReference: true,
      serviceUser: {
        select: { id: true, firstName: true, lastName: true, preferredName: true },
      },
    },
  },
  fields: { orderBy: { sortOrder: 'asc' as const } },
  _count: { select: { defaultFunders: true, defaultFundings: true } },
} as const;

function mapFields(fields?: CreateInvoiceTemplateDto['fields']) {
  return (fields ?? []).map((field, index) => {
    const key = field.systemFieldKey.trim();
    if (!isValidSystemFieldKey(key)) {
      throw new BadRequestException(`Unknown system field key: ${key}`);
    }
    return {
      label: field.label?.trim() || systemFieldLabel(key),
      systemFieldKey: key,
      isRequired: field.isRequired ?? false,
      sortOrder: field.sortOrder ?? index,
    };
  });
}

async function assertScopeTargets(
  tx: Prisma.TransactionClient,
  scope: InvoiceTemplateScope,
  funderId?: string | null,
  serviceUserFundingId?: string | null,
) {
  if (scope === InvoiceTemplateScope.ORGANISATION_DEFAULT) {
    if (funderId || serviceUserFundingId) {
      throw new BadRequestException(
        'Organisation default templates cannot be linked to a funder or funding contract',
      );
    }
    return;
  }
  if (scope === InvoiceTemplateScope.FUNDER) {
    if (!funderId) throw new BadRequestException('Funder is required for funder-scoped templates');
    if (serviceUserFundingId) {
      throw new BadRequestException('Funding contract cannot be set on a funder-scoped template');
    }
    const funder = await tx.funder.findFirst({ where: { id: funderId, deletedAt: null } });
    if (!funder) throw new NotFoundException('Funder not found');
    return;
  }
  if (scope === InvoiceTemplateScope.FUNDING_CONTRACT) {
    if (!serviceUserFundingId) {
      throw new BadRequestException('Funding contract is required for contract-scoped templates');
    }
    const funding = await tx.serviceUserFunding.findFirst({
      where: { id: serviceUserFundingId, deletedAt: null },
    });
    if (!funding) throw new NotFoundException('Funding contract not found');
    return;
  }
}

@Injectable()
export class InvoiceTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  listSystemFields() {
    return { data: INVOICE_TEMPLATE_SYSTEM_FIELDS };
  }

  async list(query: InvoiceTemplatesQueryDto) {
    const where: Prisma.InvoiceTemplateWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.templateType) where.templateType = query.templateType;
    if (query.funderId) where.funderId = query.funderId;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s, mode: 'insensitive' } },
        { deliveryMethod: { contains: s, mode: 'insensitive' } },
        { groupingRule: { contains: s, mode: 'insensitive' } },
        { funder: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }
    const rows = await this.prisma.invoiceTemplate.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: templateInclude,
    });
    return { data: rows };
  }

  async getById(id: string) {
    const row = await this.prisma.invoiceTemplate.findFirst({
      where: { id, deletedAt: null },
      include: templateInclude,
    });
    if (!row) throw new NotFoundException('Invoice template not found');
    return { data: row };
  }

  async create(userId: string, dto: CreateInvoiceTemplateDto, _meta?: RequestAuditMeta) {
    const scope = dto.scope ?? InvoiceTemplateScope.FUNDER;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await assertScopeTargets(tx, scope, dto.funderId, dto.serviceUserFundingId);
        return tx.invoiceTemplate.create({
          data: {
            name: dto.name.trim(),
            code: dto.code.trim().toUpperCase(),
            templateType: dto.templateType,
            version: dto.version?.trim() || '1.0',
            scope,
            funderId: scope === InvoiceTemplateScope.FUNDER ? dto.funderId ?? null : null,
            serviceUserFundingId:
              scope === InvoiceTemplateScope.FUNDING_CONTRACT ? dto.serviceUserFundingId ?? null : null,
            deliveryMethod: dto.deliveryMethod?.trim() || null,
            groupingRule: dto.groupingRule?.trim() || null,
            fileNamePattern: dto.fileNamePattern?.trim() || null,
            billingFrequency: dto.billingFrequency ?? 'WEEKLY',
            status: dto.status ?? 'DRAFT',
            effectiveFrom: parseDateOnly(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null,
            notes: dto.notes?.trim() || null,
            createdById: userId,
            fields: { create: mapFields(dto.fields) },
          },
          include: templateInclude,
        });
      });
      return { message: 'Invoice template created', data: created };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An invoice template with this code already exists');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateInvoiceTemplateDto, _meta?: RequestAuditMeta) {
    const existing = await this.prisma.invoiceTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Invoice template not found');

    const nextScope = dto.scope ?? existing.scope;
    const nextFunderId =
      dto.funderId !== undefined ? dto.funderId : existing.funderId;
    const nextFundingId =
      dto.serviceUserFundingId !== undefined
        ? dto.serviceUserFundingId
        : existing.serviceUserFundingId;

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await assertScopeTargets(tx, nextScope, nextFunderId, nextFundingId);
        if (dto.fields) {
          await tx.invoiceTemplateField.deleteMany({ where: { invoiceTemplateId: id } });
        }
        return tx.invoiceTemplate.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
            ...(dto.templateType !== undefined ? { templateType: dto.templateType } : {}),
            ...(dto.version !== undefined ? { version: dto.version.trim() } : {}),
            ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
            funderId: nextScope === InvoiceTemplateScope.FUNDER ? nextFunderId : null,
            serviceUserFundingId:
              nextScope === InvoiceTemplateScope.FUNDING_CONTRACT ? nextFundingId : null,
            ...(dto.deliveryMethod !== undefined
              ? { deliveryMethod: dto.deliveryMethod?.trim() || null }
              : {}),
            ...(dto.groupingRule !== undefined
              ? { groupingRule: dto.groupingRule?.trim() || null }
              : {}),
            ...(dto.fileNamePattern !== undefined
              ? { fileNamePattern: dto.fileNamePattern?.trim() || null }
              : {}),
            ...(dto.billingFrequency !== undefined ? { billingFrequency: dto.billingFrequency } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            ...(dto.effectiveFrom !== undefined
              ? { effectiveFrom: parseDateOnly(dto.effectiveFrom) }
              : {}),
            ...(dto.effectiveTo !== undefined
              ? { effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
            updatedById: userId,
            ...(dto.fields ? { fields: { create: mapFields(dto.fields) } } : {}),
          },
          include: templateInclude,
        });
      });
      return { message: 'Invoice template updated', data: updated };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An invoice template with this code already exists');
      }
      throw e;
    }
  }

  async remove(userId: string, id: string, _meta?: RequestAuditMeta) {
    const existing = await this.prisma.invoiceTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Invoice template not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.funder.updateMany({
        where: { defaultInvoiceTemplateId: id },
        data: { defaultInvoiceTemplateId: null, updatedById: userId },
      });
      await tx.serviceUserFunding.updateMany({
        where: { defaultInvoiceTemplateId: id },
        data: { defaultInvoiceTemplateId: null, updatedById: userId },
      });
      await tx.invoiceTemplate.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: userId },
      });
    });
    return { message: 'Invoice template deleted', data: { id } };
  }

  async resolveForServiceUser(serviceUserId: string, fundingId?: string) {
    const serviceUser = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        serviceUserNumber: true,
        nhsNumber: true,
        dateOfBirth: true,
      },
    });
    if (!serviceUser) throw new NotFoundException('Service user not found');

    const fundings = await this.prisma.serviceUserFunding.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        isActive: true,
        ...(fundingId ? { id: fundingId } : {}),
      },
      include: {
        funder: {
          select: {
            id: true,
            name: true,
            defaultInvoiceTemplate: { include: templateInclude },
          },
        },
        defaultInvoiceTemplate: { include: templateInclude },
      },
      orderBy: [{ isPrimary: 'desc' }, { splitPriority: 'asc' }],
    });

    const funding =
      fundings.find((f) => f.id === fundingId) ??
      fundings.find((f) => f.isPrimary) ??
      fundings[0] ??
      null;

    let source: InvoiceTemplateResolveSource = 'NONE';
    let template = null;

    if (funding?.defaultInvoiceTemplate && funding.defaultInvoiceTemplate.deletedAt == null) {
      source = 'EXPLICIT_FUNDING';
      template = funding.defaultInvoiceTemplate;
    } else if (
      funding?.funder?.defaultInvoiceTemplate &&
      funding.funder.defaultInvoiceTemplate.deletedAt == null
    ) {
      source = 'EXPLICIT_FUNDER';
      template = funding.funder.defaultInvoiceTemplate;
    } else {
      const scoped = await this.prisma.invoiceTemplate.findMany({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          OR: [
            funding?.funderId ? { scope: 'FUNDER', funderId: funding.funderId } : undefined,
            funding
              ? { scope: 'FUNDING_CONTRACT', serviceUserFundingId: funding.id }
              : undefined,
            { scope: 'ORGANISATION_DEFAULT' },
          ].filter(Boolean) as Prisma.InvoiceTemplateWhereInput[],
        },
        include: templateInclude,
      });

      const contractMatch = funding
        ? scoped.find(
            (t) => t.scope === 'FUNDING_CONTRACT' && t.serviceUserFundingId === funding.id,
          )
        : null;
      const funderMatch = funding?.funderId
        ? scoped.find((t) => t.scope === 'FUNDER' && t.funderId === funding.funderId)
        : null;
      const orgDefault = pickOrganisationDefaultTemplate(scoped);

      if (contractMatch) {
        source = 'MATCHED_SCOPE';
        template = contractMatch;
      } else if (funderMatch) {
        source = 'MATCHED_SCOPE';
        template = funderMatch;
      } else if (orgDefault) {
        source = 'ORGANISATION_DEFAULT';
        template = orgDefault;
      }
    }

    return {
      data: {
        source,
        invoiceTemplate: template,
        fundingId: funding?.id ?? null,
        funderId: funding?.funderId ?? null,
      },
    };
  }

  async validateForServiceUser(templateId: string, serviceUserId: string, fundingId?: string) {
    const template = await this.prisma.invoiceTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) throw new NotFoundException('Invoice template not found');

    const serviceUser = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: {
        firstName: true,
        lastName: true,
        preferredName: true,
        serviceUserNumber: true,
        nhsNumber: true,
        dateOfBirth: true,
      },
    });
    if (!serviceUser) throw new NotFoundException('Service user not found');

    const funding = fundingId
      ? await this.prisma.serviceUserFunding.findFirst({
          where: { id: fundingId, serviceUserId, deletedAt: null },
          include: { funder: { select: { name: true } } },
        })
      : await this.prisma.serviceUserFunding.findFirst({
          where: { serviceUserId, deletedAt: null, isActive: true, isPrimary: true },
          include: { funder: { select: { name: true } } },
        });

    const serviceUserName = [serviceUser.preferredName?.trim() || serviceUser.firstName, serviceUser.lastName]
      .filter(Boolean)
      .join(' ');

    const validation = validateInvoiceTemplateFields({
      fields: template.fields,
      context: {
        serviceUserName,
        serviceUserNumber: serviceUser.serviceUserNumber,
        dateOfBirth: serviceUser.dateOfBirth,
        nhsNumber: serviceUser.nhsNumber,
        fundingReference: funding?.fundingReference,
        packageName: funding?.packageName,
        purchaseOrderNumber: funding?.purchaseOrderNumber,
        billingContactName: funding?.billingContactName,
        billingContactEmail: funding?.billingContactEmail,
        funderName: funding?.funder?.name ?? null,
      },
    });

    return {
      data: {
        templateId,
        serviceUserId,
        fundingId: funding?.id ?? null,
        ...validation,
        requiredFieldCount: template.fields.filter((f) => f.isRequired).length,
      },
    };
  }

  async listFundingContractOptions(search?: string) {
    const s = search?.trim();
    const rows = await this.prisma.serviceUserFunding.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(s
          ? {
              OR: [
                { packageName: { contains: s, mode: 'insensitive' } },
                { fundingReference: { contains: s, mode: 'insensitive' } },
                { funder: { name: { contains: s, mode: 'insensitive' } } },
                {
                  serviceUser: {
                    OR: [
                      { firstName: { contains: s, mode: 'insensitive' } },
                      { lastName: { contains: s, mode: 'insensitive' } },
                      { preferredName: { contains: s, mode: 'insensitive' } },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        funder: { select: { name: true } },
        fundingType: { select: { name: true } },
        serviceUser: {
          select: { firstName: true, lastName: true, preferredName: true, serviceUserNumber: true },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 100,
    });

    return {
      data: rows.map((row) => {
        const suName = [row.serviceUser.preferredName?.trim() || row.serviceUser.firstName, row.serviceUser.lastName]
          .filter(Boolean)
          .join(' ');
        const parts = [suName, row.funder?.name, row.packageName ?? row.fundingReference].filter(Boolean);
        return {
          id: row.id,
          label: parts.join(' · '),
          serviceUserId: row.serviceUserId,
        };
      }),
    };
  }

  async getSummary() {
    const [total, active, missingFunderTemplate] = await Promise.all([
      this.prisma.invoiceTemplate.count({ where: { deletedAt: null } }),
      this.prisma.invoiceTemplate.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.funder.count({
        where: {
          deletedAt: null,
          isActive: true,
          defaultInvoiceTemplateId: null,
          serviceUserFundings: {
            some: { deletedAt: null, isActive: true },
          },
        },
      }),
    ]);

    const hasOrgDefault = !!(await pickOrganisationDefaultTemplate(
      await this.prisma.invoiceTemplate.findMany({ where: { deletedAt: null } }),
    ));

    return {
      data: {
        total,
        active,
        fundersMissingDefaultTemplate: missingFunderTemplate,
        hasOrganisationDefault: hasOrgDefault,
      },
    };
  }
}
