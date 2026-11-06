import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { SURVEY_UNSUBSCRIBE_REASON } from './survey-eligibility.util';

export type UnsubscribeSubject = { subjectKind: 'EMPLOYEE' | 'SERVICE_USER' | 'EXTERNAL' | 'CONTACT'; subjectId: string };
const KINDS = ['EMPLOYEE', 'SERVICE_USER', 'EXTERNAL', 'CONTACT'];

/** 32 random bytes, base64url: 43 characters. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * "Unsubscribe from all surveys" (former people, decision November 2026): a permanent opt-out from every
 * survey message, one click from any invitation, also set by STOP. Staff cannot lift it
 * (SurveyRemindersService.setOptOuts and the outside-people screen keep it).
 *
 * Each link holds an opaque random token (256 bits), new for every message. Only its SHA-256 hash is stored
 * (surveys.SurveyUnsubscribeToken, with the person it stands for), so the link reveals nothing (no person,
 * survey or answer) and a copy of the database cannot be turned back into working links. The earlier signed
 * links that carried the person's id are refused: none was ever sent to a former person.
 */
@Injectable()
export class SurveyUnsubscribeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /** A new token for this person (stored hashed). */
  async token(subject: UnsubscribeSubject): Promise<string> {
    if (!KINDS.includes(subject.subjectKind)) throw new Error('Unknown unsubscribe subject');
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$executeRaw`
      INSERT INTO "surveys"."SurveyUnsubscribeToken" ("id", "tokenHash", "subjectKind", "subjectId")
      VALUES (${randomUUID()}::uuid, ${hashOf(token)}, ${subject.subjectKind}, ${subject.subjectId}::uuid)`;
    return token;
  }

  /** Who a token stands for, or null (wrong shape, unknown, or an old signed link). */
  async read(token: string): Promise<UnsubscribeSubject | null> {
    if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return null;
    const rows = await this.prisma.$queryRaw<Array<{ subjectKind: string; subjectId: string }>>`
      SELECT "subjectKind", "subjectId"::text AS "subjectId" FROM "surveys"."SurveyUnsubscribeToken" WHERE "tokenHash" = ${hashOf(token)} LIMIT 1`;
    const row = rows[0];
    if (!row || !KINDS.includes(row.subjectKind)) return null;
    return { subjectKind: row.subjectKind as UnsubscribeSubject['subjectKind'], subjectId: row.subjectId };
  }

  /** The address for an invitation: base + /survey-unsubscribe/<token>, or null with no web address. */
  async link(base: string | null, subject: UnsubscribeSubject): Promise<string | null> {
    if (!base) return null;
    return `${base}/survey-unsubscribe/${await this.token(subject)}`;
  }

  /** Whether the link is real (the page says so before the person confirms). Nothing else. */
  async check(token: string): Promise<{ valid: boolean; alreadyDone: boolean }> {
    const subject = await this.read(token);
    if (!subject) return { valid: false, alreadyDone: false };
    const r = await this.prisma.surveyContactOptOut.findFirst({ where: { ...subject, channel: 'ALL', reason: SURVEY_UNSUBSCRIBE_REASON }, select: { id: true } });
    return { valid: true, alreadyDone: Boolean(r) };
  }

  /** Stop every survey message to them, for good. Audited without the person's details. */
  async unsubscribe(token: string, via: 'LINK' | 'STOP' = 'LINK'): Promise<{ done: boolean }> {
    const subject = await this.read(token);
    if (!subject) throw new BadRequestException('This link is not valid.');
    const result = await this.apply(subject, via);
    await this.prisma.$executeRaw`
      UPDATE "surveys"."SurveyUnsubscribeToken" SET "usedAt" = now() WHERE "tokenHash" = ${hashOf(token)} AND "usedAt" IS NULL`;
    return result;
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
