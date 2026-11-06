import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { SurveyUnsubscribeService } from './survey-unsubscribe.service';
import { SURVEY_UNSUBSCRIBE_REASON } from './survey-eligibility.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { TextMessageService } from '../text-messages/text-message.service';
import { normaliseUkMobile } from '../text-messages/uk-mobile.util';
import type { TextReplyKind } from '../text-messages/text-message-replies.util';

/** The reason kept on an opt-out made by a STOP reply (a START reply lifts only these). */
export const SURVEY_TEXT_STOP_REASON = 'Replied STOP to a survey text message';

type Subject = { subjectKind: 'EMPLOYEE' | 'SERVICE_USER'; subjectId: string };

/**
 * STOP and START replies to survey texts. STOP: everyone whose record holds that mobile stops
 * getting survey texts (an opt-out for the text channel, kept until someone changes it). START:
 * lifts only opt-outs a STOP reply made, never one recorded by staff. Works once a provider that
 * handles replies is in use (TextMessageService); the reply's words are never stored, and the
 * audit trail never holds the number.
 */
@Injectable()
export class SurveyTextRepliesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly texts: TextMessageService,
    @Optional() private readonly unsubscribe?: SurveyUnsubscribeService,
  ) {}

  /** Former people (left, or care ended): STOP unsubscribes them from all surveys, for good. */
  private async isFormer(p: Subject): Promise<boolean> {
    if (p.subjectKind === 'EMPLOYEE') {
      const e = await this.prisma.employee.findUnique({ where: { id: p.subjectId }, select: { isActive: true } }).catch(() => null);
      return e?.isActive === false;
    }
    const su = await this.prisma.serviceUser.findUnique({ where: { id: p.subjectId }, select: { status: { select: { code: true } } } }).catch(() => null);
    return su?.status?.code === 'DISCHARGED';
  }

  onModuleInit(): void {
    this.texts.onReply((reply) => this.handle(reply));
  }

  /** Records holding this mobile (numbers are written many ways, so the last ten digits find them first). */
  async peopleWithMobile(e164: string): Promise<Subject[]> {
    const lastTen = e164.replace(/\D/g, '').slice(-10);
    const [staff, supported] = await Promise.all([
      this.prisma.$queryRaw<Array<{ employeeId: string; mobileTelephone: string | null }>>`
        SELECT "employeeId", "mobileTelephone" FROM "employees"."EmployeePersonalDetail"
         WHERE "deletedAt" IS NULL AND right(regexp_replace(coalesce("mobileTelephone", ''), '\\D', '', 'g'), 10) = ${lastTen}`,
      this.prisma.$queryRaw<Array<{ id: string; mobile: string | null; phone: string | null }>>`
        SELECT "id", "mobile", "phone" FROM "service_users"."ServiceUser"
         WHERE "deletedAt" IS NULL AND (right(regexp_replace(coalesce("mobile", ''), '\\D', '', 'g'), 10) = ${lastTen}
            OR right(regexp_replace(coalesce("phone", ''), '\\D', '', 'g'), 10) = ${lastTen})`,
    ]);
    return [
      ...staff.filter((s) => normaliseUkMobile(s.mobileTelephone) === e164).map((s) => ({ subjectKind: 'EMPLOYEE' as const, subjectId: s.employeeId })),
      ...supported
        .filter((s) => normaliseUkMobile(s.mobile) === e164 || normaliseUkMobile(s.phone) === e164)
        .map((s) => ({ subjectKind: 'SERVICE_USER' as const, subjectId: s.id })),
    ];
  }

  async handle(reply: { kind: TextReplyKind; from: string }): Promise<number> {
    const people = await this.peopleWithMobile(reply.from);
    let changed = 0;
    for (const p of people) {
      const existing = await this.prisma.surveyContactOptOut.findMany({ where: { subjectKind: p.subjectKind, subjectId: p.subjectId }, select: { channel: true, reason: true } });
      if (reply.kind === 'STOP' && this.unsubscribe && (await this.isFormer(p))) {
        if (existing.some((e) => e.channel === 'ALL' && e.reason === SURVEY_UNSUBSCRIBE_REASON)) continue;
        await this.unsubscribe.apply(p, 'STOP');
        changed += 1;
        continue;
      }
      if (reply.kind === 'STOP') {
        if (existing.some((e) => e.channel === 'ALL' || e.channel === 'TEXT')) continue;
        await this.prisma.surveyContactOptOut.create({ data: { ...p, channel: 'TEXT', reason: SURVEY_TEXT_STOP_REASON, recordedById: null } });
      } else {
        const fromStop = existing.some((e) => e.channel === 'TEXT' && e.reason === SURVEY_TEXT_STOP_REASON);
        if (!fromStop) continue;
        await this.prisma.surveyContactOptOut.deleteMany({ where: { ...p, channel: 'TEXT', reason: SURVEY_TEXT_STOP_REASON } });
      }
      changed += 1;
      await this.audit.logAudit({
        userId: undefined,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_CONTACT_OPT_OUT_CHANGED,
        recordType: p.subjectKind === 'EMPLOYEE' ? 'Employee' : 'ServiceUser',
        recordId: p.subjectId,
        description:
          reply.kind === 'STOP'
            ? 'Survey contact preferences changed: replied STOP, so survey text messages stopped'
            : 'Survey contact preferences changed: replied START, so survey text messages allowed again',
        oldValues: { channels: existing.map((e) => e.channel) },
        newValues: { channels: reply.kind === 'STOP' ? [...existing.map((e) => e.channel), 'TEXT'] : existing.map((e) => e.channel).filter((c) => c !== 'TEXT') },
      });
    }
    return changed;
  }
}
