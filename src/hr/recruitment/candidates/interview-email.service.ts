import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../../mail/mail.service';
import { CompanyProfileService } from '../../../company-profile/company-profile.service';
import { buildInterviewEmail, buildInterviewIcs, type InterviewEmailKind } from './interview-email.util';

/** How long the calendar entry lasts (the interview has no end time of its own). */
const INTERVIEW_MINUTES = 60;

/** Emails the candidate about their interview, with a calendar file. Never throws: the interview is saved either way. */
@Injectable()
export class InterviewEmailService {
  private readonly logger = new Logger(InterviewEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly company: CompanyProfileService,
  ) {}

  /** Sends in the background so saving the interview stays quick (email can take a few seconds). */
  sendInBackground(kind: InterviewEmailKind, interviewId: string) {
    void this.send(kind, interviewId);
  }

  async send(kind: InterviewEmailKind, interviewId: string): Promise<{ sent: boolean; reason?: string }> {
    try {
      const interview = await this.prisma.candidateInterview.findUnique({
        where: { id: interviewId },
        include: {
          candidate: {
            select: { firstName: true, email: true, phone: true, vacancy: { select: { title: true } } },
          },
        },
      });
      if (!interview) return { sent: false, reason: 'Interview not found' };
      const email = interview.candidate.email?.trim();
      if (!email) return { sent: false, reason: 'The candidate has no email address' };

      // A change or cancellation replaces the event already in their calendar.
      const sequence = kind === 'INVITE' ? interview.calendarSequence : interview.calendarSequence + 1;
      const brand = (await this.company.getBranding()).data;
      const input = {
        kind,
        interviewId: interview.id,
        sequence,
        scheduledAt: interview.scheduledAt,
        durationMinutes: INTERVIEW_MINUTES,
        mode: interview.mode,
        location: interview.location,
        interviewers: interview.interviewers,
        candidateFirstName: interview.candidate.firstName,
        candidateEmail: email,
        candidatePhone: interview.candidate.phone,
        jobTitle: interview.candidate.vacancy.title,
        organisation: brand.displayName || brand.companyName || 'Our team',
        organisationEmail: brand.email || null,
        organisationPhone: brand.phoneNumber || null,
      };
      const message = buildInterviewEmail(input);
      await this.mail.send({
        to: email,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: [
          {
            filename: kind === 'CANCEL' ? 'interview-cancelled.ics' : 'interview.ics',
            content: buildInterviewIcs(input),
            contentType: `text/calendar; charset=utf-8; method=${kind === 'CANCEL' ? 'CANCEL' : 'REQUEST'}`,
          },
        ],
        // No skipBcc: recruitment emails are copied to MAIL_BCC (the office keeps a copy).
      });
      await this.prisma.candidateInterview.update({
        where: { id: interview.id },
        data: { candidateEmailedAt: new Date(), calendarSequence: sequence },
      });
      return { sent: true };
    } catch (err) {
      this.logger.warn(`Interview ${interviewId}: ${kind} email failed (${err instanceof Error ? err.message : 'error'})`);
      return { sent: false, reason: 'The email could not be sent' };
    }
  }
}
