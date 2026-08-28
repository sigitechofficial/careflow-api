import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VacancyStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildPaginationMeta } from '../../../common/utils/pagination.util';
import type { RequestUser } from '../../../common/decorators/current-user.decorator';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { UpdateVacancyDto } from './dto/update-vacancy.dto';
import { UpdateVacancyStatusDto } from './dto/update-vacancy-status.dto';
import { VacancyQueryDto } from './dto/vacancy-query.dto';
import { formatVacancyReference } from '../utils/recruitment-reference.util';
import {
  resolveRecruitmentScope,
  vacancyScopeWhere,
} from '../utils/recruitment-scope.util';

@Injectable()
export class VacanciesService {
  constructor(private readonly prisma: PrismaService) {}

  private mapVacancy(row: {
    id: string;
    recordNo: number;
    title: string;
    employmentType: string;
    description: string | null;
    requirements: string | null;
    salaryRange: string | null;
    numberOfPositions: number;
    status: VacancyStatus;
    hiringManagerId: string | null;
    jobTitleId: string | null;
    locationId: string | null;
    createdAt: Date;
    updatedAt: Date;
    jobTitle?: { id: string; name: string } | null;
    location?: { id: string; name: string } | null;
    hiringManager?: {
      id: string;
      personalDetail: { firstName: string; lastName: string } | null;
    } | null;
    candidates?: { stage: string }[];
  }) {
    const manager = row.hiringManager?.personalDetail;
    const managerName = manager
      ? [manager.firstName, manager.lastName].filter(Boolean).join(' ').trim()
      : null;

    const activeCandidates = row.candidates ?? [];
    const stageCounts: Record<string, number> = {};
    for (const c of activeCandidates) {
      stageCounts[c.stage] = (stageCounts[c.stage] ?? 0) + 1;
    }

    return {
      id: row.id,
      vacancyReference: formatVacancyReference(row.recordNo),
      recordNo: row.recordNo,
      title: row.title,
      jobTitleId: row.jobTitleId,
      jobTitle: row.jobTitle?.name ?? null,
      locationId: row.locationId,
      location: row.location?.name ?? null,
      employmentType: row.employmentType,
      description: row.description,
      requirements: row.requirements,
      salaryRange: row.salaryRange,
      numberOfPositions: row.numberOfPositions,
      status: row.status,
      hiringManagerId: row.hiringManagerId,
      hiringManagerName: managerName,
      candidateCount: activeCandidates.length,
      stageCounts,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(user: RequestUser, dto: CreateVacancyDto) {
    const created = await this.prisma.vacancy.create({
      data: {
        title: dto.title,
        jobTitleId: dto.jobTitleId,
        locationId: dto.locationId,
        employmentType: dto.employmentType,
        description: dto.description,
        requirements: dto.requirements,
        salaryRange: dto.salaryRange,
        numberOfPositions: dto.numberOfPositions ?? 1,
        hiringManagerId: dto.hiringManagerId,
        createdById: user.id,
      },
      include: {
        jobTitle: true,
        location: true,
        hiringManager: {
          include: { personalDetail: { select: { firstName: true, lastName: true } } },
        },
        candidates: {
          where: {
            deletedAt: null,
            stage: { notIn: ['REJECTED', 'WITHDRAWN'] },
          },
          select: { stage: true },
        },
      },
    });
    return { message: 'Vacancy created', data: this.mapVacancy(created) };
  }

  async list(user: RequestUser, query: VacancyQueryDto) {
    const scope = await resolveRecruitmentScope(this.prisma, {
      id: user.id,
      email: user.email,
      permissions: user.permissions,
    });
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.VacancyWhereInput = {
      deletedAt: null,
      ...vacancyScopeWhere(scope),
      ...(query.status ? { status: query.status } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.hiringManagerId ? { hiringManagerId: query.hiringManagerId } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { jobTitle: { name: { contains: search, mode: 'insensitive' } } },
              { location: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.vacancy.count({ where }),
      this.prisma.vacancy.findMany({
        where,
        include: {
          jobTitle: true,
          location: true,
          hiringManager: {
            include: { personalDetail: { select: { firstName: true, lastName: true } } },
          },
          candidates: {
            where: {
              deletedAt: null,
              stage: { notIn: ['REJECTED', 'WITHDRAWN'] },
            },
            select: { stage: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: rows.map((r) => this.mapVacancy(r)),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(user: RequestUser, id: string) {
    const scope = await resolveRecruitmentScope(this.prisma, {
      id: user.id,
      email: user.email,
      permissions: user.permissions,
    });
    const row = await this.prisma.vacancy.findFirst({
      where: { id, deletedAt: null, ...vacancyScopeWhere(scope) },
      include: {
        jobTitle: true,
        location: true,
        hiringManager: {
          include: { personalDetail: { select: { firstName: true, lastName: true } } },
        },
        candidates: {
          where: { deletedAt: null },
          select: { stage: true },
        },
      },
    });
    if (!row) throw new NotFoundException('Vacancy not found');
    return { data: this.mapVacancy(row) };
  }

  async update(user: RequestUser, id: string, dto: UpdateVacancyDto) {
    await this.getById(user, id);
    const updated = await this.prisma.vacancy.update({
      where: { id },
      data: {
        ...dto,
        updatedById: user.id,
      },
      include: {
        jobTitle: true,
        location: true,
        hiringManager: {
          include: { personalDetail: { select: { firstName: true, lastName: true } } },
        },
        candidates: {
          where: {
            deletedAt: null,
            stage: { notIn: ['REJECTED', 'WITHDRAWN'] },
          },
          select: { stage: true },
        },
      },
    });
    return { message: 'Vacancy updated', data: this.mapVacancy(updated) };
  }

  async updateStatus(user: RequestUser, id: string, dto: UpdateVacancyStatusDto) {
    await this.getById(user, id);
    const updated = await this.prisma.vacancy.update({
      where: { id },
      data: { status: dto.status, updatedById: user.id },
      include: {
        jobTitle: true,
        location: true,
        hiringManager: {
          include: { personalDetail: { select: { firstName: true, lastName: true } } },
        },
        candidates: {
          where: {
            deletedAt: null,
            stage: { notIn: ['REJECTED', 'WITHDRAWN'] },
          },
          select: { stage: true },
        },
      },
    });
    return { message: 'Vacancy status updated', data: this.mapVacancy(updated) };
  }
}
