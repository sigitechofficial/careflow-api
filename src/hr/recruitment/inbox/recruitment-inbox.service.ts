import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  CandidateDocumentType,
  CandidateSource,
  CandidateStage,
  Prisma,
  RecruitmentEmailStatus,
  VacancyStatus,
  type ReferralMailbox,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../../../prisma/prisma.service';
import { uploadPath } from '../../../common/utils/upload-path.util';
import type { RequestUser } from '../../../common/decorators/current-user.decorator';
import type { FetchedEmail } from '../../../referral-mailbox/connectors/connector.types';
import { DOCX_MIME, MAX_ATTACHMENT_BYTES, docxToText } from '../../../referral-mailbox/referral-email-parse.util';
import type { ExtractionAttachment } from '../../../referral-mailbox/referral-extraction.service';
import { CandidatesService } from '../candidates/candidates.service';
import { CareersService } from '../careers/careers.service';
import { formatVacancyReference } from '../utils/recruitment-reference.util';
import { RecruitmentExtractionService } from './recruitment-extraction.service';
import { historyFromExtraction, splitName, yesNoToBool, type ApplicationExtraction } from './recruitment-inbox.util';
import type { CreateCandidateFromEmailDto } from './recruitment-inbox.dto';

/**
 * Email attachments live in the uploads folder (the shared, persistent volume on Azure), in an area the public
 * /uploads routes refuse to serve (main.ts): staff get them only through the signed-in attachment route.
 */
export const RECRUITMENT_UPLOAD_AREA = 'recruitment-mailbox';
const STORAGE_ROOT = uploadPath(RECRUITMENT_UPLOAD_AREA);
/** Candidate documents live here (same place as files staff upload on the candidate). */
const CANDIDATE_UPLOAD_ROOT = uploadPath('recruitment', 'candidates');

type StoredAttachment = { fileName: string; mimeType: string; size: number; storedName: string | null; skippedReason?: string };

/** Tabs of the inbox: waiting for staff, made into candidates, and set aside. */
const TAB_STATUSES: Record<string, RecruitmentEmailStatus[]> = {
  open: [RecruitmentEmailStatus.RECEIVED, RecruitmentEmailStatus.READ, RecruitmentEmailStatus.FAILED],
  created: [RecruitmentEmailStatus.CANDIDATE_CREATED],
  closed: [RecruitmentEmailStatus.NOT_AN_APPLICATION, RecruitmentEmailStatus.DISMISSED],
};

/**
 * Job applications that arrive by email (a mailbox connected for Recruitment). Each email is saved with its
 * attachments, Claude reads the applicant's details and CV, and staff turn it into a candidate in one step.
 */
@Injectable()
export class RecruitmentInboxService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RecruitmentInboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: RecruitmentExtractionService,
    private readonly candidates: CandidatesService,
    private readonly careers: CareersService,
  ) {}

  /* ─── saving and reading (called by the mailbox checker) ─── */

  /** Message ids of this mailbox already saved (so a check skips them). */
  async savedIds(mailboxId: string, providerMessageIds: string[]): Promise<Set<string>> {
    const rows = await this.prisma.recruitmentEmail.findMany({
      where: { mailboxId, providerMessageId: { in: providerMessageIds } },
      select: { providerMessageId: true },
    });
    return new Set(rows.map((r) => r.providerMessageId));
  }

  /** Save one email and its attachments. Returns the id to read, or null (our own sent email, or already saved). */
  async save(mb: ReferralMailbox, email: FetchedEmail): Promise<string | null> {
    if (email.fromEmail && email.fromEmail.toLowerCase() === mb.emailAddress.toLowerCase()) return null;
    const exists = await this.prisma.recruitmentEmail.findUnique({
      where: { mailboxId_providerMessageId: { mailboxId: mb.id, providerMessageId: email.providerMessageId } },
      select: { id: true },
    });
    if (exists) return null;
    const id = randomUUID();
    const dir = path.join(STORAGE_ROOT, id);
    const attachments: StoredAttachment[] = [];
    for (const a of email.attachments) {
      if (a.size > MAX_ATTACHMENT_BYTES) {
        attachments.push({ fileName: a.fileName, mimeType: a.mimeType, size: a.size, storedName: null, skippedReason: 'Over 20 MB' });
        continue;
      }
      const data = a.data ?? (a.load ? await a.load().catch(() => null) : null);
      if (!data) {
        attachments.push({ fileName: a.fileName, mimeType: a.mimeType, size: a.size, storedName: null, skippedReason: 'Could not be downloaded' });
        continue;
      }
      await fs.mkdir(dir, { recursive: true });
      const storedName = `${randomUUID()}${path.extname(a.fileName).slice(0, 10)}`;
      await fs.writeFile(path.join(dir, storedName), data);
      attachments.push({ fileName: a.fileName, mimeType: a.mimeType, size: data.length, storedName });
    }
    await this.prisma.recruitmentEmail.create({
      data: {
        id,
        mailboxId: mb.id,
        providerMessageId: email.providerMessageId,
        providerThreadId: email.threadKey,
        fromName: email.fromName,
        fromEmail: email.fromEmail,
        subject: email.subject,
        receivedAt: email.receivedAt,
        bodyText: email.bodyText,
        attachments: attachments as unknown as Prisma.InputJsonValue,
      },
    });
    return id;
  }

  /** Claude reads in the background so a mailbox check returns straight away. */
  readInBackground(ids: string[]) {
    void (async () => {
      for (const id of ids) {
        await this.read(id).catch((e: Error) => this.logger.warn(`Reading application email ${id} failed: ${e.message}`));
      }
    })();
  }

  /** Emails left unread when the API stopped (a few minutes' grace in case another process is reading them). */
  async onApplicationBootstrap() {
    const pending = await this.prisma.recruitmentEmail
      .findMany({
        where: { status: RecruitmentEmailStatus.RECEIVED, updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
        select: { id: true },
        take: 20,
      })
      .catch(() => []);
    if (pending.length) this.readInBackground(pending.map((p) => p.id));
  }

  private async attachmentInputs(row: { id: string; attachments: Prisma.JsonValue }): Promise<ExtractionAttachment[]> {
    const inputs: ExtractionAttachment[] = [];
    for (const f of (row.attachments as unknown as StoredAttachment[]) ?? []) {
      if (!f.storedName) continue;
      const data = await fs.readFile(path.join(STORAGE_ROOT, row.id, f.storedName));
      const text =
        f.mimeType === DOCX_MIME
          ? await docxToText(data).catch(() => '')
          : f.mimeType.startsWith('text/')
            ? data.toString('utf8')
            : undefined;
      inputs.push({ fileName: f.fileName, mimeType: f.mimeType, data, text });
    }
    return inputs;
  }

  private async openVacancies() {
    const rows = await this.prisma.vacancy.findMany({
      where: { status: VacancyStatus.OPEN, deletedAt: null },
      select: { id: true, recordNo: true, title: true, location: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((v) => ({ id: v.id, reference: formatVacancyReference(v.recordNo), title: v.title, location: v.location?.name ?? null }));
  }

  /** Claude reads the email and CV (also "Read again"). */
  async read(id: string) {
    const row = await this.prisma.recruitmentEmail.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Email not found');
    try {
      const result = await this.extraction.extract({
        subject: row.subject,
        fromName: row.fromName,
        fromEmail: row.fromEmail,
        receivedAt: row.receivedAt,
        bodyText: row.bodyText,
        attachments: await this.attachmentInputs(row),
        vacancies: await this.openVacancies(),
      });
      await this.prisma.recruitmentEmail.update({
        where: { id },
        data: {
          extraction: result.extraction as unknown as Prisma.InputJsonValue,
          extractionModel: result.model,
          extractionCostUsd: (row.extractionCostUsd ?? 0) + result.costUsd,
          error: null,
          readAttempts: 0,
          // A candidate already made from it, or set aside by staff, stays where it is.
          status:
            row.status === RecruitmentEmailStatus.CANDIDATE_CREATED || row.status === RecruitmentEmailStatus.DISMISSED
              ? row.status
              : result.extraction.isApplication
                ? RecruitmentEmailStatus.READ
                : RecruitmentEmailStatus.NOT_AN_APPLICATION,
        },
      });
    } catch (e) {
      await this.prisma.recruitmentEmail.update({
        where: { id },
        data: { status: RecruitmentEmailStatus.FAILED, error: ((e as Error).message ?? 'Reading failed').slice(0, 2000), readAttempts: row.readAttempts + 1 },
      });
      throw e;
    }
    return this.get(id);
  }

  /* ─── the inbox screen ─── */

  async list(tab = 'open') {
    const statuses = TAB_STATUSES[tab] ?? TAB_STATUSES.open;
    const [rows, counts] = await Promise.all([
      this.prisma.recruitmentEmail.findMany({
        where: { status: { in: statuses } },
        orderBy: { receivedAt: 'desc' },
        take: 200,
        select: {
          id: true,
          fromName: true,
          fromEmail: true,
          subject: true,
          receivedAt: true,
          status: true,
          extraction: true,
          attachments: true,
          candidateId: true,
        },
      }),
      this.prisma.recruitmentEmail.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const countOf = (s: RecruitmentEmailStatus[]) =>
      counts.filter((c) => s.includes(c.status)).reduce((sum, c) => sum + c._count._all, 0);
    return {
      data: rows.map((r) => {
        const x = r.extraction as unknown as ApplicationExtraction | null;
        const name = x ? `${x.firstName} ${x.lastName}`.trim() : '';
        return {
          id: r.id,
          fromName: r.fromName,
          fromEmail: r.fromEmail,
          subject: r.subject,
          receivedAt: r.receivedAt,
          status: r.status,
          applicantName: name || r.fromName || r.fromEmail || 'Unknown sender',
          summary: x?.summary ?? null,
          attachmentCount: ((r.attachments as unknown as StoredAttachment[]) ?? []).length,
          candidateId: r.candidateId,
        };
      }),
      meta: { counts: { open: countOf(TAB_STATUSES.open), created: countOf(TAB_STATUSES.created), closed: countOf(TAB_STATUSES.closed) } },
    };
  }

  async get(id: string) {
    const row = await this.prisma.recruitmentEmail.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Email not found');
    const x = row.extraction as unknown as ApplicationExtraction | null;
    const fromName = splitName(row.fromName);
    const email = (x?.email || row.fromEmail || '').trim();
    const history = historyFromExtraction(x?.employmentHistory);

    // Already known? A candidate (any vacancy) or an employee with this email.
    const [candidates, employee, candidate] = await Promise.all([
      email
        ? this.prisma.candidate.findMany({
            where: { deletedAt: null, email: { equals: email, mode: 'insensitive' } },
            select: { id: true, firstName: true, lastName: true, stage: true, vacancy: { select: { title: true } } },
            orderBy: { createdAt: 'desc' },
            take: 5,
          })
        : [],
      email
        ? this.prisma.employeePersonalDetail.findFirst({
            where: { email: { equals: email, mode: 'insensitive' }, employee: { deletedAt: null } },
            select: { employeeId: true, firstName: true, lastName: true },
          })
        : null,
      row.candidateId
        ? this.prisma.candidate.findUnique({ where: { id: row.candidateId }, select: { id: true, firstName: true, lastName: true } })
        : null,
    ]);

    return {
      data: {
        id: row.id,
        status: row.status,
        fromName: row.fromName,
        fromEmail: row.fromEmail,
        subject: row.subject,
        receivedAt: row.receivedAt,
        bodyText: row.bodyText,
        error: row.error,
        extractionCostUsd: row.extractionCostUsd,
        attachments: ((row.attachments as unknown as StoredAttachment[]) ?? []).map((a, index) => ({
          index,
          fileName: a.fileName,
          mimeType: a.mimeType,
          size: a.size,
          available: Boolean(a.storedName),
          skippedReason: a.skippedReason ?? null,
        })),
        extraction: x,
        /** The form, filled from what Claude read (staff check it before creating the candidate). */
        draft: {
          firstName: x?.firstName || fromName.firstName,
          lastName: x?.lastName || fromName.lastName,
          email,
          phone: x?.phone ?? '',
          address: x?.address ?? '',
          vacancyId: x?.vacancyId ?? '',
          hasRightToWork: yesNoToBool(x?.rightToWork),
          drivesForWork: yesNoToBool(x?.drivesForWork),
          coverLetter: x?.coverLetter ?? '',
          cvFileName: x?.cvFileName ?? '',
        },
        employmentHistory: history.entries,
        incompleteHistoryRows: history.incomplete,
        existingCandidates: candidates.map((c) => ({
          id: c.id,
          name: `${c.firstName} ${c.lastName}`.trim(),
          stage: c.stage,
          vacancyTitle: c.vacancy?.title ?? null,
        })),
        existingEmployee: employee
          ? { employeeId: employee.employeeId, name: `${employee.firstName} ${employee.lastName}`.trim() }
          : null,
        candidate: candidate ? { id: candidate.id, name: `${candidate.firstName} ${candidate.lastName}`.trim() } : null,
      },
    };
  }

  async attachmentFile(id: string, index: number) {
    const row = await this.prisma.recruitmentEmail.findUnique({ where: { id }, select: { id: true, attachments: true } });
    const f = ((row?.attachments as unknown as StoredAttachment[]) ?? [])[index];
    if (!row || !f?.storedName) throw new NotFoundException('Attachment not found');
    return { path: path.join(STORAGE_ROOT, row.id, f.storedName), fileName: f.fileName, mimeType: f.mimeType };
  }

  /* ─── staff actions ─── */

  /**
   * Create the candidate (Application step) from the checked form: their CV and other attachments go to the
   * candidate's documents, the employment history from the CV is filled in, and they are told we received it.
   */
  async createCandidate(user: RequestUser, id: string, dto: CreateCandidateFromEmailDto) {
    const row = await this.prisma.recruitmentEmail.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Email not found');
    if (row.status === RecruitmentEmailStatus.CANDIDATE_CREATED && row.candidateId) {
      throw new ConflictException('A candidate has already been created from this email.');
    }
    const email = dto.email?.trim().toLowerCase() || null;
    if (email) {
      const already = await this.prisma.candidate.findFirst({
        where: {
          vacancyId: dto.vacancyId,
          deletedAt: null,
          email: { equals: email, mode: 'insensitive' },
          stage: { notIn: [CandidateStage.REJECTED, CandidateStage.WITHDRAWN] },
        },
        select: { id: true },
      });
      if (already) throw new ConflictException('This person is already a candidate for that vacancy.');
    }

    const created = await this.candidates.create(user, {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email: email ?? undefined,
      phone: dto.phone?.trim() || undefined,
      address: dto.address?.trim() || undefined,
      vacancyId: dto.vacancyId,
      source: CandidateSource.EMAIL,
      coverLetter: dto.coverLetter?.trim() || undefined,
      // They applied by email, so no consent was given yet: it is asked for before hiring, as always.
      dataProcessingConsent: false,
    });
    const candidateId = created.data.id;

    const x = row.extraction as unknown as ApplicationExtraction | null;
    const history = dto.includeEmploymentHistory === false ? [] : historyFromExtraction(x?.employmentHistory).entries;
    await this.prisma.candidate.update({
      where: { id: candidateId },
      data: {
        hasRightToWork: dto.hasRightToWork ?? null,
        drivesForWork: dto.drivesForWork ?? null,
        ...(history.length ? { employmentHistory: history as unknown as Prisma.InputJsonValue } : {}),
        updatedById: user.id,
      },
    });

    const copied = await this.copyAttachments(user, row, candidateId, dto.attachmentIndexes, dto.cvFileName ?? x?.cvFileName ?? '');

    await this.prisma.recruitmentEmail.update({
      where: { id },
      data: { status: RecruitmentEmailStatus.CANDIDATE_CREATED, candidateId, handledById: user.id, handledAt: new Date() },
    });

    // "We have received your application", like the careers page (a copy goes to the office).
    if (email) {
      const vacancy = await this.prisma.vacancy.findUnique({ where: { id: dto.vacancyId }, select: { title: true, recordNo: true } });
      if (vacancy) {
        void this.careers.sendConfirmation(dto.firstName.trim(), email, vacancy.title, formatVacancyReference(vacancy.recordNo));
      }
    }

    return {
      message: 'Candidate created',
      data: { candidateId, documentsCopied: copied, historyRows: history.length, emailed: Boolean(email) },
    };
  }

  /** Copies the chosen attachments (all by default) to the candidate's documents; the CV is marked as the CV. */
  private async copyAttachments(
    user: RequestUser,
    row: { id: string; attachments: Prisma.JsonValue },
    candidateId: string,
    indexes: number[] | undefined,
    cvFileName: string,
  ): Promise<number> {
    const files = (row.attachments as unknown as StoredAttachment[]) ?? [];
    const chosen = files
      .map((f, i) => ({ f, i }))
      .filter(({ f, i }) => f.storedName && (!indexes || indexes.includes(i)));
    if (!chosen.length) return 0;
    await fs.mkdir(CANDIDATE_UPLOAD_ROOT, { recursive: true });
    const isCv = (name: string) =>
      cvFileName ? name.toLowerCase() === cvFileName.toLowerCase() : /\bcv\b|resume|résumé|curriculum/i.test(name);
    let cvUrl: string | null = null;
    let count = 0;
    for (const { f } of chosen) {
      try {
        const stored = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.fileName).slice(0, 10).toLowerCase()}`;
        await fs.copyFile(path.join(STORAGE_ROOT, row.id, f.storedName!), path.join(CANDIDATE_UPLOAD_ROOT, stored));
        const fileUrl = `/uploads/recruitment/candidates/${stored}`;
        const cv = !cvUrl && isCv(f.fileName);
        await this.prisma.candidateDocument.create({
          data: {
            candidateId,
            documentType: cv ? CandidateDocumentType.CV : CandidateDocumentType.OTHER,
            fileUrl,
            fileName: f.fileName.slice(0, 200),
            fileSize: f.size,
            mimeType: f.mimeType,
            reviewNotes: 'From the applicant\'s email (recruitment inbox)',
            uploadedById: user.id,
            createdById: user.id,
          },
        });
        if (cv) cvUrl = fileUrl;
        count += 1;
      } catch (err) {
        this.logger.warn(`Could not copy ${f.fileName} to candidate ${candidateId}: ${(err as Error).message}`);
      }
    }
    if (cvUrl) await this.prisma.candidate.update({ where: { id: candidateId }, data: { cvFileUrl: cvUrl } });
    return count;
  }

  async dismiss(user: RequestUser, id: string) {
    const row = await this.prisma.recruitmentEmail.findUnique({ where: { id }, select: { status: true } });
    if (!row) throw new NotFoundException('Email not found');
    if (row.status === RecruitmentEmailStatus.CANDIDATE_CREATED) {
      throw new BadRequestException('A candidate was created from this email; it cannot be dismissed.');
    }
    await this.prisma.recruitmentEmail.update({
      where: { id },
      data: { status: RecruitmentEmailStatus.DISMISSED, handledById: user.id, handledAt: new Date() },
    });
    return { message: 'Email dismissed' };
  }

  /** Back to the inbox (dismissed or "not an application" by mistake). */
  async reopen(id: string) {
    const row = await this.prisma.recruitmentEmail.findUnique({ where: { id }, select: { status: true, extraction: true } });
    if (!row) throw new NotFoundException('Email not found');
    if (row.status !== RecruitmentEmailStatus.DISMISSED && row.status !== RecruitmentEmailStatus.NOT_AN_APPLICATION) {
      throw new BadRequestException('Only dismissed emails can be moved back to the inbox.');
    }
    await this.prisma.recruitmentEmail.update({
      where: { id },
      data: { status: row.extraction ? RecruitmentEmailStatus.READ : RecruitmentEmailStatus.RECEIVED, handledById: null, handledAt: null },
    });
    return { message: 'Moved back to the inbox' };
  }
}
