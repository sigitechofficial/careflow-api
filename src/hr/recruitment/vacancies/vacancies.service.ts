import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VacancyStatus, SalaryPeriod } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildPaginationMeta } from '../../../common/utils/pagination.util';
import type { RequestUser } from '../../../common/decorators/current-user.decorator';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { UpdateVacancyDto } from './dto/update-vacancy.dto';
import { UpdateVacancyStatusDto } from './dto/update-vacancy-status.dto';
import { VacancyQueryDto } from './dto/vacancy-query.dto';
import { formatVacancyReference } from '../utils/recruitment-reference.util';
import { normaliseQuestions, payText, type ScreeningQuestion } from '../utils/vacancy-screening.util';
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
    salaryPeriod: SalaryPeriod | null;
    closingDate: Date | null;
    numberOfPositions: number;
    status: VacancyStatus;
    hiringManagerId: string | null;
    workSetting: string | null;
    hoursType: string | null;
    hoursPerWeekMin: number | null;
    hoursPerWeekMax: number | null;
    startDate: Date | null;
    payMin: Prisma.Decimal | null;
    payMax: Prisma.Decimal | null;
    shifts: string[];
    benefits: string[];
    screeningQuestions: Prisma.JsonValue;
    cvRequirement: string;
    notifyMode: string;
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
      salaryPeriod: row.salaryPeriod,
      closingDate: row.closingDate ? row.closingDate.toISOString().slice(0, 10) : null,
      numberOfPositions: row.numberOfPositions,
      workSetting: row.workSetting,
      hoursType: row.hoursType,
      hoursPerWeekMin: row.hoursPerWeekMin,
      hoursPerWeekMax: row.hoursPerWeekMax,
      startDate: row.startDate ? row.startDate.toISOString().slice(0, 10) : null,
      payMin: row.payMin != null ? Number(row.payMin) : null,
      payMax: row.payMax != null ? Number(row.payMax) : null,
      shifts: row.shifts,
      benefits: row.benefits,
      screeningQuestions: (Array.isArray(row.screeningQuestions) ? row.screeningQuestions : []) as unknown as ScreeningQuestion[],
      cvRequirement: row.cvRequirement,
      notifyMode: row.notifyMode,
      status: row.status,
      hiringManagerId: row.hiringManagerId,
      hiringManagerName: managerName,
      candidateCount: activeCandidates.length,
      stageCounts,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * The vacancy form's newer fields: questions checked and tidied, and pay numbers also written as the pay
   * text the careers page shows. Only fields that were sent are returned (an update leaves the rest).
   */
  private formFields(dto: UpdateVacancyDto): Partial<Prisma.VacancyUncheckedCreateInput> {
    const out: Record<string, unknown> = {};
    for (const key of ['workSetting', 'hoursType', 'hoursPerWeekMin', 'hoursPerWeekMax', 'startDate', 'shifts', 'benefits', 'cvRequirement', 'notifyMode'] as const) {
      if (dto[key] !== undefined) out[key] = dto[key];
    }
    if (dto.benefits) out.benefits = [...new Set(dto.benefits.map((b) => b.trim()).filter(Boolean))];
    if (dto.hoursPerWeekMin != null && dto.hoursPerWeekMax != null && dto.hoursPerWeekMin > dto.hoursPerWeekMax) {
      throw new BadRequestException('The lowest hours per week must not be more than the highest.');
    }
    if (dto.payMin !== undefined || dto.payMax !== undefined) {
      const min = dto.payMin ?? null;
      const max = dto.payMax ?? null;
      if (min != null && max != null && min > max) throw new BadRequestException('The lowest pay must not be more than the highest.');
      out.payMin = min;
      out.payMax = max;
      // Pay given as numbers: the careers page text follows them.
      if (min != null || max != null) out.salaryRange = payText(min, max);
    }
    if (dto.screeningQuestions !== undefined) {
      try {
        out.screeningQuestions = normaliseQuestions(dto.screeningQuestions) as unknown as Prisma.InputJsonValue;
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    }
    return out as Partial<Prisma.VacancyUncheckedCreateInput>;
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
        salaryPeriod: dto.salaryPeriod ?? null,
        closingDate: dto.closingDate ?? null,
        numberOfPositions: dto.numberOfPositions ?? 1,
        hiringManagerId: dto.hiringManagerId,
        status: dto.status === 'DRAFT' ? VacancyStatus.DRAFT : VacancyStatus.OPEN,
        ...this.formFields(dto),
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
    // Status changes go through updateStatus (publish, pause, close).
    const { status: _status, screeningQuestions: _q, ...rest } = dto;
    const updated = await this.prisma.vacancy.update({
      where: { id },
      data: {
        ...rest,
        ...this.formFields(dto),
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
