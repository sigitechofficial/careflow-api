import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { UpdateLocationZoneDto } from './dto/update-location-zone.dto';
import type { UpdateMemberLocationDto } from './dto/update-member-location.dto';
import type { UpdateEmployeeLocationDto } from './dto/update-employee-location.dto';
import {
  defaultMarkerColor,
  formatFloorNames,
  formatPersonLabel,
  parentZoneFromGroupId,
  parentZoneFromLocationName,
  parseLocationName,
  parseUserIdList,
  resolveParentZoneName,
  zoneGroupId,
} from './location-management.util';

const COMPANY_PROFILE_ID = '00000000-0000-4000-8000-000000000001';

type ScheduleAreaRow = {
  id: string;
  name: string;
  code: string;
  sortOrder: number;
  locationId: string | null;
  parentZoneName: string | null;
  markerColorHex: string | null;
  incidentMessageUserIds: unknown;
  incidentEmailUserIds: unknown;
  location: { id: string; name: string } | null;
  zone: { id: string; name: string } | null;
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
        zone: { select: { id: true, name: true } },
      },
    });

    if (parentKey) {
      return areas.filter(
        (a) =>
          resolveParentZoneName(a.parentZoneName, a.location?.name ?? null, a.name) === parentKey,
      );
    }

    const single = areas.find((a) => a.id === id);
    if (!single) throw new NotFoundException('Zone not found');
    return [single];
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
    const [company, areas, serviceUsers, employees] = await Promise.all([
      this.prisma.companyProfile.findUnique({ where: { id: COMPANY_PROFILE_ID } }),
      this.prisma.scheduleArea.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          location: { select: { id: true, name: true } },
          zone: { select: { id: true, name: true } },
        },
      }),
      this.prisma.serviceUser.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          locationId: true,
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
    ]);

    const suByLocation = new Map<string, typeof serviceUsers>();
    for (const su of serviceUsers) {
      if (!su.locationId) continue;
      const list = suByLocation.get(su.locationId) ?? [];
      list.push(su);
      suByLocation.set(su.locationId, list);
    }

    const empByLocation = new Map<string, typeof employees>();
    for (const emp of employees) {
      const locId = emp.employment?.locationId;
      if (!locId) continue;
      const list = empByLocation.get(locId) ?? [];
      list.push(emp);
      empByLocation.set(locId, list);
    }

    const grouped = this.groupAreas(areas);
    const zones = grouped.map((group, groupIndex) => {
      const representative = group.areas[0];
      const isMulti = group.areas.length > 1;
      const branches = group.areas.map((area) => {
        const locationId = area.locationId;
        const children: Array<{
          id: string;
          type: 'service_user' | 'employee';
          label: string;
          entityId: string;
        }> = [];

        if (locationId) {
          for (const su of suByLocation.get(locationId) ?? []) {
            const addr = su.address;
            const line = [addr?.addressLine1, addr?.addressLine2, addr?.town, addr?.postcode]
              .filter(Boolean)
              .join(', ');
            children.push({
              id: `su-${su.id}`,
              type: 'service_user',
              entityId: su.id,
              label: formatPersonLabel(su.firstName, su.lastName, line || null),
            });
          }
          for (const emp of empByLocation.get(locationId) ?? []) {
            children.push({
              id: `emp-${emp.id}`,
              type: 'employee',
              entityId: emp.id,
              label: formatPersonLabel(
                emp.personalDetail?.firstName,
                emp.personalDetail?.lastName,
                emp.employment?.location?.name ?? null,
              ),
            });
          }
        }

        return {
          id: area.id,
          name: area.name,
          scheduleAreaId: area.id,
          locationId: area.locationId,
          locationName: area.location?.name ?? null,
          children,
        };
      });

      return {
        id: isMulti ? zoneGroupId(group.parentName) : representative.id,
        name: group.parentName,
        code: representative.code,
        markerColorHex:
          representative.markerColorHex ?? defaultMarkerColor(groupIndex),
        locationId: representative.locationId,
        locationName: representative.location?.name ?? null,
        zoneName: representative.zone?.name ?? null,
        incidentMessageUserIds: parseUserIdList(representative.incidentMessageUserIds),
        incidentEmailUserIds: parseUserIdList(representative.incidentEmailUserIds),
        branches,
        children: branches.flatMap((b) => b.children),
      };
    });

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
    const representative = areas[0];
    const parentName = resolveParentZoneName(
      representative.parentZoneName,
      representative.location?.name ?? null,
      representative.name,
    );
    const index = await this.prisma.scheduleArea.count({
      where: { deletedAt: null, isActive: true, sortOrder: { lt: representative.sortOrder } },
    });

    return {
      data: {
        id: areas.length > 1 ? zoneGroupId(parentName) : representative.id,
        name: parentName,
        code: representative.code,
        markerColorHex: representative.markerColorHex ?? defaultMarkerColor(index),
        locationId: representative.locationId,
        locationName: representative.location?.name ?? null,
        incidentMessageUserIds: parseUserIdList(representative.incidentMessageUserIds),
        incidentEmailUserIds: parseUserIdList(representative.incidentEmailUserIds),
      },
    };
  }

  async updateZone(userId: string, id: string, dto: UpdateLocationZoneDto, meta?: RequestAuditMeta) {
    const areas = await this.areasForZoneId(id);
    const parentName = resolveParentZoneName(
      areas[0].parentZoneName,
      areas[0].location?.name ?? null,
      areas[0].name,
    );

    return this.prisma.$transaction(async (tx) => {
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
          include: { location: { select: { id: true, name: true } } },
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

      return {
        message: 'Zone updated',
        data: {
          id: updatedAreas.length > 1 ? zoneGroupId(parentName) : representative.id,
          name: dto.name?.trim() ?? parentName,
          code: representative.code,
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
    const [rows, locations, scheduleAreas] = await Promise.all([
      this.prisma.serviceUser.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          isActive: true,
          locationId: true,
          location: { select: { id: true, name: true } },
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
          name: true,
          locationId: true,
          parentZoneName: true,
          location: { select: { name: true } },
          zone: { select: { name: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const areaByLocationId = new Map(
      scheduleAreas
        .filter((area) => area.locationId)
        .map((area) => [area.locationId as string, area]),
    );

    const zoneMap = new Map<string, { id: string; name: string; branches: { id: string; name: string }[] }>();
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
      zone.branches.push({ id: loc.id, name: branchName });
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
          };
        }),
      },
    };
  }

  async updateServiceUserLocation(
    userId: string,
    serviceUserId: string,
    dto: UpdateMemberLocationDto,
    meta?: RequestAuditMeta,
  ) {
    await this.assertLocation(dto.locationId ?? undefined);
    const existing = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Service user not found');

    const updated = await this.prisma.serviceUser.update({
      where: { id: serviceUserId },
      data: {
        location: dto.locationId
          ? { connect: { id: dto.locationId } }
          : { disconnect: true },
        updatedById: userId,
      },
      select: {
        id: true,
        locationId: true,
        location: { select: { id: true, name: true } },
      },
    });

    const assignment = await this.prisma.serviceUserAssignment.findFirst({
      where: { serviceUserId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    if (assignment) {
      await this.prisma.serviceUserAssignment.update({
        where: { id: assignment.id },
        data: {
          locationId: dto.locationId ?? null,
          updatedById: userId,
        },
      });
    } else if (dto.locationId) {
      await this.prisma.serviceUserAssignment.create({
        data: {
          serviceUserId,
          locationId: dto.locationId,
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
      },
    };
  }

  async listEmployeeLocations() {
    const [rows, locations] = await Promise.all([
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
    ]);

    const zoneMap = new Map<string, { id: string; name: string; branches: { id: string; name: string }[] }>();
    for (const loc of locations) {
      const { zoneName, roomName } = parseLocationName(loc.name);
      const zoneKey = zoneName || loc.name;
      const zone = zoneMap.get(zoneKey) ?? { id: zoneKey, name: zoneKey, branches: [] };
      zone.branches.push({ id: loc.id, name: roomName || loc.name });
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
            zoneName: primaryName,
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
    if (dto.locationId) await this.assertLocation(dto.locationId);
    if (dto.floorLocationIds?.length) await this.assertLocations(dto.floorLocationIds);

    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId },
      include: { floorLocations: true },
    });
    if (!employment) throw new NotFoundException('Employee employment record not found');

    const floorIds = dto.floorLocationIds ?? [];
    if (dto.locationId && !floorIds.includes(dto.locationId)) {
      floorIds.unshift(dto.locationId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.employeeEmploymentFloorLocation.deleteMany({
        where: { employmentId: employment.id },
      });

      const extraFloorIds = floorIds.filter((id) => id !== dto.locationId);
      if (extraFloorIds.length > 0) {
        await tx.employeeEmploymentFloorLocation.createMany({
          data: extraFloorIds.map((locationId) => ({
            employmentId: employment.id,
            locationId,
          })),
          skipDuplicates: true,
        });
      }

      return tx.employeeEmployment.update({
        where: { employeeId },
        data: {
          locationId: dto.locationId ?? null,
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
        zoneName: updated.location?.name ?? null,
        floorNames,
        accessAllZones: updated.accessAllZones,
        floorLocationIds: [...floorIdSet],
      },
    };
  }
}
