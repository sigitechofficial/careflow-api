import { Injectable, Logger } from '@nestjs/common';
import { CandidateSource, CandidateStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { CompanyProfileService } from '../../company-profile/company-profile.service';
import { formatVacancyReference } from './utils/recruitment-reference.util';

const ADMIN_ORIGIN = () => (process.env.ADMIN_APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Daily summaries go out in this hour (organisation time). */
export const DAILY_SUMMARY_HOUR = 8;

type AlertRow = {
  id: string;
  firstName: string;
  lastName: string;
  dealBreakersMissed: string[];
  createdAt: Date;
  vacancy: { title: string; recordNo: number };
};

/**
 * Tells a vacancy's hiring manager about new applications by email, as the vacancy asks (notifyMode):
 * EACH = an email for each application, DAILY = one summary a day, NONE = in-app notifications only.
 * Never throws: an application is saved whether or not the email goes.
 */
@Injectable()
export class ApplicationAlertsService {
  private readonly logger = new Logger(ApplicationAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly company: CompanyProfileService,
  ) {}

  /** A new application from the careers page: email the hiring manager now when the vacancy says EACH. */
  async onNewApplication(candidateId: string) {
    try {
      const c = await this.prisma.candidate.findUnique({
        where: { id: candidateId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dealBreakersMissed: true,
          createdAt: true,
          vacancy: {
            select: {
              title: true,
              recordNo: true,
              notifyMode: true,
              hiringManager: { select: { personalDetail: { select: { firstName: true, email: true } } } },
            },
          },
        },
      });
      const to = c?.vacancy.hiringManager?.personalDetail?.email?.trim();
      if (!c || c.vacancy.notifyMode !== 'EACH' || !to) return;
      const org = await this.orgName();
      const name = `${c.firstName} ${c.lastName}`.trim();
      const ref = formatVacancyReference(c.vacancy.recordNo);
      const lines = [
        `Hello ${c.vacancy.hiringManager?.personalDetail?.firstName ?? ''},`.replace(' ,', ','),
        '',
        `${name} has applied for ${c.vacancy.title} (${ref}).`,
        ...(c.dealBreakersMissed.length ? ['', `Does not meet: ${c.dealBreakersMissed.join('; ')}`] : []),
        '',
        `Open the application: ${this.link(c.id)}`,
        '',
        org,
      ];
      await this.mail.send({
        to,
        subject: `New application: ${name} — ${c.vacancy.title}`,
        text: lines.join('\n'),
        html: lines.map((l) => (l ? `<p>${escapeHtml(l)}</p>` : '')).join(''),
      });
    } catch (err) {
      this.logger.warn(`Application alert for ${candidateId} failed (${err instanceof Error ? err.message : 'error'})`);
    }
  }

  /**
   * One email per hiring manager with the applications not yet in a summary, for vacancies set to DAILY.
   * Each application is claimed (summaryEmailedAt) before sending, so it is in one summary only.
   */
  async sendDailySummaries(): Promise<{ managers: number; applications: number; failed: number }> {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const rows = await this.prisma.candidate.findMany({
      where: {
        deletedAt: null,
        summaryEmailedAt: null,
        createdAt: { gte: since },
        source: { in: [CandidateSource.WEBSITE, CandidateSource.EMAIL] },
        stage: { notIn: [CandidateStage.REJECTED, CandidateStage.WITHDRAWN] },
        vacancy: { notifyMode: 'DAILY', deletedAt: null, hiringManagerId: { not: null } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dealBreakersMissed: true,
        createdAt: true,
        vacancy: {
          select: {
            title: true,
            recordNo: true,
            hiringManagerId: true,
            hiringManager: { select: { personalDetail: { select: { firstName: true, email: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const byManager = new Map<string, { to: string; firstName: string; rows: AlertRow[] }>();
    for (const r of rows) {
      const to = r.vacancy.hiringManager?.personalDetail?.email?.trim();
      if (!to || !r.vacancy.hiringManagerId) continue;
      const entry = byManager.get(r.vacancy.hiringManagerId) ?? { to, firstName: r.vacancy.hiringManager?.personalDetail?.firstName ?? '', rows: [] };
      entry.rows.push(r);
      byManager.set(r.vacancy.hiringManagerId, entry);
    }

    const org = await this.orgName();
    let applications = 0;
    let failed = 0;
    for (const m of byManager.values()) {
      // Claim first: another process running the same job can't send these again.
      const claim = await this.prisma.candidate.updateMany({
        where: { id: { in: m.rows.map((r) => r.id) }, summaryEmailedAt: null },
        data: { summaryEmailedAt: new Date() },
      });
      if (!claim.count) continue;
      const lines = [
        `Hello ${m.firstName},`.replace(' ,', ','),
        '',
        `${m.rows.length} new application${m.rows.length === 1 ? '' : 's'} since the last summary:`,
        '',
        ...m.rows.map(
          (r) =>
            `• ${`${r.firstName} ${r.lastName}`.trim()} — ${r.vacancy.title} (${formatVacancyReference(r.vacancy.recordNo)})` +
            (r.dealBreakersMissed.length ? ` — does not meet: ${r.dealBreakersMissed.join('; ')}` : '') +
            `\n  ${this.link(r.id)}`,
        ),
        '',
        org,
      ];
      try {
        await this.mail.send({
          to: m.to,
          subject: `${m.rows.length} new application${m.rows.length === 1 ? '' : 's'} — daily summary`,
          text: lines.join('\n'),
          html: lines.map((l) => (l ? `<p>${escapeHtml(l).replace(/\n/g, '<br>')}</p>` : '')).join(''),
        });
        applications += m.rows.length;
      } catch (err) {
        failed += 1;
        // Not sent: release them so tomorrow's summary includes them.
        await this.prisma.candidate.updateMany({ where: { id: { in: m.rows.map((r) => r.id) } }, data: { summaryEmailedAt: null } });
        this.logger.warn(`Daily application summary to ${m.to} failed (${err instanceof Error ? err.message : 'error'})`);
      }
    }
    return { managers: byManager.size, applications, failed };
  }

  private link(candidateId: string) {
    return `${ADMIN_ORIGIN()}/hr/candidates/${candidateId}`;
  }

  private async orgName() {
    const brand = (await this.company.getBranding()).data;
    return brand.displayName || brand.companyName || 'CareFlow';
  }
}
