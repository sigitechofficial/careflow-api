import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, SurveyStatus, SurveyTargetKind, type Survey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { DEFAULT_OPERATIONAL_TIMEZONE, dayKeyInTimeZone, startOfOperationalDayUtc } from '../common/utils/operational-day.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { surveyVisibleInScope } from './survey-scope.util';
import { surveyAccessFor } from './survey-access';
import {
  CONTACT_RULE_DAYS,
  HELD_BACK_MIN_DAYS_LEFT,
  addIsoDays,
  checkContactRuleInput,
  checkSamplingInput,
  chooseSample,
  effectiveContactRule,
  freeFromDay,
  defaultContactRule,
  libraryContactRule,
  librarySentWith,
  readSampling,
  SENT_WITH_DAYS,
  storedRepeatReason,
} from './survey-contact-rule.util';

type Kind = 'EMPLOYEE' | 'SERVICE_USER';
/** A person's latest survey contact: the day, and the survey (never shown unless the viewer may see its results). */
export type LastContact = { day: string; surveyId: string };
export type HeldPerson = { personId: string; lastContactDay: string; freeFrom: string };

/** SKIPPED: not sent at all (the survey skips held people, or a manager chose "Don't send"); CANCELLED: a death. */
export const HELD_BACK_STATUSES = ['HELD', 'SENT', 'OVERRIDDEN', 'LAPSED', 'SKIPPED', 'CANCELLED'] as const;

/**
 * The 4-week contact rule and sampling (Phase 2 part 2): who a send may reach now, who is held back
 * until their free day, and the survey's settings. Never says which other survey held someone back
 * unless the viewer may see that survey's results (being sent some surveys is itself sensitive: after
 * a complaint, a bereavement or a distressing event). Rows made only because someone answered an
 * anonymous survey never count (they would show that the person answered).
 */
@Injectable()
export class SurveyContactRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    @Optional() private readonly orgSettings?: OrganisationGeneralSettingsService,
  ) {}

  async timeZone(): Promise<string> {
    try {
      return (await this.orgSettings?.getOperationalTimezone()) || DEFAULT_OPERATIONAL_TIMEZONE;
    } catch {
      return DEFAULT_OPERATIONAL_TIMEZONE;
    }
  }

  /** The survey holding the settings: a repeating survey's periods use their source survey's. */
  async owner(survey: Survey): Promise<Survey> {
    if (!survey.clonedFromId) return survey;
    return (await this.prisma.survey.findUnique({ where: { id: survey.clonedFromId } })) ?? survey;
  }

  /**
   * Ready-made details by library reference (the catalogue survey's libraryMeta), as access does: a
   * survey started from a ready-made template keeps its reference, not the details.
   */
  async libraryMetas(refs: Array<string | null | undefined>): Promise<Map<string, unknown>> {
    const wanted = [...new Set(refs.filter((r): r is string => Boolean(r)))];
    if (!wanted.length) return new Map();
    const rows = await this.prisma.survey.findMany({
      where: { isCatalogue: true, deletedAt: null, libraryReference: { in: wanted } },
      select: { libraryReference: true, libraryMeta: true },
    });
    return new Map(rows.map((r) => [r.libraryReference!, r.libraryMeta as unknown]));
  }

  /** The rule a survey follows (its own, its repeating survey's, then the library's, then both on). */
  async ruleFor(survey: Survey) {
    const owner = await this.owner(survey);
    const metas = await this.libraryMetas([owner.libraryReference]);
    const lib = (owner.libraryReference ? metas.get(owner.libraryReference) : undefined) ?? owner.libraryMeta;
    return { owner, libraryMeta: lib, rule: effectiveContactRule(owner, lib) };
  }

  /**
   * Each person's latest survey contact within the last 28 days, on surveys other than this series.
   * A contact: sent a survey that counts as a contact (not deleted, not a template). On anonymous
   * surveys a row created only by answering never counts.
   */
  async lastContacts(
    kind: Kind,
    personIds: string[],
    seriesId: string | null,
    now: Date,
    tz: string,
    /** The survey being sent's library reference and linked parts (timing.sentWith): sent this close, not a contact. */
    linked?: { reference: string | null; sentWith: string[] },
  ): Promise<Map<string, LastContact>> {
    const out = new Map<string, LastContact>();
    if (!personIds.length) return out;
    const today = dayKeyInTimeZone(now, tz);
    const since = startOfOperationalDayUtc(addIsoDays(today, -(CONTACT_RULE_DAYS - 1)), tz);
    const rows = await this.prisma.surveyRecipient.findMany({
      where: {
        ...(kind === 'EMPLOYEE' ? { employeeId: { in: personIds } } : { serviceUserId: { in: personIds } }),
        sentAt: { gte: since },
        survey: {
          deletedAt: null,
          isTemplate: false,
          // Never NOT { clonedFromId }: SQL NOT on a null column drops every survey that is not a period.
          ...(seriesId ? { id: { not: seriesId }, OR: [{ clonedFromId: null }, { clonedFromId: { not: seriesId } }] } : {}),
        },
      },
      select: {
        employeeId: true,
        serviceUserId: true,
        sentAt: true,
        addedByAnswer: true,
        survey: {
          select: {
            id: true,
            isAnonymous: true,
            targetKind: true,
            contactRule: true,
            libraryMeta: true,
            libraryReference: true,
            clonedFrom: { select: { contactRule: true, libraryMeta: true, libraryReference: true, targetKind: true, isAnonymous: true } },
          },
        },
      },
    });
    const metas = await this.libraryMetas(rows.map((r) => (r.survey.clonedFrom ?? r.survey).libraryReference));
    for (const r of rows) {
      if (!r.sentAt) continue;
      // A row made only by answering an anonymous survey would show that the person answered.
      if (r.addedByAnswer && r.survey.isAnonymous) continue;
      const owner = r.survey.clonedFrom ?? r.survey;
      const ownerMeta = (owner.libraryReference ? metas.get(owner.libraryReference) : undefined) ?? owner.libraryMeta;
      const rule = effectiveContactRule(owner, ownerMeta);
      if (!rule.countsAsContact) continue;
      // Linked parts sent together (e.g. SUR-STF-001 with SUR-STF-012) are one contact: never hold back.
      if (
        linked?.reference &&
        owner.libraryReference &&
        owner.libraryReference !== linked.reference &&
        (linked.sentWith.includes(owner.libraryReference) || librarySentWith(ownerMeta).includes(linked.reference)) &&
        Math.abs(now.getTime() - r.sentAt.getTime()) <= SENT_WITH_DAYS * 86_400_000
      ) {
        continue;
      }
      const personId = (kind === 'EMPLOYEE' ? r.employeeId : r.serviceUserId)!;
      const day = dayKeyInTimeZone(r.sentAt, tz);
      const prev = out.get(personId);
      if (!prev || day > prev.day) out.set(personId, { day, surveyId: r.survey.id });
    }
    return out;
  }

  /**
   * Outside people's latest survey contact in the last 28 days (one real person each): surveys sent to them, and
   * (decision P10) named answers they gave for a person we support, recorded with them chosen from People
   * involved. A linked pair (timing.sentWith, e.g. SUR-PWS-003 with SUR-FAM-001) within a few days is one
   * contact. Answers not linked to anyone never count.
   */
  async lastContactsExternal(
    contactIds: string[],
    seriesId: string | null,
    now: Date,
    tz: string,
    linked?: { reference: string | null; sentWith: string[] },
  ): Promise<Map<string, LastContact>> {
    const out = new Map<string, LastContact>();
    if (!contactIds.length) return out;
    const today = dayKeyInTimeZone(now, tz);
    const since = startOfOperationalDayUtc(addIsoDays(today, -(CONTACT_RULE_DAYS - 1)), tz);
    const surveySelect = {
      id: true,
      isAnonymous: true,
      targetKind: true,
      contactRule: true,
      libraryMeta: true,
      libraryReference: true,
      clonedFrom: { select: { contactRule: true, libraryMeta: true, libraryReference: true, targetKind: true, isAnonymous: true } },
    } as const;
    const notThisSeries = seriesId ? { id: { not: seriesId }, OR: [{ clonedFromId: null }, { clonedFromId: { not: seriesId } }] } : {};
    const contacts = await this.prisma.surveyExternalContact.findMany({ where: { id: { in: contactIds } }, select: { id: true, sourceType: true, sourceId: true } });
    const byFamily = new Map(contacts.filter((c) => c.sourceType === 'SERVICE_USER_CONTACT' && c.sourceId).map((c) => [c.sourceId!, c.id]));
    const [sent, answered] = await Promise.all([
      this.prisma.surveyRecipient.findMany({
        where: { externalContactId: { in: contactIds }, sentAt: { gte: since }, survey: { deletedAt: null, isTemplate: false, ...notThisSeries } },
        select: { externalContactId: true, sentAt: true, survey: { select: surveySelect } },
      }),
      byFamily.size
        ? this.prisma.surveyResponse.findMany({
            where: { respondentContactId: { in: [...byFamily.keys()] }, submittedAt: { gte: since }, survey: { deletedAt: null, isTemplate: false, isAnonymous: false, ...notThisSeries } },
            select: { respondentContactId: true, submittedAt: true, survey: { select: surveySelect } },
          })
        : Promise.resolve([] as Array<{ respondentContactId: string | null; submittedAt: Date; survey: Record<string, unknown> }>),
    ]);
    type Row = { personId: string; at: Date; survey: { id: string; libraryReference: string | null; libraryMeta: unknown; contactRule: unknown; targetKind: string; isAnonymous: boolean; clonedFrom: { libraryReference: string | null; libraryMeta: unknown; contactRule: unknown; targetKind: string; isAnonymous: boolean } | null } };
    const rows: Row[] = [
      ...sent.filter((r) => r.sentAt && r.externalContactId).map((r) => ({ personId: r.externalContactId!, at: r.sentAt!, survey: r.survey as unknown as Row['survey'] })),
      ...(answered as Array<{ respondentContactId: string | null; submittedAt: Date; survey: unknown }>)
        .filter((r) => r.respondentContactId && byFamily.has(r.respondentContactId))
        .map((r) => ({ personId: byFamily.get(r.respondentContactId!)!, at: r.submittedAt, survey: r.survey as Row['survey'] })),
    ];
    const metas = await this.libraryMetas(rows.map((r) => (r.survey.clonedFrom ?? r.survey).libraryReference));
    for (const r of rows) {
      const owner = r.survey.clonedFrom ?? r.survey;
      const ownerMeta = (owner.libraryReference ? metas.get(owner.libraryReference) : undefined) ?? owner.libraryMeta;
      if (!effectiveContactRule(owner, ownerMeta).countsAsContact) continue;
      if (
        linked?.reference &&
        owner.libraryReference &&
        owner.libraryReference !== linked.reference &&
        (linked.sentWith.includes(owner.libraryReference) || librarySentWith(ownerMeta).includes(linked.reference)) &&
        Math.abs(now.getTime() - r.at.getTime()) <= SENT_WITH_DAYS * 86_400_000
      ) {
        continue;
      }
      const day = dayKeyInTimeZone(r.at, tz);
      const prev = out.get(r.personId);
      if (!prev || day > prev.day) out.set(r.personId, { day, surveyId: r.survey.id });
    }
    return out;
  }

  /**
   * Who a send reaches now. Holds back people contacted in the last 4 weeks (unless the survey is
   * exempt or `override` is given), then (sampling, everyone-in-branches audiences only) takes a share
   * of the free people, those asked least often in this series first.
   */
  async apply(
    survey: Survey,
    kind: Kind,
    ids: string[],
    opts: { now: Date; override?: boolean; chosenPeople: boolean; minimum?: number },
  ): Promise<{ sendIds: string[]; held: HeldPerson[]; skipped: HeldPerson[]; sampledOut: number; holdBack: boolean }> {
    const { owner, rule, libraryMeta } = await this.ruleFor(survey);
    const tz = await this.timeZone();
    // Periods of the same repeating survey never hold each other back; nor does this survey itself.
    const seriesId = survey.clonedFromId ?? survey.id;
    let free = ids;
    const held: HeldPerson[] = [];
    if (rule.holdBack && !opts.override) {
      const today = dayKeyInTimeZone(opts.now, tz);
      const last = await this.lastContacts(kind, ids, seriesId, opts.now, tz, {
        reference: owner.libraryReference ?? null,
        sentWith: librarySentWith(libraryMeta),
      });
      free = [];
      for (const id of ids) {
        const c = last.get(id);
        if (c && freeFromDay(c.day) > today) held.push({ personId: id, lastContactDay: c.day, freeFrom: freeFromDay(c.day) });
        else free.push(id);
      }
    }
    const sampling = readSampling(owner.sampling);
    let sendIds = free;
    if (sampling && !opts.chosenPeople && free.length) {
      const asked = await this.timesAskedInSeries(kind, free, survey.clonedFromId ?? survey.id);
      sendIds = chooseSample(free, sampling.percent, asked, opts.minimum ?? 0);
      // People not sampled are simply not asked this time; nobody is held for them. People held back
      // by the rule are still held (reported, and sent later or skipped as the rule says).
      const sampledOut = free.length - sendIds.length;
      if (rule.whenHeld === 'SKIP') return { sendIds, held: [], skipped: held, sampledOut, holdBack: rule.holdBack };
      return { sendIds, held, skipped: [], sampledOut, holdBack: rule.holdBack };
    }
    // Skip, don't delay (routine and sampled surveys): held people are not sent it at all this time.
    if (rule.whenHeld === 'SKIP') return { sendIds, held: [], skipped: held, sampledOut: 0, holdBack: rule.holdBack };
    return { sendIds, held, skipped: [], sampledOut: 0, holdBack: rule.holdBack };
  }

  private async timesAskedInSeries(kind: Kind, ids: string[], seriesId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.surveyRecipient.groupBy({
      by: [kind === 'EMPLOYEE' ? 'employeeId' : 'serviceUserId'],
      where: {
        ...(kind === 'EMPLOYEE' ? { employeeId: { in: ids } } : { serviceUserId: { in: ids } }),
        addedByAnswer: false,
        survey: { OR: [{ id: seriesId }, { clonedFromId: seriesId }] },
      },
      _count: { _all: true },
    });
    const out = new Map<string, number>();
    for (const r of rows as Array<{ employeeId?: string | null; serviceUserId?: string | null; _count: { _all: number } }>) {
      const id = kind === 'EMPLOYEE' ? r.employeeId : r.serviceUserId;
      if (id) out.set(id, r._count._all);
    }
    return out;
  }

  /** Keep who was held back (days only). Someone already held on this survey keeps their row. */
  async recordHeld(surveyId: string, kind: Kind, held: HeldPerson[], status: 'HELD' | 'SKIPPED' = 'HELD'): Promise<void> {
    if (!held.length) return;
    const tz = await this.timeZone();
    const now = new Date();
    await this.prisma.surveyHeldBack.createMany({
      data: held.map((h) => ({
        surveyId,
        employeeId: kind === 'EMPLOYEE' ? h.personId : null,
        serviceUserId: kind === 'SERVICE_USER' ? h.personId : null,
        lastContactOn: startOfOperationalDayUtc(h.lastContactDay, tz),
        freeFrom: startOfOperationalDayUtc(h.freeFrom, tz),
        status,
        ...(status === 'SKIPPED' ? { resolvedAt: now } : {}),
      })),
      skipDuplicates: true,
    });
  }

  // ─── Settings and the held-back list ──────────────────────────────────────

  private async requireSurvey(actor: RequestUser, id: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({ where: { id, deletedAt: null, isCatalogue: false } });
    if (!survey || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), survey)) throw new NotFoundException('Survey not found');
    return survey;
  }

  /**
   * What another survey may say about a held person: its title and the day only to someone who may
   * see that survey's results and is in its branches; otherwise nothing ("another survey").
   */
  private async describeContacts(actor: RequestUser, surveyIds: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const scope = this.orgScope.fromRequestUser(actor);
    for (const id of [...new Set(surveyIds)]) {
      const other = await this.prisma.survey.findUnique({ where: { id } });
      if (!other || other.deletedAt || !surveyVisibleInScope(scope, other)) {
        out.set(id, null);
        continue;
      }
      const access = await surveyAccessFor(this.prisma, actor, other).catch(() => null);
      out.set(id, access?.results ? other.title : null);
    }
    return out;
  }

  async getSettings(actor: RequestUser, surveyId: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    const canSend = actor.permissions.includes('surveys.manage');
    const { owner, rule, libraryMeta } = await this.ruleFor(survey);
    const lib = libraryContactRule(libraryMeta);
    const { calendar, ...byDefault } = defaultContactRule(owner);
    const tz = await this.timeZone();
    const rows = survey.targetKind === SurveyTargetKind.PUBLIC
      ? []
      : await this.prisma.surveyHeldBack.findMany({ where: { surveyId: survey.id }, orderBy: { freeFrom: 'asc' } });
    const kind: Kind = survey.targetKind === SurveyTargetKind.SERVICE_USER ? 'SERVICE_USER' : 'EMPLOYEE';
    const personIds = rows.map((r) => (r.employeeId ?? r.serviceUserId)!);
    const names = await this.names(kind, personIds);
    const seriesId = survey.clonedFromId ?? survey.id;
    // Which survey held each person: recomputed now, and named only where the viewer may see it.
    const heldNow = rows.filter((r) => r.status === 'HELD');
    const contacts = heldNow.length
      ? await this.lastContacts(kind, heldNow.map((r) => (r.employeeId ?? r.serviceUserId)!), seriesId, new Date(), tz)
      : new Map<string, LastContact>();
    const described = await this.describeContacts(actor, [...contacts.values()].map((c) => c.surveyId));
    return {
      message: 'Who gets it',
      data: {
        inheritedFrom: survey.clonedFromId ? { id: owner.id, title: owner.title } : null,
        rule: { holdBack: rule.holdBack, countsAsContact: rule.countsAsContact, whenHeld: rule.whenHeld, reason: rule.reason, source: rule.source },
        /** The library's rule and its reason (why it differs from the default), when it has one. */
        library: lib,
        /** The rule when nothing else is said; calendar: anonymous staff surveys follow the all-staff calendar. */
        defaultRule: { holdBack: byDefault.holdBack, countsAsContact: byDefault.countsAsContact, whenHeld: byDefault.whenHeld, calendar },
        /** Why a repeat shorter than 4 weeks (weekly) asks people this often, when it does. */
        repeatReason: storedRepeatReason(owner.contactRule),
        /** Ready-made parts sent together with this one (one contact). */
        sentWith: librarySentWith(libraryMeta),
        days: CONTACT_RULE_DAYS,
        sampling: readSampling(owner.sampling),
        samplingAvailable: survey.targetKind !== SurveyTargetKind.PUBLIC,
        held: rows.map((r) => {
          const personId = (r.employeeId ?? r.serviceUserId)!;
          const c = r.status === 'HELD' ? contacts.get(personId) : undefined;
          const title = c ? (described.get(c.surveyId) ?? null) : null;
          return {
            id: r.id,
            personId,
            name: names.get(personId) ?? (kind === 'EMPLOYEE' ? 'Employee' : 'Person we support'),
            status: r.status,
            /** Only for people who can send (surveys.manage): needed to plan. */
            freeFrom: canSend ? dayKeyInTimeZone(r.freeFrom, tz) : null,
            /** Only for someone who may see that survey's results: else null ("another survey"). */
            otherSurvey: c && title ? { id: c.surveyId, title, on: c.day } : null,
            overrideReason: r.status === 'OVERRIDDEN' || r.status === 'SKIPPED' ? r.overrideReason : null,
            resolvedOn: r.resolvedAt ? dayKeyInTimeZone(r.resolvedAt, tz) : null,
          };
        }),
      },
    };
  }

  private async names(kind: Kind, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    if (kind === 'EMPLOYEE') {
      const rows = await this.prisma.employeePersonalDetail.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, firstName: true, lastName: true } });
      return new Map(rows.map((r) => [r.employeeId, `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || 'Employee']));
    }
    const rows = await this.prisma.serviceUser.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, preferredName: true } });
    return new Map(rows.map((r) => [r.id, `${r.preferredName?.trim() || r.firstName} ${r.lastName ?? ''}`.trim()]));
  }

  async saveSettings(
    actor: RequestUser,
    surveyId: string,
    input: { rule?: unknown; sampling?: unknown },
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (survey.clonedFromId) {
      throw new BadRequestException('This is one period of a repeating survey. Change this on the repeating survey itself.');
    }
    if (survey.targetKind === SurveyTargetKind.PUBLIC) {
      throw new BadRequestException('Public surveys are answered through their shared link, so the 4-week rule and sampling do not apply.');
    }
    const { libraryMeta } = await this.ruleFor(survey);
    const data: Prisma.SurveyUpdateInput = { updatedById: actor.id };
    if (input.rule !== undefined) {
      const checked = checkContactRuleInput(input.rule, libraryMeta, survey);
      if (!checked.ok) throw new BadRequestException(checked.message);
      // A short repeat's reason is kept with the rule (it is not part of the 4-week setting).
      const repeatReason = storedRepeatReason(survey.contactRule);
      const merged = checked.rule ? { ...checked.rule, ...(repeatReason ? { repeatReason } : {}) } : repeatReason ? { repeatReason } : null;
      data.contactRule = merged ? (merged as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    }
    if (input.sampling !== undefined) {
      const checked = checkSamplingInput(input.sampling);
      if (!checked.ok) throw new BadRequestException(checked.message);
      data.sampling = checked.sampling ? (checked.sampling as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    }
    const updated = await this.prisma.survey.update({ where: { id: survey.id }, data });
    const before = effectiveContactRule(survey, libraryMeta);
    const after = effectiveContactRule(updated, libraryMeta);
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_CONTACT_RULE_CHANGED,
      recordType: 'Survey',
      recordId: survey.id,
      description: `Who gets survey "${survey.title}" changed (4-week rule or sampling)`,
      oldValues: { rule: { holdBack: before.holdBack, countsAsContact: before.countsAsContact, whenHeld: before.whenHeld, reason: before.reason }, sampling: readSampling(survey.sampling) },
      newValues: { rule: { holdBack: after.holdBack, countsAsContact: after.countsAsContact, whenHeld: after.whenHeld, reason: after.reason }, sampling: readSampling(updated.sampling) },
      metadata: { surveyId: survey.id },
      ...meta,
    });
    return this.getSettings(actor, survey.id);
  }

  /**
   * "Don't send": held people (some or all) are not sent this survey at all, with a reason. Audited as a
   * count and the reason only, never who.
   */
  async skipHeld(actor: RequestUser, surveyId: string, input: { heldIds?: string[]; reason: string }, meta?: RequestAuditMeta) {
    const survey = await this.requireSurvey(actor, surveyId);
    const reason = input.reason?.trim() ?? '';
    if (reason.length < 5 || reason.length > 300) throw new BadRequestException('Say why they should not be sent it (5 to 300 characters).');
    const rows = await this.prisma.surveyHeldBack.findMany({
      where: { surveyId: survey.id, status: 'HELD', ...(input.heldIds?.length ? { id: { in: input.heldIds } } : {}) },
      select: { id: true },
    });
    if (!rows.length) throw new BadRequestException('Nobody is waiting to be sent this survey.');
    const now = new Date();
    const taken = await this.prisma.surveyHeldBack.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: 'HELD' },
      data: { status: 'SKIPPED', overrideReason: reason, resolvedById: actor.id, resolvedAt: now },
    });
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_HELD_BACK_NOT_SENT,
      recordType: 'Survey',
      recordId: survey.id,
      description: `Survey "${survey.title}" not sent to people held back by the 4-week rule`,
      // A count and the reason only: never who, or which other survey held them.
      newValues: { notSent: taken.count, reason },
      metadata: { surveyId: survey.id },
      ...meta,
    });
    return { message: `${taken.count} ${taken.count === 1 ? 'person' : 'people'} will not be sent it`, data: { notSent: taken.count } };
  }

  /** Held rows of surveys closed or deleted before the person's free day: LAPSED (never sent). */
  async lapseClosed(now: Date): Promise<number> {
    const r = await this.prisma.surveyHeldBack.updateMany({
      where: { status: 'HELD', survey: { OR: [{ deletedAt: { not: null } }, { status: SurveyStatus.CLOSED }] } },
      data: { status: 'LAPSED', resolvedAt: now },
    });
    return r.count;
  }

  /** True when a survey stays open long enough after now for a held person to answer it. */
  static openLongEnough(closesAt: Date | null, now: Date): boolean {
    return !closesAt || closesAt.getTime() - now.getTime() >= HELD_BACK_MIN_DAYS_LEFT * 86_400_000;
  }
}
