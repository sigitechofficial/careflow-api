import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { UpdateLocationZoneDto } from './dto/update-location-zone.dto';
import type {
  CreateLocationBranchDto,
  CreateLocationZoneDto,
} from './dto/create-location-zone-branch.dto';
import type { UpdateMemberLocationDto } from './dto/update-member-location.dto';
import type { UpdateEmployeeLocationDto } from './dto/update-employee-location.dto';
import {
  defaultMarkerColor,
  formatFloorNames,
  formatPersonLabel,
  formatPostcodeDisplay,
  normalizePostcodeKey,
  parentZoneFromGroupId,
  parentZoneFromLocationName,
  parseLocationName,
  parsePostcodeList,
  parseUserIdList,
  resolveParentZoneName,
  slugifyAreaCode,
  zoneGroupId,
} from './location-management.util';
import type { CreateServiceUserAreaDto, UpdateServiceUserAreaDto } from './dto/service-user-area.dto';
import { normalizeVisitRefBranchCode } from '../billing/visit-reconciliation.util';

const COMPANY_PROFILE_ID = '00000000-0000-4000-8000-000000000001';

type ScheduleAreaRow = {
  id: string;
  name: string;
  code: string;
  sortOrder: number;
  locationId: string | null;
  parentZoneName: string | null;
  markerColorHex: string | null;
  address: string | null;
  incidentMessageUserIds: unknown;
  incidentEmailUserIds: unknown;
  location: { id: string; name: string } | null;
  zone: { id: string; name: string; country: string | null; city: string | null } | null;
};

@Injectable()
export class LocationManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async assertLocation(id: string | null | undefined) {
    if (!id) return;
    const row = await this.prisma.location.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new BadRequestException('Location not found');
  }

  private async assertLocations(ids: string[]) {
    for (const id of ids) await this.assertLocation(id);
  }

  private groupAreas(areas: ScheduleAreaRow[]) {
    const groups = new Map<string, ScheduleAreaRow[]>();
    for (const area of areas) {
      const key = resolveParentZoneName(
        area.parentZoneName,
        area.location?.name ?? null,
        area.name,
      );
      const list = groups.get(key) ?? [];
      list.push(area);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([parentName, groupAreas]) => ({
      parentName,
      areas: groupAreas.sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }

  private async areasForZoneId(id: string): Promise<ScheduleAreaRow[]> {
    const parentKey = parentZoneFromGroupId(id);
    const areas = await this.prisma.scheduleArea.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        location: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true, country: true, city: true } },
      },
    });

    if (parentKey) {
      return areas.filter(
        (a) =>
          resolveParentZoneName(a.parentZoneName, a.location?.name ?? null, a.name) === parentKey,
      );
    }

    const byLookupZone = areas.filter((a) => a.zone?.id === id);
    if (byLookupZone.length) return byLookupZone;

    const single = areas.find((a) => a.id === id);
    if (single) return [single];

    const zoneOnly = await this.prisma.zone.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (zoneOnly) return [];
    throw new NotFoundException('Zone not found');
  }

  async listActiveUsers() {
    const rows = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });
    return {
      data: rows.map((u) => ({
        id: u.id,
        email: u.email,
        label: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
      })),
    };
  }

  async getTree() {
    const [company, areas, serviceUserAreas, serviceUsers, employees, zoneLookups] =
      await Promise.all([
      this.prisma.companyProfile.findUnique({ where: { id: COMPANY_PROFILE_ID } }),
      this.prisma.scheduleArea.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          location: { select: { id: true, name: true } },
          zone: { select: { id: true, name: true, country: true, city: true } },
        },
      }),
      this.prisma.serviceUserArea.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          postcodes: {
            orderBy: { postcode: 'asc' },
            select: { id: true, postcode: true, normalizedPostcode: true },
          },
        },
      }),
      this.prisma.serviceUser.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          locationId: true,
          serviceUserAreaId: true,
          address: {
            select: {
              addressLine1: true,
              addressLine2: true,
              town: true,
              postcode: true,
            },
          },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.prisma.employee.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          personalDetail: { select: { firstName: true, lastName: true } },
          employment: {
            select: {
              locationId: true,
              location: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { personalDetail: { lastName: 'asc' } },
      }),
      this.prisma.zone.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, country: true, city: true },
      }),
    ]);

    const suByArea = new Map<string, typeof serviceUsers>();
    const suByLocationUnassigned = new Map<string, typeof serviceUsers>();
    for (const su of serviceUsers) {
      if (su.serviceUserAreaId) {
        const list = suByArea.get(su.serviceUserAreaId) ?? [];
        list.push(su);
        suByArea.set(su.serviceUserAreaId, list);
        continue;
      }
      if (!su.locationId) continue;
      const list = suByLocationUnassigned.get(su.locationId) ?? [];
      list.push(su);
      suByLocationUnassigned.set(su.locationId, list);
    }

    const empByLocation = new Map<string, typeof employees>();
    for (const emp of employees) {
      const locId = emp.employment?.locationId;
      if (!locId) continue;
      const list = empByLocation.get(locId) ?? [];
      list.push(emp);
      empByLocation.set(locId, list);
    }

    const areasByScheduleArea = new Map<string, typeof serviceUserAreas>();
    for (const sua of serviceUserAreas) {
      const list = areasByScheduleArea.get(sua.scheduleAreaId) ?? [];
      list.push(sua);
      areasByScheduleArea.set(sua.scheduleAreaId, list);
    }

    const suChild = (su: (typeof serviceUsers)[number]) => {
      const addr = su.address;
      const line = [addr?.addressLine1, addr?.addressLine2, addr?.town, addr?.postcode]
        .filter(Boolean)
        .join(', ');
      return {
        id: `su-${su.id}`,
        type: 'service_user' as const,
        entityId: su.id,
        label: formatPersonLabel(su.firstName, su.lastName, line || null),
      };
    };

    const empChild = (emp: (typeof employees)[number]) => ({
      id: `emp-${emp.id}`,
      type: 'employee' as const,
      entityId: emp.id,
      label: formatPersonLabel(
        emp.personalDetail?.firstName,
        emp.personalDetail?.lastName,
        emp.employment?.location?.name ?? null,
      ),
    });

    const grouped = this.groupAreas(areas);
    const zones = grouped.map((group, groupIndex) => {
      const representative = group.areas[0];
      const isMulti = group.areas.length > 1;
      const branches = group.areas.map((area) => {
        const locationId = area.locationId;
        const branchAreas = (areasByScheduleArea.get(area.id) ?? []).map((sua) => ({
          id: sua.id,
          name: sua.name,
          code: sua.code,
          scheduleAreaId: sua.scheduleAreaId,
          postcodes: sua.postcodes.map((p) => p.postcode),
          children: (suByArea.get(sua.id) ?? []).map(suChild),
        }));

        const children: Array<{
          id: string;
          type: 'service_user' | 'employee';
          label: string;
          entityId: string;
        }> = [];

        if (locationId) {
          for (const su of suByLocationUnassigned.get(locationId) ?? []) {
            children.push(suChild(su));
          }
          for (const emp of empByLocation.get(locationId) ?? []) {
            children.push(empChild(emp));
          }
        }

        return {
          id: area.id,
          name: area.name,
          scheduleAreaId: area.id,
          locationId: area.locationId,
          locationName: area.location?.name ?? null,
          address: area.address ?? null,
          areas: branchAreas,
          /** Unassigned service users + all employees (employees nest under branches only). */
          children,
        };
      });

      const lookup =
        representative.zone ??
        zoneLookups.find((z) => z.name.toLowerCase() === group.parentName.toLowerCase()) ??
        null;

      return {
        id: isMulti ? zoneGroupId(group.parentName) : representative.id,
        lookupZoneId: lookup?.id ?? representative.zone?.id ?? null,
        name: group.parentName,
        code: representative.code,
        country: lookup?.country ?? null,
        city: lookup?.city ?? null,
        markerColorHex:
          representative.markerColorHex ?? defaultMarkerColor(groupIndex),
        locationId: representative.locationId,
        locationName: representative.location?.name ?? null,
        zoneName: representative.zone?.name ?? null,
        incidentMessageUserIds: parseUserIdList(representative.incidentMessageUserIds),
        incidentEmailUserIds: parseUserIdList(representative.incidentEmailUserIds),
        branches,
        children: branches.flatMap((b) => [
          ...b.areas.flatMap((a) => a.children),
          ...b.children,
        ]),
      };
    });

    const coveredZoneNames = new Set(zones.map((z) => z.name.toLowerCase()));
    for (const zl of zoneLookups) {
      if (coveredZoneNames.has(zl.name.toLowerCase())) continue;
      zones.push({
        id: zl.id,
        lookupZoneId: zl.id,
        name: zl.name,
        code: slugifyAreaCode(zl.name).toUpperCase(),
        country: zl.country,
        city: zl.city,
        markerColorHex: defaultMarkerColor(zones.length),
        locationId: null,
        locationName: null,
        zoneName: zl.name,
        incidentMessageUserIds: [],
        incidentEmailUserIds: [],
        branches: [],
        children: [],
      });
    }

    zones.sort((a, b) => a.name.localeCompare(b.name));

    return {
      data: {
        organisation: {
          id: company?.id ?? COMPANY_PROFILE_ID,
          name: company?.companyName ?? company?.displayName ?? 'Organisation',
        },
        zones,
      },
    };
  }

  async getZone(id: string) {
    const areas = await this.areasForZoneId(id);
    if (!areas.length) {
      const zone = await this.prisma.zone.findFirst({
        where: { id, deletedAt: null },
      });
      if (!zone) throw new NotFoundException('Zone not found');
      return {
        data: {
          id: zone.id,
          lookupZoneId: zone.id,
          name: zone.name,
          code: slugifyAreaCode(zone.name).toUpperCase(),
          country: zone.country,
          city: zone.city,
          markerColorHex: defaultMarkerColor(0),
          locationId: null,
          locationName: null,
          incidentMessageUserIds: [] as string[],
          incidentEmailUserIds: [] as string[],
        },
      };
    }
    const representative = areas[0];
    const parentName = resolveParentZoneName(
      representative.parentZoneName,
      representative.location?.name ?? null,
      representative.name,
    );
    const index = await this.prisma.scheduleArea.count({
      where: { deletedAt: null, isActive: true, sortOrder: { lt: representative.sortOrder } },
    });
    const lookup =
      representative.zone ??
      (await this.prisma.zone.findFirst({
        where: { name: parentName, deletedAt: null },
        select: { id: true, country: true, city: true },
      }));

    return {
      data: {
        id: areas.length > 1 ? zoneGroupId(parentName) : representative.id,
        lookupZoneId: lookup?.id ?? null,
        name: parentName,
        code: representative.code,
        country: lookup?.country ?? null,
        city: lookup?.city ?? null,
        markerColorHex: representative.markerColorHex ?? defaultMarkerColor(index),
        locationId: representative.locationId,
        locationName: representative.location?.name ?? null,
        incidentMessageUserIds: parseUserIdList(representative.incidentMessageUserIds),
        incidentEmailUserIds: parseUserIdList(representative.incidentEmailUserIds),
      },
    };
  }

  async createZone(userId: string, dto: CreateLocationZoneDto, meta?: RequestAuditMeta) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Zone name is required');
    try {
      const created = await this.prisma.zone.create({
        data: {
          name,
          country: dto.country?.trim() || null,
          city: dto.city?.trim() || null,
          isActive: true,
        },
      });
      await this.audit.logAudit({
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_AREA_CREATED,
        recordType: 'Zone',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return {
        message: 'Zone created',
        data: {
          id: created.id,
          lookupZoneId: created.id,
          name: created.name,
          code: slugifyAreaCode(created.name).toUpperCase(),
          country: created.country,
          city: created.city,
          markerColorHex: dto.markerColorHex ?? defaultMarkerColor(0),
          locationId: null,
          locationName: null,
          incidentMessageUserIds: [] as string[],
          incidentEmailUserIds: [] as string[],
        },
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A zone with this name already exists');
      }
      throw e;
    }
  }

  /**
   * Pick a free 3-char visit reference branch code.
   * Prefer a derived token from the branch name; otherwise L00…L99 then A00…Z99.
   */
  private async allocateUniqueVisitRefCode(
    tx: Prisma.TransactionClient,
    seed: string,
  ): Promise<string> {
    const preferred = normalizeVisitRefBranchCode(seed);
    const candidates: string[] = [];
    if (preferred && preferred !== 'GEN') candidates.push(preferred);
    for (let i = 0; i < 100; i += 1) {
      candidates.push(`L${String(i).padStart(2, '0')}`);
    }
    for (let letter = 65; letter <= 90; letter += 1) {
      for (let i = 0; i < 100; i += 1) {
        candidates.push(`${String.fromCharCode(letter)}${String(i).padStart(2, '0')}`);
      }
    }

    const seen = new Set<string>();
    for (const raw of candidates) {
      const code = normalizeVisitRefBranchCode(raw);
      if (!code || code === 'GEN' || seen.has(code)) continue;
      seen.add(code);
      const clash = await tx.scheduleArea.findFirst({
        where: { visitRefCode: code, deletedAt: null },
        select: { id: true },
      });
      if (!clash) return code;
    }

    throw new ConflictException('Could not allocate a unique visit reference branch code');
  }

  async createBranch(userId: string, dto: CreateLocationBranchDto, meta?: RequestAuditMeta) {
    const zone = await this.prisma.zone.findFirst({
      where: { id: dto.zoneId, deletedAt: null, isActive: true },
    });
    if (!zone) throw new BadRequestException('Zone not found');

    const branchName = dto.name.trim();
    if (!branchName) throw new BadRequestException('Branch name is required');

    const preferredCode = (dto.code?.trim() || slugifyAreaCode(`${zone.name}_${branchName}`))
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .slice(0, 80);
    const visitRefCode = dto.visitRefCode
      ? normalizeVisitRefBranchCode(dto.visitRefCode)
      : null;
    const locationName = `${zone.name} - ${branchName}`;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const location = await tx.location.upsert({
          where: { name: locationName },
          update: { isActive: true, deletedAt: null },
          create: { name: locationName, isActive: true },
        });

        let code = preferredCode;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const clash = await tx.scheduleArea.findFirst({
            where: { code, deletedAt: null },
            select: { id: true },
          });
          if (!clash) break;
          code = `${preferredCode.slice(0, 70)}_${attempt + 1}`;
        }

        const resolvedVisitRef =
          visitRefCode ??
          (await this.allocateUniqueVisitRefCode(tx, preferredCode || branchName));

        const visitClash = await tx.scheduleArea.findFirst({
          where: { visitRefCode: resolvedVisitRef, deletedAt: null },
          select: { id: true },
        });
        if (visitClash) {
          throw new ConflictException(
            `Visit reference branch code “${resolvedVisitRef}” is already in use`,
          );
        }

        const maxSort = await tx.scheduleArea.aggregate({
          where: { deletedAt: null, zoneId: zone.id },
          _max: { sortOrder: true },
        });

        return tx.scheduleArea.create({
          data: {
            name: branchName,
            code,
            visitRefCode: resolvedVisitRef,
            address: dto.address?.trim() || null,
            locationId: location.id,
            zoneId: zone.id,
            parentZoneName: zone.name,
            sortOrder: (maxSort._max.sortOrder ?? 0) + 10,
            createdById: userId,
          },
          include: {
            location: { select: { id: true, name: true } },
            zone: { select: { id: true, name: true, country: true, city: true } },
          },
        });
      });

      await this.audit.logAudit({
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_AREA_CREATED,
        recordType: 'ScheduleArea',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return {
        message: 'Branch created',
        data: {
          id: created.id,
          name: created.name,
          scheduleAreaId: created.id,
          locationId: created.locationId,
          locationName: created.location?.name ?? null,
          address: created.address,
          areas: [],
          children: [],
        },
      };
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A branch with this code already exists');
      }
      throw e;
    }
  }

  async updateZone(userId: string, id: string, dto: UpdateLocationZoneDto, meta?: RequestAuditMeta) {
    const areas = await this.areasForZoneId(id);
    if (!areas.length) {
      const zone = await this.prisma.zone.findFirst({ where: { id, deletedAt: null } });
      if (!zone) throw new NotFoundException('Zone not found');
      const updated = await this.prisma.zone.update({
        where: { id: zone.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.country !== undefined ? { country: dto.country?.trim() || null } : {}),
          ...(dto.city !== undefined ? { city: dto.city?.trim() || null } : {}),
        },
      });
      await this.audit.logAudit({
        userId,
        module: AuditModule.SCHEDULING,
        action: AuditAction.SCHEDULE_AREA_UPDATED,
        recordType: 'Zone',
        recordId: updated.id,
        oldValues: auditSnapshot(zone),
        newValues: auditSnapshot(updated),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return {
        message: 'Zone updated',
        data: {
          id: updated.id,
          lookupZoneId: updated.id,
          name: updated.name,
          code: slugifyAreaCode(updated.name).toUpperCase(),
          country: updated.country,
          city: updated.city,
          markerColorHex: dto.markerColorHex ?? defaultMarkerColor(0),
          locationId: null,
          locationName: null,
          incidentMessageUserIds: [] as string[],
          incidentEmailUserIds: [] as string[],
        },
      };
    }

    const parentName = resolveParentZoneName(
      areas[0].parentZoneName,
      areas[0].location?.name ?? null,
      areas[0].name,
    );

    return this.prisma.$transaction(async (tx) => {
      const linkedZoneId = areas[0].zone?.id;
      if (linkedZoneId || dto.country !== undefined || dto.city !== undefined || dto.name) {
        const zoneRow =
          (linkedZoneId
            ? await tx.zone.findFirst({ where: { id: linkedZoneId, deletedAt: null } })
            : null) ??
          (await tx.zone.findFirst({ where: { name: parentName, deletedAt: null } }));
        if (zoneRow) {
          await tx.zone.update({
            where: { id: zoneRow.id },
            data: {
              ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
              ...(dto.country !== undefined ? { country: dto.country?.trim() || null } : {}),
              ...(dto.city !== undefined ? { city: dto.city?.trim() || null } : {}),
            },
          });
        } else if (dto.name || dto.country || dto.city) {
          await tx.zone.create({
            data: {
              name: (dto.name?.trim() || parentName).trim(),
              country: dto.country?.trim() || null,
              city: dto.city?.trim() || null,
              isActive: true,
            },
          });
        }
      }

      const updateData: Prisma.ScheduleAreaUpdateInput = {
        ...(dto.markerColorHex !== undefined ? { markerColorHex: dto.markerColorHex } : {}),
        ...(dto.incidentMessageUserIds !== undefined
          ? { incidentMessageUserIds: dto.incidentMessageUserIds as Prisma.InputJsonValue }
          : {}),
        ...(dto.incidentEmailUserIds !== undefined
          ? { incidentEmailUserIds: dto.incidentEmailUserIds as Prisma.InputJsonValue }
          : {}),
        updatedBy: { connect: { id: userId } },
      };

      if (dto.name !== undefined) {
        updateData.parentZoneName = dto.name.trim();
      }

      const updatedAreas = [];
      for (const area of areas) {
        const before = await tx.scheduleArea.findUnique({ where: { id: area.id } });
        const updated = await tx.scheduleArea.update({
          where: { id: area.id },
          data: updateData,
          include: {
            location: { select: { id: true, name: true } },
            zone: { select: { id: true, name: true, country: true, city: true } },
          },
        });
        updatedAreas.push(updated);

        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SCHEDULING,
          action: AuditAction.SCHEDULE_AREA_UPDATED,
          recordType: 'ScheduleArea',
          recordId: area.id,
          oldValues: auditSnapshot(before),
          newValues: auditSnapshot(updated),
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        });
      }

      const representative = updatedAreas[0];
      const index = await tx.scheduleArea.count({
        where: { deletedAt: null, isActive: true, sortOrder: { lt: representative.sortOrder } },
      });
      const lookup = representative.zone;

      return {
        message: 'Zone updated',
        data: {
          id: updatedAreas.length > 1 ? zoneGroupId(parentName) : representative.id,
          lookupZoneId: lookup?.id ?? null,
          name: dto.name?.trim() ?? parentName,
          code: representative.code,
          country: lookup?.country ?? null,
          city: lookup?.city ?? null,
          markerColorHex: representative.markerColorHex ?? defaultMarkerColor(index),
          locationId: representative.locationId,
          locationName: representative.location?.name ?? null,
          incidentMessageUserIds: parseUserIdList(representative.incidentMessageUserIds),
          incidentEmailUserIds: parseUserIdList(representative.incidentEmailUserIds),
        },
      };
    });
  }

  async listServiceUserLocations() {
    const [rows, locations, scheduleAreas, serviceUserAreas] = await Promise.all([
      this.prisma.serviceUser.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          isActive: true,
          locationId: true,
          serviceUserAreaId: true,
          location: { select: { id: true, name: true } },
          address: { select: { postcode: true } },
          serviceUserArea: {
            select: {
              id: true,
              name: true,
              scheduleAreaId: true,
              postcodes: { select: { postcode: true }, orderBy: { postcode: 'asc' } },
            },
          },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.prisma.location.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.scheduleArea.findMany({
        where: { deletedAt: null, isActive: true, locationId: { not: null } },
        select: {
          id: true,
          name: true,
          locationId: true,
          parentZoneName: true,
          location: { select: { name: true } },
          zone: { select: { name: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.serviceUserArea.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          name: true,
          scheduleAreaId: true,
          postcodes: { select: { postcode: true }, orderBy: { postcode: 'asc' } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const areaByLocationId = new Map(
      scheduleAreas
        .filter((area) => area.locationId)
        .map((area) => [area.locationId as string, area]),
    );

    const areasByScheduleAreaId = new Map<string, typeof serviceUserAreas>();
    for (const sua of serviceUserAreas) {
      const list = areasByScheduleAreaId.get(sua.scheduleAreaId) ?? [];
      list.push(sua);
      areasByScheduleAreaId.set(sua.scheduleAreaId, list);
    }

    const zoneMap = new Map<
      string,
      {
        id: string;
        name: string;
        branches: Array<{
          id: string;
          name: string;
          scheduleAreaId: string | null;
          areas: Array<{ id: string; name: string; postcodes: string[] }>;
        }>;
      }
    >();
    for (const loc of locations) {
      const area = areaByLocationId.get(loc.id);
      const parsed = parseLocationName(loc.name);
      const zoneName =
        area?.parentZoneName?.trim() ||
        area?.zone?.name ||
        parsed.zoneName ||
        loc.name;
      const branchName = area?.name || parsed.roomName || loc.name;
      const zoneKey = zoneName || loc.name;
      const zone = zoneMap.get(zoneKey) ?? { id: zoneKey, name: zoneKey, branches: [] };
      const nestedAreas = area
        ? (areasByScheduleAreaId.get(area.id) ?? []).map((sua) => ({
            id: sua.id,
            name: sua.name,
            postcodes: sua.postcodes.map((p) => p.postcode),
          }))
        : [];
      zone.branches.push({
        id: loc.id,
        name: branchName,
        scheduleAreaId: area?.id ?? null,
        areas: nestedAreas,
      });
      zoneMap.set(zoneKey, zone);
    }

    return {
      data: {
        zones: [...zoneMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
        locations,
        members: rows.map((r) => {
          const area = r.locationId ? areaByLocationId.get(r.locationId) : undefined;
          const parsed = parseLocationName(r.location?.name ?? null);
          const zoneName =
            area?.parentZoneName?.trim() ||
            area?.zone?.name ||
            parsed.zoneName ||
            null;
          const branchName = area?.name || parsed.roomName || null;
          return {
            id: r.id,
            fullName: formatPersonLabel(r.firstName, r.lastName, null),
            isActive: r.isActive,
            locationId: r.locationId,
            locationName: r.location?.name ?? null,
            zoneName: zoneName || null,
            roomName: branchName,
            serviceUserAreaId: r.serviceUserAreaId,
            serviceUserAreaName: r.serviceUserArea?.name ?? null,
            serviceUserAreaPostcodes:
              r.serviceUserArea?.postcodes.map((p) => p.postcode) ?? [],
            postcode: r.address?.postcode?.trim() || null,
          };
        }),
      },
    };
  }

  private mapServiceUserArea(row: {
    id: string;
    scheduleAreaId: string;
    name: string;
    code: string;
    description: string | null;
    sortOrder: number;
    isActive: boolean;
    postcodes: Array<{ id: string; postcode: string; normalizedPostcode: string }>;
    scheduleArea?: { id: string; name: string; locationId: string | null } | null;
  }) {
    return {
      id: row.id,
      scheduleAreaId: row.scheduleAreaId,
      scheduleAreaName: row.scheduleArea?.name ?? null,
      locationId: row.scheduleArea?.locationId ?? null,
      name: row.name,
      code: row.code,
      description: row.description,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      postcodes: row.postcodes.map((p) => p.postcode),
    };
  }

  private async assertUniquePostcodes(
    postcodes: Array<{ postcode: string; normalizedPostcode: string }>,
    exceptAreaId?: string,
  ) {
    if (!postcodes.length) return;
    const clash = await this.prisma.serviceUserAreaPostcode.findFirst({
      where: {
        normalizedPostcode: { in: postcodes.map((p) => p.normalizedPostcode) },
        ...(exceptAreaId ? { serviceUserAreaId: { not: exceptAreaId } } : {}),
      },
      include: {
        serviceUserArea: { select: { id: true, name: true, deletedAt: true } },
      },
    });
    if (clash && !clash.serviceUserArea.deletedAt) {
      throw new BadRequestException(
        `Postcode ${clash.postcode} is already used by area “${clash.serviceUserArea.name}”.`,
      );
    }
  }

  private async uniqueAreaCode(scheduleAreaId: string, preferred: string, exceptId?: string) {
    let code = preferred.slice(0, 40);
    let attempt = 0;
    while (attempt < 50) {
      const existing = await this.prisma.serviceUserArea.findFirst({
        where: {
          scheduleAreaId,
          code,
          deletedAt: null,
          ...(exceptId ? { id: { not: exceptId } } : {}),
        },
        select: { id: true },
      });
      if (!existing) return code;
      attempt += 1;
      code = `${preferred.slice(0, 36)}_${attempt}`;
    }
    throw new BadRequestException('Could not allocate a unique area code');
  }

  async createServiceUserArea(userId: string, dto: CreateServiceUserAreaDto, meta?: RequestAuditMeta) {
    const branch = await this.prisma.scheduleArea.findFirst({
      where: { id: dto.scheduleAreaId, deletedAt: null, isActive: true },
      select: { id: true, name: true, locationId: true },
    });
    if (!branch) throw new BadRequestException('Branch (schedule area) not found');

    const postcodes = parsePostcodeList(dto.postcodes);
    await this.assertUniquePostcodes(postcodes);

    const preferredCode = (dto.code?.trim() || slugifyAreaCode(dto.name)).toUpperCase();
    const code = await this.uniqueAreaCode(dto.scheduleAreaId, preferredCode);

    const created = await this.prisma.$transaction(async (tx) => {
      const area = await tx.serviceUserArea.create({
        data: {
          scheduleAreaId: dto.scheduleAreaId,
          name: dto.name.trim(),
          code,
          description: dto.description?.trim() || null,
          sortOrder: dto.sortOrder ?? 0,
          createdById: userId,
          updatedById: userId,
          postcodes: postcodes.length
            ? {
                create: postcodes.map((p) => ({
                  postcode: p.postcode,
                  normalizedPostcode: p.normalizedPostcode,
                })),
              }
            : undefined,
        },
        include: {
          postcodes: { orderBy: { postcode: 'asc' } },
          scheduleArea: { select: { id: true, name: true, locationId: true } },
        },
      });
      return area;
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.SCHEDULE_AREA_CREATED,
      recordType: 'ServiceUserArea',
      recordId: created.id,
      newValues: auditSnapshot(created),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Service user area created', data: this.mapServiceUserArea(created) };
  }

  async updateServiceUserArea(
    userId: string,
    id: string,
    dto: UpdateServiceUserAreaDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.serviceUserArea.findFirst({
      where: { id, deletedAt: null },
      include: {
        postcodes: true,
        scheduleArea: { select: { id: true, name: true, locationId: true } },
      },
    });
    if (!existing) throw new NotFoundException('Service user area not found');

    const postcodes =
      dto.postcodes !== undefined ? parsePostcodeList(dto.postcodes) : null;
    if (postcodes) await this.assertUniquePostcodes(postcodes, id);

    let nextCode = existing.code;
    if (dto.code?.trim()) {
      nextCode = await this.uniqueAreaCode(
        existing.scheduleAreaId,
        dto.code.trim().toUpperCase(),
        id,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (postcodes) {
        await tx.serviceUserAreaPostcode.deleteMany({ where: { serviceUserAreaId: id } });
        if (postcodes.length) {
          await tx.serviceUserAreaPostcode.createMany({
            data: postcodes.map((p) => ({
              serviceUserAreaId: id,
              postcode: p.postcode,
              normalizedPostcode: p.normalizedPostcode,
            })),
          });
        }
      }

      return tx.serviceUserArea.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.code !== undefined ? { code: nextCode } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedById: userId,
        },
        include: {
          postcodes: { orderBy: { postcode: 'asc' } },
          scheduleArea: { select: { id: true, name: true, locationId: true } },
        },
      });
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.SCHEDULE_AREA_UPDATED,
      recordType: 'ServiceUserArea',
      recordId: id,
      oldValues: auditSnapshot(existing),
      newValues: auditSnapshot(updated),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Service user area updated', data: this.mapServiceUserArea(updated) };
  }

  async deleteServiceUserArea(userId: string, id: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.serviceUserArea.findFirst({
      where: { id, deletedAt: null },
      include: {
        postcodes: true,
        scheduleArea: { select: { id: true, name: true, locationId: true } },
        _count: { select: { serviceUsers: true } },
      },
    });
    if (!existing) throw new NotFoundException('Service user area not found');

    if (existing._count.serviceUsers > 0) {
      throw new BadRequestException(
        `Cannot delete area “${existing.name}” while ${existing._count.serviceUsers} service user(s) are assigned. Reassign them first.`,
      );
    }

    const deleted = await this.prisma.serviceUserArea.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, deletedById: userId, updatedById: userId },
      include: {
        postcodes: { orderBy: { postcode: 'asc' } },
        scheduleArea: { select: { id: true, name: true, locationId: true } },
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.SCHEDULING,
      action: AuditAction.SCHEDULE_AREA_DELETED,
      recordType: 'ServiceUserArea',
      recordId: id,
      oldValues: auditSnapshot(existing),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Service user area deleted', data: this.mapServiceUserArea(deleted) };
  }

  async updateServiceUserLocation(
    userId: string,
    serviceUserId: string,
    dto: UpdateMemberLocationDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Service user not found');

    let locationId = dto.locationId ?? null;
    let serviceUserAreaId =
      dto.serviceUserAreaId === undefined ? existing.serviceUserAreaId : dto.serviceUserAreaId;

    if (dto.serviceUserAreaId) {
      const sua = await this.prisma.serviceUserArea.findFirst({
        where: { id: dto.serviceUserAreaId, deletedAt: null, isActive: true },
        include: {
          scheduleArea: { select: { id: true, locationId: true, deletedAt: true, isActive: true } },
        },
      });
      if (!sua || !sua.scheduleArea || sua.scheduleArea.deletedAt || !sua.scheduleArea.isActive) {
        throw new BadRequestException('Service user area not found');
      }
      serviceUserAreaId = sua.id;
      locationId = sua.scheduleArea.locationId;
      if (!locationId) {
        throw new BadRequestException(
          'This area’s branch has no linked location. Link a location on the schedule area first.',
        );
      }
    } else if (dto.serviceUserAreaId === null) {
      serviceUserAreaId = null;
      if (dto.locationId !== undefined) {
        locationId = dto.locationId;
      }
    } else if (dto.locationId !== undefined) {
      locationId = dto.locationId;
      // Clearing/changing branch without an area clears the area assignment.
      if (dto.locationId == null) {
        serviceUserAreaId = null;
      } else if (existing.serviceUserAreaId) {
        const currentArea = await this.prisma.serviceUserArea.findFirst({
          where: { id: existing.serviceUserAreaId, deletedAt: null },
          include: { scheduleArea: { select: { locationId: true } } },
        });
        if (currentArea?.scheduleArea.locationId !== dto.locationId) {
          serviceUserAreaId = null;
        }
      }
    }

    await this.assertLocation(locationId ?? undefined);

    let nextPostcode: string | null | undefined = undefined;
    if (dto.postcode !== undefined) {
      if (dto.postcode === null || !String(dto.postcode).trim()) {
        nextPostcode = null;
      } else {
        const formatted = formatPostcodeDisplay(String(dto.postcode));
        const key = normalizePostcodeKey(formatted);
        if (serviceUserAreaId) {
          const areaPcs = await this.prisma.serviceUserAreaPostcode.findMany({
            where: { serviceUserAreaId },
            select: { postcode: true, normalizedPostcode: true },
          });
          const hit = areaPcs.find((p) => p.normalizedPostcode === key);
          nextPostcode = hit?.postcode ?? formatted;
        } else {
          nextPostcode = formatted;
        }
      }
    }

    const updated = await this.prisma.serviceUser.update({
      where: { id: serviceUserId },
      data: {
        location: locationId ? { connect: { id: locationId } } : { disconnect: true },
        serviceUserArea: serviceUserAreaId
          ? { connect: { id: serviceUserAreaId } }
          : { disconnect: true },
        updatedById: userId,
      },
      select: {
        id: true,
        locationId: true,
        serviceUserAreaId: true,
        location: { select: { id: true, name: true } },
        address: { select: { id: true, postcode: true } },
        serviceUserArea: {
          select: {
            id: true,
            name: true,
            postcodes: { select: { postcode: true }, orderBy: { postcode: 'asc' } },
          },
        },
      },
    });

    let addressPostcode = updated.address?.postcode?.trim() || null;
    if (nextPostcode !== undefined) {
      if (updated.address?.id) {
        const addr = await this.prisma.serviceUserAddress.update({
          where: { id: updated.address.id },
          data: { postcode: nextPostcode, updatedById: userId },
          select: { postcode: true },
        });
        addressPostcode = addr.postcode?.trim() || null;
      } else if (nextPostcode) {
        const addr = await this.prisma.serviceUserAddress.create({
          data: {
            serviceUserId,
            postcode: nextPostcode,
            createdById: userId,
            updatedById: userId,
          },
          select: { postcode: true },
        });
        addressPostcode = addr.postcode?.trim() || null;
      }
    }

    const assignment = await this.prisma.serviceUserAssignment.findFirst({
      where: { serviceUserId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    if (assignment) {
      await this.prisma.serviceUserAssignment.update({
        where: { id: assignment.id },
        data: {
          locationId: locationId ?? null,
          updatedById: userId,
        },
      });
    } else if (locationId) {
      await this.prisma.serviceUserAssignment.create({
        data: {
          serviceUserId,
          locationId,
          createdById: userId,
        },
      });
    }

    const parsed = parseLocationName(updated.location?.name ?? null);
    const area = updated.locationId
      ? await this.prisma.scheduleArea.findFirst({
          where: {
            deletedAt: null,
            isActive: true,
            locationId: updated.locationId,
          },
          select: {
            name: true,
            parentZoneName: true,
            zone: { select: { name: true } },
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        })
      : null;
    const zoneName =
      area?.parentZoneName?.trim() || area?.zone?.name || parsed.zoneName || null;
    const branchName = area?.name || parsed.roomName || null;
    return {
      message: 'Service user location updated',
      data: {
        id: updated.id,
        locationId: updated.locationId,
        locationName: updated.location?.name ?? null,
        zoneName,
        roomName: branchName,
        serviceUserAreaId: updated.serviceUserAreaId,
        serviceUserAreaName: updated.serviceUserArea?.name ?? null,
        serviceUserAreaPostcodes:
          updated.serviceUserArea?.postcodes.map((p) => p.postcode) ?? [],
        postcode: addressPostcode,
      },
    };
  }

  async listEmployeeLocations() {
    const [rows, locations, scheduleAreas] = await Promise.all([
      this.prisma.employee.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          isActive: true,
          personalDetail: { select: { firstName: true, lastName: true } },
          employment: {
            select: {
              id: true,
              locationId: true,
              accessAllZones: true,
              location: { select: { id: true, name: true } },
              jobTitle: { select: { name: true } },
              role: { select: { name: true } },
              floorLocations: {
                select: { location: { select: { id: true, name: true } } },
              },
            },
          },
        },
        orderBy: { personalDetail: { lastName: 'asc' } },
      }),
      this.prisma.location.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.scheduleArea.findMany({
        where: { deletedAt: null, isActive: true, locationId: { not: null } },
        select: {
          id: true,
          name: true,
          locationId: true,
          parentZoneName: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const areaByLocationId = new Map(
      scheduleAreas
        .filter((a) => a.locationId)
        .map((a) => [a.locationId as string, a]),
    );

    const zoneMap = new Map<
      string,
      {
        id: string;
        name: string;
        branches: Array<{
          id: string;
          name: string;
          scheduleAreaId: string | null;
        }>;
      }
    >();
    for (const loc of locations) {
      const area = areaByLocationId.get(loc.id);
      const parsed = parseLocationName(loc.name);
      const zoneName = area?.parentZoneName?.trim() || parsed.zoneName || loc.name;
      const branchName = area?.name || parsed.roomName || loc.name;
      const zoneKey = zoneName || loc.name;
      const zone = zoneMap.get(zoneKey) ?? { id: zoneKey, name: zoneKey, branches: [] };
      zone.branches.push({
        id: loc.id,
        name: branchName,
        scheduleAreaId: area?.id ?? null,
      });
      zoneMap.set(zoneKey, zone);
    }

    return {
      data: {
        zones: [...zoneMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
        locations,
        members: rows.map((r) => {
          const emp = r.employment;
          const primaryName = emp?.location?.name ?? null;
          const parentZone = parentZoneFromLocationName(primaryName);
          const floorIds = new Set<string>();
          if (emp?.locationId) floorIds.add(emp.locationId);
          for (const fl of emp?.floorLocations ?? []) {
            if (fl.location?.id) floorIds.add(fl.location.id);
          }
          const floorLocationNames = locations
            .filter((l) => floorIds.has(l.id))
            .map((l) => l.name);
          const accessAllZones = emp?.accessAllZones ?? false;
          const floorNames = accessAllZones
            ? formatFloorNames(
                locations.map((l) => l.name),
                true,
                parentZone,
              )
            : formatFloorNames(floorLocationNames, false, parentZone);

          const jobTitle = emp?.jobTitle?.name;
          const role = emp?.role?.name;
          const nameParts = [
            formatPersonLabel(r.personalDetail?.firstName, r.personalDetail?.lastName, null),
            jobTitle,
            role,
          ].filter(Boolean);

          return {
            id: r.id,
            fullName: nameParts.join(' - '),
            isActive: r.isActive,
            locationId: emp?.locationId ?? null,
            locationName: primaryName,
            zoneName: parentZone || primaryName,
            floorNames,
            accessAllZones,
            floorLocationIds: [...floorIds],
          };
        }),
      },
    };
  }

  async updateEmployeeLocation(
    userId: string,
    employeeId: string,
    dto: UpdateEmployeeLocationDto,
    meta?: RequestAuditMeta,
  ) {
    const locationId = dto.locationId === undefined ? undefined : dto.locationId;

    if (locationId) await this.assertLocation(locationId);
    if (dto.floorLocationIds?.length) await this.assertLocations(dto.floorLocationIds);

    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId },
      include: { floorLocations: true },
    });
    if (!employment) throw new NotFoundException('Employee employment record not found');

    const resolvedLocationId =
      locationId !== undefined ? locationId : employment.locationId;
    const floorIds = dto.floorLocationIds ?? [];
    if (resolvedLocationId && !floorIds.includes(resolvedLocationId)) {
      floorIds.unshift(resolvedLocationId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.employeeEmploymentFloorLocation.deleteMany({
        where: { employmentId: employment.id },
      });

      const extraFloorIds = floorIds.filter((id) => id !== resolvedLocationId);
      if (extraFloorIds.length > 0) {
        await tx.employeeEmploymentFloorLocation.createMany({
          data: extraFloorIds.map((locId) => ({
            employmentId: employment.id,
            locationId: locId,
          })),
          skipDuplicates: true,
        });
      }

      return tx.employeeEmployment.update({
        where: { employeeId },
        data: {
          locationId: resolvedLocationId ?? null,
          ...(dto.accessAllZones !== undefined
            ? { accessAllZones: dto.accessAllZones }
            : {}),
          updatedById: userId,
        },
        select: {
          employeeId: true,
          locationId: true,
          accessAllZones: true,
          location: { select: { id: true, name: true } },
          jobTitle: { select: { name: true } },
          role: { select: { name: true } },
          floorLocations: {
            select: { location: { select: { id: true, name: true } } },
          },
        },
      });
    });

    const locations = await this.prisma.location.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true },
    });
    const parentZone = parentZoneFromLocationName(updated.location?.name ?? null);
    const floorIdSet = new Set<string>();
    if (updated.locationId) floorIdSet.add(updated.locationId);
    for (const fl of updated.floorLocations) {
      if (fl.location?.id) floorIdSet.add(fl.location.id);
    }
    const floorLocationNames = locations
      .filter((l) => floorIdSet.has(l.id))
      .map((l) => l.name);
    const floorNames = updated.accessAllZones
      ? formatFloorNames(
          locations.map((l) => l.name),
          true,
          parentZone,
        )
      : formatFloorNames(floorLocationNames, false, parentZone);

    return {
      message: 'Employee location updated',
      data: {
        id: updated.employeeId,
        locationId: updated.locationId,
        locationName: updated.location?.name ?? null,
        zoneName: parentZone || updated.location?.name || null,
        floorNames,
        accessAllZones: updated.accessAllZones,
        floorLocationIds: [...floorIdSet],
      },
    };
  }
}
