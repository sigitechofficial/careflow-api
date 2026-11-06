import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { SURVEY_UNSUBSCRIBE_REASON } from './survey-eligibility.util';

export type UnsubscribeSubject = { subjectKind: 'EMPLOYEE' | 'SERVICE_USER' | 'EXTERNAL' | 'CONTACT'; subjectId: string };
const KINDS = ['EMPLOYEE', 'SERVICE_USER', 'EXTERNAL', 'CONTACT'];

/**
 * "Unsubscribe from all surveys" (former people, decision November 2026): a permanent opt-out from every
 * survey message, one click from any invitation, also set by STOP. The link names the person, never a survey
 * or an answer (so it is safe on anonymous surveys too), and is signed so it cannot be guessed. Staff cannot
 * lift it (SurveyRemindersService.setOptOuts and the outside-people screen keep it).
 */
@Injectable()
export class SurveyUnsubscribeService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    config: ConfigService,
  ) {
    const secret = config.get<string>('JWT_ACCESS_TOKEN_SECRET') ?? '';
    this.key = createHash('sha256').update(`survey-unsubscribe:${secret}`).digest();
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url').slice(0, 32);
  }

  token(subject: UnsubscribeSubject): string {
    const payload = Buffer.from(`${subject.subjectKind}:${subject.subjectId}`).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  read(token: string): UnsubscribeSubject | null {
    const [payload, sig] = (token ?? '').split('.');
    if (!payload || !sig) return null;
    // Compared as bytes: a signature with non-ASCII characters is refused, never an error.
    const got = Buffer.from(sig);
    const want = Buffer.from(this.mac(payload));
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const [subjectKind, subjectId] = Buffer.from(payload, 'base64url').toString('utf8').split(':');
    if (!KINDS.includes(subjectKind) || !/^[0-9a-f-]{36}$/i.test(subjectId ?? '')) return null;
    return { subjectKind: subjectKind as UnsubscribeSubject['subjectKind'], subjectId };
  }

  /** The address for an invitation: base + /survey-unsubscribe/<token>. */
  link(base: string | null, subject: UnsubscribeSubject): string | null {
    return base ? `${base}/survey-unsubscribe/${this.token(subject)}` : null;
  }

  /** Whether the link is real (the page says so before the person confirms). */
  check(token: string): { valid: boolean; alreadyDone: boolean } | Promise<{ valid: boolean; alreadyDone: boolean }> {
    const subject = this.read(token);
    if (!subject) return { valid: false, alreadyDone: false };
    return this.prisma.surveyContactOptOut
      .findFirst({ where: { ...subject, channel: 'ALL', reason: SURVEY_UNSUBSCRIBE_REASON }, select: { id: true } })
      .then((r) => ({ valid: true, alreadyDone: Boolean(r) }));
  }

  /** Stop every survey message to them, for good. Audited without the person's details. */
  async unsubscribe(token: string, via: 'LINK' | 'STOP' = 'LINK'): Promise<{ done: boolean }> {
    const subject = this.read(token);
    if (!subject) throw new BadRequestException('This link is not valid.');
    return this.apply(subject, via);
  }

  async apply(subject: UnsubscribeSubject, via: 'LINK' | 'STOP'): Promise<{ done: boolean }> {
    await this.prisma.surveyContactOptOut.upsert({
      where: { subjectKind_subjectId_channel: { ...subject, channel: 'ALL' } },
      create: { ...subject, channel: 'ALL', reason: SURVEY_UNSUBSCRIBE_REASON, recordedById: null },
      update: { reason: SURVEY_UNSUBSCRIBE_REASON },
    });
    await this.audit.logAudit({
      userId: undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_CONTACT_OPT_OUT_CHANGED,
      recordType:
        subject.subjectKind === 'EMPLOYEE' ? 'Employee' : subject.subjectKind === 'SERVICE_USER' ? 'ServiceUser' : subject.subjectKind === 'CONTACT' ? 'ServiceUserContact' : 'SurveyExternalContact',
      recordId: subject.subjectId,
      description: via === 'STOP' ? 'Unsubscribed from all surveys (replied STOP)' : 'Unsubscribed from all surveys (link in a survey message)',
      newValues: { channels: ['ALL'], permanent: true },
    });
    return { done: true };
  }
}
