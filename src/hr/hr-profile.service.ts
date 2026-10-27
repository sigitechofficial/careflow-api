import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreateHrProfileDto } from './dto/create-hr-profile.dto';
import { HrEmployeeListQueryDto } from './dto/hr-employee-list-query.dto';
import { UpdateHrProfileDto } from './dto/update-hr-profile.dto';
import {
  mapHrEmployeeListRow,
  mapHrProfileResponse,
} from './mappers/hr-profile.mapper';

@Injectable()
export class HrProfileService {
  constructor(private readonly prisma: PrismaService) {}

  private employeeInclude = {
    personalDetail: { include: { status: true } },
    employment: {
      include: {
        jobTitle: true,
        contractType: true,
        location: true,
      },
    },
    hrProfile: {
      include: {
        reportingManager: {
          include: {
            personalDetail: { select: { firstName: true, lastName: true } },
          },
        },
      },
    },
    emergencyContacts: {
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' as const },
    },
  } satisfies Prisma.EmployeeInclude;

  async list(query: HrEmployeeListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      ...(query.employeeLifecycleStatus || query.deploymentStatus
        ? {
            hrProfile: {
              deletedAt: null,
              ...(query.employeeLifecycleStatus
                ? { employeeLifecycleStatus: query.employeeLifecycleStatus }
                : {}),
              ...(query.deploymentStatus
                ? { deploymentStatus: query.deploymentStatus }
                : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              {
                personalDetail: {
                  OR: [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
              {
                employment: {
                  OR: [
                    { employeeNumber: { contains: search, mode: 'insensitive' } },
                    {
                      jobTitle: {
                        name: { contains: search, mode: 'insensitive' },
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        include: this.employeeInclude,
        skip,
        take: limit,
        orderBy: [
          { personalDetail: { lastName: 'asc' } },
          { personalDetail: { firstName: 'asc' } },
        ],
      }),
    ]);

    return {
      data: rows.map((row) =>
        mapHrEmployeeListRow({
          employee: row,
          personalDetail: row.personalDetail,
          employment: row.employment,
          hrProfile: row.hrProfile,
          emergencyContacts: row.emergencyContacts,
        }),
      ),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  private async loadAggregate(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: this.employeeInclude,
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return mapHrProfileResponse({
      employee,
      personalDetail: employee.personalDetail,
      employment: employee.employment,
      hrProfile: employee.hrProfile,
      emergencyContacts: employee.emergencyContacts,
    });
  }

  async getProfile(employeeId: string) {
    return { data: await this.loadAggregate(employeeId) };
  }

  async createProfile(
    userId: string,
    employeeId: string,
    dto: CreateHrProfileDto,
    _meta?: RequestAuditMeta,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { hrProfile: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.hrProfile && employee.hrProfile.deletedAt == null) {
      throw new ConflictException('HR profile already exists for this employee');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.applySharedUpdates(tx, userId, employeeId, dto);
      await tx.employeeHRProfile.upsert({
        where: { employeeId },
        update: {
          ...this.buildHrProfileFields(dto),
          deletedAt: null,
          isActive: true,
          updatedById: userId,
        },
        create: {
          employeeId,
          ...this.buildHrProfileCreateFields(dto),
          createdById: userId,
        },
      });
    });

    return {
      message: 'HR profile created',
      data: await this.loadAggregate(employeeId),
    };
  }

  async updateProfile(
    userId: string,
    employeeId: string,
    dto: UpdateHrProfileDto,
    _meta?: RequestAuditMeta,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { hrProfile: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    await this.prisma.$transaction(async (tx) => {
      await this.applySharedUpdates(tx, userId, employeeId, dto);

      const hrFields = this.buildHrProfileFields(dto);
      if (Object.keys(hrFields).length > 0 || !employee.hrProfile) {
        await tx.employeeHRProfile.upsert({
          where: { employeeId },
          update: {
            ...hrFields,
            deletedAt: null,
            isActive: true,
            updatedById: userId,
          },
          create: {
            employeeId,
            ...this.buildHrProfileCreateFields(dto),
            createdById: userId,
          },
        });
      }
    });

    return {
      message: 'HR profile updated',
      data: await this.loadAggregate(employeeId),
    };
  }

  private buildHrProfileCreateFields(
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ): Omit<Prisma.EmployeeHRProfileUncheckedCreateInput, 'employeeId' | 'createdById'> {
    return this.buildHrProfileFields(dto) as Omit<
      Prisma.EmployeeHRProfileUncheckedCreateInput,
      'employeeId' | 'createdById'
    >;
  }

  private buildHrProfileFields(
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ): Prisma.EmployeeHRProfileUncheckedUpdateInput {
    const data: Prisma.EmployeeHRProfileUncheckedUpdateInput = {};
    if (dto.legalName !== undefined) data.legalName = dto.legalName;
    if (dto.preferredName !== undefined) data.preferredName = dto.preferredName;
    if (dto.careWorkforceCategory !== undefined) {
      data.careWorkforceCategory = dto.careWorkforceCategory;
    }
    if (dto.employeeLifecycleStatus !== undefined) {
      data.employeeLifecycleStatus = dto.employeeLifecycleStatus;
    }
    if (dto.deploymentStatus !== undefined) data.deploymentStatus = dto.deploymentStatus;
    if (dto.reportingManagerId !== undefined) {
      data.reportingManagerId = dto.reportingManagerId;
    }
    if (dto.branchTeam !== undefined) data.branchTeam = dto.branchTeam;
    return data;
  }

  private buildEmploymentCreateFields(
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ): Omit<Prisma.EmployeeEmploymentUncheckedCreateInput, 'employeeId' | 'createdById'> {
    return this.buildEmploymentFields(dto) as Omit<
      Prisma.EmployeeEmploymentUncheckedCreateInput,
      'employeeId' | 'createdById'
    >;
  }

  private async applySharedUpdates(
    tx: Prisma.TransactionClient,
    userId: string,
    employeeId: string,
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ) {
    const personalFields = this.buildPersonalFields(dto);
    if (Object.keys(personalFields).length > 0) {
      const existing = await tx.employeePersonalDetail.findUnique({
        where: { employeeId },
      });
      if (existing) {
        await tx.employeePersonalDetail.update({
          where: { employeeId },
          data: { ...personalFields, updatedById: userId },
        });
      }
    }

    const employmentFields = this.buildEmploymentFields(dto);
    if (Object.keys(employmentFields).length > 0) {
      await tx.employeeEmployment.upsert({
        where: { employeeId },
        update: { ...employmentFields, updatedById: userId },
        create: {
          employeeId,
          ...this.buildEmploymentCreateFields(dto),
          createdById: userId,
        },
      });
    }

    if (dto.reportingManagerId) {
      const manager = await tx.employee.findFirst({
        where: { id: dto.reportingManagerId, deletedAt: null },
      });
      if (!manager) throw new NotFoundException('Reporting manager not found');
      if (dto.reportingManagerId === employeeId) {
        throw new ConflictException('Employee cannot be their own reporting manager');
      }
    }
  }

  private buildPersonalFields(
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ): Prisma.EmployeePersonalDetailUncheckedUpdateInput {
    const data: Prisma.EmployeePersonalDetailUncheckedUpdateInput = {};
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = dto.dateOfBirth;
    if (dto.profilePhoto !== undefined) data.photoUrl = dto.profilePhoto;
    return data;
  }

  private buildEmploymentFields(
    dto: CreateHrProfileDto | UpdateHrProfileDto,
  ): Prisma.EmployeeEmploymentUncheckedUpdateInput {
    const data: Prisma.EmployeeEmploymentUncheckedUpdateInput = {};
    if (dto.jobTitleId !== undefined) data.jobTitleId = dto.jobTitleId;
    if (dto.contractTypeId !== undefined) data.contractTypeId = dto.contractTypeId;
    if (dto.branchLocationId !== undefined) data.locationId = dto.branchLocationId;
    if (dto.employmentStartDate !== undefined) data.startDate = dto.employmentStartDate;
    return data;
  }
}
