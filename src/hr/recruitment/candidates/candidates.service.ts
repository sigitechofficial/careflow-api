import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CandidateStage, EmployeeLifecycleStatus, HrDeploymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildPaginationMeta } from '../../../common/utils/pagination.util';
import type { RequestUser } from '../../../common/decorators/current-user.decorator';
import { EmployeesService } from '../../../employees/employees.service';
import { EmployeePersonalDetailsService } from '../../../employee-personal-details/employee-personal-details.service';
import { EmployeeEmploymentService } from '../../../employee-employment/employee-employment.service';
import { HrProfileService } from '../../hr-profile.service';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { UpdateCandidateStageDto } from './dto/update-candidate-stage.dto';
import { CandidateQueryDto } from './dto/candidate-query.dto';
import { formatCandidateReference, formatVacancyReference } from '../utils/recruitment-reference.util';
import {
  candidateScopeWhere,
  resolveRecruitmentScope,
  vacancyScopeWhere,
} from '../utils/recruitment-scope.util';
import { RecruitmentNotificationHook } from '../recruitment-notification.hook';
import { resolveContractTypeIdForRecruitmentType } from '../utils/recruitment-employment-map.util';

const PIPELINE_STAGES: CandidateStage[] = [
  CandidateStage.APPLIED,
  CandidateStage.SCREENING,
  CandidateStage.SHORTLISTED,
  CandidateStage.INTERVIEW,
  CandidateStage.ASSESSMENT,
  CandidateStage.OFFER,
  CandidateStage.VETTING,
  CandidateStage.ACCEPTED,
];

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: RecruitmentNotificationHook,
  ) {}

  private mapCandidate(row: {
    id: string;
    recordNo: number;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    dateOfBirth: Date | null;
    address: string | null;
    vacancyId: string;
    source: string;
    stage: CandidateStage;
    coverLetter: string | null;
    personalStatement: string | null;
    cvFileUrl: string | null;
    dataProcessingConsent: boolean;
    consentDate: Date | null;
    convertedEmployeeId: string | null;
    convertedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    vacancy?: {
      id: string;
      title: string;
      recordNo: number;
      hiringManagerId: string | null;
    };
  }) {
    return {
      id: row.id,
      candidateReference: formatCandidateReference(row.recordNo),
      recordNo: row.recordNo,
      firstName: row.firstName,
      lastName: row.lastName,
      name: [row.firstName, row.lastName].filter(Boolean).join(' ').trim(),
      email: row.email,
      phone: row.phone,
      dateOfBirth: row.dateOfBirth,
      address: row.address,
      vacancyId: row.vacancyId,
      vacancyTitle: row.vacancy?.title ?? null,
      vacancyReference: row.vacancy ? formatVacancyReference(row.vacancy.recordNo) : null,
      source: row.source,
      stage: row.stage,
      coverLetter: row.coverLetter,
      personalStatement: row.personalStatement,
      cvFileUrl: row.cvFileUrl,
      dataProcessingConsent: row.dataProcessingConsent,
      consentDate: row.consentDate,
      convertedEmployeeId: row.convertedEmployeeId,
      convertedAt: row.convertedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(user: RequestUser, dto: CreateCandidateDto) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id: dto.vacancyId, deletedAt: null },
    });
    if (!vacancy) throw new NotFoundException('Vacancy not found');

    const created = await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.candidate.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          dateOfBirth: dto.dateOfBirth,
          address: dto.address,
          vacancyId: dto.vacancyId,
          source: dto.source,
          stage: CandidateStage.APPLIED,
          coverLetter: dto.coverLetter,
          personalStatement: dto.personalStatement,
          cvFileUrl: dto.cvFileUrl,
          dataProcessingConsent: dto.dataProcessingConsent ?? false,
          consentDate: dto.dataProcessingConsent ? dto.consentDate ?? new Date() : dto.consentDate,
          createdById: user.id,
        },
        include: {
          vacancy: { select: { id: true, title: true, recordNo: true, hiringManagerId: true } },
        },
      });

      await tx.candidateStageHistory.create({
        data: {
          candidateId: candidate.id,
          fromStage: null,
          toStage: CandidateStage.APPLIED,
          changedById: user.id,
          notes: 'Application created',
        },
      });

      return candidate;
    });

    await this.notifications.onApplicationReceived({
      candidateId: created.id,
      candidateName: `${created.firstName} ${created.lastName}`,
      vacancyTitle: created.vacancy.title,
      hiringManagerId: created.vacancy.hiringManagerId,
    });

    return {
      message: 'Candidate created',
      data: this.mapCandidate(created),
    };
  }

  async list(user: RequestUser, query: CandidateQueryDto) {
    const scope = await resolveRecruitmentScope(this.prisma, {
      id: user.id,
      email: user.email,
      permissions: user.permissions,
    });
    const candidateScope = await candidateScopeWhere(this.prisma, scope);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.CandidateWhereInput = {
      deletedAt: null,
      ...candidateScope,
      ...(query.vacancyId ? { vacancyId: query.vacancyId } : {}),
      ...(query.stage ? { stage: query.stage } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.candidate.count({ where }),
      this.prisma.candidate.findMany({
        where,
        include: {
          vacancy: { select: { id: true, title: true, recordNo: true, hiringManagerId: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: rows.map((r) => this.mapCandidate(r)),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(user: RequestUser, id: string) {
    const scope = await resolveRecruitmentScope(this.prisma, {
      id: user.id,
      email: user.email,
      permissions: user.permissions,
    });
    const candidateScope = await candidateScopeWhere(this.prisma, scope);

    const row = await this.prisma.candidate.findFirst({
      where: { id, deletedAt: null, ...candidateScope },
      include: {
        vacancy: { select: { id: true, title: true, recordNo: true, hiringManagerId: true } },
        stageHistory: {
          orderBy: { createdAt: 'desc' },
          include: {
            changedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Candidate not found');

    return {
      data: {
        ...this.mapCandidate(row),
        timeline: row.stageHistory.map((h) => ({
          id: h.id,
          fromStage: h.fromStage,
          toStage: h.toStage,
          notes: h.notes,
          createdAt: h.createdAt,
          changedBy: h.changedBy
            ? {
                id: h.changedBy.id,
                name: [h.changedBy.firstName, h.changedBy.lastName].filter(Boolean).join(' ') ||
                  h.changedBy.email,
              }
            : null,
        })),
      },
    };
  }

  async updateStage(user: RequestUser, id: string, dto: UpdateCandidateStageDto) {
    const existing = await this.getById(user, id);
    const candidate = existing.data;

    if (candidate.convertedEmployeeId) {
      throw new BadRequestException('Cannot change stage after candidate has been converted');
    }

    if (candidate.stage === dto.stage) {
      return { message: 'Stage unchanged', data: candidate };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.candidate.update({
        where: { id },
        data: { stage: dto.stage, updatedById: user.id },
        include: {
          vacancy: { select: { id: true, title: true, recordNo: true, hiringManagerId: true } },
        },
      });

      await tx.candidateStageHistory.create({
        data: {
          candidateId: id,
          fromStage: candidate.stage as CandidateStage,
          toStage: dto.stage,
          changedById: user.id,
          notes: dto.notes,
        },
      });

      return row;
    });

    await this.notifications.onStageChange({
      candidateId: id,
      candidateName: `${updated.firstName} ${updated.lastName}`,
      vacancyTitle: updated.vacancy.title,
      hiringManagerId: updated.vacancy.hiringManagerId,
      toStage: dto.stage,
    });

    return {
      message: 'Candidate stage updated',
      data: this.mapCandidate(updated),
    };
  }

  async listPipeline(user: RequestUser, vacancyId?: string) {
    const scope = await resolveRecruitmentScope(this.prisma, {
      id: user.id,
      email: user.email,
      permissions: user.permissions,
    });
    const candidateScope = await candidateScopeWhere(this.prisma, scope);

    const where: Prisma.CandidateWhereInput = {
      deletedAt: null,
      stage: { in: PIPELINE_STAGES },
      ...candidateScope,
      ...(vacancyId ? { vacancyId } : {}),
    };

    const rows = await this.prisma.candidate.findMany({
      where,
      include: {
        vacancy: { select: { id: true, title: true, recordNo: true, hiringManagerId: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const columns = PIPELINE_STAGES.map((stage) => ({
      stage,
      candidates: rows.filter((r) => r.stage === stage).map((r) => this.mapCandidate(r)),
    }));

    return { data: { columns } };
  }
}

@Injectable()
export class CandidateConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly personalDetailsService: EmployeePersonalDetailsService,
    private readonly employmentService: EmployeeEmploymentService,
    private readonly hrProfileService: HrProfileService,
  ) {}

  private async deriveUsername(
    tx: Prisma.TransactionClient,
    firstName: string,
    lastName: string,
    email?: string | null,
  ): Promise<string> {
    const fromEmail = email?.split('@')[0]?.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 90);
    const base =
      fromEmail ||
      `${firstName}.${lastName}`.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
    let username = base.slice(0, 100) || `candidate-${Date.now()}`;
    let suffix = 0;
    while (
      await tx.employeePersonalDetail.findFirst({
        where: { username, deletedAt: null },
      })
    ) {
      suffix += 1;
      username = `${base.slice(0, 90)}-${suffix}`;
    }
    return username;
  }

  async convert(user: RequestUser, candidateId: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id: candidateId, deletedAt: null },
      include: { vacancy: true },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');
    if (candidate.convertedEmployeeId) {
      throw new ConflictException('Candidate has already been converted to an employee');
    }
    if (candidate.stage !== CandidateStage.ACCEPTED) {
      throw new BadRequestException('Candidate must be in ACCEPTED stage before conversion');
    }
    if (!candidate.dataProcessingConsent) {
      throw new BadRequestException('Data processing consent is required before conversion');
    }

    const username = await this.deriveUsername(
      this.prisma,
      candidate.firstName,
      candidate.lastName,
      candidate.email,
    );

    const createResult = await this.employeesService.create(user.id, {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      username,
      email: candidate.email ?? undefined,
    });

    const employeeId = createResult.data.id;

    await this.personalDetailsService.update(user.id, employeeId, {
      dateOfBirth: candidate.dateOfBirth ?? undefined,
      addressLine1: candidate.address ?? undefined,
      mobileTelephone: candidate.phone ?? undefined,
      email: candidate.email ?? undefined,
    });

    const contractTypeId = await resolveContractTypeIdForRecruitmentType(
      this.prisma,
      candidate.vacancy.employmentType,
    );

    await this.employmentService.update(user.id, employeeId, {
      jobTitleId: candidate.vacancy.jobTitleId ?? undefined,
      locationId: candidate.vacancy.locationId ?? undefined,
      contractTypeId: contractTypeId ?? undefined,
      startDate: new Date(),
    });

    await this.hrProfileService.updateProfile(user.id, employeeId, {
      employeeLifecycleStatus: EmployeeLifecycleStatus.ONBOARDING,
      deploymentStatus: HrDeploymentStatus.GREEN,
      reportingManagerId: candidate.vacancy.hiringManagerId ?? undefined,
    });

    const updatedCandidate = await this.prisma.$transaction(async (tx) => {
      const row = await tx.candidate.update({
        where: { id: candidateId },
        data: {
          convertedEmployeeId: employeeId,
          convertedAt: new Date(),
          convertedById: user.id,
          updatedById: user.id,
        },
        include: {
          vacancy: { select: { id: true, title: true, recordNo: true, hiringManagerId: true } },
        },
      });

      await tx.candidateStageHistory.create({
        data: {
          candidateId,
          fromStage: CandidateStage.ACCEPTED,
          toStage: CandidateStage.ACCEPTED,
          changedById: user.id,
          notes: `Converted to employee ${employeeId}`,
        },
      });

      return row;
    });

    return {
      message: 'Candidate converted to employee',
      data: {
        employeeId,
        candidate: {
          id: updatedCandidate.id,
          candidateReference: formatCandidateReference(updatedCandidate.recordNo),
          convertedEmployeeId: updatedCandidate.convertedEmployeeId,
          convertedAt: updatedCandidate.convertedAt,
        },
      },
    };
  }
}
