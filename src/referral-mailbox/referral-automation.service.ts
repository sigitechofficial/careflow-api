import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EnquiryLostReason, EnquiryStage, Prisma, ReferralEmailStatus } from '@prisma/client';
import { parseFromHeader } from './referral-email-parse.util';
import { QuotationsService } from '../crm/quotations/quotations.service';
import type { QuoteDraftDto } from '../crm/quotations/dto/quotation.dto';
import { EMAIL_RE, htmlToPlain, sanitizeReplyHtml, textToHtml, type ReplyMime } from './referral-reply-mime.util';
import { mayGetCopy, referralTestCopyAddresses } from './referral-test-copies.util';
import { normaliseQuoteRates } from '../crm/quotations/quote-pricing.util';
import { exampleVisitPrices, formatGbp, isCommissioned, standardRatesInWords, standardRatesList } from './referral-pricing.util';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { CrmService } from '../crm/crm.service';
import { ServiceUserVisitPlansService } from '../service-user-visit-plans/service-user-visit-plans.service';
import { ReferralConnectorsService } from './connectors/referral-connectors.service';
import { ReferralExtractionService, type ReferralExtraction } from './referral-extraction.service';
import { enquiryFromReferral } from './referral-to-enquiry.util';
import {
  EMAIL_KIND_INFO,
  EMAIL_KINDS,
  RULE_CATALOG,
  emailKindOf,
  type EmailKind,
  kindAction,
  normaliseRules,
  ruleChecks,
  type ReferralRules,
} from './referral-rules.util';
import {
  DECISION_LABEL,
  addMinutes,
  branchForCouncil,
  carerGenderPreference,
  matchFunder,
  shiftTime,
  dayIndexes,
  daysUntil,
  decideReferral,
  lookupCouncil,
  rateSummary,
  type ReferralCheck,
  type ReferralDecision,
} from './referral-checks.util';

const t = (v: string | null | undefined) => (v ?? '').trim();

@Injectable()
export class ReferralAutomationService {
  private readonly logger = new Logger(ReferralAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly visitPlans: ServiceUserVisitPlansService,
    private readonly ai: ReferralExtractionService,
    private readonly quotations: QuotationsService,
    private readonly connectors: ReferralConnectorsService,
  ) {}

  /* ─── rates and quotations ───────────────────────────────────── */

  /** The branch's standard private rates, else the all-branches row; null when none are set. */
  private async standardRateFor(locationId: string | null) {
    const rows = await this.prisma.quoteStandardRate.findMany({
      where: { isActive: true, OR: [{ locationId: null }, ...(locationId ? [{ locationId }] : [])] },
      orderBy: { updatedAt: 'desc' },
    });
    const row = rows.find((r) => r.locationId && r.locationId === locationId) ?? rows.find((r) => !r.locationId);
    if (!row) return null;
    const branch = row.locationId
      ? await this.prisma.location.findUnique({ where: { id: row.locationId }, select: { name: true } })
      : null;
    return {
      hourlyRate: Number(row.hourlyRate),
      rates: row.rates,
      source: branch ? `${branch.name} standard private rates` : 'Standard private rates (all branches)',
    };
  }

  private async existingQuote(versionId: string) {
    const v = await this.prisma.enquiryQuotationVersion.findUnique({
      where: { id: versionId },
      select: { id: true, quotationId: true, weeklyTotal: true, validUntil: true, quotation: { select: { quotationNumber: true, deletedAt: true } } },
    });
    if (!v || v.quotation.deletedAt) return null;
    return {
      quotationId: v.quotationId,
      versionId: v.id,
      quotationNumber: v.quotation.quotationNumber,
      weeklyTotal: Number(v.weeklyTotal),
      validUntil: v.validUntil?.toISOString().slice(0, 10) ?? '',
    };
  }

  /** A provisional quotation through the normal quotation process, priced from the standard private rates. */
  private async createQuote(
    actor: RequestUser,
    enquiryId: string,
    locationId: string,
    e: ReferralExtraction,
    visits: ReferralExtraction['visits'],
    standard: { hourlyRate: number; rates: unknown; source: string },
    validDays: number,
    subject: string | null,
  ) {
    const today = new Date();
    const validUntil = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + Math.max(1, validDays)))
      .toISOString()
      .slice(0, 10);
    const start = t(e.care.requestedStartDate);
    const dto = {
      quoteType: 'PROVISIONAL_ESTIMATE',
      locationId,
      fundingCategory: e.funding.type === 'MIXED' ? 'MIXED' : 'PRIVATE',
      proposedStartDate: /^\d{4}-\d{2}-\d{2}$/.test(start) && (daysUntil(start) ?? -1) >= 0 ? start : null,
      validUntil,
      hourlyRate: standard.hourlyRate,
      rates: (standard.rates ?? null) as never,
      clientNotes:
        'A provisional quotation from the details in your email. The visits and the price are confirmed after our assessment visit.',
      internalNotes: `Made automatically from the referral email "${subject ?? ''}" with the ${standard.source}.`,
      patterns: visits.map((v, i) => {
        const startTime = v.startTime.padStart(5, '0');
        return {
          label: v.label || `Visit ${i + 1}`,
          startTime,
          endTime: addMinutes(startTime, v.durationMinutes),
          durationMinutes: v.durationMinutes,
          daysOfWeek: dayIndexes(v.days ?? []),
          frequency: 'WEEKLY',
          carersPerVisit: Math.max(1, Math.min(4, v.carers || 1)),
          nightDuty: 'NONE',
        };
      }),
      fundings: [],
      extras: [],
    } as unknown as QuoteDraftDto;
    const q = await this.quotations.createApprovedFromReferral(
      actor,
      enquiryId,
      dto,
      `Approved automatically: ${standard.source}, from the referral email.`,
    );
    return { ...q, validUntil };
  }

  /* ─── settings ───────────────────────────────────────────────── */

  async settings() {
    const s =
      (await this.prisma.referralAutomationSettings.findFirst()) ??
      (await this.prisma.referralAutomationSettings.create({ data: {} }));
    const coverage = await this.prisma.referralBranchCoverage.findMany({ orderBy: { createdAt: 'asc' } });
    const locations = await this.prisma.location.findMany({
      where: { id: { in: coverage.map((c) => c.locationId) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(locations.map((l) => [l.id, l.name]));
    const rates = await this.prisma.quoteStandardRate.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    return {
      data: {
        ...s,
        rules: normaliseRules(s.rules),
        ruleCatalog: RULE_CATALOG,
        emailKinds: EMAIL_KINDS.map((k) => ({ key: k, ...EMAIL_KIND_INFO[k] })),
        coverage: coverage.map((c) => ({ ...c, branchName: nameOf.get(c.locationId) ?? 'Branch' })),
        standardRates: rates.map((r) => ({
          id: r.id,
          locationId: r.locationId,
          branchName: r.locationId ? (nameOf.get(r.locationId) ?? 'Branch') : 'All branches',
          hourlyRate: Number(r.hourlyRate),
          rates: r.rates,
          notes: r.notes,
        })),
      },
    };
  }

  async updateSettings(
    userId: string,
    dto: {
      autoCreateEnquiry?: boolean;
      autoReply?: boolean;
      autoReplyDecisions?: string[];
      minNoticeDays?: number;
      answerPriceQuestions?: boolean;
      availabilityMode?: 'SAME_CARER' | 'ANY_CARER_EACH_DAY';
      travelBufferMinutes?: number;
      copyRepliesTo?: string[];
      autoQuote?: boolean;
      quoteValidDays?: number;
      unplacedLocationId?: string | null;
      rules?: ReferralRules;
      standardRates?: Array<{ locationId: string | null; hourlyRate: number | null; rates?: unknown; notes?: string | null }>;
      coverage?: Array<{
        locationId: string;
        localAuthorities: string[];
        replyManagerName?: string | null;
        replyManagerTitle?: string | null;
        replyPhone?: string | null;
        isActive?: boolean;
      }>;
    },
  ) {
    const current = await this.settings();
    // A decline ("NO") is never sent automatically.
    const valid = new Set(['YES', 'POSSIBLY', 'NEED_INFO']);
    await this.prisma.$transaction(async (tx) => {
      await tx.referralAutomationSettings.update({
        where: { id: current.data.id },
        data: {
          ...(dto.autoCreateEnquiry !== undefined ? { autoCreateEnquiry: dto.autoCreateEnquiry } : {}),
          ...(dto.autoReply !== undefined ? { autoReply: dto.autoReply } : {}),
          ...(dto.autoReplyDecisions ? { autoReplyDecisions: dto.autoReplyDecisions.filter((d) => valid.has(d)) } : {}),
          ...(dto.minNoticeDays !== undefined ? { minNoticeDays: Math.max(0, Math.min(60, dto.minNoticeDays)) } : {}),
          ...(dto.answerPriceQuestions !== undefined ? { answerPriceQuestions: dto.answerPriceQuestions } : {}),
          ...(dto.availabilityMode ? { availabilityMode: dto.availabilityMode } : {}),
          ...(dto.travelBufferMinutes !== undefined
            ? { travelBufferMinutes: Math.max(0, Math.min(90, Math.round(dto.travelBufferMinutes))) }
            : {}),
          ...(dto.copyRepliesTo
            ? { copyRepliesTo: [...new Set(dto.copyRepliesTo.map((x) => x.trim().toLowerCase()).filter((x) => EMAIL_RE.test(x)))] }
            : {}),
          ...(dto.autoQuote !== undefined ? { autoQuote: dto.autoQuote } : {}),
          ...(dto.quoteValidDays !== undefined ? { quoteValidDays: Math.max(1, Math.min(180, Math.round(dto.quoteValidDays))) } : {}),
          ...(dto.unplacedLocationId !== undefined ? { unplacedLocationId: dto.unplacedLocationId || null } : {}),
          ...(dto.rules ? { rules: normaliseRules(dto.rules) as unknown as Prisma.InputJsonValue } : {}),
          updatedById: userId,
        },
      });
      // Standard private rates: one row per branch (or all branches); an empty rate removes the row.
      for (const r of dto.standardRates ?? []) {
        const existing = await tx.quoteStandardRate.findFirst({ where: { locationId: r.locationId ?? null, isActive: true } });
        if (r.hourlyRate == null || !(r.hourlyRate > 0)) {
          if (existing) await tx.quoteStandardRate.update({ where: { id: existing.id }, data: { isActive: false, updatedById: userId } });
          continue;
        }
        const data = {
          hourlyRate: new Prisma.Decimal(Math.round(r.hourlyRate * 100) / 100),
          rates: (normaliseQuoteRates(r.rates) ?? Prisma.DbNull) as Prisma.InputJsonValue,
          notes: r.notes?.trim() || null,
          updatedById: userId,
        };
        if (existing) await tx.quoteStandardRate.update({ where: { id: existing.id }, data });
        else await tx.quoteStandardRate.create({ data: { ...data, locationId: r.locationId ?? null } });
      }
      for (const c of dto.coverage ?? []) {
        const data = {
          localAuthorities: [...new Set(c.localAuthorities.map((x) => x.trim()).filter(Boolean))],
          replyManagerName: c.replyManagerName?.trim() || null,
          replyManagerTitle: c.replyManagerTitle?.trim() || null,
          replyPhone: c.replyPhone?.trim() || null,
          isActive: c.isActive ?? true,
          updatedById: userId,
        };
        await tx.referralBranchCoverage.upsert({
          where: { locationId: c.locationId },
          create: { locationId: c.locationId, ...data },
          update: data,
        });
      }
    });
    return this.settings();
  }

  /** The branch for emails whose area can't be worked out: the chosen one, else the first active covered branch. */
  private async unplacedBranch(
    settings: { unplacedLocationId: string | null; coverage: Array<{ locationId: string; isActive: boolean }> },
    mailboxLocationId: string | null = null,
  ) {
    // The mailbox's own branch first (e.g. a branch's referrals address), then the setting, then any covered branch.
    const ids = [mailboxLocationId, settings.unplacedLocationId, ...settings.coverage.filter((c) => c.isActive).map((c) => c.locationId)].filter(
      (x): x is string => Boolean(x),
    );
    for (const id of ids) {
      const loc = await this.prisma.location.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true } });
      if (loc) return loc;
    }
    return null;
  }

  /* ─── the pipeline ───────────────────────────────────────────── */

  /** After Claude has read an email: branch, checks, decision, enquiry, reply (sent when settings allow). */
  async process(emailId: string) {
    // One run per email at a time (the 2-minute check, "Read again" and "Check again" can overlap).
    if (this.running.has(emailId)) return;
    this.running.add(emailId);
    try {
      await this.processOnce(emailId);
    } finally {
      this.running.delete(emailId);
    }
  }

  private readonly running = new Set<string>();

  private async processOnce(emailId: string) {
    const row =await this.prisma.referralEmail.findUnique({ where: { id: emailId }, include: { mailbox: true } });
    if (!row?.extraction) return;
    const e = row.extraction as unknown as ReferralExtraction;
    const settings = (await this.settings()).data;
    const coverage = settings.coverage.filter((c) => c.isActive);
    // What kind of email this is, and what our rules say to do with that kind.
    const kind = emailKindOf(e);
    const action = kindAction(settings.rules, kind);
    if (action === 'IGNORE') return;
    // Only these kinds can become a new enquiry or get a drafted reply (complaints, news about clients… are for staff).
    const newCare = EMAIL_KIND_INFO[kind].newCare && e.isReferral;
    if (!newCare) return this.processForStaff(row, e, kind);

    // 1. Branch from the postcode.
    let locationId = row.locationId;
    const checks: ReferralCheck[] = [];
    const postcode = t(e.person.postcode);
    if (postcode) {
      const found = await lookupCouncil(postcode);
      if (found.kind === 'exact') {
        const branch = branchForCouncil(found.council, coverage);
        if (branch) {
          locationId ??= branch.locationId;
          checks.push({ key: 'area', label: 'Area', result: 'PASS', detail: `${postcode} is in ${found.council}, covered by ${branch.branchName}.` });
        } else {
          checks.push({ key: 'area', label: 'Area', result: 'FAIL', detail: `${postcode} is in ${found.council}, which none of our branches covers.` });
        }
      } else if (found.kind === 'district') {
        const covered = found.councils
          .map((c) => ({ council: c, branch: branchForCouncil(c, coverage) }))
          .filter((x) => x.branch);
        if (covered.length) {
          locationId ??= covered[0].branch!.locationId;
          checks.push({
            key: 'area',
            label: 'Area',
            result: 'WARN',
            detail: `Only the district ${found.district} is known (${found.councils.join(', ')}); probably ${covered[0].council}, covered by ${covered[0].branch!.branchName}. Confirm the full address.`,
          });
        } else {
          checks.push({ key: 'area', label: 'Area', result: 'FAIL', detail: `${found.district} is in ${found.councils.join(', ')}, which none of our branches covers.` });
        }
      } else {
        checks.push({ key: 'area', label: 'Area', result: 'UNKNOWN', detail: found.reason });
      }
    } else {
      checks.push({ key: 'area', label: 'Area', result: 'UNKNOWN', detail: 'No postcode was given, so the area could not be checked.' });
    }

    // 2. Already known?
    const dup = await this.findExisting(e);
    checks.push(
      dup.enquiry || dup.serviceUser
        ? {
            key: 'duplicate',
            label: 'Already known',
            result: 'WARN',
            detail: dup.serviceUser
              ? `Matches existing service user ${dup.serviceUser.name}.`
              : `Matches existing enquiry ${dup.enquiry!.referenceNumber}.`,
          }
        : dup.closedEnquiry
          ? {
              key: 'duplicate',
              label: 'Already known',
              result: 'WARN',
              detail: `Was enquiry ${dup.closedEnquiry.referenceNumber} before (${dup.closedEnquiry.stage === EnquiryStage.WON ? 'won' : 'closed as lost'}); a new enquiry is made.`,
            }
          : { key: 'duplicate', label: 'Already known', result: 'PASS', detail: 'No existing enquiry or service user matches.' },
    );

    // 3. Start date.
    const start = t(e.care.requestedStartDate);
    const days = start ? daysUntil(start) : null;
    checks.push(
      days == null
        ? { key: 'start', label: 'Start date', result: 'UNKNOWN', detail: 'No start date was given.' }
        : days < 0
          ? { key: 'start', label: 'Start date', result: 'WARN', detail: `The requested start (${start}) is in the past.` }
          : days < settings.minNoticeDays
            ? { key: 'start', label: 'Start date', result: 'WARN', detail: `Starts in ${days} day(s); we usually need ${settings.minNoticeDays}.` }
            : { key: 'start', label: 'Start date', result: 'PASS', detail: `Starts ${start} (${days} days' notice).` },
    );

    // 4. Carers free for each visit (the rota's own rules), with travel time either side.
    const gender = carerGenderPreference(e.care.genderPreference);
    const buffer = Math.max(0, settings.travelBufferMinutes ?? 0);
    const perDay = settings.availabilityMode !== 'SAME_CARER';
    for (const [i, v] of (e.visits ?? []).entries()) {
      const key = `carers:${i}`;
      const label = `Carers for ${v.label || `visit ${i + 1}`}`;
      const end = v.startTime ? addMinutes(v.startTime, v.durationMinutes || 30) : null;
      if (!locationId) {
        checks.push({ key, label, result: 'UNKNOWN', detail: 'No branch yet, so carers could not be checked.' });
        continue;
      }
      if (!v.startTime || !end) {
        checks.push({ key, label, result: 'UNKNOWN', detail: 'No visit time was given.' });
        continue;
      }
      const needed = Math.max(1, Math.min(4, v.carers || 1));
      const from = shiftTime(v.startTime.padStart(5, '0'), -buffer) ?? v.startTime.padStart(5, '0');
      const to = shiftTime(end, buffer) ?? end;
      const freeOn = async (days: number[]) => {
        const res = await this.visitPlans.suggestCarersForBranch(
          [locationId],
          {
            slotCode: (v.label || `VISIT_${i + 1}`).toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 60),
            daysOfWeek: days,
            plannedStartTime: from,
            plannedEndTime: to,
            requiredCarers: needed,
          } as never,
          e.careAreas ?? [],
        );
        return res.data.candidates.filter(
          (c) =>
            !c.ruleBlocked &&
            !c.hasRotaConflict &&
            !c.exceedsContractedHours &&
            c.availability.timeWindowOk &&
            c.availability.unavailableDays.length === 0 &&
            c.skills.missing.length === 0 &&
            (!gender || (c.gender ?? '').toLowerCase().startsWith(gender)),
        ).length;
      };
      try {
        const days = dayIndexes(v.days ?? []);
        // Per day: the lowest number free on any one day (carers may differ by day). Same carer: free on all of them.
        const free = perDay ? Math.min(...(await Promise.all(days.map((d) => freeOn([d]))))) : await freeOn(days);
        const when = `${v.startTime}–${end}${buffer ? ` (+${buffer} min travel either side)` : ''}`;
        const extra = gender ? ` ${gender} ` : ' ';
        const scope = perDay ? ' on every day asked for' : ' for all the days asked for';
        checks.push(
          free >= needed
            ? { key, label, result: 'PASS', detail: `${free}${extra}carer(s) free at ${when}${scope}${needed > 1 ? ` (${needed} needed)` : ''}.` }
            : free > 0
              ? { key, label, result: 'WARN', detail: `Only ${free}${extra}carer free at ${when} on some days; ${needed} needed.` }
              : { key, label, result: 'FAIL', detail: `No${extra}carer free at ${when}${perDay ? ' on at least one of the days' : scope}.` },
        );
      } catch (err) {
        checks.push({ key, label, result: 'UNKNOWN', detail: `Could not check carers: ${(err as Error).message}` });
      }
    }

    // 5. Our rules: care we note, hand to a manager or decline (for this branch), and our own written rules.
    const fromRules = ruleChecks(e, settings.rules, locationId);
    checks.push(...fromRules);
    if (!fromRules.some((c) => c.key.startsWith('rule:'))) {
      checks.push({ key: 'service', label: 'Type of care', result: 'PASS', detail: 'Nothing our rules hand to a manager or decline.' });
    }
    if (action === 'STAFF') {
      checks.push({
        key: 'kind',
        label: 'Kind of email',
        result: 'WARN',
        detail: `${EMAIL_KIND_INFO[kind].label}: our rules say staff handle this, so no reply is sent automatically.`,
      });
    }

    // 6. Funding and (if asked) our rate.
    const funder = t(e.funding.funderName)
      ? matchFunder(
          t(e.funding.funderName),
          await this.prisma.funder.findMany({
            where: { deletedAt: null, isActive: true },
            select: { name: true, defaultChargeCard: { select: { rules: { select: { rateType: true, dayType: true, amount: true, label: true } } } } },
          }),
        )
      : null;
    checks.push(
      funder
        ? { key: 'funding', label: 'Funding', result: 'PASS', detail: `${funder.name} is one of our funders.` }
        : { key: 'funding', label: 'Funding', result: 'WARN', detail: t(e.funding.funderName) ? `${e.funding.funderName} is not set up as a funder yet.` : 'Funder not given.' },
    );
    // Where a price comes from (see referral-pricing.util): the funder's card for commissioned care,
    // otherwise the branch's (or all branches') standard private rates.
    const priceRequest = e.priceAsked || e.requestType === 'PRICE_ENQUIRY';
    const commissioned = isCommissioned(e.funding.type);
    const funderRate =
      commissioned && funder?.defaultChargeCard
        ? rateSummary(funder.defaultChargeCard.rules.map((r) => ({ ...r, amount: Number(r.amount) })))
        : null;
    const standard = commissioned ? null : await this.standardRateFor(locationId);
    if (priceRequest || standard) {
      checks.push(
        commissioned
          ? funderRate
            ? { key: 'price', label: 'Price', result: 'PASS', detail: `Funded care: ${funder!.name}'s standard rate (${funderRate}).` }
            : { key: 'price', label: 'Price', result: 'WARN', detail: 'Funded care: the cost is agreed with the funder; no funder rate is set up.' }
          : standard
            ? { key: 'price', label: 'Price', result: 'PASS', detail: `${standard.source}: ${standardRatesInWords(standard.hourlyRate, standard.rates)}.` }
            : { key: 'price', label: 'Price', result: 'WARN', detail: 'No standard private rates are set up, so no price was given. Add them in Referral inbox → Rates.' },
      );
    }

    // 7. Risks (never block; for the assessment).
    if (e.risks.length) checks.push({ key: 'risks', label: 'Risks to assess', result: 'PASS', detail: e.risks.join('; ') });

    const { decision, reasons } = decideReferral(checks);

    // 8. Enquiry: link to an existing one or create it.
    // An existing service user is never turned into a new enquiry automatically: a person decides.
    let enquiryId = row.enquiryId;
    const actor = await this.systemActor(row.mailbox.connectedById);
    if (!enquiryId && settings.autoCreateEnquiry && actor && !dup.serviceUser) {
      if (dup.enquiry) {
        enquiryId = dup.enquiry.id;
        await this.prisma.enquiryEvent.create({
          data: { enquiryId, action: 'Referral email received', note: `${row.subject ?? ''} — linked to this enquiry`, userId: null },
        });
      } else {
        // The area couldn't be worked out (no or unknown postcode, e.g. "what do you charge?"): record it
        // under the "no postcode" branch so it isn't lost. Out-of-area emails (area FAIL) still get no enquiry.
        const areaUnknown = checks.find((c) => c.key === 'area')?.result === 'UNKNOWN';
        const unplaced = !locationId && areaUnknown ? await this.unplacedBranch(settings, row.mailbox?.defaultLocationId ?? null) : null;
        const enquiryLocation = locationId ?? unplaced?.id ?? null;
        if (enquiryLocation) {
          const dto = enquiryFromReferral(e, row, enquiryLocation);
          dto.nextFollowUpAt = followUpDate(e.urgency);
          dto.nextAction = unplaced
            ? 'No postcode given: ask for the address and move this enquiry to the right branch'
            : 'Check the referral details (created from email) and reply';
          const created = await this.crm.create(actor, dto);
          enquiryId = (created.data as { id: string }).id;
          if (unplaced) {
            await this.prisma.enquiryEvent.create({
              data: {
                enquiryId,
                action: 'Branch not known yet',
                note: `The email gave no usable postcode, so this enquiry was placed in ${unplaced.name} for now. Change the branch once the address is known.`,
                userId: null,
              },
            });
          }
        }
      }
    }
    // Only note the checks on the enquiry when they are new or have changed (re-reading doesn't repeat them).
    const sameAsBefore =
      row.enquiryId === enquiryId && row.decision === decision && JSON.stringify(row.checks ?? null) === JSON.stringify(checks);
    if (enquiryId && !sameAsBefore) {
      await this.prisma.enquiryEvent.create({
        data: {
          enquiryId,
          action: `${row.decision ? 'Referral checks updated' : 'Referral checks'}: ${DECISION_LABEL[decision]}`,
          note: [...reasons, ...checks.map((c) => `${c.result} — ${c.label}: ${c.detail}`)].join('\n').slice(0, 4000),
          userId: null,
        },
      });
    }

    // 9. Provisional quotation (the existing quotation process) when the visits are known and priced privately.
    let quote: { quotationId: string; versionId: string; quotationNumber: string; weeklyTotal: number; validUntil: string } | null =
      row.quotationVersionId ? await this.existingQuote(row.quotationVersionId) : null;
    const quotable = (e.visits ?? []).filter((v) => /^\d{1,2}:\d{2}$/.test(t(v.startTime)) && v.durationMinutes > 0);
    const earlierQuote =
      !quote && enquiryId
        ? await this.prisma.enquiryQuotation.findFirst({
            where: { enquiryId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { quotationNumber: true },
          })
        : null;
    if (earlierQuote) {
      checks.push({
        key: 'quote',
        label: 'Quotation',
        result: 'WARN',
        detail: `The enquiry already has quotation ${earlierQuote.quotationNumber}; no new one was made. Revise it if the visits changed.`,
      });
    } else if (
      !quote &&
      settings.autoQuote &&
      standard &&
      enquiryId &&
      locationId &&
      actor &&
      decision !== 'NO' &&
      quotable.length &&
      quotable.length === (e.visits ?? []).length
    ) {
      try {
        quote = await this.createQuote(actor, enquiryId, locationId, e, quotable, standard, settings.quoteValidDays, row.subject);
        checks.push({ key: 'quote', label: 'Quotation', result: 'PASS', detail: `${quote.quotationNumber}: ${formatGbp(quote.weeklyTotal)} a week, attached to the reply.` });
      } catch (err) {
        checks.push({ key: 'quote', label: 'Quotation', result: 'WARN', detail: `No quotation made: ${(err as Error).message}` });
      }
    } else if (quote) {
      checks.push({ key: 'quote', label: 'Quotation', result: 'PASS', detail: `${quote.quotationNumber}: ${formatGbp(quote.weeklyTotal)} a week, attached to the reply.` });
    }

    // 10. Reply.
    let replyText: string | null = null;
    let costUsd = 0;
    const alreadySent = Boolean(row.replySentAt);
    if (newCare && !alreadySent) {
      const coverageRow = coverage.find((c) => c.locationId === locationId);
      const draft = await this.ai.draftReply({
        decision,
        decisionLabel: DECISION_LABEL[decision],
        reasons,
        checks: checks
          .filter((c) => !['risks', 'duplicate', 'price', 'quote', 'funding', 'kind'].includes(c.key) && !c.key.startsWith('note:'))
          .map(({ label, result, detail }) => ({ label, result, detail })),
        requestType: e.requestType ?? 'CARE_REFERRAL',
        pricing:
          priceRequest || quote
            ? {
                source: commissioned ? (funder?.name ?? null) : (standard?.source ?? null),
                rates: commissioned || !standard ? [] : standardRatesList(standard.hourlyRate, standard.rates),
                examples:
                  !commissioned && standard && !quote
                    ? exampleVisitPrices(standard.hourlyRate, standard.rates, (e.visits ?? []).map((v) => v.durationMinutes))
                    : [],
                quote: quote
                  ? { number: quote.quotationNumber, weeklyTotal: `${formatGbp(quote.weeklyTotal)} a week`, validUntil: quote.validUntil }
                  : null,
                funderNote: commissioned
                  ? `Funded by ${t(e.funding.funderName) || 'the council or NHS'}${funderRate ? `; their standard rate with us: ${funderRate}` : ''}.`
                  : null,
              }
            : { source: null, rates: [], examples: [], quote: null, funderNote: null },
        referral: {
          personName: [e.person.firstName, e.person.lastName].filter(Boolean).join(' '),
          referrerName: t(e.referrer.name) || t(row.fromName) || '',
          organisation: t(e.referrer.organisation),
          summary: e.summary,
        },
        questionsAsked: e.questionsAsked,
        informationNeeded: e.missingInformation,
        branchName: coverageRow?.branchName ?? 'Allfor Care',
        signOff: {
          name: coverageRow?.replyManagerName ?? 'The referrals team',
          title: coverageRow?.replyManagerTitle ?? '',
          phone: coverageRow?.replyPhone ?? '',
        },
      });
      replyText = draft.body;
      costUsd = draft.costUsd;
    }

    await this.prisma.referralEmail.update({
      where: { id: emailId },
      data: {
        locationId,
        checks: checks as unknown as Prisma.InputJsonValue,
        decision,
        decisionReasons: reasons,
        // Once a reply has gone, what was sent (and the quote attached to it) stays on record.
        ...(alreadySent
          ? {}
          : {
              replySubject: replyText ? `Re: ${(row.subject ?? 'Your referral').replace(/^re:\s*/i, '')}` : null,
              replyText,
              replyHtml: replyText ? textToHtml(replyText) : null,
              quotationId: quote?.quotationId ?? null,
              quotationVersionId: quote?.versionId ?? null,
            }),
        rateSource: commissioned ? (funderRate ? `${funder!.name} standard rate` : null) : (standard?.source ?? null),
        enquiryId,
        extractionCostUsd: (row.extractionCostUsd ?? 0) + costUsd,
        ...(enquiryId && !row.enquiryId ? { status: ReferralEmailStatus.ENQUIRY_CREATED, handledAt: new Date() } : {}),
      },
    });

    // Sent automatically unless it's a decline (always a manager's call), a rule says a manager decides,
    // the kind of email is for staff, or the person is already one of ours.
    const specialCare = checks.some((c) => c.key.startsWith('rule:'));
    // Linked to an enquiry staff were already handling: they reply, so two answers don't cross.
    const linkedToExisting = Boolean(dup.enquiry && enquiryId === dup.enquiry.id);
    if (
      replyText &&
      action === 'AUTO' &&
      !linkedToExisting &&
      settings.autoReply &&
      decision !== 'NO' &&
      !specialCare &&
      settings.autoReplyDecisions.includes(decision) &&
      !dup.serviceUser &&
      !row.replySentAt
    ) {
      await this.sendReply(emailId, null).catch((err: Error) => this.logger.warn(`Auto reply for ${emailId} failed: ${err.message}`));
    }
  }

  /**
   * Emails that are not a request for new care (follow-ups, withdrawals, complaints, safeguarding, news about our
   * own clients): no referral checks, decision, enquiry or reply — only what helps staff act on them. A follow-up
   * or a withdrawal is noted on the open enquiry it matches; nothing is closed automatically.
   */
  private async processForStaff(
    row: { id: string; subject: string | null; enquiryId: string | null; checks: Prisma.JsonValue },
    e: ReferralExtraction,
    kind: EmailKind,
  ) {
    const dup = await this.findExisting(e);
    const checks: ReferralCheck[] = [
      {
        key: 'kind',
        label: 'Kind of email',
        result: 'WARN',
        detail: `${EMAIL_KIND_INFO[kind].label}: staff handle this; no referral checks or automatic reply.`,
      },
    ];
    if (dup.serviceUser) checks.push({ key: 'duplicate', label: 'Already known', result: 'WARN', detail: `About ${dup.serviceUser.name}, one of our service users.` });
    else if (dup.enquiry) checks.push({ key: 'duplicate', label: 'Already known', result: 'WARN', detail: `Matches open enquiry ${dup.enquiry.referenceNumber}.` });
    if (e.risks.length) checks.push({ key: 'risks', label: 'Risks mentioned', result: 'PASS', detail: e.risks.join('; ') });

    let enquiryId = row.enquiryId;
    if (!enquiryId && dup.enquiry && (kind === 'FOLLOW_UP' || kind === 'REFERRAL_WITHDRAWN')) {
      enquiryId = dup.enquiry.id;
      await this.prisma.enquiryEvent.create({
        data: {
          enquiryId,
          action: kind === 'REFERRAL_WITHDRAWN' ? 'Referral withdrawn (email) – check and close if right' : 'More information by email',
          note: `${row.subject ?? ''} — ${e.summary}`.slice(0, 4000),
          userId: null,
        },
      });
    }
    await this.prisma.referralEmail.update({
      where: { id: row.id },
      data: {
        checks: checks as unknown as Prisma.InputJsonValue,
        decision: null,
        decisionReasons: [],
        enquiryId,
      },
    });
  }

  /** Send the reply in the referral's email thread (testing: only to the mailbox itself). */
  async sendReply(emailId: string, sentById: string | null, edited?: { subject?: string; text?: string; html?: string }) {
    const row = await this.prisma.referralEmail.findUnique({ where: { id: emailId }, include: { mailbox: true } });
    if (!row) throw new NotFoundException('Referral email not found');
    if (row.replySentAt) throw new BadRequestException('The reply has already been sent.');
    // The formatted (HTML) reply wins; the plain-text part is made from it.
    const html = t(edited?.html)
      ? sanitizeReplyHtml(edited!.html!)
      : t(edited?.text)
        ? textToHtml(t(edited?.text))
        : t(row.replyHtml) || (t(row.replyText) ? textToHtml(t(row.replyText)) : '');
    const text = htmlToPlain(html) || t(row.replyText);
    const subject = t(edited?.subject) || t(row.replySubject) || 'Re: your referral';
    if (!text) throw new BadRequestException('There is no reply to send.');

    // Claim the send so two runs can't both send it (a claim older than 5 minutes is treated as abandoned).
    const claimed = await this.prisma.referralEmail.updateMany({
      where: {
        id: emailId,
        replySentAt: null,
        OR: [{ replyClaimedAt: null }, { replyClaimedAt: { lt: new Date(Date.now() - 5 * 60_000) } }],
      },
      data: { replyClaimedAt: new Date() },
    });
    if (!claimed.count) throw new BadRequestException('This reply is already being sent.');

    try {
      const thread = await this.connectors.replyHeaders(row.mailbox, row);
      // Only ever to the sender (or the Reply-To they set) — never an address read out of the email or its attachments.
      const realTo = t(parseFromHeader(thread.replyTo ?? '').email) || t(row.fromEmail);
      if (!realTo) throw new BadRequestException('There is no address to reply to.');
      const production = (process.env.NODE_ENV ?? 'development') === 'production';
      // Outside production every reply goes to the mailbox itself, never to the referrer.
      const to = production ? realTo : row.mailbox.emailAddress;
      const finalSubject = production ? subject : `[TEST – would go to ${realTo}] ${subject}`;
      const coverage = row.locationId
        ? await this.prisma.referralBranchCoverage.findUnique({ where: { locationId: row.locationId } })
        : null;
      const fromName = coverage?.replyManagerName ?? 'Referrals';
      const settings = (await this.settings()).data;
      // Copies (e.g. the registered manager): Bcc in production; Cc while testing, and then only to our own addresses
      // and the REFERRAL_TEST_COPY_TO testers (who always get one).
      const copies = [
        ...new Set([
          ...settings.copyRepliesTo.map((x) => x.trim().toLowerCase()).filter((x) => EMAIL_RE.test(x)),
          ...referralTestCopyAddresses(),
        ]),
      ]
        .filter((x) => x !== to.toLowerCase())
        .filter((x) => mayGetCopy(x, row.mailbox.emailAddress));
      const actor = await this.systemActor(sentById ?? row.mailbox.connectedById);
      const pdf =
        row.quotationId && row.quotationVersionId && row.enquiryId && actor
          ? await this.quotations.clientPdf(actor, row.enquiryId, row.quotationId, row.quotationVersionId)
          : null;
      const reply: ReplyMime = {
        from: `"${fromName.replace(/"/g, '')}" <${row.mailbox.emailAddress}>`,
        to,
        cc: production ? [] : copies,
        bcc: production ? copies : [],
        subject: finalSubject,
        inReplyTo: thread.messageIdHeader,
        references: [thread.references, thread.messageIdHeader].filter(Boolean).join(' ') || null,
        text,
        html,
        attachments: pdf ? [{ filename: pdf.filename, contentType: 'application/pdf', content: pdf.buffer }] : [],
      };
      // From the mailbox itself (Gmail, Microsoft 365, IMAP/SMTP) or through its relay (ZeptoMail, Brevo…).
      const sentId = await this.connectors.send(row.mailbox, reply, {
        providerMessageId: row.providerMessageId,
        providerThreadId: row.providerThreadId,
      });
      await this.prisma.referralEmail.update({
        where: { id: emailId },
        data: {
          replySentAt: new Date(),
          replySentById: sentById,
          replySentTo: to,
          replyCopiedTo: copies,
          replyError: null,
          replyClaimedAt: null,
          replyText: text,
          replyHtml: html,
          replySubject: subject,
        },
      });
      if (pdf && actor && row.enquiryId && row.quotationId && row.quotationVersionId) {
        await this.quotations
          .recordEmailedFromMailbox(actor, row.enquiryId, row.quotationId, row.quotationVersionId, {
            recipientEmail: realTo,
            recipientName: row.fromName,
            subject,
            providerMessageId: sentId ?? undefined,
          })
          .catch((err: Error) => this.logger.warn(`Recording the quote send for ${emailId} failed: ${err.message}`));
      }
      if (row.enquiryId) {
        await this.prisma.enquiryEvent.create({
          data: {
            enquiryId: row.enquiryId,
            action: sentById ? 'Referral reply sent' : 'Referral reply sent automatically',
            note: [
              `To ${realTo}${production ? '' : ` (testing: sent to ${to})`}${copies.length ? `; copy to ${copies.join(', ')}` : ''}`,
              pdf ? `Attached: ${pdf.filename}` : '',
              '',
              text,
            ]
              .filter((x, i) => x || i === 2)
              .join('\n')
              .slice(0, 4000),
            userId: sentById,
          },
        });
        // A decline closes the enquiry as lost (out of area, or no capacity); anything else means we've made contact.
        // Only moves forward: an enquiry already further on (e.g. Quote sent, just set by the quote above) keeps its stage.
        const outOfArea = ((row.checks as unknown as ReferralCheck[] | null) ?? []).some((c) => c.key === 'area' && c.result === 'FAIL');
        await this.prisma.enquiry
          .updateMany({
            where: {
              id: row.enquiryId,
              stage: row.decision === 'NO' ? { notIn: [EnquiryStage.WON, EnquiryStage.LOST] } : EnquiryStage.NEW,
            },
            data:
              row.decision === 'NO'
                ? {
                    stage: EnquiryStage.LOST,
                    lostReasonCode: outOfArea ? EnquiryLostReason.OUT_OF_AREA : EnquiryLostReason.NO_CAPACITY,
                    lostReason: (row.decisionReasons[0] ?? 'Declined by email').slice(0, 500),
                    stageChangedAt: new Date(),
                  }
                : { stage: EnquiryStage.CONTACTED, stageChangedAt: new Date() },
          })
          .catch(() => undefined);
      }
      return { message: production ? `Reply sent to ${realTo}` : `Testing: reply sent to ${to} instead of ${realTo}` };
    } catch (err) {
      await this.prisma.referralEmail.update({
        where: { id: emailId },
        data: { replyError: (err as Error).message.slice(0, 2000), replyClaimedAt: null },
      });
      throw err;
    }
  }

  /** Existing enquiry or service user: same name and date of birth, or same name and postcode. */
  private async findExisting(e: ReferralExtraction) {
    const first = t(e.person.firstName);
    const last = t(e.person.lastName);
    if (!first || !last) return { enquiry: null, closedEnquiry: null, serviceUser: null };
    const dob = /^\d{4}-\d{2}-\d{2}$/.test(t(e.person.dateOfBirth)) ? new Date(`${e.person.dateOfBirth}T00:00:00Z`) : null;
    const pc = t(e.person.postcode).replace(/\s+/g, '').toUpperCase();
    const name = { firstName: { equals: first, mode: 'insensitive' as const }, lastName: { equals: last, mode: 'insensitive' as const } };
    const matches = (rowDob: Date | null, rowPc: string | null | undefined) =>
      (dob && rowDob && rowDob.toISOString().slice(0, 10) === dob.toISOString().slice(0, 10)) ||
      (!!pc && (rowPc ?? '').replace(/\s+/g, '').toUpperCase() === pc);
    const enquiries = await this.prisma.enquiry.findMany({
      where: { ...name, deletedAt: null },
      select: { id: true, referenceNumber: true, dateOfBirth: true, postcode: true, stage: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const matching = enquiries.filter((r) => matches(r.dateOfBirth, r.postcode));
    // Only an open enquiry is linked; someone referred again after a closed (won or lost) enquiry gets a new one.
    const open = matching.find((r) => r.stage !== EnquiryStage.WON && r.stage !== EnquiryStage.LOST) ?? null;
    const closed = open ? null : (matching[0] ?? null);
    const enquiry = open;
    const sus = await this.prisma.serviceUser.findMany({
      where: { ...name, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true, address: { select: { postcode: true } } },
      take: 10,
    });
    const su = sus.find((r) => matches(r.dateOfBirth, r.address?.postcode)) ?? null;
    return {
      enquiry: enquiry ? { id: enquiry.id, referenceNumber: enquiry.referenceNumber } : null,
      closedEnquiry: closed ? { referenceNumber: closed.referenceNumber, stage: closed.stage } : null,
      serviceUser: su ? { id: su.id, name: `${su.firstName} ${su.lastName}` } : null,
    };
  }

  /** Automatic runs act as the manager who connected the mailbox (no branch restriction). */
  private async systemActor(userId: string | null): Promise<RequestUser | null> {
    if (!userId) return null;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!u) return null;
    return { id: u.id, email: u.email, roles: [], permissions: [], accountKind: 'user' } as RequestUser;
  }
}

/** Urgent and emergency referrals are followed up today; others the next working day. */
export function followUpDate(urgency: ReferralDecision | string, now = new Date()): string {
  const d = new Date(now);
  if (urgency !== 'URGENT' && urgency !== 'EMERGENCY') {
    d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString();
}
