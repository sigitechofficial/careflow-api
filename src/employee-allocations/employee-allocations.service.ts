import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  CreateAllocationItemTypeDto,
  CreateEmployeeAllocationDto,
  EmployeeAllocationsRegistryQueryDto,
  UpdateAllocationItemTypeDto,
  UpdateEmployeeAllocationDto,
} from './dto/employee-allocation.dto';

const ITEM_TYPE_SELECT = {
  id: true,
  name: true,
  category: true,
  returnable: true,
  sortOrder: true,
  isActive: true,
} satisfies Prisma.AllocationItemTypeSelect;

type AllocationWithItem = Prisma.EmployeeAllocationGetPayload<{
  include: { itemType: { select: typeof ITEM_TYPE_SELECT } };
}>;

function trimOrNull(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function isoOrNull(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

@Injectable()
export class EmployeeAllocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  // ---------------------------------------------------------------- item catalogue

  listItemTypes() {
    return this.prisma.allocationItemType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: ITEM_TYPE_SELECT,
    });
  }

  async createItemType(dto: CreateAllocationItemTypeDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    const existing = await this.prisma.allocationItemType.findUnique({
      where: { name },
    });
    if (existing?.isActive) {
      throw new BadRequestException('This item is already in the list');
    }
    if (existing) {
      // Re-adding a removed item brings it back with the new settings.
      return this.prisma.allocationItemType.update({
        where: { id: existing.id },
        data: {
          category: dto.category,
          returnable: dto.returnable ?? existing.returnable,
          sortOrder: dto.sortOrder ?? existing.sortOrder,
          isActive: true,
        },
        select: ITEM_TYPE_SELECT,
      });
    }
    const last = await this.prisma.allocationItemType.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return this.prisma.allocationItemType.create({
      data: {
        name,
        category: dto.category,
        returnable: dto.returnable ?? false,
        sortOrder: dto.sortOrder ?? (last?.sortOrder ?? 0) + 10,
      },
      select: ITEM_TYPE_SELECT,
    });
  }

  async updateItemType(id: string, dto: UpdateAllocationItemTypeDto) {
    const existing = await this.prisma.allocationItemType.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Item not found');
    const data: Prisma.AllocationItemTypeUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      data.name = name;
    }
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.returnable !== undefined) data.returnable = dto.returnable;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.allocationItemType.update({
        where: { id },
        data,
        select: ITEM_TYPE_SELECT,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException('This item is already in the list');
      }
      throw e;
    }
  }

  /** Removes the item from the pick list; existing allocations keep it. */
  async deleteItemType(id: string) {
    const existing = await this.prisma.allocationItemType.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Item not found');
    await this.prisma.allocationItemType.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ---------------------------------------------------------------- per employee

  async list(actor: RequestUser, employeeId: string) {
    await this.ensureEmployee(actor, employeeId);
    const rows = await this.prisma.employeeAllocation.findMany({
      where: { employeeId, deletedAt: null },
      include: { itemType: { select: ITEM_TYPE_SELECT } },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const names = await this.userNames(rows.map((r) => r.issuedById));
    return { data: rows.map((r) => this.toRow(r, names)) };
  }

  async create(
    actor: RequestUser,
    employeeId: string,
    dto: CreateEmployeeAllocationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(actor, employeeId);
    await this.ensureActiveItemType(dto.itemTypeId);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.employeeAllocation.create({
        data: {
          employeeId,
          itemTypeId: dto.itemTypeId,
          quantity: dto.quantity ?? 1,
          size: trimOrNull(dto.size),
          serialNumber: trimOrNull(dto.serialNumber),
          issuedAt: new Date(dto.issuedAt),
          issuedById: actor.id,
          expectedReturnAt: isoOrNull(dto.expectedReturnAt),
          notes: trimOrNull(dto.notes),
          createdById: actor.id,
        },
        include: { itemType: { select: ITEM_TYPE_SELECT } },
      });
      await this.audit.logAudit({
        tx,
        userId: actor.id,
        module: AuditModule.EMPLOYEE_ALLOCATION,
        action: AuditAction.EMPLOYEE_ALLOCATION_ADDED,
        recordType: 'EmployeeAllocation',
        recordId: row.id,
        newValues: auditSnapshot({ ...row, itemName: row.itemType.name }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return row;
    });
    const names = await this.userNames([created.issuedById]);
    return { message: 'Item allocated', data: this.toRow(created, names) };
  }

  async update(
    actor: RequestUser,
    employeeId: string,
    allocationId: string,
    dto: UpdateEmployeeAllocationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(actor, employeeId);
    const existing = await this.prisma.employeeAllocation.findFirst({
      where: { id: allocationId, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Allocation not found');
    if (dto.itemTypeId && dto.itemTypeId !== existing.itemTypeId) {
      await this.ensureActiveItemType(dto.itemTypeId);
    }

    const data: Prisma.EmployeeAllocationUncheckedUpdateInput = {
      updatedById: actor.id,
    };
    if (dto.itemTypeId !== undefined) data.itemTypeId = dto.itemTypeId;
    if (dto.quantity !== undefined) data.quantity = dto.quantity;
    if (dto.size !== undefined) data.size = trimOrNull(dto.size);
    if (dto.serialNumber !== undefined)
      data.serialNumber = trimOrNull(dto.serialNumber);
    if (dto.issuedAt !== undefined) data.issuedAt = new Date(dto.issuedAt);
    if (dto.expectedReturnAt !== undefined)
      data.expectedReturnAt = isoOrNull(dto.expectedReturnAt);
    if (dto.notes !== undefined) data.notes = trimOrNull(dto.notes);
    if (dto.returnNotes !== undefined)
      data.returnNotes = trimOrNull(dto.returnNotes);

    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === 'ISSUED') {
        // Back with the employee: clear the return details.
        data.returnedAt = null;
        if (dto.returnNotes === undefined) data.returnNotes = null;
      } else {
        data.returnedAt = dto.returnedAt
          ? new Date(dto.returnedAt)
          : (existing.returnedAt ?? new Date());
      }
    } else if (dto.returnedAt !== undefined && existing.status !== 'ISSUED') {
      data.returnedAt = isoOrNull(dto.returnedAt);
    }

    const issuedAt = (data.issuedAt as Date | undefined) ?? existing.issuedAt;
    const returnedAt =
      data.returnedAt === undefined
        ? existing.returnedAt
        : (data.returnedAt as Date | null);
    if (returnedAt && returnedAt.getTime() < issuedAt.getTime()) {
      throw new BadRequestException(
        'Return date cannot be before the issue date',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.employeeAllocation.update({
        where: { id: allocationId },
        data,
        include: { itemType: { select: ITEM_TYPE_SELECT } },
      });
      await this.audit.logAudit({
        tx,
        userId: actor.id,
        module: AuditModule.EMPLOYEE_ALLOCATION,
        action: AuditAction.EMPLOYEE_ALLOCATION_UPDATED,
        recordType: 'EmployeeAllocation',
        recordId: allocationId,
        oldValues: auditSnapshot(existing),
        newValues: auditSnapshot({ ...row, itemName: row.itemType.name }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return row;
    });
    const names = await this.userNames([updated.issuedById]);
    return { message: 'Allocation updated', data: this.toRow(updated, names) };
  }

  async remove(
    actor: RequestUser,
    employeeId: string,
    allocationId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(actor, employeeId);
    const existing = await this.prisma.employeeAllocation.findFirst({
      where: { id: allocationId, employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Allocation not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.employeeAllocation.update({
        where: { id: allocationId },
        data: { deletedAt: new Date(), deletedById: actor.id },
      });
      await this.audit.logAudit({
        tx,
        userId: actor.id,
        module: AuditModule.EMPLOYEE_ALLOCATION,
        action: AuditAction.EMPLOYEE_ALLOCATION_DELETED,
        recordType: 'EmployeeAllocation',
        recordId: allocationId,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return { message: 'Allocation deleted', data: {} };
  }

  // ---------------------------------------------------------------- all employees

  /** Allocations across employees the viewer may see (Employee → Allocations). */
  async registry(
    actor: RequestUser,
    query: EmployeeAllocationsRegistryQueryDto,
  ) {
    const scope = this.orgScope.fromRequestUser(actor);
    const locationIds = this.orgScope.resolveListLocationIds(scope);
    if (locationIds && locationIds.length === 0) return { data: [] };

    const employeeWhere: Prisma.EmployeeWhereInput = { deletedAt: null };
    if (locationIds) {
      employeeWhere.employment = {
        accessAllZones: false,
        OR: [
          { locationId: { in: locationIds } },
          { baseLocationId: { in: locationIds } },
          { floorLocations: { some: { locationId: { in: locationIds } } } },
        ],
      };
    }
    const search = query.search?.trim();
    const where: Prisma.EmployeeAllocationWhereInput = {
      deletedAt: null,
      employee: employeeWhere,
      ...(query.status ? { status: query.status } : {}),
      ...(query.itemTypeId ? { itemTypeId: query.itemTypeId } : {}),
      ...(query.category ? { itemType: { category: query.category } } : {}),
      ...(search
        ? {
            OR: [
              { serialNumber: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              {
                employee: {
                  personalDetail: {
                    OR: [
                      { firstName: { contains: search, mode: 'insensitive' } },
                      { lastName: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.employeeAllocation.findMany({
      where,
      include: {
        itemType: { select: ITEM_TYPE_SELECT },
        employee: {
          select: {
            personalDetail: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });
    const names = await this.userNames(rows.map((r) => r.issuedById));
    return {
      data: rows.map((r) => {
        const pd = r.employee?.personalDetail;
        const employeeDisplayName =
          [pd?.firstName?.trim(), pd?.lastName?.trim()]
            .filter(Boolean)
            .join(' ') || '—';
        return { ...this.toRow(r, names), employeeDisplayName };
      }),
    };
  }

  // ---------------------------------------------------------------- helpers

  private toRow(r: AllocationWithItem, names: Map<string, string>) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      itemTypeId: r.itemTypeId,
      itemType: r.itemType,
      quantity: r.quantity,
      size: r.size,
      serialNumber: r.serialNumber,
      issuedAt: r.issuedAt.toISOString(),
      issuedByName: r.issuedById ? (names.get(r.issuedById) ?? null) : null,
      expectedReturnAt: r.expectedReturnAt?.toISOString() ?? null,
      status: r.status,
      returnedAt: r.returnedAt?.toISOString() ?? null,
      returnNotes: r.returnNotes,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async userNames(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const map = new Map<string, string>();
    if (unique.length === 0) return map;
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    for (const u of users) {
      map.set(
        u.id,
        [u.firstName?.trim(), u.lastName?.trim()].filter(Boolean).join(' ') ||
          u.email,
      );
    }
    return map;
  }

  private async ensureEmployee(actor: RequestUser, employeeId: string) {
    const exists = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Employee not found');
    await this.orgScope.assertEmployeeInScope(
      this.orgScope.fromRequestUser(actor),
      employeeId,
    );
  }

  private async ensureActiveItemType(itemTypeId: string) {
    const item = await this.prisma.allocationItemType.findFirst({
      where: { id: itemTypeId, isActive: true },
      select: { id: true },
    });
    if (!item) throw new BadRequestException('Select an item from the list');
  }
}
