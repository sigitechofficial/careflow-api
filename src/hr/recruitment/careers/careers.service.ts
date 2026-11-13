import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CandidateDocumentType, CandidateSource, CandidateStage, VacancyStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../../mail/mail.service';
import { CompanyProfileService } from '../../../company-profile/company-profile.service';
import { RecruitmentNotificationHook } from '../recruitment-notification.hook';
import { formatVacancyReference } from '../utils/recruitment-reference.util';
import { ApplyForVacancyDto } from './dto/apply-for-vacancy.dto';

const openVacancyInclude = {
  location: { select: { name: true } },
  jobTitle: { select: { name: true } },
} as const;

type OpenVacancyRow = {
  id: string;
  recordNo: number;
  title: string;
  employmentType: string;
  description: string | null;
  requirements: string | null;
  salaryRange: string | null;
  salaryPeriod: string | null;
  closingDate: Date | null;
  numberOfPositions: number;
  createdAt: Date;
  location: { name: string } | null;
  jobTitle: { name: string } | null;
};

/**
 * A vacancy takes applications while it is OPEN and its closing date (inclusive) has not passed.
 * Closing dates are whole days, so compare with the start of today (UTC).
 */
function openForApplications() {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    status: VacancyStatus.OPEN,
    deletedAt: null,
    isActive: true,
    OR: [{ closingDate: null }, { closingDate: { gte: today } }],
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The public careers page: open vacancies anyone can read, and the application form.
 * An application becomes a candidate at the Application step (source: Website).
 */
@Injectable()
export class CareersService {
  private readonly logger = new Logger(CareersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: RecruitmentNotificationHook,
    private readonly mail: MailService,
    private readonly company: CompanyProfileService,
  ) {}

  /** Only what an applicant should see (no hiring manager, no candidate counts). */
  private mapPublic(row: OpenVacancyRow) {
    return {
      id: row.id,
      reference: formatVacancyReference(row.recordNo),
      title: row.title,
      jobTitle: row.jobTitle?.name ?? null,
      location: row.location?.name ?? null,
      employmentType: row.employmentType,
      salaryRange: row.salaryRange,
      salaryPeriod: row.salaryPeriod,
      closingDate: row.closingDate ? row.closingDate.toISOString().slice(0, 10) : null,
      numberOfPositions: row.numberOfPositions,
      description: row.description,
      requirements: row.requirements,
      postedAt: row.createdAt,
    };
  }

  async listOpen() {
    const rows = await this.prisma.vacancy.findMany({
      where: openForApplications(),
      include: openVacancyInclude,
      orderBy: { createdAt: 'desc' },
    });
    return { data: rows.map((r) => this.mapPublic(r)) };
  }

  async getOpen(id: string) {
    const row = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.vacancy.findFirst({
          where: { id, ...openForApplications() },
          include: openVacancyInclude,
        })
      : null;
    if (!row) throw new NotFoundException('This job is no longer open for applications.');
    return { data: this.mapPublic(row) };
  }

  async apply(
    vacancyId: string,
    dto: ApplyForVacancyDto,
    file: Express.Multer.File | undefined,
    fileUrl: string | null,
  ) {
    // Bots fill in every field, including the hidden one; people never see it. Pretend it worked.
    if (dto.website?.trim()) {
      this.logger.warn(`Careers: application to ${vacancyId} dropped by the spam check`);
      return { message: 'Application received', data: { reference: null } };
    }

    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id: vacancyId, ...openForApplications() },
      select: { id: true, title: true, recordNo: true, hiringManagerId: true },
    });
    if (!vacancy) throw new NotFoundException('This job is no longer open for applications.');

    const email = dto.email.trim().toLowerCase();
    const already = await this.prisma.candidate.findFirst({
      where: {
        vacancyId,
        deletedAt: null,
        email: { equals: email, mode: 'insensitive' },
        stage: { notIn: [CandidateStage.REJECTED, CandidateStage.WITHDRAWN] },
      },
      select: { id: true },
    });
    if (already) {
      throw new ConflictException('You have already applied for this job. We will be in touch.');
    }
    if (dto.consent !== true) {
      throw new BadRequestException('Please agree to us using your details for your application.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.candidate.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email,
          phone: dto.phone,
          address: dto.address ?? null,
          vacancyId,
          source: CandidateSource.WEBSITE,
          stage: CandidateStage.APPLIED,
          coverLetter: dto.coverLetter ?? null,
          cvFileUrl: fileUrl,
          hasRightToWork: dto.hasRightToWork,
          drivesForWork: dto.drivesForWork ?? null,
          dataProcessingConsent: true,
          consentDate: new Date(),
        },
      });
      await tx.candidateStageHistory.create({
        data: {
          candidateId: candidate.id,
          fromStage: null,
          toStage: CandidateStage.APPLIED,
          notes: 'Applied online (careers page)',
        },
      });
      if (file && fileUrl) {
        await tx.candidateDocument.create({
          data: {
            candidateId: candidate.id,
            documentType: CandidateDocumentType.CV,
            fileUrl,
            // The applicant's own file name (the stored name is in fileUrl).
            fileName: file.originalname.slice(0, 200),
            fileSize: file.size,
            mimeType: file.mimetype,
            reviewNotes: `Uploaded by the applicant: ${file.originalname}`,
          },
        });
      }
      return candidate;
    });

    await this.notifications.onApplicationReceived({
      candidateId: created.id,
      candidateName: `${created.firstName} ${created.lastName}`,
      vacancyTitle: vacancy.title,
      hiringManagerId: vacancy.hiringManagerId,
    });
    // In the background: the applicant gets their answer straight away, even when email is slow.
    void this.sendConfirmation(created.firstName, email, vacancy.title, formatVacancyReference(vacancy.recordNo));

    return { message: 'Application received', data: { reference: formatVacancyReference(vacancy.recordNo) } };
  }

  /** "Thank you for applying" — never fails the application if email is down. Also used by the recruitment inbox. */
  async sendConfirmation(firstName: string, email: string, jobTitle: string, reference: string) {
    try {
      const brand = (await this.company.getBranding()).data;
      const org = brand.displayName || brand.companyName || 'our team';
      const subject = `We have received your application — ${jobTitle}`;
      const lines = [
        `Hello ${firstName},`,
        '',
        `Thank you for applying for ${jobTitle} (${reference}) with ${org}.`,
        'We will look at your application and contact you about the next steps.',
        '',
        'If you have any questions, just reply to this email.',
        '',
        `${org}`,
      ];
      await this.mail.send({
        to: email,
        subject,
        text: lines.join('\n'),
        html: lines.map((l) => (l ? `<p>${escapeHtml(l)}</p>` : '')).join(''),
        // No skipBcc: recruitment emails are copied to MAIL_BCC (the office keeps a copy).
      });
    } catch (err) {
      this.logger.warn(`Careers: confirmation email failed (${err instanceof Error ? err.name : 'error'})`);
    }
  }
}
