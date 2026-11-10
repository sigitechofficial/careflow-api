import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { CandidateStage, SurveyStatus, SurveyTargetKind, type Survey } from '@prisma/client';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { MailService } from '../mail/mail.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { surveyVisibleInScope } from './survey-scope.util';
import { surveyEmailBranding, surveyEmailFacts, type SurveyEmailBranding } from './survey-email-branding';
import { renderSurveyEmailHtml } from './survey-email-html.util';
import { SurveyUnsubscribeService } from './survey-unsubscribe.service';

/** The applicant has been told the outcome (or withdrew): they can be asked what applying was like. */
export const APPLICANT_OUTCOME_STAGES: CandidateStage[] = [CandidateStage.REJECTED, CandidateStage.WITHDRAWN, CandidateStage.ACCEPTED];
/** Invitations go in a batch of at least this many, so the day they are sent cannot point to one applicant. */
export const APPLICANT_MIN_BATCH = 3;
/** Applicants told longer ago than this are not invited (too late to ask). */
export const APPLICANT_MAX_WAIT_DAYS = 42;
/** A link works for this many days. */
export const APPLICANT_LINK_DAYS = 30;
/** Someone who applies again (a new candidate, same email) is not invited again within this many days. */
export const APPLICANT_REINVITE_DAYS = 183;
/** Invitation links start with this (personal links of staff and service users are UUIDs). */
export const APPLICANT_TOKEN_PREFIX = 'ap-';
const TOKEN_SHAPE = /^ap-[A-Za-z0-9_-]{32}$/;
const DAY_MS = 24 * 60 * 60_000;

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');
/** Today (UTC) as a date-only value. */
const dayOf = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

export const isApplicantToken = (token: string) => token.startsWith(APPLICANT_TOKEN_PREFIX);

/** Why a survey cannot invite applicants, or null when it can. */
export function applicantInvitesBlock(survey: Pick<Survey, 'targetKind' | 'isAnonymous' | 'isTemplate' | 'isCatalogue' | 'status' | 'recurrence'>, repeats: boolean): string | null {
  if (survey.isTemplate || survey.isCatalogue) return 'Start a survey from the template first.';
  if (survey.targetKind !== SurveyTargetKind.PUBLIC) return 'Only surveys for people outside the organisation can invite job applicants.';
  if (!survey.isAnonymous) return 'Applicants can only be invited to an anonymous survey, so their answers can never affect an application.';
  if (survey.recurrence || repeats) return 'A repeating survey cannot invite applicants. Use one survey for each period (for example each quarter).';
  if (survey.status === SurveyStatus.CLOSED) return 'This survey is closed.';
  return null;
}

/** The email to an applicant: warm, short, and clear that taking part cannot affect any application. */
export function applicantInviteEmail(input: {
  title: string;
  firstName: string | null;
  link: string;
  brand: SurveyEmailBranding;
  minutes: number | null;
  linkUntil: string;
  unsubscribeLink: string | null;
}): { subject: string; text: string; html: string } {
  const org = input.brand.organisation?.trim() || null;
  const first = input.firstName?.trim() || null;
  const subject = `How was applying to ${org ?? 'us'}?`;
  const greeting = first ? `Hi ${first},` : 'Hello,';
  const mins = input.minutes && input.minutes > 0 ? `${Math.round(input.minutes)} minutes` : null;
  const paragraphs = [
    `Thank you for applying to ${org ?? 'us'}. We'd like to know what applying was like, so we can make it better for the people who apply after you.`,
    `**It's anonymous and up to you.** We can't see who answered, and taking part (or not) cannot affect this or any future application.`,
    ...(mins ? [`It takes about **${mins}**, and you can do it on your phone.`] : []),
  ];
  const button = { label: 'Start the survey', href: input.link };
  const facts = `The link works until **${input.linkUntil}**`;
  const phone = input.brand.contactPhone?.trim() || null;
  const mail = input.brand.contactEmail?.trim() || null;
  const reach = [phone ? `call us on ${phone}` : '', mail ? `email ${mail}` : ''].filter(Boolean).join(' or ');
  const sections = [
    {
      heading: 'What happens to your answers',
      body: "We read them together with other applicants' answers to improve how we recruit. Please don't include names or details that could identify you or anyone else. If you have a complaint about your application, please contact us directly instead.",
    },
    { heading: 'Need help?', body: `If you'd prefer to answer on paper, or need large print or another language, ${reach || 'contact us'}.` },
  ];
  const signOff = ['Thank you,', org ?? 'The team'];
  const b = input.brand;
  const legalLines = [
    b.legalName?.trim() ? `${b.legalName.trim()}${b.companyNumber?.trim() ? ` · Registered in England and Wales, company number ${b.companyNumber.trim()}` : ''}` : '',
    b.cqcProviderId?.trim() ? `Registered with the Care Quality Commission, provider ID ${b.cqcProviderId.trim()}` : '',
  ].filter(Boolean);
  const contactLine = [phone, mail].filter(Boolean).join(' · ') || null;
  const why = `You're receiving this because you applied for a job with ${org ?? 'us'}. Please do not reply to this email.`;
  const unsubscribe = input.unsubscribeLink ? { label: 'Stop all survey messages from us, for good', href: input.unsubscribeLink } : null;
  const html = renderSurveyEmailHtml({
    organisation: org,
    logoUrl: b.logoUrl,
    brandColour: b.brandColour,
    preheader: mins ? `A ${mins} anonymous survey about applying to ${org ?? 'us'}` : `An anonymous survey about applying to ${org ?? 'us'}`,
    greeting,
    paragraphs,
    button,
    facts,
    howToAnswer: null,
    sections,
    closingNote: null,
    signOff,
    footer: { legalLines, contactLine, website: b.website ?? null, why },
    unsubscribe,
  });
  const plain = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1');
  const lines = [greeting, '', ...paragraphs.flatMap((p) => [plain(p), '']), `${button.label}: ${button.href}`, '', plain(facts), ''];
  for (const s of sections) lines.push(s.heading, s.body, '');
  lines.push(...signOff, '', '---', ...[org, contactLine, b.website ?? null, ...legalLines, why].filter((x): x is string => Boolean(x)));
  if (unsubscribe) lines.push(`To stop all survey messages from us, for good: ${unsubscribe.href}`);
  return { subject, text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), html };
}

type Eligible = { id: string; firstName: string; email: string };

/**
 * Job applicants (Phase 3): an anonymous public survey can invite applicants by email once they have been
 * told the outcome (or withdrew), each with a one-time link. One survey at a time. Every Monday the
 * applicants told since invitations were turned on (within APPLICANT_MAX_WAIT_DAYS) are invited, but only
 * in a batch of APPLICANT_MIN_BATCH or more; fewer wait for the next week.
 *
 * Nothing ties an answer to an applicant: the link's token is kept only as a hash with no applicant, and
 * the applicant only as invited (so never twice). The answers go the way of a shared link's answers on an
 * anonymous survey: held and written out in shuffled groups, days only.
 */
@Injectable()
export class SurveyApplicantInvitesService {
  private readonly logger = new Logger(SurveyApplicantInvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    @Optional() private readonly unsubscribe?: SurveyUnsubscribeService,
  ) {}

  private async requireSurvey(actor: RequestUser, id: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({ where: { id, deletedAt: null, isCatalogue: false } });
    if (!survey || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), survey)) throw new NotFoundException('Survey not found');
    return survey;
  }

  private async repeats(survey: Survey): Promise<boolean> {
    if (survey.clonedFromId) return false;
    return (await this.prisma.survey.count({ where: { clonedFromId: survey.id, deletedAt: null } })) > 0;
  }

  /** The applicants who would be invited now: told the outcome since `from`, not invited, not opted out, with an email. */
  private async eligible(from: Date, now: Date): Promise<Eligible[]> {
    const since = new Date(Math.max(from.getTime(), now.getTime() - APPLICANT_MAX_WAIT_DAYS * DAY_MS));
    const candidates = await this.prisma.candidate.findMany({
      where: {
        deletedAt: null,
        email: { not: null },
        stage: { in: APPLICANT_OUTCOME_STAGES },
        // When they reached the stage they are at now.
        stageHistory: { some: { createdAt: { gte: since } } },
      },
      select: { id: true, firstName: true, email: true, stage: true, stageHistory: { orderBy: { createdAt: 'desc' }, take: 1, select: { toStage: true, createdAt: true } } },
    });
    const told = candidates.filter((c) => {
      const last = c.stageHistory[0];
      return last && last.toStage === c.stage && last.createdAt >= since && Boolean(c.email?.trim());
    });
    if (!told.length) return [];
    const ids = told.map((c) => c.id);
    const emailOf = (e: string | null) => (e ?? '').trim().toLowerCase();
    // Their earlier applications (same email), so nobody is invited twice within 6 months.
    const earlier = await this.prisma.candidate.findMany({
      where: { id: { notIn: ids }, email: { in: [...new Set(told.map((c) => c.email!.trim()))], mode: 'insensitive' } },
      select: { id: true, email: true },
    });
    const [invited, optOuts] = await Promise.all([
      this.prisma.surveyApplicantInvited.findMany({ where: { candidateId: { in: [...ids, ...earlier.map((e) => e.id)] } }, select: { candidateId: true, invitedOn: true } }),
      this.prisma.surveyContactOptOut.findMany({
        where: { subjectKind: 'CANDIDATE', subjectId: { in: ids }, channel: { in: ['ALL', 'EMAIL'] } },
        select: { subjectId: true },
      }),
    ]);
    const reinviteFrom = dayOf(new Date(now.getTime() - APPLICANT_REINVITE_DAYS * DAY_MS));
    const earlierEmail = new Map(earlier.map((e) => [e.id, emailOf(e.email)]));
    const recentEmails = new Set(invited.filter((r) => earlierEmail.has(r.candidateId) && r.invitedOn >= reinviteFrom).map((r) => earlierEmail.get(r.candidateId)!));
    const skip = new Set([...invited.map((r) => r.candidateId), ...optOuts.map((r) => r.subjectId)]);
    const seen = new Set<string>();
    return told
      .filter((c) => {
        const email = emailOf(c.email);
        // One invitation per email address, even with two applications told at once.
        if (skip.has(c.id) || recentEmails.has(email) || seen.has(email)) return false;
        seen.add(email);
        return true;
      })
      .map((c) => ({ id: c.id, firstName: c.firstName, email: c.email!.trim() }));
  }

  /** The survey with invitations on (one at a time), or null. */
  private async activeSurvey(): Promise<Survey | null> {
    return this.prisma.survey.findFirst({ where: { applicantInvitesFrom: { not: null }, deletedAt: null } });
  }

  /** Staff: whether this survey invites applicants, and what is happening (counts only). */
  async status(actor: RequestUser, surveyId: string) {
    const survey = await this.requireSurvey(actor, surveyId);
    const blockedBy = applicantInvitesBlock(survey, await this.repeats(survey));
    const other = await this.prisma.survey.findFirst({
      where: { applicantInvitesFrom: { not: null }, deletedAt: null, id: { not: survey.id } },
      select: { id: true, title: true },
    });
    const on = Boolean(survey.applicantInvitesFrom);
    const now = new Date();
    // How many answered is never shown here: answers are held and added in groups (Results), so the
    // moment one arrives is never visible.
    const [invited, waiting] = await Promise.all([
      this.prisma.surveyApplicantInvited.count({ where: { surveyId: survey.id } }),
      on ? this.eligible(survey.applicantInvitesFrom!, now).then((r) => r.length) : Promise.resolve(0),
    ]);
    return {
      message: 'Applicant invitations',
      data: {
        on,
        from: survey.applicantInvitesFrom?.toISOString() ?? null,
        canTurnOn: !blockedBy,
        blockedBy,
        otherSurvey: other,
        invited,
        waiting,
        minBatch: APPLICANT_MIN_BATCH,
        linkDays: APPLICANT_LINK_DAYS,
        canSend: Boolean(this.appBase()),
      },
    };
  }

  /** Turn invitations on (off on any other survey: one at a time) or off. Audited. */
  async setOn(actor: RequestUser, surveyId: string, on: boolean, meta?: RequestAuditMeta) {
    const survey = await this.requireSurvey(actor, surveyId);
    if (on) {
      const blockedBy = applicantInvitesBlock(survey, await this.repeats(survey));
      if (blockedBy) throw new BadRequestException(blockedBy);
    }
    if (Boolean(survey.applicantInvitesFrom) === on) return this.status(actor, surveyId);
    const now = new Date();
    const others = on
      ? await this.prisma.survey.findMany({ where: { applicantInvitesFrom: { not: null }, deletedAt: null, id: { not: survey.id } }, select: { id: true, title: true } })
      : [];
    await this.prisma.$transaction([
      ...(others.length ? [this.prisma.survey.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { applicantInvitesFrom: null } })] : []),
      this.prisma.survey.update({ where: { id: survey.id }, data: { applicantInvitesFrom: on ? now : null, updatedById: actor.id } }),
    ]);
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_APPLICANT_INVITES_CHANGED,
      recordType: 'Survey',
      recordId: survey.id,
      description: on
        ? `Job applicants invited to survey "${survey.title}"${others.length ? ` (instead of "${others.map((o) => o.title).join('", "')}")` : ''}`
        : `Job applicants no longer invited to survey "${survey.title}"`,
      oldValues: { applicantInvites: !on },
      newValues: { applicantInvites: on },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return this.status(actor, surveyId);
  }

  private appBase(): string | null {
    const configured = this.config.get<string>('app.adminAppUrl', '')?.trim().replace(/\/+$/, '');
    return configured || null;
  }

  /** Every Monday morning: this week's invitations. */
  @Cron('0 9 * * 1', { name: 'survey-applicant-invites', timeZone: 'Europe/London' })
  async weekly(): Promise<void> {
    try {
      const sent = await this.runBatch();
      if (sent) this.logger.log(`Survey applicant invitations: ${sent} sent`);
    } catch (e) {
      this.logger.warn(`Survey applicant invitations not sent this week (${e instanceof Error ? e.name : 'error'})`);
    }
  }

  /** Invite the applicants waiting, when there are enough of them. Returns how many were sent. */
  async runBatch(now: Date = new Date()): Promise<number> {
    // Links past their last day are of no use: removed (their survey's counts keep only the used ones).
    await this.prisma.surveyApplicantInvite.deleteMany({ where: { used: false, expiresOn: { lt: dayOf(now) } } });
    const survey = await this.activeSurvey();
    const base = this.appBase();
    if (!survey || !base || survey.status !== SurveyStatus.ACTIVE) return 0;
    if (applicantInvitesBlock(survey, await this.repeats(survey))) return 0;
    if (survey.opensAt && survey.opensAt > now) return 0;
    // Not when the survey closes within a few days (they would have no time to answer).
    if (survey.closesAt && survey.closesAt.getTime() - now.getTime() < 3 * DAY_MS) return 0;
    const people = await this.eligible(survey.applicantInvitesFrom!, now);
    if (people.length < APPLICANT_MIN_BATCH) return 0;

    const today = dayOf(now);
    const lastDay = new Date(today.getTime() + (APPLICANT_LINK_DAYS - 1) * DAY_MS);
    const linkEnd = survey.closesAt && survey.closesAt < lastDay ? dayOf(survey.closesAt) : lastDay;
    const links = people.map(() => `${APPLICANT_TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`);
    // Written in a shuffled order and apart from the applicants, so no row can be matched to another.
    const shuffled = [...links];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    await this.prisma.$transaction([
      this.prisma.surveyApplicantInvite.createMany({
        data: shuffled.map((t) => ({ id: randomUUID(), surveyId: survey.id, tokenHash: hashOf(t), createdOn: today, expiresOn: linkEnd })),
      }),
      this.prisma.surveyApplicantInvited.createMany({
        data: people.map((p) => ({ id: randomUUID(), candidateId: p.id, surveyId: survey.id, invitedOn: today })),
        skipDuplicates: true,
      }),
    ]);

    const brand = await surveyEmailBranding(this.prisma);
    const facts = await surveyEmailFacts(this.prisma, survey.id);
    const linkUntil = linkEnd.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    let sent = 0;
    for (const [i, person] of people.entries()) {
      try {
        const unsubscribeLink = (await this.unsubscribe?.link(base, { subjectKind: 'CANDIDATE', subjectId: person.id }).catch(() => null)) ?? null;
        const m = applicantInviteEmail({
          title: survey.title,
          firstName: person.firstName,
          link: `${base}/survey/${links[i]}`,
          brand,
          minutes: facts.minutes,
          linkUntil,
          unsubscribeLink,
        });
        await this.mail.send({ kind: 'surveys', to: person.email, subject: m.subject, text: m.text, html: m.html, skipBcc: true });
        sent += 1;
      } catch (e) {
        this.logger.warn(`Survey ${survey.id}: an applicant invitation email failed (${e instanceof Error ? e.name : 'error'})`);
      }
    }
    // Counts only: never who was invited.
    await this.audit.logAudit({
      userId: undefined,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_APPLICANT_INVITES_CHANGED,
      recordType: 'Survey',
      recordId: survey.id,
      description: `${sent} job ${sent === 1 ? 'applicant' : 'applicants'} invited to survey "${survey.title}"`,
      newValues: { invited: people.length, sent },
    });
    return sent;
  }

  // ─── The link (public) ──────────────────────────────────────────────────

  /** The survey an invitation link opens, whether it was used, and whether it has expired; null when unknown. */
  async resolve(token: string, now: Date = new Date()): Promise<{ id: string; survey: Survey; used: boolean; expired: boolean } | null> {
    if (!TOKEN_SHAPE.test(token)) return null;
    const invite = await this.prisma.surveyApplicantInvite.findUnique({ where: { tokenHash: hashOf(token) }, include: { survey: true } });
    if (!invite || invite.survey.deletedAt || invite.survey.targetKind !== SurveyTargetKind.PUBLIC || !invite.survey.isAnonymous) return null;
    return { id: invite.id, survey: invite.survey, used: invite.used, expired: invite.expiresOn < dayOf(now) };
  }

  /** Use the link (once, on every server at once). False when it was already used or has expired. */
  async claim(id: string, now: Date = new Date()): Promise<boolean> {
    const r = await this.prisma.surveyApplicantInvite.updateMany({ where: { id, used: false, expiresOn: { gte: dayOf(now) } }, data: { used: true } });
    return r.count === 1;
  }

  /** The answers were not kept (a missing answer): the link can be used again. */
  async release(id: string): Promise<void> {
    await this.prisma.surveyApplicantInvite.updateMany({ where: { id, used: true }, data: { used: false } });
  }
}
