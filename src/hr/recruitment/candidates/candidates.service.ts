import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CandidateCheckStatus,
  CandidateCheckType,
  CandidateDocumentStatus,
  CandidateDocumentType,
  CandidateInterviewOutcome,
  CandidateInterviewStatus,
  CandidateOfferStatus,
  CandidateStage,
  EmployeeLifecycleStatus,
  HrDeploymentStatus,
  HrDocumentStatus,
  HrDocumentType,
  Prisma,
  type Candidate,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildPaginationMeta } from '../../../common/utils/pagination.util';
import type { RequestUser } from '../../../common/decorators/current-user.decorator';
import { EmployeesService } from '../../../employees/employees.service';
import { EmployeePersonalDetailsService } from '../../../employee-personal-details/employee-personal-details.service';
import { EmployeeEmploymentService } from '../../../employee-employment/employee-employment.service';
import { EmployeeComplianceService } from '../../../employee-compliance/employee-compliance.service';
import { HrProfileService } from '../../hr-profile.service';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { UpdateCandidateStageDto } from './dto/update-candidate-stage.dto';
import { CandidateQueryDto } from './dto/candidate-query.dto';
import {
  ClearCandidateDto,
  ConvertCandidateDto,
  CreateInterviewDto,
  OfferResponseDto,
  SaveOfferDto,
  UpdateCandidateDto,
  UpdateCheckDto,
  UpdateEmploymentHistoryDto,
  UpdateInterviewDto,
  UpdateScreeningDto,
} from './dto/candidate-flow.dto';
import { formatCandidateReference, formatVacancyReference } from '../utils/recruitment-reference.util';
import {
  candidateScopeWhere,
  resolveRecruitmentScope,
} from '../utils/recruitment-scope.util';
import { RecruitmentNotificationHook } from '../recruitment-notification.hook';
import { InterviewEmailService } from './interview-email.service';
import { CandidateEmailService } from './candidate-email.service';
import type { RejectionPoint } from './candidate-email.util';
import { resolveContractTypeIdForRecruitmentType } from '../utils/recruitment-employment-map.util';
import {
  CHECK_COMPLIANCE_CODES,
  CHECK_LABELS,
  CLOSED_STAGES,
  FLOW_STAGES,
  STAGE_LABELS,
  checksForCandidate,
  clearanceBlockerItems,
  clearanceBlockers,
  employmentHistoryErrors,
  findUnexplainedGaps,
  parseEmploymentHistory,
  stageMoveError,
} from '../utils/recruitment-flow.util';

const vacancySelect = {
  select: { id: true, title: true, recordNo: true, hiringManagerId: true },
} as const;

const CHECK_ORDER = Object.values(CandidateCheckType);

/** How far the candidate got, for the wording of the rejection email. */
function rejectionPoint(stage: CandidateStage): RejectionPoint {
  if (stage === CandidateStage.INTERVIEW) return 'INTERVIEW';
  if (stage === CandidateStage.OFFER || stage === CandidateStage.VETTING || stage === CandidateStage.ACCEPTED) return 'OFFER';
  return 'APPLICATION';
}

type CandidateWithVacancy = Candidate & {
  vacancy?: { id: string; title: string; recordNo: number; hiringManagerId: string | null };
};

type Tx = Prisma.TransactionClient;

/** The employee (not deleted) whose record already has this email, if any. Employee emails are unique. */
async function employeeWithEmail(
  prisma: PrismaService,
  email: string | null | undefined,
): Promise<{ employeeId: string; name: string } | null> {
  const value = email?.trim();
  if (!value) return null;
  const row = await prisma.employeePersonalDetail.findFirst({
    where: { email: { equals: value, mode: 'insensitive' }, employee: { deletedAt: null } },
    select: { employeeId: true, firstName: true, lastName: true },
  });
  return row ? { employeeId: row.employeeId, name: `${row.firstName} ${row.lastName}`.trim() } : null;
}

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: RecruitmentNotificationHook,
    private readonly interviewEmails: InterviewEmailService,
    private readonly candidateEmails: CandidateEmailService,
  ) {}

  private mapCandidate(row: CandidateWithVacancy) {
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
      employmentHistory: parseEmploymentHistory(row.employmentHistory),
      hasRightToWork: row.hasRightToWork,
      needsSponsorship: row.needsSponsorship,
      drivesForWork: row.drivesForWork,
      livedOverseas: row.livedOverseas,
      screeningNotes: row.screeningNotes,
      offerStatus: row.offerStatus,
      offerStartDate: row.offerStartDate,
      offerHoursPerWeek: row.offerHoursPerWeek,
      offerPayRate: row.offerPayRate,
      offerNotes: row.offerNotes,
      offerSentAt: row.offerSentAt,
      offerRespondedAt: row.offerRespondedAt,
      offerEmailedAt: row.offerEmailedAt,
      outcomeReason: row.outcomeReason,
      rejectionEmailedAt: row.rejectionEmailedAt,
      clearedAt: row.clearedAt,
      clearanceNotes: row.clearanceNotes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email]),
    );
  }

  /** Loads a candidate the user may see, or throws. */
  private async loadScoped(user: RequestUser, id: string) {
    const scope = await resolveRecruitmentScope(this.prisma, {
      id: user.id,
      email: user.email,
      permissions: user.permissions,
    });
    const candidateScope = await candidateScopeWhere(this.prisma, scope);
    const row = await this.prisma.candidate.findFirst({
      where: { id, deletedAt: null, ...candidateScope },
      include: {
        vacancy: vacancySelect,
        interviews: true,
        checks: true,
        stageHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!row) throw new NotFoundException('Candidate not found');
    return row;
  }

  private assertOpen(candidate: Pick<Candidate, 'convertedEmployeeId'>) {
    if (candidate.convertedEmployeeId) {
      throw new BadRequestException('This candidate is already an employee. Make changes on the employee record.');
    }
  }

  private stageBeforeClosing(
    stage: CandidateStage,
    history: { fromStage: CandidateStage | null; toStage: CandidateStage }[],
  ): CandidateStage | null {
    if (!CLOSED_STAGES.includes(stage)) return null;
    return history.find((h) => h.toStage === stage)?.fromStage ?? null;
  }

  /** Creates any missing checks for the candidate (idempotent) and keeps the conditional ones in step. */
  private async ensureChecks(tx: Tx, candidate: Pick<Candidate, 'id' | 'drivesForWork' | 'livedOverseas'>) {
    const wanted = checksForCandidate(candidate);
    await tx.candidateCheck.createMany({
      data: wanted.map((c) => ({ candidateId: candidate.id, type: c.type, required: c.required })),
      skipDuplicates: true,
    });
    // Answers changed after the checks were set up: overseas / driving are only required when they apply.
    for (const type of [CandidateCheckType.OVERSEAS_POLICE_CHECK, CandidateCheckType.DRIVING]) {
      const needed = wanted.some((c) => c.type === type);
      await tx.candidateCheck.updateMany({
        where: { candidateId: candidate.id, type, required: !needed },
        data: { required: needed },
      });
    }
  }

  /** Moves the candidate, writes the history row, and returns the updated candidate. */
  private async moveStage(
    tx: Tx,
    params: {
      candidateId: string;
      from: CandidateStage;
      to: CandidateStage;
      userId: string;
      notes?: string | null;
      data?: Prisma.CandidateUpdateInput;
    },
  ) {
    const row = await tx.candidate.update({
      where: { id: params.candidateId },
      data: { ...params.data, stage: params.to, updatedById: params.userId },
      include: { vacancy: vacancySelect },
    });
    if (params.from !== params.to) {
      await tx.candidateStageHistory.create({
        data: {
          candidateId: params.candidateId,
          fromStage: params.from,
          toStage: params.to,
          changedById: params.userId,
          notes: params.notes ?? null,
        },
      });
    }
    return row;
  }

  private async notifyStage(row: CandidateWithVacancy, toStage: CandidateStage) {
    await this.notifications.onStageChange({
      candidateId: row.id,
      candidateName: `${row.firstName} ${row.lastName}`,
      vacancyTitle: row.vacancy?.title ?? 'the vacancy',
      hiringManagerId: row.vacancy?.hiringManagerId ?? null,
      toStage,
    });
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
        include: { vacancy: vacancySelect },
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
      ...(query.stage ? { stage: query.stage } : query.closed ? { stage: { in: CLOSED_STAGES } } : {}),
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
        include: { vacancy: vacancySelect },
        orderBy: query.closed ? { updatedAt: 'desc' } : { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    if (!query.closed) {
      return { data: rows.map((r) => this.mapCandidate(r)), meta: buildPaginationMeta({ page, limit, total }) };
    }

    // When and at which step each candidate was rejected or marked as withdrawn (their latest closing).
    const closings = await this.prisma.candidateStageHistory.findMany({
      where: { candidateId: { in: rows.map((r) => r.id) }, toStage: { in: CLOSED_STAGES } },
      orderBy: { createdAt: 'desc' },
      select: { candidateId: true, fromStage: true, createdAt: true },
    });
    const latest = new Map<string, { fromStage: CandidateStage | null; createdAt: Date }>();
    for (const c of closings) if (!latest.has(c.candidateId)) latest.set(c.candidateId, c);

    return {
      data: rows.map((r) => ({
        ...this.mapCandidate(r),
        closedFromStage: latest.get(r.id)?.fromStage ?? null,
        closedAt: latest.get(r.id)?.createdAt ?? r.updatedAt,
      })),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(user: RequestUser, id: string) {
    const row = await this.loadScoped(user, id);

    // Older candidates reached the checks step before checks existed: set them up now.
    if (row.stage === CandidateStage.VETTING && !row.convertedEmployeeId && row.checks.length === 0) {
      await this.prisma.$transaction((tx) => this.ensureChecks(tx, row));
    }

    const full = await this.prisma.candidate.findFirstOrThrow({
      where: { id: row.id },
      include: {
        vacancy: vacancySelect,
        stageHistory: {
          orderBy: { createdAt: 'desc' },
          include: {
            changedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
        interviews: { orderBy: { scheduledAt: 'desc' } },
        checks: {
          include: {
            documents: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
              select: { id: true, fileName: true, fileUrl: true, mimeType: true, createdAt: true },
            },
          },
        },
      },
    });

    const names = await this.userNames([
      full.clearedById,
      ...full.interviews.map((i) => i.completedById),
      ...full.checks.map((c) => c.verifiedById),
    ]);
    const history = parseEmploymentHistory(full.employmentHistory);
    const checks = [...full.checks].sort((a, b) => CHECK_ORDER.indexOf(a.type) - CHECK_ORDER.indexOf(b.type));

    return {
      data: {
        ...this.mapCandidate(full),
        clearedByName: full.clearedById ? names.get(full.clearedById) ?? null : null,
        interviews: full.interviews.map((i) => ({
          id: i.id,
          scheduledAt: i.scheduledAt,
          mode: i.mode,
          location: i.location,
          interviewers: i.interviewers,
          status: i.status,
          answers: Array.isArray(i.answers) ? i.answers : [],
          recommendation: i.recommendation,
          gapsDiscussed: i.gapsDiscussed,
          notes: i.notes,
          completedAt: i.completedAt,
          completedByName: i.completedById ? names.get(i.completedById) ?? null : null,
          candidateEmailedAt: i.candidateEmailedAt,
        })),
        checks: checks.map((c) => ({
          id: c.id,
          type: c.type,
          label: CHECK_LABELS[c.type],
          required: c.required,
          status: c.status,
          referenceNumber: c.referenceNumber,
          provider: c.provider,
          issueDate: c.issueDate,
          expiryDate: c.expiryDate,
          notes: c.notes,
          requestedAt: c.requestedAt,
          receivedAt: c.receivedAt,
          verifiedAt: c.verifiedAt,
          verifiedByName: c.verifiedById ? names.get(c.verifiedById) ?? null : null,
          documents: c.documents,
        })),
        unexplainedGaps: findUnexplainedGaps(history),
        // Shown early, so a clash is fixed before the hire step (employee emails must be unique).
        emailUsedByEmployee: full.convertedEmployeeId ? null : await employeeWithEmail(this.prisma, full.email),
        clearanceBlockers:
          full.stage === CandidateStage.VETTING
            ? clearanceBlockerItems({
                stage: full.stage,
                dataProcessingConsent: full.dataProcessingConsent,
                employmentHistory: history,
                checks: full.checks,
              })
            : [],
        stageBeforeClosing: this.stageBeforeClosing(full.stage, full.stageHistory),
        timeline: full.stageHistory.map((h) => ({
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

  async updateProfile(user: RequestUser, id: string, dto: UpdateCandidateDto) {
    const existing = await this.loadScoped(user, id);
    this.assertOpen(existing);
    const consentNow = dto.dataProcessingConsent === true && !existing.dataProcessingConsent;
    await this.prisma.candidate.update({
      where: { id },
      data: {
        ...dto,
        consentDate: consentNow ? dto.consentDate ?? new Date() : dto.consentDate,
        updatedById: user.id,
      },
    });
    return { message: 'Candidate updated', data: (await this.getById(user, id)).data };
  }

  async updateStage(user: RequestUser, id: string, dto: UpdateCandidateStageDto) {
    const candidate = await this.loadScoped(user, id);
    this.assertOpen(candidate);
    if (candidate.stage === dto.stage) {
      return { message: 'Stage unchanged', data: this.mapCandidate(candidate) };
    }

    const closing = CLOSED_STAGES.includes(dto.stage);
    const reason = dto.notes?.trim();
    if (closing && !reason) {
      throw new BadRequestException(`Give a reason for marking the candidate as ${STAGE_LABELS[dto.stage].toLowerCase()}.`);
    }

    const error = stageMoveError(candidate.stage, dto.stage, {
      hasRightToWork: candidate.hasRightToWork,
      hasPositiveInterview: candidate.interviews.some(
        (i) =>
          i.status === CandidateInterviewStatus.COMPLETED &&
          (i.recommendation === CandidateInterviewOutcome.HIRE || i.recommendation === CandidateInterviewOutcome.MAYBE),
      ),
      offerStatus: candidate.offerStatus,
      stageBeforeClosing: this.stageBeforeClosing(candidate.stage, candidate.stageHistory),
    });
    if (error) throw new BadRequestException(error);

    const data: Prisma.CandidateUpdateInput = {};
    if (closing) data.outcomeReason = reason;
    if (CLOSED_STAGES.includes(candidate.stage)) {
      data.outcomeReason = null;
      data.rejectionEmailedAt = null;
    }
    // Stepping back from "Cleared to start" undoes the sign-off.
    if (candidate.stage === CandidateStage.ACCEPTED) {
      data.clearedAt = null;
      data.clearedById = null;
      data.clearanceNotes = null;
    }
    // Stepping back to the offer: the candidate's reply is recorded again.
    if (candidate.stage === CandidateStage.VETTING && dto.stage === CandidateStage.OFFER) {
      data.offerStatus = CandidateOfferStatus.SENT;
      data.offerRespondedAt = null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.moveStage(tx, {
        candidateId: id,
        from: candidate.stage,
        to: dto.stage,
        userId: user.id,
        notes: dto.notes,
        data,
      });
      if (dto.stage === CandidateStage.VETTING) await this.ensureChecks(tx, row);
      return row;
    });

    await this.notifyStage(updated, dto.stage);
    const emailing = dto.stage === CandidateStage.REJECTED && dto.notifyCandidate === true && !!candidate.email;
    if (emailing) this.candidateEmails.sendRejectionInBackground(id, rejectionPoint(candidate.stage));
    return {
      message: emailing ? 'Candidate rejected — the candidate is being emailed' : 'Candidate stage updated',
      data: this.mapCandidate(updated),
    };
  }

  async updateScreening(user: RequestUser, id: string, dto: UpdateScreeningDto) {
    const candidate = await this.loadScoped(user, id);
    this.assertOpen(candidate);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.candidate.update({
        where: { id },
        data: { ...dto, updatedById: user.id },
      });
      if (row.stage === CandidateStage.VETTING) await this.ensureChecks(tx, row);
    });
    return { message: 'Screening saved', data: (await this.getById(user, id)).data };
  }

  async updateEmploymentHistory(user: RequestUser, id: string, dto: UpdateEmploymentHistoryDto) {
    const candidate = await this.loadScoped(user, id);
    this.assertOpen(candidate);
    const entries = dto.entries.map((e) => ({
      kind: e.kind,
      from: e.from,
      to: e.to ?? null,
      employer: e.employer?.trim() || null,
      jobTitle: e.jobTitle?.trim() || null,
      reasonForLeaving: e.reasonForLeaving?.trim() || null,
      careRole: e.careRole ?? null,
      explanation: e.explanation?.trim() || null,
    }));
    const errors = employmentHistoryErrors(entries);
    if (errors.length > 0) throw new BadRequestException(errors.join(' '));
    entries.sort((a, b) => a.from.localeCompare(b.from));
    await this.prisma.candidate.update({
      where: { id },
      data: { employmentHistory: entries, updatedById: user.id },
    });
    return { message: 'Employment history saved', data: (await this.getById(user, id)).data };
  }

  async createInterview(user: RequestUser, id: string, dto: CreateInterviewDto) {
    const candidate = await this.loadScoped(user, id);
    this.assertOpen(candidate);
    if (candidate.stage !== CandidateStage.SCREENING && candidate.stage !== CandidateStage.INTERVIEW) {
      throw new BadRequestException('Interviews are arranged after screening.');
    }
    const moving = candidate.stage === CandidateStage.SCREENING;
    if (moving) {
      const error = stageMoveError(CandidateStage.SCREENING, CandidateStage.INTERVIEW, {
        hasRightToWork: candidate.hasRightToWork,
        hasPositiveInterview: false,
        offerStatus: candidate.offerStatus,
        stageBeforeClosing: null,
      });
      if (error) throw new BadRequestException(error);
    }

    let interviewId = '';
    const moved = await this.prisma.$transaction(async (tx) => {
      const createdInterview = await tx.candidateInterview.create({
        data: {
          candidateId: id,
          scheduledAt: dto.scheduledAt,
          mode: dto.mode,
          location: dto.location?.trim() || null,
          interviewers: dto.interviewers?.trim() || null,
          createdById: user.id,
        },
      });
      interviewId = createdInterview.id;
      if (!moving) return null;
      return this.moveStage(tx, {
        candidateId: id,
        from: CandidateStage.SCREENING,
        to: CandidateStage.INTERVIEW,
        userId: user.id,
        // The time is shown on the interview itself (in the viewer's time zone), so the note stays plain.
        notes: 'Interview arranged',
      });
    });

    if (moved) await this.notifyStage(moved, CandidateStage.INTERVIEW);
    const emailing = dto.notifyCandidate !== false && !!candidate.email;
    if (emailing) this.interviewEmails.sendInBackground('INVITE', interviewId);
    return {
      message: emailing ? 'Interview arranged — the invitation is being emailed' : 'Interview arranged',
      data: (await this.getById(user, id)).data,
    };
  }

  async updateInterview(user: RequestUser, id: string, interviewId: string, dto: UpdateInterviewDto) {
    const candidate = await this.loadScoped(user, id);
    this.assertOpen(candidate);
    const interview = candidate.interviews.find((i) => i.id === interviewId);
    if (!interview) throw new NotFoundException('Interview not found');

    const status = dto.status ?? interview.status;
    const recommendation = dto.recommendation !== undefined ? dto.recommendation : interview.recommendation;
    if (status === CandidateInterviewStatus.COMPLETED && !recommendation) {
      throw new BadRequestException('Choose a recommendation to complete the interview.');
    }
    const completing = status === CandidateInterviewStatus.COMPLETED && interview.status !== CandidateInterviewStatus.COMPLETED;
    // What the candidate should hear about (only when asked to email them).
    const cancelling =
      status === CandidateInterviewStatus.CANCELLED && interview.status === CandidateInterviewStatus.SCHEDULED;
    const rescheduled =
      status === CandidateInterviewStatus.SCHEDULED &&
      interview.status === CandidateInterviewStatus.SCHEDULED &&
      ((dto.scheduledAt !== undefined && dto.scheduledAt.getTime() !== interview.scheduledAt.getTime()) ||
        (dto.mode !== undefined && dto.mode !== interview.mode) ||
        (dto.location !== undefined && (dto.location.trim() || null) !== interview.location));

    await this.prisma.candidateInterview.update({
      where: { id: interviewId },
      data: {
        scheduledAt: dto.scheduledAt,
        mode: dto.mode,
        location: dto.location !== undefined ? dto.location.trim() || null : undefined,
        interviewers: dto.interviewers !== undefined ? dto.interviewers.trim() || null : undefined,
        status,
        answers: dto.answers
          ? dto.answers.map((a) => ({ question: a.question, score: a.score ?? null, notes: a.notes?.trim() || null }))
          : undefined,
        recommendation,
        gapsDiscussed: dto.gapsDiscussed,
        notes: dto.notes !== undefined ? dto.notes.trim() || null : undefined,
        completedAt: completing ? new Date() : status === CandidateInterviewStatus.COMPLETED ? undefined : null,
        completedById: completing ? user.id : status === CandidateInterviewStatus.COMPLETED ? undefined : null,
        updatedById: user.id,
      },
    });
    const emailKind = cancelling ? 'CANCEL' : rescheduled ? 'UPDATE' : null;
    const emailing = !!emailKind && dto.notifyCandidate === true && !!candidate.email;
    if (emailing && emailKind) this.interviewEmails.sendInBackground(emailKind, interviewId);
    return {
      message: emailing ? 'Interview saved — the candidate is being emailed' : 'Interview saved',
      data: (await this.getById(user, id)).data,
    };
  }

  /** Email the candidate the interview details again (e.g. the first email failed or they lost it). Waits for the result. */
  async emailInterview(user: RequestUser, id: string, interviewId: string) {
    const candidate = await this.loadScoped(user, id);
    this.assertOpen(candidate);
    const interview = candidate.interviews.find((i) => i.id === interviewId);
    if (!interview) throw new NotFoundException('Interview not found');
    if (interview.status !== CandidateInterviewStatus.SCHEDULED) {
      throw new BadRequestException('Only a scheduled interview can be emailed.');
    }
    if (!candidate.email) throw new BadRequestException("Add the candidate's email address first (Application step).");
    const result = await this.interviewEmails.send('INVITE', interviewId);
    if (!result.sent) throw new BadRequestException(result.reason ?? 'The email could not be sent.');
    return { message: `Interview details emailed to ${candidate.email}`, data: (await this.getById(user, id)).data };
  }

  /** Make (or change) the conditional offer. From the interview step this also moves the candidate on. */
  async saveOffer(user: RequestUser, id: string, dto: SaveOfferDto) {
    const candidate = await this.loadScoped(user, id);
    this.assertOpen(candidate);
    const fromInterview = candidate.stage === CandidateStage.INTERVIEW;
    if (!fromInterview && candidate.stage !== CandidateStage.OFFER) {
      throw new BadRequestException('An offer is made after the interview.');
    }
    if (fromInterview) {
      const error = stageMoveError(CandidateStage.INTERVIEW, CandidateStage.OFFER, {
        hasRightToWork: candidate.hasRightToWork,
        hasPositiveInterview: candidate.interviews.some(
          (i) =>
            i.status === CandidateInterviewStatus.COMPLETED &&
            (i.recommendation === CandidateInterviewOutcome.HIRE || i.recommendation === CandidateInterviewOutcome.MAYBE),
        ),
        offerStatus: candidate.offerStatus,
        stageBeforeClosing: null,
      });
      if (error) throw new BadRequestException(error);
    }

    const data: Prisma.CandidateUpdateInput = {
      offerStatus: CandidateOfferStatus.SENT,
      offerStartDate: dto.startDate,
      offerHoursPerWeek: dto.hoursPerWeek?.trim() || null,
      offerPayRate: dto.payRate?.trim() || null,
      offerNotes: dto.notes?.trim() || null,
      offerSentAt: candidate.offerStatus === CandidateOfferStatus.SENT && candidate.offerSentAt ? candidate.offerSentAt : new Date(),
      offerRespondedAt: null,
      // The candidate has not seen these terms yet (set again once the email goes).
      offerEmailedAt: null,
    };
    await this.prisma.$transaction(async (tx) => {
      if (fromInterview) {
        await this.moveStage(tx, {
          candidateId: id,
          from: CandidateStage.INTERVIEW,
          to: CandidateStage.OFFER,
          userId: user.id,
          notes: 'Conditional offer made',
          data,
        });
      } else {
        await tx.candidate.update({ where: { id }, data: { ...data, updatedById: user.id } });
      }
    });
    const emailing = (dto.notifyCandidate ?? fromInterview) && !!candidate.email;
    if (emailing) this.candidateEmails.sendOfferInBackground(id, fromInterview ? 'OFFER' : 'UPDATE');
    return {
      message: emailing ? 'Offer saved — the candidate is being emailed' : 'Offer saved',
      data: (await this.getById(user, id)).data,
    };
  }

  /** Email the current offer to the candidate (again). Waits for the result. */
  async emailOffer(user: RequestUser, id: string) {
    const candidate = await this.loadScoped(user, id);
    this.assertOpen(candidate);
    if (candidate.stage !== CandidateStage.OFFER || candidate.offerStatus !== CandidateOfferStatus.SENT) {
      throw new BadRequestException('There is no offer waiting for a reply.');
    }
    if (!candidate.email) throw new BadRequestException("Add the candidate's email address first (Application step).");
    const result = await this.candidateEmails.sendOffer(id, 'OFFER');
    if (!result.sent) throw new BadRequestException(result.reason ?? 'The email could not be sent.');
    return { message: `Offer emailed to ${candidate.email}`, data: (await this.getById(user, id)).data };
  }

  async respondToOffer(user: RequestUser, id: string, dto: OfferResponseDto) {
    const candidate = await this.loadScoped(user, id);
    this.assertOpen(candidate);
    if (candidate.stage !== CandidateStage.OFFER || candidate.offerStatus !== CandidateOfferStatus.SENT) {
      throw new BadRequestException('There is no offer waiting for a reply.');
    }
    const notes = dto.notes?.trim() || null;
    const to = dto.accepted ? CandidateStage.VETTING : CandidateStage.WITHDRAWN;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.moveStage(tx, {
        candidateId: id,
        from: CandidateStage.OFFER,
        to,
        userId: user.id,
        notes: dto.accepted
          ? ['Offer accepted', notes].filter(Boolean).join(' — ')
          : ['Declined the offer', notes].filter(Boolean).join(' — '),
        data: {
          offerStatus: dto.accepted ? CandidateOfferStatus.ACCEPTED : CandidateOfferStatus.DECLINED,
          offerRespondedAt: new Date(),
          ...(dto.accepted ? {} : { outcomeReason: ['Declined the offer', notes].filter(Boolean).join(': ') }),
        },
      });
      if (dto.accepted) await this.ensureChecks(tx, row);
      return row;
    });

    await this.notifyStage(updated, to);
    return { message: dto.accepted ? 'Offer accepted' : 'Offer declined', data: (await this.getById(user, id)).data };
  }

  async updateCheck(user: RequestUser, id: string, checkId: string, dto: UpdateCheckDto) {
    const candidate = await this.loadScoped(user, id);
    this.assertOpen(candidate);
    if (candidate.stage !== CandidateStage.VETTING) {
      throw new BadRequestException(
        candidate.stage === CandidateStage.ACCEPTED
          ? 'The candidate is already cleared. Step back to the checks to change them.'
          : 'Checks are recorded once the candidate accepts the offer.',
      );
    }
    const check = candidate.checks.find((c) => c.id === checkId);
    if (!check) throw new NotFoundException('Check not found');

    const status = dto.status ?? check.status;
    const notes = dto.notes !== undefined ? dto.notes.trim() || null : check.notes;
    if ((status === CandidateCheckStatus.NOT_REQUIRED || status === CandidateCheckStatus.FAILED) && !notes) {
      throw new BadRequestException(
        status === CandidateCheckStatus.FAILED ? 'Say why the check failed.' : 'Say why this check is not needed.',
      );
    }
    const issueDate = dto.issueDate !== undefined ? dto.issueDate : check.issueDate;
    const expiryDate = dto.expiryDate !== undefined ? dto.expiryDate : check.expiryDate;
    if (issueDate && expiryDate && expiryDate < issueDate) {
      throw new BadRequestException('The expiry date is before the issue date.');
    }

    const now = new Date();
    const changed = status !== check.status;
    await this.prisma.candidateCheck.update({
      where: { id: checkId },
      data: {
        status,
        referenceNumber: dto.referenceNumber !== undefined ? dto.referenceNumber.trim() || null : undefined,
        provider: dto.provider !== undefined ? dto.provider.trim() || null : undefined,
        issueDate,
        expiryDate,
        notes,
        requestedAt: changed && status === CandidateCheckStatus.REQUESTED ? now : undefined,
        receivedAt: changed && status === CandidateCheckStatus.RECEIVED ? now : undefined,
        verifiedAt: changed ? (status === CandidateCheckStatus.VERIFIED ? now : null) : undefined,
        verifiedById: changed ? (status === CandidateCheckStatus.VERIFIED ? user.id : null) : undefined,
        updatedById: user.id,
      },
    });
    return { message: 'Check saved', data: (await this.getById(user, id)).data };
  }

  /** Manager sign-off: every check is satisfactory, so the candidate is fit and proper to start. */
  async clear(user: RequestUser, id: string, dto: ClearCandidateDto) {
    const candidate = await this.loadScoped(user, id);
    this.assertOpen(candidate);
    const blockers = clearanceBlockers({
      stage: candidate.stage,
      dataProcessingConsent: candidate.dataProcessingConsent,
      employmentHistory: parseEmploymentHistory(candidate.employmentHistory),
      checks: candidate.checks,
    });
    if (blockers.length > 0) throw new BadRequestException(blockers.join(' '));

    const notes = dto.notes?.trim() || null;
    const updated = await this.prisma.$transaction((tx) =>
      this.moveStage(tx, {
        candidateId: id,
        from: CandidateStage.VETTING,
        to: CandidateStage.ACCEPTED,
        userId: user.id,
        notes: ['Cleared to start — all checks satisfactory', notes].filter(Boolean).join(': '),
        data: { clearedAt: new Date(), clearedById: user.id, clearanceNotes: notes },
      }),
    );
    await this.notifyStage(updated, CandidateStage.ACCEPTED);
    return { message: 'Candidate cleared to start', data: (await this.getById(user, id)).data };
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
      stage: { in: FLOW_STAGES },
      ...candidateScope,
      ...(vacancyId ? { vacancyId } : {}),
    };

    const rows = await this.prisma.candidate.findMany({
      where,
      include: { vacancy: vacancySelect },
      orderBy: { updatedAt: 'desc' },
    });

    const columns = FLOW_STAGES.map((stage) => ({
      stage,
      candidates: rows.filter((r) => r.stage === stage).map((r) => this.mapCandidate(r)),
    }));

    return { data: { columns } };
  }
}

@Injectable()
export class CandidateConversionService {
  private readonly logger = new Logger(CandidateConversionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly personalDetailsService: EmployeePersonalDetailsService,
    private readonly employmentService: EmployeeEmploymentService,
    private readonly hrProfileService: HrProfileService,
    private readonly complianceService: EmployeeComplianceService,
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

  /**
   * Copies each verified check onto the new employee's compliance record (with its evidence files),
   * so the checks are not entered twice. Returns the checks that could not be copied.
   */
  private async transferChecks(userId: string, candidateId: string, employeeId: string) {
    const checks = await this.prisma.candidateCheck.findMany({
      where: { candidateId, status: CandidateCheckStatus.VERIFIED },
      include: { documents: { where: { deletedAt: null } } },
    });
    const codes = [...new Set(checks.flatMap((c) => CHECK_COMPLIANCE_CODES[c.type]))];
    const types = codes.length
      ? await this.prisma.complianceType.findMany({
          where: { code: { in: codes }, deletedAt: null },
          select: { id: true, code: true },
        })
      : [];

    const transferred: string[] = [];
    const notTransferred: string[] = [];
    for (const check of checks) {
      const label = CHECK_LABELS[check.type];
      const type = CHECK_COMPLIANCE_CODES[check.type]
        .map((code) => types.find((t) => t.code === code))
        .find(Boolean);
      if (!type) {
        notTransferred.push(label);
        continue;
      }
      try {
        const notes = [
          'From recruitment checks',
          check.referenceNumber ? `Ref: ${check.referenceNumber}` : null,
          check.provider,
          check.notes,
        ]
          .filter(Boolean)
          .join(' · ');
        const created = await this.complianceService.create(userId, employeeId, {
          complianceTypeId: type.id,
          issueDate: check.issueDate ?? undefined,
          expiryDate: check.expiryDate ?? undefined,
          notes,
        });
        if (check.documents.length > 0) {
          await this.prisma.employeeComplianceDocument.createMany({
            data: check.documents.map((d) => ({
              employeeComplianceId: created.data.id,
              fileName: d.fileName,
              originalName: d.fileName,
              fileUrl: d.fileUrl,
              fileSize: d.fileSize,
              mimeType: d.mimeType,
              uploadedById: d.uploadedById,
            })),
          });
        }
        await this.complianceService.verify(userId, employeeId, created.data.id, 'Verified during recruitment');
        transferred.push(label);
      } catch (err) {
        this.logger.warn(`Could not copy check ${check.type} for candidate ${candidateId}: ${String(err)}`);
        notTransferred.push(label);
      }
    }
    return { transferred, notTransferred };
  }

  /**
   * The candidate's own documents (CV, ID, certificates, ...) go to the employee's HR documents.
   * Check evidence is not copied here: transferChecks puts it on the compliance record.
   * Never fails the hire; returns how many were copied.
   */
  private async copyDocuments(userId: string, candidateId: string, employeeId: string): Promise<number> {
    const types: Record<CandidateDocumentType, { type: HrDocumentType; label: string }> = {
      CV: { type: HrDocumentType.OTHER, label: 'CV' },
      CERTIFICATE: { type: HrDocumentType.CERTIFICATE, label: 'Certificate' },
      ID_DOCUMENT: { type: HrDocumentType.ID_DOCUMENT, label: 'ID document' },
      OFFER_LETTER: { type: HrDocumentType.OTHER, label: 'Offer letter' },
      CHECK_EVIDENCE: { type: HrDocumentType.OTHER, label: 'Check evidence' },
      OTHER: { type: HrDocumentType.OTHER, label: 'Document' },
    };
    try {
      const docs = await this.prisma.candidateDocument.findMany({
        where: { candidateId, deletedAt: null, checkId: null, status: { not: CandidateDocumentStatus.REJECTED } },
        orderBy: { createdAt: 'asc' },
      });
      if (docs.length === 0) return 0;
      const { count } = await this.prisma.employeeDocument.createMany({
        data: docs.map((d) => ({
          employeeId,
          name: `${types[d.documentType].label} — ${d.fileName}`.slice(0, 250),
          description: 'Copied from recruitment',
          fileUrl: d.fileUrl,
          fileName: d.fileName,
          fileSize: d.fileSize,
          mimeType: d.mimeType,
          uploadedById: d.uploadedById,
          uploadedDate: d.createdAt,
          documentType: types[d.documentType].type,
          status: d.status === CandidateDocumentStatus.ACCEPTED ? HrDocumentStatus.APPROVED : HrDocumentStatus.PENDING,
          tags: ['hr', 'recruitment'],
          createdById: userId,
        })),
      });
      return count;
    } catch (err) {
      this.logger.warn(`Could not copy documents for candidate ${candidateId}: ${String(err)}`);
      return 0;
    }
  }

  async convert(user: RequestUser, candidateId: string, dto: ConvertCandidateDto = {}) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id: candidateId, deletedAt: null },
      include: { vacancy: true },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');
    if (candidate.convertedEmployeeId) {
      throw new ConflictException('Candidate has already been converted to an employee');
    }
    if (candidate.stage !== CandidateStage.ACCEPTED || !candidate.clearedAt) {
      throw new BadRequestException('The candidate must be cleared to start before they can be hired.');
    }
    if (!candidate.dataProcessingConsent) {
      throw new BadRequestException('Data processing consent is required before conversion');
    }

    const startDate = dto.startDate ?? candidate.offerStartDate ?? new Date();

    // Employee emails are unique: check before creating anything, with a clear way forward.
    const email = dto.email?.trim().toLowerCase() || candidate.email?.trim() || null;
    const clash = await employeeWithEmail(this.prisma, email);
    if (clash) {
      throw new ConflictException(
        `${email} is already used by employee ${clash.name}. Enter a different email for the new employee record.`,
      );
    }

    const username = await this.deriveUsername(
      this.prisma,
      candidate.firstName,
      candidate.lastName,
      email,
    );

    const createResult = await this.employeesService.create(user.id, {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      username,
      email: email ?? undefined,
    });

    const employeeId = createResult.data.id;

    await this.personalDetailsService.update(user.id, employeeId, {
      dateOfBirth: candidate.dateOfBirth ?? undefined,
      addressLine1: candidate.address ?? undefined,
      mobileTelephone: candidate.phone ?? undefined,
      email: email ?? undefined,
    });

    const contractTypeId = await resolveContractTypeIdForRecruitmentType(
      this.prisma,
      candidate.vacancy.employmentType,
    );

    await this.employmentService.update(user.id, employeeId, {
      jobTitleId: candidate.vacancy.jobTitleId ?? undefined,
      locationId: candidate.vacancy.locationId ?? undefined,
      contractTypeId: contractTypeId ?? undefined,
      startDate,
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
      });

      await tx.candidateStageHistory.create({
        data: {
          candidateId,
          fromStage: CandidateStage.ACCEPTED,
          toStage: CandidateStage.ACCEPTED,
          changedById: user.id,
          notes: `Hired — employee record created, starting ${startDate.toISOString().slice(0, 10)}`,
        },
      });

      return row;
    });

    const checks = await this.transferChecks(user.id, candidateId, employeeId);
    const documentsCopied = await this.copyDocuments(user.id, candidateId, employeeId);

    return {
      message: 'Candidate converted to employee',
      data: {
        employeeId,
        checksCopied: checks.transferred,
        checksNotCopied: checks.notTransferred,
        documentsCopied,
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
