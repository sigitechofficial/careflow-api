import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../../mail/mail.service';
import { CompanyProfileService } from '../../../company-profile/company-profile.service';
import { buildOfferEmail, buildRejectionEmail, type RejectionPoint } from './candidate-email.util';

type Result = { sent: boolean; reason?: string };

/**
 * Emails the candidate their conditional offer, or that they were not successful. Never throws.
 * Like every recruitment email, a hidden copy goes to the MAIL_BCC addresses (the office).
 */
@Injectable()
export class CandidateEmailService {
  private readonly logger = new Logger(CandidateEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly company: CompanyProfileService,
  ) {}

  /** In the background, so saving stays quick (email can take a few seconds). */
  sendOfferInBackground(candidateId: string, kind: 'OFFER' | 'UPDATE') {
    void this.sendOffer(candidateId, kind);
  }

  sendRejectionInBackground(candidateId: string, point: RejectionPoint) {
    void this.sendRejection(candidateId, point);
  }

  async sendOffer(candidateId: string, kind: 'OFFER' | 'UPDATE'): Promise<Result> {
    try {
      const c = await this.load(candidateId);
      if (!c) return { sent: false, reason: 'Candidate not found' };
      if (!c.email) return { sent: false, reason: 'The candidate has no email address' };
      const message = buildOfferEmail({
        ...(await this.base(c.firstName, c.vacancy.title)),
        kind,
        startDate: c.offerStartDate,
        hoursPerWeek: c.offerHoursPerWeek,
        payRate: c.offerPayRate,
      });
      await this.mail.send({ to: c.email, ...message });
      await this.prisma.candidate.update({ where: { id: candidateId }, data: { offerEmailedAt: new Date() } });
      return { sent: true };
    } catch (err) {
      this.logger.warn(`Candidate ${candidateId}: offer email failed (${err instanceof Error ? err.message : 'error'})`);
      return { sent: false, reason: 'The email could not be sent' };
    }
  }

  async sendRejection(candidateId: string, point: RejectionPoint): Promise<Result> {
    try {
      const c = await this.load(candidateId);
      if (!c) return { sent: false, reason: 'Candidate not found' };
      if (!c.email) return { sent: false, reason: 'The candidate has no email address' };
      const message = buildRejectionEmail({ ...(await this.base(c.firstName, c.vacancy.title)), point });
      await this.mail.send({ to: c.email, ...message });
      await this.prisma.candidate.update({ where: { id: candidateId }, data: { rejectionEmailedAt: new Date() } });
      return { sent: true };
    } catch (err) {
      this.logger.warn(`Candidate ${candidateId}: rejection email failed (${err instanceof Error ? err.message : 'error'})`);
      return { sent: false, reason: 'The email could not be sent' };
    }
  }

  private async load(candidateId: string) {
    const c = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      select: {
        firstName: true,
        email: true,
        offerStartDate: true,
        offerHoursPerWeek: true,
        offerPayRate: true,
        vacancy: { select: { title: true } },
      },
    });
    return c ? { ...c, email: c.email?.trim() || null } : null;
  }

  private async base(firstName: string, jobTitle: string) {
    const brand = (await this.company.getBranding()).data;
    return {
      candidateFirstName: firstName,
      jobTitle,
      organisation: brand.displayName || brand.companyName || 'Our team',
      organisationEmail: brand.email || null,
      organisationPhone: brand.phoneNumber || null,
    };
  }
}
