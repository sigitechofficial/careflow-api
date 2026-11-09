import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditEventType,
  EnquiryLostReason,
  EnquiryQuoteStatus,
  EnquiryStage,
  InitialAssessmentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AuditModule } from '../../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../../common/utils/request-audit-meta.util';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { OrgScopeService } from '../../common/org-scope/org-scope.service';
import { MailService } from '../../mail/mail.service';
import { buildQuoteEmail } from './quote-email.util';
import { OrganisationGeneralSettingsService } from '../../organisation-general-settings/organisation-general-settings.service';
import { ServiceUserVisitPlansService } from '../../service-user-visit-plans/service-user-visit-plans.service';
import type { VisitPlanSlotDto } from '../../service-user-visit-plans/dto/visit-plan-slot.dto';
import { operationalTodayIso } from '../../common/utils/operational-day.util';
import { CrmService, LOST_REASON_LABELS } from '../crm.service';
import { OPEN_STAGES } from '../crm-workflow.util';
import {
  describeQuoteRates,
  mondayOnOrAfter,
  normaliseQuoteRates,
  priceQuote,
  round2,
  WEEKDAY_NAMES,
  type QuoteExtraInput,
  type QuoteFundingInput,
  type QuotePatternInput,
  type QuotePricingResult,
  type QuoteRates,
} from './quote-pricing.util';
import {
  AWAITING_CLIENT,
  canTransition,
  diffVersions,
  type DiffFormat,
  formatQuotationNumber,
  isEditable,
  QUOTE_STATUS_LABELS,
  RESPONDABLE,
  SENDABLE,
} from './quote-workflow.util';
import { buildQuotePdf, type ClientQuoteView } from './quote-pdf.util';
import type {
  CreateFollowUpDto,
  QuoteDraftDto,
  RecordResponseDto,
  ReconcileLegacyQuoteDto,
  SendQuoteDto,
  UpdateFollowUpDto,
} from './dto/quotation.dto';

type Tx = Prisma.TransactionClient;

const versionInclude = {
  patterns: { orderBy: { sortOrder: 'asc' as const } },
  fundings: { orderBy: { sortOrder: 'asc' as const } },
  extras: { orderBy: { sortOrder: 'asc' as const } },
  quotation: true,
} satisfies Prisma.EnquiryQuotationVersionInclude;

type VersionRow = Prisma.EnquiryQuotationVersionGetPayload<{
  include: typeof versionInclude;
}>;
type EnquiryRow = Prisma.EnquiryGetPayload<object>;

/** Frozen when a version leaves DRAFT; everything client-facing is built from it. */
type PricingSnapshot = {
  calculatedAt: string;
  /** £ per carer per hour the quote was priced at. */
  hourlyRate: number | null;
  /** The other rates the quote was priced at (absent on quotes priced before they existed). */
  rates?: QuoteRates | null;
  /** The typed weekly total of a "total amount" (SUMMARY) quote. */
  manualWeeklyTotal?: number | null;
  /** Quotes issued before manual pricing were priced from this charge card. */
  card?: { id: string; name: string } | null;
  referenceWeekStart: string;
  calendarMonth: string;
  pricing: QuotePricingResult;
};

const num = (d: Prisma.Decimal | number | null | undefined) =>
  d == null ? null : Number(d);
/** Pattern fields as stored (Date / Decimal) or as sent by the editor (strings / numbers). */
type PatternLike = {
  label: string;
  startTime: string;
  endTime?: string | null;
  windowEndTime?: string | null;
  durationMinutes: number;
  daysOfWeek?: number[];
  frequency: QuotePatternInput['frequency'];
  effectiveFrom?: string | Date | null;
  effectiveTo?: string | Date | null;
  oneOffDates?: Array<string | Date>;
  carersPerVisit: number;
  nightDuty?: QuotePatternInput['nightDuty'];
  manualChargePerVisit?: number | Prisma.Decimal | null;
  overrideReason?: string | null;
};

const isoDay = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;
const dayOf = (d: string | Date) =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
/** A copied child row without its own id / parent id (revisions copy patterns, funding, extras). */
function omitIds<T extends { id: string; versionId: string }>(
  row: T,
): Omit<T, 'id' | 'versionId'> {
  const copy: Partial<T> = { ...row };
  delete copy.id;
  delete copy.versionId;
  return copy as Omit<T, 'id' | 'versionId'>;
}

const toDate = (v: string | null | undefined) =>
  v ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : null;
const gbp = (n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(
    n,
  );
/** Morning / Lunchtime / Afternoon / Evening / Night, for a summary quote that shows no times. */
export const timeOfDay = (startTime: string, nightDuty?: string | null) => {
  if (nightDuty && nightDuty !== 'NONE') return 'Night';
  const h = Number(startTime.slice(0, 2));
  if (h >= 5 && h < 11) return 'Morning';
  if (h >= 11 && h < 14) return 'Lunchtime';
  if (h >= 14 && h < 17) return 'Afternoon';
  if (h >= 17 && h < 21) return 'Evening';
  return 'Night';
};

/** "£12.00", or "£12.00–£14.40" when weekend / bank holiday rates make the days differ. */
const perVisitRange = (
  priced:
    | {
        chargePerOccurrence: number | null;
        occurrences: { amount: number | null }[];
      }
    | undefined,
) => {
  if (!priced) return null;
  if (priced.chargePerOccurrence != null)
    return gbp(priced.chargePerOccurrence);
  const amounts = priced.occurrences
    .map((o) => o.amount)
    .filter((a): a is number => a != null);
  return amounts.length
    ? `${gbp(Math.min(...amounts))}–${gbp(Math.max(...amounts))}`
    : null;
};
const QUOTE_TYPE_LABELS = {
  PROVISIONAL_ESTIMATE: 'Provisional estimate',
  FINAL: 'Final quotation',
} as const;
const FOLLOW_UP_PREFIX = 'Quote follow-up';

@Injectable()
export class QuotationsService {
  private readonly logger = new Logger(QuotationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    private readonly crm: CrmService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly visitPlans: ServiceUserVisitPlansService,
  ) {}

  /* ─── scope + loading ───────────────────────────────────────────────── */

  private async enquiry(
    actor: RequestUser,
    enquiryId: string,
    tx: Tx = this.prisma,
  ): Promise<EnquiryRow> {
    return this.crm.getInScope(actor, enquiryId, tx);
  }

  /** A version of a quotation on this enquiry; a quote on a branch the user cannot access is refused. */
  private async version(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    tx: Tx = this.prisma,
  ): Promise<VersionRow> {
    await this.enquiry(actor, enquiryId, tx);
    const row = await tx.enquiryQuotationVersion.findFirst({
      where: {
        id: versionId,
        quotationId,
        quotation: { enquiryId, deletedAt: null },
      },
      include: versionInclude,
    });
    if (!row) throw new NotFoundException('Quotation version not found');
    this.assertBranch(actor, row.locationId);
    return row;
  }

  private assertBranch(actor: RequestUser, locationId: string | null) {
    if (locationId)
      this.orgScope.assertLocationAccess(
        this.orgScope.fromRequestUser(actor),
        locationId,
      );
  }

  private emailAvailable(): boolean {
    // "log" mode only writes to the server log — it is not a real send.
    const mode = this.config.get<string>('mail.mode', 'log');
    // SMTP with a user but no password is always refused by the server (e.g. Microsoft 365 "530 not authenticated").
    if (
      mode === 'smtp' &&
      this.config.get<string>('mail.user') &&
      !this.config.get<string>('mail.pass')
    ) {
      return false;
    }
    return mode !== 'log' && this.mail.isConfigured();
  }

  /* ─── pricing ───────────────────────────────────────────────────────── */

  private patternInputs(rows: PatternLike[]): QuotePatternInput[] {
    return rows.map((p) => ({
      label: p.label,
      startTime: p.startTime,
      endTime: p.endTime ?? null,
      windowEndTime: p.windowEndTime ?? null,
      durationMinutes: p.durationMinutes,
      daysOfWeek: p.daysOfWeek ?? [],
      frequency: p.frequency,
      effectiveFrom: p.effectiveFrom ? dayOf(p.effectiveFrom) : null,
      effectiveTo: p.effectiveTo ? dayOf(p.effectiveTo) : null,
      oneOffDates: (p.oneOffDates ?? []).map(dayOf),
      carersPerVisit: p.carersPerVisit,
      nightDuty: p.nightDuty ?? 'NONE',
      manualChargePerVisit: num(p.manualChargePerVisit),
      overrideReason: p.overrideReason ?? null,
    }));
  }

  /** Price draft content by hand: the quote's hourly rate (charge cards are not used for quotes). */
  private async calculate(
    tx: Tx,
    input: {
      locationId: string | null;
      hourlyRate: number | Prisma.Decimal | null;
      rates: unknown;
      clientLayout: string | null | undefined;
      manualWeeklyTotal: number | Prisma.Decimal | null | undefined;
      proposedStartDate: string | null;
      fundingCategory: string;
      serviceUserId: string | null;
      patterns: PatternLike[];
      fundings: Array<{
        payerType: QuoteFundingInput['payerType'];
        payerName?: string | null;
        funderId?: string | null;
        method: QuoteFundingInput['method'];
        amount: number | Prisma.Decimal;
        status?: QuoteFundingInput['status'];
      }>;
      extras: Array<{
        kind: QuoteExtraInput['kind'];
        description: string;
        frequency: QuoteExtraInput['frequency'];
        amount?: number | Prisma.Decimal | null;
        quantity?: number | Prisma.Decimal | null;
        isPercentage?: boolean;
      }>;
    },
  ): Promise<{
    pricing: QuotePricingResult;
    snapshot: Omit<PricingSnapshot, 'pricing' | 'calculatedAt'>;
  }> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const today = operationalTodayIso(new Date(), timeZone);
    const start =
      input.proposedStartDate && input.proposedStartDate > today
        ? input.proposedStartDate
        : today;
    const referenceWeekStart = mondayOnOrAfter(start);
    // First whole calendar month from the start date.
    const [sy, sm, sd] = start.split('-').map(Number);
    const monthDate = new Date(Date.UTC(sy, sm - 1 + (sd === 1 ? 0 : 1), 1));
    const calendarMonth = monthDate.toISOString().slice(0, 7);

    const holidayTo = new Date(
      Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 2, 1),
    );
    const holidays = await tx.bankHoliday.findMany({
      where: {
        isActive: true,
        region: 'UK',
        holidayDate: {
          gte: new Date(`${referenceWeekStart}T00:00:00Z`),
          lt: holidayTo,
        },
      },
      select: { holidayDate: true },
    });
    const oneOffDays = input.patterns.flatMap((p) =>
      (p.oneOffDates ?? []).map(dayOf),
    );
    const extraHolidays = oneOffDays.length
      ? await tx.bankHoliday.findMany({
          where: {
            isActive: true,
            region: 'UK',
            holidayDate: {
              in: oneOffDays.map((d) => new Date(`${d}T00:00:00Z`)),
            },
          },
          select: { holidayDate: true },
        })
      : [];
    const hourlyRate = num(input.hourlyRate);
    const rates = normaliseQuoteRates(input.rates);
    // A "total amount" quote is priced from its typed weekly total, not from rates.
    const manualWeeklyTotal =
      input.clientLayout === 'SUMMARY'
        ? num(input.manualWeeklyTotal ?? null)
        : undefined;
    const pricing = priceQuote(
      this.patternInputs(input.patterns),
      input.extras.map((e) => ({
        kind: e.kind,
        description: e.description,
        frequency: e.frequency,
        amount: num(e.amount),
        quantity: num(e.quantity),
        isPercentage: Boolean(e.isPercentage),
      })),
      input.fundings.map((f) => ({
        payerType: f.payerType,
        payerName: f.payerName ?? null,
        method: f.method,
        amount: Number(f.amount),
        status: f.status ?? 'PENDING_APPROVAL',
      })),
      input.fundingCategory,
      {
        hourlyRate,
        rates,
        manualWeeklyTotal,
        timeZone,
        bankHolidays: new Set(
          [...holidays, ...extraHolidays].map((h) => isoDay(h.holidayDate)!),
        ),
        referenceWeekStart,
        calendarMonth,
        vat: { rate: null, label: 'VAT not added' },
      },
      null,
    );
    return {
      pricing,
      snapshot: {
        hourlyRate,
        rates,
        manualWeeklyTotal: manualWeeklyTotal ?? null,
        referenceWeekStart,
        calendarMonth,
      },
    };
  }

  /** Recalculate a draft and store the computed figures on it. */
  private async recalcDraft(
    tx: Tx,
    versionId: string,
    serviceUserId: string | null,
  ) {
    const v = await tx.enquiryQuotationVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: versionInclude,
    });
    const { pricing } = await this.calculate(tx, {
      locationId: v.locationId,
      hourlyRate: v.hourlyRate,
      rates: v.rates,
      clientLayout: v.clientLayout,
      manualWeeklyTotal: v.manualWeeklyTotal,
      proposedStartDate: isoDay(v.proposedStartDate),
      fundingCategory: v.fundingCategory,
      serviceUserId,
      patterns: v.patterns,
      fundings: v.fundings,
      extras: v.extras,
    });
    await this.storeComputed(tx, v, pricing);
    return pricing;
  }

  private async storeComputed(
    tx: Tx,
    v: VersionRow,
    pricing: QuotePricingResult,
  ) {
    for (const [i, p] of v.patterns.entries()) {
      const r = pricing.patterns[i];
      await tx.enquiryQuotationVisitPattern.update({
        where: { id: p.id },
        data: {
          rateReference: r.rateReference,
          chargePerOccurrence: r.chargePerOccurrence,
          weeklyOccurrences: r.weeklyOccurrences,
          weeklyCoverageMinutes: r.weeklyCoverageMinutes,
          weeklyCarerMinutes: r.weeklyCarerMinutes,
          weeklyTotal: r.weeklyTotal,
          pricingIssue: r.issues.join('\n') || null,
        },
      });
    }
    for (const [i, f] of v.fundings.entries()) {
      await tx.enquiryQuotationFunding.update({
        where: { id: f.id },
        data: { weeklyAmount: pricing.fundings[i].weeklyAmount },
      });
    }
    for (const [i, e] of v.extras.entries()) {
      await tx.enquiryQuotationExtra.update({
        where: { id: e.id },
        data: { total: pricing.extras[i].total },
      });
    }
    const est = Object.fromEntries(
      pricing.estimates.map((e) => [e.key, e.amount]),
    );
    await tx.enquiryQuotationVersion.update({
      where: { id: v.id },
      data: {
        weeklyTotal: pricing.weeklyTotal,
        fourWeeklyTotal: est.fourWeekly,
        monthlyAverageTotal: est.monthlyAverage,
        annualTotal: est.annual,
        calendarMonthTotal: pricing.calendarMonth.complete
          ? pricing.calendarMonth.amount
          : null,
        oneOffTotal: pricing.oneOffTotal,
        vatWeekly: pricing.vatWeekly,
        clientWeeklyLiability: pricing.clientWeeklyLiability,
        weeklyCoverageMinutes: pricing.weeklyCoverageMinutes,
        weeklyCarerMinutes: pricing.weeklyCarerMinutes,
        unresolvedCharges: pricing.unresolvedCharges,
        calculatedAt: new Date(),
      },
    });
  }

  /** Pricing for unsaved editor content (nothing is stored). */
  async pricingPreview(
    actor: RequestUser,
    enquiryId: string,
    dto: QuoteDraftDto,
  ) {
    const enquiry = await this.enquiry(actor, enquiryId);
    const { pricing, snapshot } = await this.calculate(this.prisma, {
      locationId: dto.locationId ?? enquiry.locationId,
      hourlyRate: dto.hourlyRate ?? null,
      rates: dto.rates ?? null,
      clientLayout: dto.clientLayout ?? 'DETAILED',
      manualWeeklyTotal: dto.manualWeeklyTotal ?? null,
      proposedStartDate: dto.proposedStartDate?.slice(0, 10) ?? null,
      fundingCategory: dto.fundingCategory ?? 'PRIVATE',
      serviceUserId: enquiry.convertedServiceUserId,
      patterns: dto.patterns ?? [],
      fundings: dto.fundings ?? [],
      extras: dto.extras ?? [],
    });
    return { data: { ...snapshot, pricing } };
  }

  /* ─── presenting ────────────────────────────────────────────────────── */

  private snapshotOf(v: VersionRow): PricingSnapshot | null {
    return (v.pricingSnapshot as unknown as PricingSnapshot | null) ?? null;
  }

  private mapVersion(v: VersionRow) {
    const snap = this.snapshotOf(v);
    return {
      id: v.id,
      quotationId: v.quotationId,
      quotationNumber: v.quotation.quotationNumber,
      versionNumber: v.versionNumber,
      label: `${v.quotation.quotationNumber} V${v.versionNumber}`,
      status: v.status,
      statusLabel: QUOTE_STATUS_LABELS[v.status],
      editable: isEditable(v.status),
      quoteType: v.quoteType,
      revisedFromVersionId: v.revisedFromVersionId,
      locationId: v.locationId,
      ownerId: v.ownerId,
      proposedStartDate: isoDay(v.proposedStartDate),
      proposedEndDate: isoDay(v.proposedEndDate),
      issueDate: isoDay(v.issueDate),
      validUntil: isoDay(v.validUntil),
      currency: v.currency,
      assessmentSubmissionId: v.assessmentSubmissionId,
      assessmentReference: v.assessmentReference,
      fundingCategory: v.fundingCategory,
      hourlyRate: num(v.hourlyRate),
      rates: normaliseQuoteRates(v.rates),
      clientLayout: v.clientLayout,
      manualWeeklyTotal: num(v.manualWeeklyTotal),
      internalNotes: v.internalNotes,
      clientNotes: v.clientNotes,
      terms: v.terms,
      totals: {
        weekly: num(v.weeklyTotal)!,
        fourWeekly: num(v.fourWeeklyTotal)!,
        monthlyAverage: num(v.monthlyAverageTotal)!,
        annual: num(v.annualTotal)!,
        calendarMonth: num(v.calendarMonthTotal),
        oneOff: num(v.oneOffTotal)!,
        vatWeekly: num(v.vatWeekly)!,
        clientWeeklyLiability: num(v.clientWeeklyLiability)!,
        weeklyCoverageMinutes: v.weeklyCoverageMinutes,
        weeklyCarerMinutes: v.weeklyCarerMinutes,
        unresolvedCharges: v.unresolvedCharges,
        calculatedAt: v.calculatedAt?.toISOString() ?? null,
      },
      pricing: snap?.pricing ?? null,
      pricingCard: snap?.card ?? null,
      issuedAt: v.issuedAt?.toISOString() ?? null,
      issuedById: v.issuedById,
      submittedForApprovalAt: v.submittedForApprovalAt?.toISOString() ?? null,
      approvedAt: v.approvedAt?.toISOString() ?? null,
      approvedById: v.approvedById,
      approvalNote: v.approvalNote,
      sentAt: v.sentAt?.toISOString() ?? null,
      respondedAt: v.respondedAt?.toISOString() ?? null,
      acceptedAt: v.acceptedAt?.toISOString() ?? null,
      agreementReceivedAt: v.agreementReceivedAt?.toISOString() ?? null,
      agreementNote: v.agreementNote,
      convertedVisitPlanId: v.convertedVisitPlanId,
      convertedAt: v.convertedAt?.toISOString() ?? null,
      statusChangedAt: v.statusChangedAt.toISOString(),
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      patterns: v.patterns.map((p) => ({
        id: p.id,
        label: p.label,
        careType: p.careType,
        startTime: p.startTime,
        endTime: p.endTime,
        windowEndTime: p.windowEndTime,
        durationMinutes: p.durationMinutes,
        daysOfWeek: p.daysOfWeek,
        frequency: p.frequency,
        effectiveFrom: isoDay(p.effectiveFrom),
        effectiveTo: isoDay(p.effectiveTo),
        oneOffDates: p.oneOffDates.map((d) => isoDay(d)!),
        carersPerVisit: p.carersPerVisit,
        nightDuty: p.nightDuty,
        activities: p.activities,
        notes: p.notes,
        manualChargePerVisit: num(p.manualChargePerVisit),
        overrideReason: p.overrideReason,
        overrideById: p.overrideById,
        overrideAt: p.overrideAt?.toISOString() ?? null,
        rateReference: p.rateReference,
        chargePerOccurrence: num(p.chargePerOccurrence),
        weeklyOccurrences: num(p.weeklyOccurrences)!,
        weeklyCoverageMinutes: p.weeklyCoverageMinutes,
        weeklyCarerMinutes: p.weeklyCarerMinutes,
        weeklyTotal: num(p.weeklyTotal)!,
        pricingIssue: p.pricingIssue,
      })),
      fundings: v.fundings.map((f) => ({
        id: f.id,
        payerType: f.payerType,
        payerName: f.payerName,
        funderId: f.funderId,
        reference: f.reference,
        method: f.method,
        amount: num(f.amount)!,
        status: f.status,
        weeklyAmount: num(f.weeklyAmount)!,
      })),
      extras: v.extras.map((e) => ({
        id: e.id,
        kind: e.kind,
        description: e.description,
        frequency: e.frequency,
        amount: num(e.amount),
        quantity: num(e.quantity),
        isPercentage: e.isPercentage,
        total: num(e.total)!,
      })),
    };
  }

  /** Latest full initial assessment of the enquiry's service user (archived and cancelled left out). */
  private async latestInitialAssessmentStatus(serviceUserId: string | null) {
    if (!serviceUserId) return null;
    const row = await this.prisma.initialAssessmentSubmission.findFirst({
      where: {
        serviceUserId,
        deletedAt: null,
        status: { notIn: ['ARCHIVED', 'CANCELLED'] },
      },
      orderBy: { updatedAt: 'desc' },
      select: { status: true },
    });
    return row?.status ?? null;
  }

  /**
   * Branch, assessment, funding and agreement — shown as pending after acceptance (nothing is
   * auto-completed). A submitted or reviewed full initial assessment counts as the assessment.
   */
  private prerequisites(
    enquiry: EnquiryRow,
    v: VersionRow,
    iaStatus: InitialAssessmentStatus | null = null,
  ) {
    const thirdParty = v.fundings.filter(
      (f) => f.payerType !== 'PRIVATE_CLIENT',
    );
    const pendingFunding = thirdParty.filter((f) => f.status !== 'CONFIRMED');
    const iaDone = iaStatus === 'SUBMITTED' || iaStatus === 'REVIEWED';
    const assessed =
      iaDone ||
      Boolean(v.assessmentSubmissionId) ||
      Boolean(
        enquiry.assessmentAt && enquiry.assessmentAt.getTime() <= Date.now(),
      );
    return [
      {
        key: 'branch',
        label: 'Branch',
        done: Boolean(enquiry.locationId && v.locationId),
        detail: enquiry.locationId ? 'Set' : 'Set a branch on the enquiry',
      },
      {
        key: 'assessment',
        label: 'Assessment',
        done: assessed,
        detail:
          iaStatus === 'REVIEWED'
            ? 'Initial assessment reviewed'
            : iaStatus === 'SUBMITTED'
              ? 'Initial assessment submitted · awaiting manager review'
              : assessed
                ? 'Assessment recorded'
                : iaStatus
                  ? 'Initial assessment in progress, not yet submitted'
                  : enquiry.assessmentAt
                    ? 'Assessment booked, not yet carried out'
                    : 'No assessment booked',
      },
      {
        key: 'funding',
        label: 'Funding',
        done: pendingFunding.length === 0,
        detail: pendingFunding.length
          ? `${pendingFunding.length} funding allocation(s) pending approval`
          : thirdParty.length
            ? 'Confirmed'
            : 'Private — no third-party funding',
      },
      {
        key: 'agreement',
        label: 'Agreement',
        done: Boolean(v.agreementReceivedAt),
        detail: v.agreementReceivedAt
          ? 'Agreement recorded by staff'
          : 'Signed agreement not yet recorded',
      },
    ];
  }

  /* ─── reads ─────────────────────────────────────────────────────────── */

  /** Sent quotes past their valid-until date become Expired (conditional update, safe to repeat). */
  private async expireOverdue(enquiryId: string) {
    const today = new Date(`${operationalTodayIso()}T00:00:00Z`);
    const overdue = await this.prisma.enquiryQuotationVersion.findMany({
      where: {
        quotation: { enquiryId },
        status: { in: ['SENT', 'UNDER_NEGOTIATION'] },
        validUntil: { lt: today },
      },
      include: { quotation: true },
    });
    for (const v of overdue) {
      const done = await this.prisma.enquiryQuotationVersion.updateMany({
        where: { id: v.id, status: v.status },
        data: { status: 'EXPIRED', statusChangedAt: new Date() },
      });
      if (done.count) {
        await this.prisma.enquiryEvent.create({
          data: {
            enquiryId,
            action: 'Quote expired',
            note: `${v.quotation.quotationNumber} V${v.versionNumber} passed its valid-until date`,
            quotationVersionId: v.id,
          },
        });
      }
    }
  }

  /** Quotations on an enquiry (newest first), the summary card data and the legacy flag. */
  async list(actor: RequestUser, enquiryId: string) {
    const enquiry = await this.enquiry(actor, enquiryId);
    await this.expireOverdue(enquiryId);
    const quotations = await this.prisma.enquiryQuotation.findMany({
      where: { enquiryId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: versionInclude,
        },
        responses: { orderBy: { respondedAt: 'desc' } },
        followUps: { orderBy: { dueAt: 'asc' } },
        communications: { orderBy: { createdAt: 'desc' } },
      },
    });
    const scope = this.orgScope.fromRequestUser(actor);
    const visible = quotations.filter(
      (q) =>
        scope.locationIds === null ||
        q.versions.every(
          (v) => !v.locationId || scope.locationIds!.includes(v.locationId),
        ),
    );
    const now = Date.now();
    const data = visible.map((q) => {
      const latest = q.versions[0];
      const lastSent = q.versions.find((v) => v.sentAt);
      const openFollowUp = q.followUps.find((f) => f.status === 'OPEN');
      return {
        id: q.id,
        quotationNumber: q.quotationNumber,
        isCurrent: q.isCurrent,
        createdAt: q.createdAt.toISOString(),
        latestVersion: latest ? this.mapVersion(latest) : null,
        versions: q.versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          status: v.status,
          statusLabel: QUOTE_STATUS_LABELS[v.status],
          weeklyTotal: num(v.weeklyTotal)!,
          sentAt: v.sentAt?.toISOString() ?? null,
          createdAt: v.createdAt.toISOString(),
        })),
        summary: {
          weeklyTotal: latest ? num(latest.weeklyTotal)! : 0,
          monthlyAverage: latest ? num(latest.monthlyAverageTotal)! : 0,
          sentAt: lastSent?.sentAt?.toISOString() ?? null,
          // Latest send attempt, so a failed email is shown as failed (not as sent).
          lastSend: q.communications[0]
            ? {
                status: q.communications[0].status,
                channel: q.communications[0].channel,
                at: (
                  q.communications[0].sentAt ?? q.communications[0].createdAt
                ).toISOString(),
                failureReason: q.communications[0].failureReason,
              }
            : null,
          responseType: q.responses[0]?.responseType ?? null,
          respondedAt: q.responses[0]?.respondedAt.toISOString() ?? null,
          followUp: openFollowUp
            ? {
                id: openFollowUp.id,
                dueAt: openFollowUp.dueAt.toISOString(),
                overdue: openFollowUp.dueAt.getTime() <= now,
              }
            : null,
        },
      };
    });
    const hasLegacyFields =
      enquiry.quoteWeeklyAmount != null ||
      enquiry.quoteHourlyRate != null ||
      Boolean(enquiry.quoteSentAt) ||
      Boolean(enquiry.quoteNotes);
    return {
      data: {
        quotations: data,
        emailAvailable: this.emailAvailable(),
        legacy: {
          // "Quote sent" (or old quote fields) with no quotation record: flagged until staff reconcile it.
          unlinked:
            quotations.length === 0 &&
            (enquiry.stage === EnquiryStage.OFFER || hasLegacyFields) &&
            !enquiry.legacyQuoteReconciledAt,
          hasLegacyFields,
          weeklyAmount: enquiry.quoteWeeklyAmount,
          hourlyRate: enquiry.quoteHourlyRate,
          sentAt: enquiry.quoteSentAt?.toISOString() ?? null,
          notes: enquiry.quoteNotes,
          reconciledAt: enquiry.legacyQuoteReconciledAt?.toISOString() ?? null,
          reconcileNote: enquiry.legacyQuoteReconcileNote,
        },
      },
    };
  }

  async getVersion(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
  ) {
    await this.expireOverdue(enquiryId);
    const v = await this.version(actor, enquiryId, quotationId, versionId);
    const enquiry = await this.enquiry(actor, enquiryId);
    const [communications, responses, followUps] = await Promise.all([
      this.prisma.enquiryQuotationCommunication.findMany({
        where: { quotationId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.enquiryQuotationResponse.findMany({
        where: { quotationId },
        orderBy: { respondedAt: 'desc' },
      }),
      this.prisma.enquiryQuotationFollowUp.findMany({
        where: { quotationId },
        orderBy: { dueAt: 'asc' },
      }),
    ]);
    const versions = await this.prisma.enquiryQuotationVersion.findMany({
      where: { quotationId },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true, status: true },
    });
    // A draft shows its live calculation (with any problems); an issued version shows its snapshot.
    let livePricing: QuotePricingResult | null = null;
    if (isEditable(v.status)) {
      livePricing = (
        await this.calculate(this.prisma, {
          locationId: v.locationId,
          hourlyRate: v.hourlyRate,
          rates: v.rates,
          clientLayout: v.clientLayout,
          manualWeeklyTotal: v.manualWeeklyTotal,
          proposedStartDate: isoDay(v.proposedStartDate),
          fundingCategory: v.fundingCategory,
          serviceUserId: enquiry.convertedServiceUserId,
          patterns: v.patterns,
          fundings: v.fundings,
          extras: v.extras,
        })
      ).pricing;
    }
    const userIds = [
      v.ownerId,
      v.approvedById,
      v.issuedById,
      ...communications.map((c) => c.senderId),
      ...responses.map((r) => r.recordedById),
      ...followUps.flatMap((f) => [
        f.assigneeId,
        f.completedById,
        f.createdById,
      ]),
    ];
    const names = await this.userNames(userIds);
    return {
      data: {
        ...this.mapVersion(v),
        pricing: livePricing ?? this.snapshotOf(v)?.pricing ?? null,
        ownerName: v.ownerId ? (names.get(v.ownerId) ?? null) : null,
        approvedByName: v.approvedById
          ? (names.get(v.approvedById) ?? null)
          : null,
        allVersions: versions.map((x) => ({
          ...x,
          statusLabel: QUOTE_STATUS_LABELS[x.status],
        })),
        prerequisites:
          v.status === 'ACCEPTED'
            ? this.prerequisites(
                enquiry,
                v,
                await this.latestInitialAssessmentStatus(
                  enquiry.convertedServiceUserId,
                ),
              )
            : null,
        serviceUserId: enquiry.convertedServiceUserId,
        enquiryStage: enquiry.stage,
        emailAvailable: this.emailAvailable(),
        defaultRecipient: {
          name: enquiry.contactName,
          email: enquiry.contactEmail,
        },
        communications: communications.map((c) => ({
          id: c.id,
          versionId: c.versionId,
          channel: c.channel,
          status: c.status,
          recipientName: c.recipientName,
          recipientEmail: c.recipientEmail,
          template: c.template,
          subject: c.subject,
          senderName: c.senderId ? (names.get(c.senderId) ?? null) : null,
          sentAt: c.sentAt?.toISOString() ?? null,
          failureReason: c.failureReason,
          attemptCount: c.attemptCount,
          followUpDate: c.followUpDate?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
        })),
        responses: responses.map((r) => ({
          id: r.id,
          versionId: r.versionId,
          responseType: r.responseType,
          responderName: r.responderName,
          responderRelationship: r.responderRelationship,
          method: r.method,
          respondedAt: r.respondedAt.toISOString(),
          details: r.details,
          evidence: r.evidence,
          declineReasonCode: r.declineReasonCode,
          nextAction: r.nextAction,
          createdVersionId: r.createdVersionId,
          recordedByName: r.recordedById
            ? (names.get(r.recordedById) ?? null)
            : null,
        })),
        followUps: followUps.map((f) => ({
          id: f.id,
          versionId: f.versionId,
          assigneeId: f.assigneeId,
          assigneeName: f.assigneeId ? (names.get(f.assigneeId) ?? null) : null,
          method: f.method,
          dueAt: f.dueAt.toISOString(),
          note: f.note,
          status: f.status,
          overdue: f.status === 'OPEN' && f.dueAt.getTime() <= Date.now(),
          completedAt: f.completedAt?.toISOString() ?? null,
          completedByName: f.completedById
            ? (names.get(f.completedById) ?? null)
            : null,
          outcome: f.outcome,
          rescheduledFromId: f.rescheduledFromId,
          createdAt: f.createdAt.toISOString(),
        })),
      },
    };
  }

  private async userNames(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
      ]),
    );
  }

  /* ─── drafts ────────────────────────────────────────────────────────── */

  private resolveBranch(
    actor: RequestUser,
    requested: string | null | undefined,
    enquiry: EnquiryRow,
  ): string {
    const scope = this.orgScope.fromRequestUser(actor);
    const id =
      requested ||
      enquiry.locationId ||
      (scope.locationIds?.length === 1 ? scope.locationIds[0] : null);
    if (!id)
      throw new BadRequestException('Choose the branch for this quotation');
    this.orgScope.assertLocationAccess(scope, id);
    return id;
  }

  private draftFields(dto: QuoteDraftDto) {
    const data: Prisma.EnquiryQuotationVersionUncheckedUpdateInput = {};
    if (dto.quoteType !== undefined) data.quoteType = dto.quoteType;
    if (dto.ownerId !== undefined) data.ownerId = dto.ownerId;
    if (dto.proposedStartDate !== undefined)
      data.proposedStartDate = toDate(dto.proposedStartDate);
    if (dto.proposedEndDate !== undefined)
      data.proposedEndDate = toDate(dto.proposedEndDate);
    if (dto.issueDate !== undefined) data.issueDate = toDate(dto.issueDate);
    if (dto.validUntil !== undefined) data.validUntil = toDate(dto.validUntil);
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.assessmentSubmissionId !== undefined)
      data.assessmentSubmissionId = dto.assessmentSubmissionId;
    if (dto.assessmentReference !== undefined)
      data.assessmentReference = dto.assessmentReference?.trim() || null;
    if (dto.fundingCategory !== undefined)
      data.fundingCategory = dto.fundingCategory;
    if (dto.hourlyRate !== undefined) data.hourlyRate = dto.hourlyRate;
    if (dto.clientLayout !== undefined) data.clientLayout = dto.clientLayout;
    if (dto.manualWeeklyTotal !== undefined)
      data.manualWeeklyTotal = dto.manualWeeklyTotal;
    if (dto.rates !== undefined)
      data.rates =
        (normaliseQuoteRates(dto.rates) as Prisma.InputJsonValue | null) ??
        Prisma.DbNull;
    if (dto.internalNotes !== undefined)
      data.internalNotes = dto.internalNotes?.trim() || null;
    if (dto.clientNotes !== undefined)
      data.clientNotes = dto.clientNotes?.trim() || null;
    if (dto.terms !== undefined) data.terms = dto.terms?.trim() || null;
    return data;
  }

  private assertDates(v: {
    proposedStartDate?: Date | null;
    proposedEndDate?: Date | null;
    issueDate?: Date | null;
    validUntil?: Date | null;
  }) {
    if (
      v.proposedStartDate &&
      v.proposedEndDate &&
      v.proposedEndDate < v.proposedStartDate
    ) {
      throw new BadRequestException(
        'The proposed end date is before the start date',
      );
    }
    if (v.issueDate && v.validUntil && v.validUntil < v.issueDate) {
      throw new BadRequestException('Valid until is before the issue date');
    }
  }

  /** Replace patterns / fundings / extras when given. Manual charges keep who set them and when. */
  private async replaceLists(
    tx: Tx,
    versionId: string,
    dto: QuoteDraftDto,
    userId: string,
    before?: VersionRow,
  ) {
    if (dto.patterns) {
      await tx.enquiryQuotationVisitPattern.deleteMany({
        where: { versionId },
      });
      for (const [i, p] of dto.patterns.entries()) {
        if (p.manualChargePerVisit != null && !p.overrideReason?.trim()) {
          throw new BadRequestException(
            `${p.label}: give a reason for the manual charge`,
          );
        }
        const prev = before?.patterns[i];
        const sameOverride =
          prev &&
          num(prev.manualChargePerVisit) === (p.manualChargePerVisit ?? null) &&
          (prev.overrideReason ?? null) === (p.overrideReason?.trim() || null);
        await tx.enquiryQuotationVisitPattern.create({
          data: {
            versionId,
            sortOrder: i,
            label: p.label.trim(),
            careType: p.careType?.trim() || null,
            startTime: p.startTime,
            endTime: p.endTime || null,
            windowEndTime: p.windowEndTime || null,
            durationMinutes: p.durationMinutes,
            daysOfWeek:
              p.frequency === 'ONE_OFF'
                ? []
                : [...new Set(p.daysOfWeek)].sort((a, b) => a - b),
            frequency: p.frequency,
            effectiveFrom: toDate(p.effectiveFrom),
            effectiveTo: toDate(p.effectiveTo),
            oneOffDates:
              p.frequency === 'ONE_OFF'
                ? (p.oneOffDates ?? []).map((d) => toDate(d)!)
                : [],
            carersPerVisit: p.carersPerVisit,
            nightDuty: p.nightDuty ?? 'NONE',
            activities: (p.activities ?? [])
              .map((a) => a.trim())
              .filter(Boolean),
            notes: p.notes?.trim() || null,
            manualChargePerVisit: p.manualChargePerVisit ?? null,
            overrideReason:
              p.manualChargePerVisit != null ? p.overrideReason!.trim() : null,
            overrideById:
              p.manualChargePerVisit != null
                ? sameOverride
                  ? prev.overrideById
                  : userId
                : null,
            overrideAt:
              p.manualChargePerVisit != null
                ? sameOverride
                  ? prev.overrideAt
                  : new Date()
                : null,
          },
        });
      }
    }
    if (dto.fundings) {
      await tx.enquiryQuotationFunding.deleteMany({ where: { versionId } });
      await tx.enquiryQuotationFunding.createMany({
        data: dto.fundings.map((f, i) => ({
          versionId,
          sortOrder: i,
          payerType: f.payerType,
          payerName: f.payerName?.trim() || null,
          funderId: f.funderId ?? null,
          reference: f.reference?.trim() || null,
          method: f.method,
          amount: f.amount,
          status:
            f.payerType === 'PRIVATE_CLIENT'
              ? 'CONFIRMED'
              : (f.status ?? 'PENDING_APPROVAL'),
        })),
      });
    }
    if (dto.extras) {
      await tx.enquiryQuotationExtra.deleteMany({ where: { versionId } });
      await tx.enquiryQuotationExtra.createMany({
        data: dto.extras.map((e, i) => ({
          versionId,
          sortOrder: i,
          kind: e.kind,
          description: e.description.trim(),
          frequency: e.frequency,
          amount: e.amount ?? null,
          quantity: e.quantity ?? null,
          isPercentage: e.kind === 'DISCOUNT' ? Boolean(e.isPercentage) : false,
        })),
      });
    }
  }

  private async event(
    tx: Tx,
    enquiryId: string,
    action: string,
    note: string | null,
    userId: string | null,
    versionId: string | null,
  ) {
    await tx.enquiryEvent.create({
      data: { enquiryId, action, note, userId, quotationVersionId: versionId },
    });
  }

  private async logAudit(
    tx: Tx,
    userId: string,
    action: AuditAction,
    eventType: AuditEventType,
    recordId: string,
    description: string,
    meta?: RequestAuditMeta,
    values?: {
      oldValues?: Record<string, unknown>;
      newValues?: Record<string, unknown>;
    },
  ) {
    await this.audit.logAudit({
      tx,
      userId,
      module: AuditModule.CRM,
      action,
      eventType,
      recordType: 'EnquiryQuotationVersion',
      recordId,
      description,
      oldValues: values?.oldValues
        ? auditSnapshot(values.oldValues)
        : undefined,
      newValues: values?.newValues
        ? auditSnapshot(values.newValues)
        : undefined,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
  }

  /** New quotation (V1 draft) on the enquiry. It becomes the enquiry's current quotation. Never changes the stage. */
  async create(
    actor: RequestUser,
    enquiryId: string,
    dto: QuoteDraftDto,
    meta?: RequestAuditMeta,
  ) {
    const userId = actor.id;
    const created = await this.prisma.$transaction(async (tx) => {
      const enquiry = await this.enquiry(actor, enquiryId, tx);
      const locationId = this.resolveBranch(actor, dto.locationId, enquiry);
      const year = new Date().getFullYear();
      const seq = await tx.enquiryQuotationNumberSequence.upsert({
        where: { year },
        create: { year, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
      const quotationNumber = formatQuotationNumber(year, seq.lastValue);
      await tx.enquiryQuotation.updateMany({
        where: { enquiryId, isCurrent: true },
        data: { isCurrent: false },
      });
      const quotation = await tx.enquiryQuotation.create({
        data: {
          enquiryId,
          quotationNumber,
          isCurrent: true,
          createdById: userId,
        },
      });
      const fields = this.draftFields(dto);
      const version = await tx.enquiryQuotationVersion.create({
        data: {
          ...(fields as Prisma.EnquiryQuotationVersionUncheckedCreateInput),
          quotationId: quotation.id,
          versionNumber: 1,
          status: 'DRAFT',
          locationId,
          ownerId: dto.ownerId ?? enquiry.ownerId ?? userId,
          proposedStartDate:
            toDate(dto.proposedStartDate) ?? enquiry.requestedStartDate,
          createdById: userId,
          updatedById: userId,
        },
      });
      this.assertDates(version);
      await this.replaceLists(tx, version.id, dto, userId);
      await this.recalcDraft(tx, version.id, enquiry.convertedServiceUserId);
      if (!enquiry.locationId) {
        // The enquiry had no branch: it takes the quote's branch (branch must not stay unset).
        await tx.enquiry.update({
          where: { id: enquiryId },
          data: { locationId },
        });
        await this.event(
          tx,
          enquiryId,
          'Branch set from quotation',
          null,
          userId,
          version.id,
        );
      }
      await this.event(
        tx,
        enquiryId,
        'Quote created',
        `${quotationNumber} V1 (draft)`,
        userId,
        version.id,
      );
      if (enquiry.stage === EnquiryStage.NEW) {
        // A quote is only made once the person has been spoken to, so a new enquiry is now Contacted.
        await tx.enquiry.update({
          where: { id: enquiryId },
          data: { stage: EnquiryStage.CONTACTED, stageChangedAt: new Date() },
        });
        await this.event(
          tx,
          enquiryId,
          `Moved to ${EnquiryStage.CONTACTED}`,
          `${quotationNumber} created`,
          userId,
          version.id,
        );
      }
      await this.logAudit(
        tx,
        userId,
        AuditAction.ENQUIRY_QUOTE_CREATED,
        AuditEventType.CREATE,
        version.id,
        `Quotation ${quotationNumber} created`,
        meta,
        {
          newValues: { quotationNumber, enquiryId },
        },
      );
      return version;
    });
    return {
      message: 'Quotation created',
      data: (
        await this.getVersion(actor, enquiryId, created.quotationId, created.id)
      ).data,
    };
  }

  /** Save a draft. Issued versions are never edited — revise instead. */
  async update(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    dto: QuoteDraftDto,
    meta?: RequestAuditMeta,
  ) {
    const userId = actor.id;
    await this.prisma.$transaction(async (tx) => {
      const before = await this.version(
        actor,
        enquiryId,
        quotationId,
        versionId,
        tx,
      );
      if (!isEditable(before.status)) {
        throw new ConflictException(
          `${QUOTE_STATUS_LABELS[before.status]} quotations cannot be edited — create a revision`,
        );
      }
      const enquiry = await this.enquiry(actor, enquiryId, tx);
      const data = this.draftFields(dto);
      if (dto.locationId !== undefined)
        data.locationId = this.resolveBranch(actor, dto.locationId, enquiry);
      // Conditional on DRAFT so a concurrent submit/approve wins cleanly.
      const done = await tx.enquiryQuotationVersion.updateMany({
        where: { id: versionId, status: 'DRAFT' },
        data: {
          ...(data as Prisma.EnquiryQuotationVersionUncheckedUpdateManyInput),
          updatedById: userId,
        },
      });
      if (!done.count)
        throw new ConflictException(
          'This quotation was changed by someone else — reload it',
        );
      this.assertDates(
        await tx.enquiryQuotationVersion.findUniqueOrThrow({
          where: { id: versionId },
        }),
      );
      await this.replaceLists(tx, versionId, dto, userId, before);
      await this.recalcDraft(tx, versionId, enquiry.convertedServiceUserId);
      await this.logAudit(
        tx,
        userId,
        AuditAction.ENQUIRY_QUOTE_UPDATED,
        AuditEventType.UPDATE,
        versionId,
        `Quotation ${before.quotation.quotationNumber} V${before.versionNumber} saved`,
        meta,
      );
    });
    return {
      message: 'Draft saved',
      data: (await this.getVersion(actor, enquiryId, quotationId, versionId))
        .data,
    };
  }

  /** Make another quotation on the enquiry the current one. */
  async makeCurrent(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.enquiry(actor, enquiryId, tx);
      const q = await tx.enquiryQuotation.findFirst({
        where: { id: quotationId, enquiryId, deletedAt: null },
      });
      if (!q) throw new NotFoundException('Quotation not found');
      await tx.enquiryQuotation.updateMany({
        where: { enquiryId },
        data: { isCurrent: false },
      });
      await tx.enquiryQuotation.update({
        where: { id: quotationId },
        data: { isCurrent: true },
      });
      await this.event(
        tx,
        enquiryId,
        'Current quote changed',
        q.quotationNumber,
        actor.id,
        null,
      );
    });
    return { message: 'Current quotation changed' };
  }

  /* ─── status changes ────────────────────────────────────────────────── */

  /** Atomic move: only succeeds from the status that was read (a double click gets a 409). */
  private async move(
    tx: Tx,
    v: { id: string; status: EnquiryQuoteStatus },
    to: EnquiryQuoteStatus,
    data: Prisma.EnquiryQuotationVersionUncheckedUpdateManyInput = {},
  ) {
    if (!canTransition(v.status, to)) {
      throw new ConflictException(
        `A ${QUOTE_STATUS_LABELS[v.status].toLowerCase()} quotation cannot become ${QUOTE_STATUS_LABELS[to].toLowerCase()}`,
      );
    }
    const done = await tx.enquiryQuotationVersion.updateMany({
      where: { id: v.id, status: v.status },
      data: { ...data, status: to, statusChangedAt: new Date() },
    });
    if (!done.count)
      throw new ConflictException(
        'This quotation was changed by someone else — reload it',
      );
  }

  /** Price, check and freeze a draft (it leaves DRAFT). Blocked while any charge is unresolved. */
  private async issue(
    tx: Tx,
    v: VersionRow,
    serviceUserId: string | null,
    userId: string,
  ) {
    if (!v.locationId)
      throw new BadRequestException(
        'Choose the branch before issuing the quotation',
      );
    if (!v.patterns.length)
      throw new BadRequestException(
        'Add at least one visit before issuing the quotation',
      );
    if (!v.validUntil)
      throw new BadRequestException(
        'Set the valid-until date before issuing the quotation',
      );
    const { pricing, snapshot } = await this.calculate(tx, {
      locationId: v.locationId,
      hourlyRate: v.hourlyRate,
      rates: v.rates,
      clientLayout: v.clientLayout,
      manualWeeklyTotal: v.manualWeeklyTotal,
      proposedStartDate: isoDay(v.proposedStartDate),
      fundingCategory: v.fundingCategory,
      serviceUserId,
      patterns: v.patterns,
      fundings: v.fundings,
      extras: v.extras,
    });
    if (pricing.unresolvedCharges > 0 || pricing.issues.length) {
      throw new BadRequestException({
        message: `Resolve ${pricing.issues.length} pricing problem(s) before issuing: ${pricing.issues.slice(0, 3).join('; ')}`,
        issues: pricing.issues,
      });
    }
    await this.storeComputed(tx, v, pricing);
    const full: PricingSnapshot = {
      ...snapshot,
      calculatedAt: new Date().toISOString(),
      pricing,
    };
    return {
      pricingSnapshot: full as unknown as Prisma.InputJsonValue,
      issuedAt: new Date(),
      issuedById: userId,
      issueDate: v.issueDate ?? toDate(operationalTodayIso()),
    };
  }

  async submitForApproval(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    meta?: RequestAuditMeta,
  ) {
    return this.statusChange(
      actor,
      enquiryId,
      quotationId,
      versionId,
      meta,
      async (tx, v, enquiry) => {
        const issued = await this.issue(
          tx,
          v,
          enquiry.convertedServiceUserId,
          actor.id,
        );
        await this.move(tx, v, 'PENDING_APPROVAL', {
          ...issued,
          submittedForApprovalAt: new Date(),
          submittedForApprovalById: actor.id,
        });
        return {
          action: 'Quote submitted for approval',
          to: 'PENDING_APPROVAL' as const,
        };
      },
    );
  }

  /** Approve a pending (or, by a manager directly, a draft) version. */
  async approve(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    note: string | undefined,
    meta?: RequestAuditMeta,
  ) {
    return this.statusChange(
      actor,
      enquiryId,
      quotationId,
      versionId,
      meta,
      async (tx, v, enquiry) => {
        const issued =
          v.status === 'DRAFT'
            ? await this.issue(tx, v, enquiry.convertedServiceUserId, actor.id)
            : {};
        await this.move(tx, v, 'APPROVED', {
          ...issued,
          approvedAt: new Date(),
          approvedById: actor.id,
          approvalNote: note?.trim() || null,
        });
        return { action: 'Quote approved', to: 'APPROVED' as const, note };
      },
    );
  }

  /** Send a pending version back to draft (its snapshot is cleared; it becomes editable again). */
  async rejectApproval(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    note: string | undefined,
    meta?: RequestAuditMeta,
  ) {
    return this.statusChange(
      actor,
      enquiryId,
      quotationId,
      versionId,
      meta,
      async (tx, v) => {
        if (v.status !== 'PENDING_APPROVAL')
          throw new ConflictException(
            'Only a quotation waiting for approval can be sent back',
          );
        await this.move(tx, v, 'DRAFT', {
          pricingSnapshot: Prisma.DbNull,
          issuedAt: null,
          issuedById: null,
          submittedForApprovalAt: null,
          submittedForApprovalById: null,
          approvalNote: note?.trim() || null,
        });
        return {
          action: 'Quote returned to draft',
          to: 'DRAFT' as const,
          note,
        };
      },
    );
  }

  async cancel(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    note: string | undefined,
    meta?: RequestAuditMeta,
  ) {
    return this.statusChange(
      actor,
      enquiryId,
      quotationId,
      versionId,
      meta,
      async (tx, v) => {
        await this.move(tx, v, 'CANCELLED');
        return { action: 'Quote cancelled', to: 'CANCELLED' as const, note };
      },
    );
  }

  private async statusChange(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    meta: RequestAuditMeta | undefined,
    fn: (
      tx: Tx,
      v: VersionRow,
      enquiry: EnquiryRow,
    ) => Promise<{ action: string; to: EnquiryQuoteStatus; note?: string }>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const v = await this.version(
        actor,
        enquiryId,
        quotationId,
        versionId,
        tx,
      );
      const enquiry = await this.enquiry(actor, enquiryId, tx);
      const result = await fn(tx, v, enquiry);
      const label = `${v.quotation.quotationNumber} V${v.versionNumber}`;
      await this.event(
        tx,
        enquiryId,
        result.action,
        [label, result.note?.trim()].filter(Boolean).join(' — '),
        actor.id,
        v.id,
      );
      await this.logAudit(
        tx,
        actor.id,
        AuditAction.ENQUIRY_QUOTE_STATUS_CHANGED,
        AuditEventType.UPDATE,
        v.id,
        `${result.action}: ${label}`,
        meta,
        {
          oldValues: { status: v.status },
          newValues: { status: result.to },
        },
      );
    });
    return {
      message: 'Quotation updated',
      data: (await this.getVersion(actor, enquiryId, quotationId, versionId))
        .data,
    };
  }

  /** New draft revision copied from any issued version; the source version is kept unchanged. */
  async revise(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    meta?: RequestAuditMeta,
  ) {
    const created = await this.prisma.$transaction(async (tx) => {
      const source = await this.version(
        actor,
        enquiryId,
        quotationId,
        versionId,
        tx,
      );
      const v = await this.createRevision(tx, source, actor.id);
      await this.event(
        tx,
        enquiryId,
        'Quote revised',
        `${source.quotation.quotationNumber} V${v.versionNumber} (draft) from V${source.versionNumber}`,
        actor.id,
        v.id,
      );
      await this.logAudit(
        tx,
        actor.id,
        AuditAction.ENQUIRY_QUOTE_CREATED,
        AuditEventType.CREATE,
        v.id,
        `Revision V${v.versionNumber} of ${source.quotation.quotationNumber}`,
        meta,
      );
      return v;
    });
    return {
      message: `Draft V${created.versionNumber} created`,
      data: (await this.getVersion(actor, enquiryId, quotationId, created.id))
        .data,
    };
  }

  private async createRevision(tx: Tx, source: VersionRow, userId: string) {
    if (source.status === 'DRAFT' || source.status === 'CANCELLED') {
      throw new ConflictException(
        'Only an issued quotation can be revised — edit the draft instead',
      );
    }
    const open = await tx.enquiryQuotationVersion.findFirst({
      where: {
        quotationId: source.quotationId,
        status: { in: ['DRAFT', 'PENDING_APPROVAL'] },
      },
    });
    if (open)
      throw new ConflictException(
        `V${open.versionNumber} is already being prepared — finish or cancel it first`,
      );
    const last = await tx.enquiryQuotationVersion.aggregate({
      where: { quotationId: source.quotationId },
      _max: { versionNumber: true },
    });
    const v = await tx.enquiryQuotationVersion.create({
      data: {
        quotationId: source.quotationId,
        versionNumber: (last._max.versionNumber ?? 0) + 1,
        status: 'DRAFT',
        quoteType: source.quoteType,
        revisedFromVersionId: source.id,
        locationId: source.locationId,
        ownerId: source.ownerId,
        proposedStartDate: source.proposedStartDate,
        proposedEndDate: source.proposedEndDate,
        validUntil: null,
        currency: source.currency,
        assessmentSubmissionId: source.assessmentSubmissionId,
        assessmentReference: source.assessmentReference,
        fundingCategory: source.fundingCategory,
        hourlyRate: source.hourlyRate,
        rates: source.rates ?? Prisma.DbNull,
        clientLayout: source.clientLayout,
        manualWeeklyTotal: source.manualWeeklyTotal,
        internalNotes: source.internalNotes,
        clientNotes: source.clientNotes,
        terms: source.terms,
        createdById: userId,
        updatedById: userId,
        patterns: {
          create: source.patterns.map((row) => omitIds(row)),
        },
        fundings: {
          create: source.fundings.map((row) => omitIds(row)),
        },
        extras: {
          create: source.extras.map((row) => omitIds(row)),
        },
      },
    });
    const enquiry = await tx.enquiry.findUniqueOrThrow({
      where: { id: source.quotation.enquiryId },
      select: { convertedServiceUserId: true },
    });
    await this.recalcDraft(tx, v.id, enquiry.convertedServiceUserId);
    return v;
  }

  /* ─── sending ───────────────────────────────────────────────────────── */

  /** Moves the enquiry to "Quote sent" (OFFER) — only after a real or recorded send, never from a draft. */
  private async markEnquiryQuoteSent(
    tx: Tx,
    enquiry: EnquiryRow,
    label: string,
    versionId: string,
    userId: string,
  ) {
    if (
      !OPEN_STAGES.includes(enquiry.stage) ||
      enquiry.stage === EnquiryStage.OFFER
    )
      return;
    await tx.enquiry.update({
      where: { id: enquiry.id },
      data: { stage: EnquiryStage.OFFER, stageChangedAt: new Date() },
    });
    await this.event(
      tx,
      enquiry.id,
      `Moved to ${EnquiryStage.OFFER}`,
      `${label} sent`,
      userId,
      versionId,
    );
  }

  /**
   * Send a version (EMAIL through the mail integration) or record a send done elsewhere.
   * The idempotency key makes a retry / double click return the first result.
   */
  async send(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    dto: SendQuoteDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.enquiryQuotationCommunication.findUnique(
      { where: { idempotencyKey: dto.idempotencyKey } },
    );
    if (existing) {
      if (existing.versionId !== versionId)
        throw new ConflictException(
          'This send key was used for another quotation',
        );
      return {
        message: 'Already recorded',
        data: (await this.getVersion(actor, enquiryId, quotationId, versionId))
          .data,
      };
    }
    const v = await this.version(actor, enquiryId, quotationId, versionId);
    if (!SENDABLE.includes(v.status)) {
      throw new ConflictException(
        v.status === 'DRAFT' || v.status === 'PENDING_APPROVAL'
          ? 'The quotation must be approved before it is sent'
          : `A ${QUOTE_STATUS_LABELS[v.status].toLowerCase()} quotation cannot be sent`,
      );
    }
    const enquiry = await this.enquiry(actor, enquiryId);
    const label = `${v.quotation.quotationNumber} V${v.versionNumber}`;
    const isEmail = dto.channel === 'EMAIL';
    const recipientEmail =
      dto.recipientEmail?.trim() || (isEmail ? enquiry.contactEmail : null);
    if (isEmail) {
      if (!this.emailAvailable()) {
        throw new BadRequestException(
          'Email sending is not set up — record the send as external instead',
        );
      }
      if (!recipientEmail)
        throw new BadRequestException('Enter the recipient email address');
    }

    // Claim the key first so two simultaneous requests cannot both send.
    let comm;
    try {
      comm = await this.prisma.enquiryQuotationCommunication.create({
        data: {
          quotationId,
          versionId,
          channel: dto.channel,
          status: isEmail ? 'FAILED' : 'RECORDED',
          failureReason: isEmail ? 'Sending…' : null,
          recipientName: dto.recipientName?.trim() || enquiry.contactName,
          recipientEmail,
          template: isEmail ? 'enquiry-quotation-v1' : null,
          subject: dto.subject?.trim() || `Your care quotation ${label}`,
          message: dto.message?.trim() || null,
          senderId: actor.id,
          sentAt: isEmail
            ? null
            : dto.sentAt
              ? new Date(dto.sentAt)
              : new Date(),
          followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : null,
          idempotencyKey: dto.idempotencyKey,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return {
          message: 'Already recorded',
          data: (
            await this.getVersion(actor, enquiryId, quotationId, versionId)
          ).data,
        };
      }
      throw e;
    }

    if (isEmail) {
      const ok = await this.deliverEmail(comm.id, v, enquiry);
      if (!ok) {
        await this.prisma.enquiryEvent.create({
          data: {
            enquiryId,
            action: 'Quote email failed',
            note: label,
            userId: actor.id,
            quotationVersionId: versionId,
          },
        });
        throw new BadRequestException(
          'The email could not be sent — see the communication history to retry, or record an external send',
        );
      }
    }
    await this.afterSuccessfulSend(
      actor,
      enquiryId,
      v,
      comm.id,
      dto.channel,
      meta,
    );
    return {
      message: isEmail ? 'Quotation emailed' : 'External send recorded',
      data: (await this.getVersion(actor, enquiryId, quotationId, versionId))
        .data,
    };
  }

  /** Retry a failed email. */
  async retrySend(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    communicationId: string,
    meta?: RequestAuditMeta,
  ) {
    const comm = await this.prisma.enquiryQuotationCommunication.findFirst({
      where: { id: communicationId, quotationId },
    });
    if (!comm) throw new NotFoundException('Communication not found');
    const v = await this.version(actor, enquiryId, quotationId, comm.versionId);
    if (comm.channel !== 'EMAIL' || comm.status !== 'FAILED')
      throw new ConflictException('Only a failed email can be retried');
    if (!SENDABLE.includes(v.status))
      throw new ConflictException('This quotation can no longer be sent');
    if (!this.emailAvailable())
      throw new BadRequestException(
        'Email sending is not set up — record the send as external instead',
      );
    // Claim the retry (attempt count moves only for this request).
    const claimed = await this.prisma.enquiryQuotationCommunication.updateMany({
      where: { id: comm.id, status: 'FAILED', attemptCount: comm.attemptCount },
      data: { attemptCount: comm.attemptCount + 1, failureReason: 'Sending…' },
    });
    if (!claimed.count)
      throw new ConflictException('A retry is already in progress');
    const enquiry = await this.enquiry(actor, enquiryId);
    const ok = await this.deliverEmail(comm.id, v, enquiry);
    if (!ok) throw new BadRequestException('The email could not be sent again');
    await this.afterSuccessfulSend(actor, enquiryId, v, comm.id, 'EMAIL', meta);
    return {
      message: 'Quotation emailed',
      data: (await this.getVersion(actor, enquiryId, quotationId, v.id)).data,
    };
  }

  private async deliverEmail(
    communicationId: string,
    v: VersionRow,
    enquiry: EnquiryRow,
  ): Promise<boolean> {
    const comm =
      await this.prisma.enquiryQuotationCommunication.findUniqueOrThrow({
        where: { id: communicationId },
      });
    try {
      const view = await this.clientView(v, enquiry);
      const pdf = await buildQuotePdf(view);
      // The whole quotation is in the message as well as in the attached PDF.
      const body = buildQuoteEmail(view, {
        recipientName: comm.recipientName,
        message: comm.message,
      });
      const result = await this.mail.send({
        to: comm.recipientEmail!,
        subject: comm.subject ?? `Your care quotation ${view.quotationNumber}`,
        text: body.text,
        html: body.html,
        attachments: [
          {
            filename: `${view.quotationNumber}-V${view.versionNumber}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      });
      await this.prisma.enquiryQuotationCommunication.update({
        where: { id: communicationId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          failureReason: null,
          providerMessageId: result.messageId,
        },
      });
      return true;
    } catch (e) {
      this.logger.warn(
        `Quote email ${communicationId} failed: ${(e as Error).message}`,
      );
      await this.prisma.enquiryQuotationCommunication.update({
        where: { id: communicationId },
        data: {
          status: 'FAILED',
          failureReason: (e as Error).message?.slice(0, 1000) || 'Email failed',
        },
      });
      return false;
    }
  }

  private async afterSuccessfulSend(
    actor: RequestUser,
    enquiryId: string,
    v: VersionRow,
    communicationId: string,
    channel: string,
    meta?: RequestAuditMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const enquiry = await this.enquiry(actor, enquiryId, tx);
      const current = await tx.enquiryQuotationVersion.findUniqueOrThrow({
        where: { id: v.id },
      });
      const label = `${v.quotation.quotationNumber} V${v.versionNumber}`;
      const comm = await tx.enquiryQuotationCommunication.findUniqueOrThrow({
        where: { id: communicationId },
      });
      if (current.status === 'APPROVED') {
        await this.move(tx, current, 'SENT', {
          sentAt: comm.sentAt ?? new Date(),
        });
        // Older versions still with the client are replaced by this one.
        const older = await tx.enquiryQuotationVersion.findMany({
          where: {
            quotationId: v.quotationId,
            id: { not: v.id },
            status: { in: ['APPROVED', ...AWAITING_CLIENT, 'EXPIRED'] },
          },
        });
        for (const o of older) {
          await this.move(tx, o, 'SUPERSEDED');
          await this.event(
            tx,
            enquiryId,
            'Quote superseded',
            `${v.quotation.quotationNumber} V${o.versionNumber} replaced by V${v.versionNumber}`,
            actor.id,
            o.id,
          );
        }
      }
      const how =
        channel === 'EMAIL'
          ? `emailed to ${comm.recipientEmail}`
          : `sent outside CareFlow (${channel.replace('_', ' ').toLowerCase()})`;
      await this.event(
        tx,
        enquiryId,
        'Quote sent',
        `${label} ${how}`,
        actor.id,
        v.id,
      );
      await this.markEnquiryQuoteSent(tx, enquiry, label, v.id, actor.id);
      if (comm.followUpDate) {
        await tx.enquiryQuotationFollowUp.create({
          data: {
            quotationId: v.quotationId,
            versionId: v.id,
            dueAt: comm.followUpDate,
            assigneeId: actor.id,
            note: `Follow up ${label}`,
            createdById: actor.id,
          },
        });
        await this.syncEnquiryFollowUp(tx, enquiryId);
      }
      await this.logAudit(
        tx,
        actor.id,
        AuditAction.ENQUIRY_QUOTE_SENT,
        AuditEventType.UPDATE,
        v.id,
        `Quotation ${label} ${how}`,
        meta,
      );
    });
  }

  /* ─── client view / PDF ─────────────────────────────────────────────── */

  private async clientView(
    v: VersionRow,
    enquiry: EnquiryRow,
  ): Promise<ClientQuoteView> {
    const snap = this.snapshotOf(v);
    if (!snap)
      throw new ConflictException(
        'A draft has no issued price yet — submit or approve it first',
      );
    const profile = await this.prisma.companyProfile.findFirst({
      select: {
        displayName: true,
        companyName: true,
        email: true,
        phoneNumber: true,
        vatNumber: true,
      },
    });
    const p = snap.pricing;
    const freq: Record<string, string> = {
      WEEKLY: 'weekly',
      FORTNIGHTLY: 'every 2 weeks',
      FOUR_WEEKLY: 'every 4 weeks',
      ONE_OFF: 'one-off',
    };
    const hm = (m: number) =>
      m < 60
        ? `${m} min`
        : m % 60
          ? `${Math.floor(m / 60)}h ${m % 60}m`
          : `${m / 60}h`;
    return {
      provider: {
        name: profile?.displayName || profile?.companyName || 'Care provider',
        email: profile?.email ?? null,
        phone: profile?.phoneNumber ?? null,
        vatNumber: profile?.vatNumber ?? null,
      },
      quotationNumber: v.quotation.quotationNumber,
      versionNumber: v.versionNumber,
      quoteTypeLabel: QUOTE_TYPE_LABELS[v.quoteType],
      statusLabel: QUOTE_STATUS_LABELS[v.status],
      issueDate: isoDay(v.issueDate),
      validUntil: isoDay(v.validUntil),
      proposedStartDate: isoDay(v.proposedStartDate),
      proposedEndDate: isoDay(v.proposedEndDate),
      clientName: `${enquiry.firstName} ${enquiry.lastName}`,
      contactName: enquiry.contactName,
      layout: v.clientLayout,
      visits: v.patterns.map((pat, i) => {
        const priced = p.patterns[i];
        if (v.clientLayout === 'SUMMARY') {
          // No times, lengths or prices: "Morning visit", the days and how often.
          const days =
            pat.frequency === 'ONE_OFF'
              ? pat.oneOffDates.map((d) => isoDay(d)!)
              : [1, 2, 3, 4, 5, 6, 0]
                  .filter((d) => pat.daysOfWeek.includes(d))
                  .map((d) => WEEKDAY_NAMES[d].slice(0, 3));
          const often =
            freq[pat.frequency].charAt(0).toUpperCase() +
            freq[pat.frequency].slice(1);
          return {
            // The slot's name ("Morning visit"); visits added with times get one from their start time.
            label:
              pat.label?.trim() ||
              `${timeOfDay(pat.startTime, pat.nightDuty)} visit`,
            when: `${days.length === 7 ? 'Every day' : days.join(', ')} (${freq[pat.frequency]})`,
            days: days.length === 7 ? ['Every day'] : days,
            time: '',
            frequency: often,
            duration: '',
            carers: pat.carersPerVisit,
            activities: pat.activities,
            perVisit: null,
            weekly: '',
          };
        }
        const days =
          pat.frequency === 'ONE_OFF'
            ? pat.oneOffDates.map((d) => isoDay(d)).join(', ')
            : pat.daysOfWeek
                .map((d) => WEEKDAY_NAMES[d].slice(0, 3))
                .join(', ');
        const time = pat.windowEndTime
          ? `between ${pat.startTime} and ${pat.windowEndTime}`
          : `${pat.startTime}${pat.endTime ? `-${pat.endTime}` : ''}`;
        return {
          label: pat.label,
          when: `${days} ${time} (${freq[pat.frequency]})`,
          days:
            pat.frequency === 'ONE_OFF'
              ? pat.oneOffDates.map((d) => isoDay(d)!)
              : [1, 2, 3, 4, 5, 6, 0]
                  .filter((d) => pat.daysOfWeek.includes(d))
                  .map((d) => WEEKDAY_NAMES[d].slice(0, 3)),
          time: pat.windowEndTime
            ? `Between ${pat.startTime} and ${pat.windowEndTime}`
            : `${pat.startTime}${pat.endTime ? ` – ${pat.endTime}` : ''}`,
          frequency:
            freq[pat.frequency].charAt(0).toUpperCase() +
            freq[pat.frequency].slice(1),
          duration: hm(pat.durationMinutes),
          carers: pat.carersPerVisit,
          activities: pat.activities,
          perVisit: perVisitRange(priced),
          weekly:
            pat.frequency === 'ONE_OFF'
              ? `${gbp(priced?.oneOffTotal ?? 0)} one-off`
              : `${gbp(priced?.weeklyTotal ?? 0)} / week`,
        };
      }),
      extras: p.extras.map((e) => ({
        description: e.description,
        frequency: e.frequency.toLowerCase().replace('_', '-'),
        amount: gbp(e.total),
      })),
      totals: [
        ...p.estimates.map((e) => ({
          label: e.label,
          amount: gbp(e.amount),
          method: e.method,
        })),
        ...(p.calendarMonth.complete
          ? [
              {
                label: 'Calendar month estimate',
                amount: gbp(p.calendarMonth.amount),
                method: p.calendarMonth.method,
              },
            ]
          : []),
      ],
      oneOffTotal: p.oneOffTotal ? gbp(p.oneOffTotal) : null,
      // Only when the quote has rates besides the hourly one (the visit rows show that); never on a summary.
      rates:
        snap.rates && v.clientLayout === 'DETAILED'
          ? describeQuoteRates(snap.hourlyRate, snap.rates)
          : [],
      // Care is VAT exempt, so VAT is only mentioned when the quote charges it.
      vatLabel: p.vatWeekly > 0 ? p.vatLabel : null,
      funding: p.fundings
        .filter((f) => f.payerType !== 'PRIVATE_CLIENT')
        .map((f) => ({
          payer: f.payerName || f.payerType.replace('_', ' ').toLowerCase(),
          detail:
            f.method === 'PERCENTAGE'
              ? `${f.amount}%`
              : f.method === 'PER_VISIT'
                ? `${gbp(f.amount)} per visit`
                : `${gbp(f.amount)} per week`,
          weekly: `${gbp(f.weeklyAmount)} / week`,
          status: f.status === 'CONFIRMED' ? 'confirmed' : 'pending approval',
        })),
      clientWeeklyLiability: `${gbp(p.clientWeeklyLiability)} / week`,
      clientNotes: v.clientNotes,
      terms: v.terms,
    };
  }

  /** Client-facing preview (no internal notes). Drafts are refused — preview what will be sent. */
  async preview(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
  ) {
    const v = await this.version(actor, enquiryId, quotationId, versionId);
    const enquiry = await this.enquiry(actor, enquiryId);
    return { data: await this.clientView(v, enquiry) };
  }

  async pdf(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
  ) {
    const v = await this.version(actor, enquiryId, quotationId, versionId);
    const enquiry = await this.enquiry(actor, enquiryId);
    const buffer = await buildQuotePdf(await this.clientView(v, enquiry));
    return {
      buffer,
      filename: `${v.quotation.quotationNumber}-V${v.versionNumber}.pdf`,
    };
  }

  /* ─── automatic quotes (referral inbox) ─────────────────────────────── */

  /**
   * A provisional quotation made automatically from a referral email: created as a draft, then approved
   * with the standard rates (the approval note says it was automatic). Pricing problems throw, so a quote
   * is only made when every visit can be priced.
   */
  async createApprovedFromReferral(actor: RequestUser, enquiryId: string, dto: QuoteDraftDto, note: string) {
    const created = await this.create(actor, enquiryId, dto);
    const v = created.data as { id: string; quotationId: string };
    try {
      await this.approve(actor, enquiryId, v.quotationId, v.id, note);
    } catch (e) {
      // Leave nothing half-made: the draft is removed when it can't be priced.
      await this.prisma.enquiryQuotation.update({ where: { id: v.quotationId }, data: { deletedAt: new Date(), isCurrent: false } });
      throw e;
    }
    const row = await this.prisma.enquiryQuotationVersion.findUniqueOrThrow({
      where: { id: v.id },
      select: { weeklyTotal: true, quotation: { select: { quotationNumber: true } } },
    });
    return { quotationId: v.quotationId, versionId: v.id, quotationNumber: row.quotation.quotationNumber, weeklyTotal: Number(row.weeklyTotal) };
  }

  /** The PDF and the client wording of an issued version (for attaching to an email sent elsewhere). */
  async clientPdf(actor: RequestUser, enquiryId: string, quotationId: string, versionId: string) {
    const v = await this.version(actor, enquiryId, quotationId, versionId);
    const enquiry = await this.enquiry(actor, enquiryId);
    const view = await this.clientView(v, enquiry);
    return { buffer: await buildQuotePdf(view), filename: `${v.quotation.quotationNumber}-V${v.versionNumber}.pdf`, view };
  }

  /** Record that an approved version was emailed from the referrals mailbox (moves it to Sent, like a normal send). */
  async recordEmailedFromMailbox(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    sent: { recipientEmail: string; recipientName?: string | null; subject: string; providerMessageId?: string | null },
  ) {
    const v = await this.version(actor, enquiryId, quotationId, versionId);
    const comm = await this.prisma.enquiryQuotationCommunication.create({
      data: {
        quotationId,
        versionId,
        channel: 'EMAIL',
        status: 'SENT',
        recipientEmail: sent.recipientEmail,
        recipientName: sent.recipientName ?? null,
        template: 'referral-reply',
        subject: sent.subject,
        senderId: null,
        sentAt: new Date(),
        providerMessageId: sent.providerMessageId ?? null,
        idempotencyKey: `referral-${versionId}`,
      },
    });
    await this.afterSuccessfulSend(actor, enquiryId, v, comm.id, 'EMAIL');
  }

  /* ─── responses ─────────────────────────────────────────────────────── */

  async recordResponse(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    dto: RecordResponseDto,
    meta?: RequestAuditMeta,
  ) {
    const userId = actor.id;
    let resultVersionId = versionId;
    await this.prisma.$transaction(async (tx) => {
      const v = await this.version(
        actor,
        enquiryId,
        quotationId,
        versionId,
        tx,
      );
      const enquiry = await this.enquiry(actor, enquiryId, tx);
      if (!RESPONDABLE.includes(v.status)) {
        throw new ConflictException(
          `A response cannot be recorded on a ${QUOTE_STATUS_LABELS[v.status].toLowerCase()} quotation`,
        );
      }
      const label = `${v.quotation.quotationNumber} V${v.versionNumber}`;
      const respondedAt = dto.respondedAt
        ? new Date(dto.respondedAt)
        : new Date();
      const detail = dto.details?.trim() || null;
      let createdVersionId: string | null = null;

      switch (dto.responseType) {
        case 'ACCEPTED': {
          await this.move(tx, v, 'ACCEPTED', {
            acceptedAt: respondedAt,
            respondedAt,
          });
          // Other open versions of this quotation are replaced by the accepted one.
          const others = await tx.enquiryQuotationVersion.findMany({
            where: {
              quotationId,
              id: { not: v.id },
              status: {
                in: [
                  'DRAFT',
                  'PENDING_APPROVAL',
                  'APPROVED',
                  ...AWAITING_CLIENT,
                  'EXPIRED',
                ],
              },
            },
          });
          for (const o of others)
            await this.move(
              tx,
              o,
              o.status === 'DRAFT' || o.status === 'PENDING_APPROVAL'
                ? 'CANCELLED'
                : 'SUPERSEDED',
            );
          // The enquiry is NOT marked Won here: Won follows the existing rules (create / link service user, or Mark as won).
          break;
        }
        case 'DECLINED': {
          if (!dto.declineReasonCode)
            throw new BadRequestException('Choose why the quote was declined');
          if (dto.declineReasonCode === EnquiryLostReason.OTHER && !detail) {
            throw new BadRequestException(
              'Describe the reason when choosing "Other"',
            );
          }
          await this.move(tx, v, 'DECLINED', { respondedAt });
          if (
            dto.markEnquiryLost !== false &&
            enquiry.stage !== EnquiryStage.LOST &&
            enquiry.stage !== EnquiryStage.WON
          ) {
            await tx.enquiry.update({
              where: { id: enquiryId },
              data: {
                stage: EnquiryStage.LOST,
                stageChangedAt: new Date(),
                lostReasonCode: dto.declineReasonCode,
                lostReason: detail,
              },
            });
            await this.event(
              tx,
              enquiryId,
              `Moved to ${EnquiryStage.LOST}`,
              [LOST_REASON_LABELS[dto.declineReasonCode], detail]
                .filter(Boolean)
                .join(' — '),
              userId,
              v.id,
            );
          }
          break;
        }
        case 'CHANGES_REQUESTED': {
          if (v.status !== 'CHANGES_REQUESTED')
            await this.move(tx, v, 'CHANGES_REQUESTED', { respondedAt });
          const fresh = await tx.enquiryQuotationVersion.findUniqueOrThrow({
            where: { id: v.id },
            include: versionInclude,
          });
          const revision = await this.createRevision(tx, fresh, userId);
          createdVersionId = revision.id;
          resultVersionId = revision.id;
          await this.event(
            tx,
            enquiryId,
            'Quote revised',
            `${v.quotation.quotationNumber} V${revision.versionNumber} (draft) from V${v.versionNumber}`,
            userId,
            revision.id,
          );
          break;
        }
        case 'QUERY': {
          if (v.status === 'SENT')
            await this.move(tx, v, 'UNDER_NEGOTIATION', { respondedAt });
          break;
        }
        case 'NO_RESPONSE':
          break;
      }

      await tx.enquiryQuotationResponse.create({
        data: {
          quotationId,
          versionId,
          responseType: dto.responseType,
          responderName: dto.responderName?.trim() || null,
          responderRelationship: dto.responderRelationship?.trim() || null,
          method: dto.method?.trim() || null,
          respondedAt,
          details: detail,
          evidence: dto.evidence?.trim() || null,
          declineReasonCode:
            dto.responseType === 'DECLINED' ? dto.declineReasonCode : null,
          nextAction: dto.nextAction?.trim() || null,
          createdVersionId,
          recordedById: userId,
        },
      });
      if (dto.followUpAt) {
        await tx.enquiryQuotationFollowUp.create({
          data: {
            quotationId,
            versionId,
            dueAt: new Date(dto.followUpAt),
            assigneeId: userId,
            note: dto.nextAction?.trim() || `Follow up ${label}`,
            createdById: userId,
          },
        });
      }
      const words: Record<string, string> = {
        ACCEPTED: 'Quote accepted',
        DECLINED: 'Quote declined',
        CHANGES_REQUESTED: 'Quote changes requested',
        QUERY: 'Quote query',
        NO_RESPONSE: 'No response to quote',
      };
      const who = [dto.responderName, dto.responderRelationship]
        .filter(Boolean)
        .join(', ');
      await this.event(
        tx,
        enquiryId,
        words[dto.responseType],
        [
          label,
          who ? `by ${who}` : null,
          dto.method ? `(${dto.method})` : null,
          detail,
        ]
          .filter(Boolean)
          .join(' · '),
        userId,
        v.id,
      );
      await this.syncEnquiryFollowUp(tx, enquiryId);
      await this.logAudit(
        tx,
        userId,
        AuditAction.ENQUIRY_QUOTE_RESPONSE_RECORDED,
        AuditEventType.UPDATE,
        v.id,
        `${words[dto.responseType]}: ${label}`,
        meta,
        {
          oldValues: { status: v.status },
          newValues: { responseType: dto.responseType },
        },
      );
    });
    return {
      message: 'Response recorded',
      data: (
        await this.getVersion(actor, enquiryId, quotationId, resultVersionId)
      ).data,
    };
  }

  /** Staff record that the signed / written agreement has been received (not a digital signature). */
  async recordAgreement(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    note: string | undefined,
    meta?: RequestAuditMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const v = await this.version(
        actor,
        enquiryId,
        quotationId,
        versionId,
        tx,
      );
      if (v.status !== 'ACCEPTED')
        throw new ConflictException(
          'Record the agreement on the accepted quotation',
        );
      const done = await tx.enquiryQuotationVersion.updateMany({
        where: { id: v.id, agreementReceivedAt: null },
        data: {
          agreementReceivedAt: new Date(),
          agreementRecordedById: actor.id,
          agreementNote: note?.trim() || null,
        },
      });
      if (!done.count) return;
      await this.event(
        tx,
        enquiryId,
        'Quote agreement recorded',
        `${v.quotation.quotationNumber} V${v.versionNumber}${note ? ` — ${note.trim()}` : ''}`,
        actor.id,
        v.id,
      );
      await this.logAudit(
        tx,
        actor.id,
        AuditAction.ENQUIRY_QUOTE_UPDATED,
        AuditEventType.UPDATE,
        v.id,
        'Quote agreement recorded',
        meta,
      );
    });
    return {
      message: 'Agreement recorded',
      data: (await this.getVersion(actor, enquiryId, quotationId, versionId))
        .data,
    };
  }

  /**
   * A funder approved its share after the client accepted. Only that funding row's status (and
   * reference) changes: the price and the copy the client received stay as they were.
   */
  async confirmFunding(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    fundingId: string,
    dto: { reference?: string; note?: string },
    meta?: RequestAuditMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const v = await this.version(
        actor,
        enquiryId,
        quotationId,
        versionId,
        tx,
      );
      if (v.status !== 'ACCEPTED')
        throw new ConflictException(
          'Confirm funding on the accepted quotation (change a draft in Who pays)',
        );
      const funding = v.fundings.find((f) => f.id === fundingId);
      if (!funding)
        throw new NotFoundException('Funding not found on this quotation');
      if (funding.status === 'CONFIRMED') return;
      const reference = dto.reference?.trim() || funding.reference;
      await tx.enquiryQuotationFunding.update({
        where: { id: funding.id },
        data: { status: 'CONFIRMED', reference },
      });
      const payer =
        funding.payerName || funding.payerType.replace('_', ' ').toLowerCase();
      await this.event(
        tx,
        enquiryId,
        'Funding confirmed',
        [
          `${v.quotation.quotationNumber} V${v.versionNumber} — ${payer}`,
          reference ? `ref ${reference}` : null,
          dto.note?.trim() || null,
        ]
          .filter(Boolean)
          .join(' · '),
        actor.id,
        v.id,
      );
      await this.logAudit(
        tx,
        actor.id,
        AuditAction.ENQUIRY_QUOTE_UPDATED,
        AuditEventType.UPDATE,
        v.id,
        `Funding confirmed: ${payer}`,
        meta,
      );
    });
    return {
      message: 'Funding confirmed',
      data: (await this.getVersion(actor, enquiryId, quotationId, versionId))
        .data,
    };
  }

  /* ─── follow-ups ────────────────────────────────────────────────────── */

  /**
   * Keep the enquiry's own "next follow-up" (the existing follow-up field, overdue badges and
   * summary counts) on the soonest open quote follow-up. A follow-up staff set by hand is
   * only replaced by an earlier quote follow-up, and only cleared when it came from a quote.
   */
  private async syncEnquiryFollowUp(tx: Tx, enquiryId: string) {
    const enquiry = await tx.enquiry.findUniqueOrThrow({
      where: { id: enquiryId },
    });
    const next = await tx.enquiryQuotationFollowUp.findFirst({
      where: { status: 'OPEN', quotation: { enquiryId, deletedAt: null } },
      orderBy: { dueAt: 'asc' },
      include: { quotation: { select: { quotationNumber: true } } },
    });
    const fromQuote = (enquiry.nextAction ?? '').startsWith(FOLLOW_UP_PREFIX);
    if (next) {
      const sooner =
        !enquiry.nextFollowUpAt ||
        fromQuote ||
        next.dueAt < enquiry.nextFollowUpAt;
      if (sooner) {
        await tx.enquiry.update({
          where: { id: enquiryId },
          data: {
            nextFollowUpAt: next.dueAt,
            nextAction:
              `${FOLLOW_UP_PREFIX} ${next.quotation.quotationNumber}${next.note ? `: ${next.note}` : ''}`.slice(
                0,
                500,
              ),
          },
        });
      }
    } else if (fromQuote) {
      await tx.enquiry.update({
        where: { id: enquiryId },
        data: { nextFollowUpAt: null, nextAction: null },
      });
    }
  }

  async createFollowUp(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    dto: CreateFollowUpDto,
    meta?: RequestAuditMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.enquiry(actor, enquiryId, tx);
      const q = await tx.enquiryQuotation.findFirst({
        where: { id: quotationId, enquiryId, deletedAt: null },
      });
      if (!q) throw new NotFoundException('Quotation not found');
      const f = await tx.enquiryQuotationFollowUp.create({
        data: {
          quotationId,
          versionId: dto.versionId ?? null,
          assigneeId: dto.assigneeId ?? actor.id,
          method: dto.method?.trim() || null,
          dueAt: new Date(dto.dueAt),
          note: dto.note?.trim() || null,
          createdById: actor.id,
        },
      });
      await this.event(
        tx,
        enquiryId,
        'Follow-up scheduled',
        [
          q.quotationNumber,
          dto.note?.trim(),
          `due ${f.dueAt.toISOString().slice(0, 16).replace('T', ' ')}`,
        ]
          .filter(Boolean)
          .join(' · '),
        actor.id,
        dto.versionId ?? null,
      );
      await this.syncEnquiryFollowUp(tx, enquiryId);
      await this.logAudit(
        tx,
        actor.id,
        AuditAction.ENQUIRY_QUOTE_FOLLOW_UP,
        AuditEventType.CREATE,
        f.id,
        `Quote follow-up for ${q.quotationNumber}`,
        meta,
      );
    });
    return { message: 'Follow-up scheduled' };
  }

  async updateFollowUp(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    followUpId: string,
    dto: UpdateFollowUpDto,
    meta?: RequestAuditMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.enquiry(actor, enquiryId, tx);
      const f = await tx.enquiryQuotationFollowUp.findFirst({
        where: { id: followUpId, quotationId, quotation: { enquiryId } },
        include: { quotation: true },
      });
      if (!f) throw new NotFoundException('Follow-up not found');
      if (dto.action === 'RESCHEDULE' && !dto.dueAt)
        throw new BadRequestException('Choose the new due date');
      const status = dto.action === 'COMPLETE' ? 'DONE' : 'CANCELLED';
      const done = await tx.enquiryQuotationFollowUp.updateMany({
        where: { id: f.id, status: 'OPEN' },
        data: {
          status,
          completedAt: new Date(),
          completedById: actor.id,
          outcome:
            dto.outcome?.trim() ||
            (dto.action === 'RESCHEDULE' ? 'Rescheduled' : null),
        },
      });
      if (!done.count)
        throw new ConflictException('This follow-up is already closed');
      if (dto.action === 'RESCHEDULE') {
        // History: the old one is closed as rescheduled and a new one replaces it.
        await tx.enquiryQuotationFollowUp.create({
          data: {
            quotationId,
            versionId: f.versionId,
            assigneeId: f.assigneeId,
            method: f.method,
            dueAt: new Date(dto.dueAt!),
            note: f.note,
            rescheduledFromId: f.id,
            createdById: actor.id,
          },
        });
      }
      const verb = {
        COMPLETE: 'Follow-up completed',
        RESCHEDULE: 'Follow-up rescheduled',
        CANCEL: 'Follow-up cancelled',
      }[dto.action];
      await this.event(
        tx,
        enquiryId,
        verb,
        [
          f.quotation.quotationNumber,
          dto.outcome?.trim(),
          dto.dueAt
            ? `now due ${dto.dueAt.slice(0, 16).replace('T', ' ')}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        actor.id,
        f.versionId,
      );
      await this.syncEnquiryFollowUp(tx, enquiryId);
      await this.logAudit(
        tx,
        actor.id,
        AuditAction.ENQUIRY_QUOTE_FOLLOW_UP,
        AuditEventType.UPDATE,
        f.id,
        verb,
        meta,
      );
    });
    return { message: 'Follow-up updated' };
  }

  /* ─── comparison ────────────────────────────────────────────────────── */

  async compare(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    otherVersionId: string,
  ) {
    const [a, b] = await Promise.all([
      this.version(actor, enquiryId, quotationId, otherVersionId),
      this.version(actor, enquiryId, quotationId, versionId),
    ]);
    const shape = (v: VersionRow) => {
      const m = this.mapVersion(v);
      return {
        ...m,
        weeklyTotal: m.totals.weekly,
        monthlyAverage: m.totals.monthlyAverage,
        clientWeeklyLiability: m.totals.clientWeeklyLiability,
        coverageHours: round2(m.totals.weeklyCoverageMinutes / 60),
        carerHours: round2(m.totals.weeklyCarerMinutes / 60),
        status: QUOTE_STATUS_LABELS[v.status],
      };
    };
    const sa = shape(a);
    const sb = shape(b);
    // A "total amount" quote has no visit prices or hours, so those are not compared.
    const timed =
      a.clientLayout === 'DETAILED' && b.clientLayout === 'DETAILED';
    const rows = diffVersions(
      sa,
      sb,
      [
        ['General', 'status', 'Status'],
        ['General', 'quoteType', 'Quote type', 'enum'],
        ['General', 'proposedStartDate', 'Proposed start', 'date'],
        ['General', 'proposedEndDate', 'Proposed end', 'date'],
        ['General', 'validUntil', 'Valid until', 'date'],
        ['General', 'fundingCategory', 'Funding type', 'enum'],
        ['General', 'clientNotes', 'Notes for the client'],
        ['General', 'terms', 'Terms'],
        ['Pricing', 'clientLayout', 'How it is priced', 'enum'],
        ['Pricing', 'hourlyRate', 'Hourly rate', 'money'],
        ['Pricing', 'manualWeeklyTotal', 'Typed weekly total', 'money'],
        ['Price', 'weeklyTotal', 'Weekly total', 'money'],
        ['Price', 'monthlyAverage', 'Average month', 'money'],
        ['Price', 'clientWeeklyLiability', 'Client pays per week', 'money'],
        ...(timed
          ? ([
              ['Price', 'coverageHours', 'Hours of care a week', 'hours'],
              ['Price', 'carerHours', 'Carer hours a week', 'hours'],
            ] as Array<[string, string, string, DiffFormat]>)
          : []),
      ],
      { visitPrices: timed },
    );
    const side = (v: VersionRow, m: typeof sa) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      statusLabel: m.status,
      weeklyTotal: m.weeklyTotal,
      clientWeeklyLiability: m.clientWeeklyLiability,
    });
    return {
      data: {
        from: side(a, sa),
        to: side(b, sb),
        rows,
      },
    };
  }

  /* ─── accepted quote → active service user ──────────────────────────── */

  /**
   * The client accepted: make the person an active service user (see CrmService.activateServiceUser)
   * with the quote's proposed start as their service start, then, if asked, the draft care package.
   * A care package that cannot be made does not undo the service user; the reason is returned.
   */
  async createServiceUserFromQuote(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    opts: { createCarePackage: boolean },
    meta?: RequestAuditMeta,
  ) {
    const v = await this.version(actor, enquiryId, quotationId, versionId);
    if (v.status !== 'ACCEPTED')
      throw new ConflictException(
        "Record the client's acceptance before creating the service user",
      );
    const { serviceUserId, created } = await this.crm.activateServiceUser(
      actor,
      enquiryId,
      { serviceStartDate: v.proposedStartDate },
      meta,
    );
    let carePackage: { created: boolean; error: string | null } = {
      created: false,
      error: null,
    };
    if (opts.createCarePackage && !v.convertedVisitPlanId) {
      try {
        const r = await this.convertToCarePackage(
          actor,
          enquiryId,
          quotationId,
          versionId,
          meta,
        );
        carePackage = { created: r.data.created, error: null };
      } catch (e) {
        carePackage = {
          created: false,
          error:
            e instanceof Error
              ? e.message
              : 'The care package could not be made',
        };
      }
    }
    return {
      message: created ? 'Service user created' : 'Service user made active',
      data: { serviceUserId, created, carePackage },
    };
  }

  /* ─── accepted quote → draft care package ───────────────────────────── */

  /**
   * Create a DRAFT care package (visit plan) for the linked service user from an accepted version.
   * Uses the existing visit plan creation (weekly hours checks included). Visits are not generated
   * and no carers are assigned; an existing live package is never touched. Repeating the call
   * returns the package already created.
   */
  async convertToCarePackage(
    actor: RequestUser,
    enquiryId: string,
    quotationId: string,
    versionId: string,
    meta?: RequestAuditMeta,
  ) {
    const v = await this.version(actor, enquiryId, quotationId, versionId);
    const enquiry = await this.enquiry(actor, enquiryId);
    if (v.status !== 'ACCEPTED')
      throw new ConflictException(
        'Only an accepted quotation can become a care package',
      );
    if (v.convertedVisitPlanId) {
      return {
        message: 'Draft care package already created',
        data: {
          visitPlanId: v.convertedVisitPlanId,
          serviceUserId: enquiry.convertedServiceUserId,
          created: false,
        },
      };
    }
    const serviceUserId = enquiry.convertedServiceUserId;
    if (!serviceUserId)
      throw new BadRequestException(
        'Create (or link) the service user from this enquiry first',
      );
    await this.orgScope.assertServiceUserInScope(
      this.orgScope.fromRequestUser(actor),
      serviceUserId,
    );

    // Claim the conversion so a double click cannot create two packages.
    const claimed = await this.prisma.enquiryQuotationVersion.updateMany({
      where: { id: v.id, convertedVisitPlanId: null, convertedAt: null },
      data: { convertedAt: new Date(), convertedById: actor.id },
    });
    if (!claimed.count)
      throw new ConflictException(
        'The care package is already being created — reload in a moment',
      );

    const label = `${v.quotation.quotationNumber} V${v.versionNumber}`;
    let planId: string;
    try {
      const slots = v.patterns.flatMap((p, i): VisitPlanSlotDto[] => {
        const end =
          p.endTime ??
          (() => {
            const m =
              (Number(p.startTime.slice(0, 2)) * 60 +
                Number(p.startTime.slice(3, 5)) +
                p.durationMinutes) %
              1440;
            return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          })();
        const overnight = p.nightDuty !== 'NONE' || end <= p.startTime;
        const notes = [
          p.notes,
          p.activities.length ? `Activities: ${p.activities.join(', ')}` : null,
          `From quotation ${label}`,
        ]
          .filter(Boolean)
          .join('\n');
        const base = {
          plannedStartTime: p.startTime,
          plannedEndTime: end,
          durationMinutes: p.durationMinutes,
          requiredCarers: p.carersPerVisit,
          isEnabled: true,
          notes,
          nightDuty: p.nightDuty,
          assignedEmployeeIds: [] as string[],
        };
        if (p.frequency === 'ONE_OFF') {
          return p.oneOffDates.map((d, j) => ({
            ...base,
            slotCode: `Q${i + 1}-${j + 1}`,
            daysOfWeek: [d.getUTCDay()],
            slotKind: 'ONE_OFF' as const,
            oneOffDate: isoDay(d),
          }));
        }
        return [
          {
            ...base,
            slotCode: `Q${i + 1}`,
            daysOfWeek: p.daysOfWeek,
            slotKind: overnight
              ? ('OVERNIGHT' as const)
              : ('STANDARD' as const),
            scheduleFrequency: 'WEEKLY' as const,
            repeatEvery: {
              WEEKLY: 1,
              FORTNIGHTLY: 2,
              FOUR_WEEKLY: 4,
              ONE_OFF: 1,
            }[p.frequency],
            repeatUnit: 'WEEKS' as const,
            slotEffectiveFrom: isoDay(p.effectiveFrom),
            slotEffectiveTo: isoDay(p.effectiveTo),
          },
        ];
      });
      // A "total amount" quote prices no visit minutes, so its contracted hours come from the visits.
      const weeklyMinutes =
        v.weeklyCoverageMinutes ||
        v.patterns.reduce(
          (sum, p) =>
            sum +
            p.durationMinutes *
              (p.frequency === 'ONE_OFF'
                ? p.oneOffDates.length
                : p.daysOfWeek.length),
          0,
        );
      const weeklyHours = round2(weeklyMinutes / 60);
      const created = await this.visitPlans.create(
        actor.id,
        serviceUserId,
        {
          effectiveFrom: isoDay(v.proposedStartDate) ?? undefined,
          weeklyContractedHours: String(weeklyHours),
          numberOfCarers: Math.max(
            1,
            ...v.patterns.map((p) => p.carersPerVisit),
          ),
          notes: `Draft created from accepted quotation ${label}. Review, assign carers and activate when ready.`,
          slots,
        },
        meta,
      );
      planId = created.data.id;
    } catch (e) {
      await this.prisma.enquiryQuotationVersion.updateMany({
        where: { id: v.id, convertedVisitPlanId: null },
        data: { convertedAt: null, convertedById: null },
      });
      throw e;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.serviceUserVisitPlan.update({
        where: { id: planId },
        data: {
          sourceEnquiryQuotationId: quotationId,
          sourceEnquiryQuotationVersionId: v.id,
        },
      });
      await tx.enquiryQuotationVersion.update({
        where: { id: v.id },
        data: { convertedVisitPlanId: planId },
      });
      await this.event(
        tx,
        enquiryId,
        'Draft care package created',
        `From ${label} (draft — not active, no carers assigned)`,
        actor.id,
        v.id,
      );
      await this.logAudit(
        tx,
        actor.id,
        AuditAction.ENQUIRY_QUOTE_CONVERTED,
        AuditEventType.CREATE,
        v.id,
        `Draft care package created from ${label}`,
        meta,
        {
          newValues: { visitPlanId: planId, serviceUserId },
        },
      );
    });
    const live = await this.prisma.serviceUserVisitPlan.count({
      where: { serviceUserId, status: 'ACTIVE', deletedAt: null },
    });
    return {
      message: 'Draft care package created',
      data: {
        visitPlanId: planId,
        serviceUserId,
        created: true,
        hasActivePackage: live > 0,
      },
    };
  }

  /* ─── legacy quote reconcile ────────────────────────────────────────── */

  /**
   * A legacy "Quote sent" enquiry with no quotation record. Staff confirm it (the old figures stay
   * as recorded and labelled legacy) or move it back to an earlier stage. No amounts are created.
   */
  async reconcileLegacy(
    actor: RequestUser,
    enquiryId: string,
    dto: ReconcileLegacyQuoteDto,
    meta?: RequestAuditMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const enquiry = await this.enquiry(actor, enquiryId, tx);
      const count = await tx.enquiryQuotation.count({
        where: { enquiryId, deletedAt: null },
      });
      if (count)
        throw new ConflictException(
          'This enquiry already has a quotation record',
        );
      if (enquiry.legacyQuoteReconciledAt)
        throw new ConflictException('This legacy quote was already reviewed');
      const note = dto.note.trim();
      if (!note)
        throw new BadRequestException('Add a note explaining the review');
      const moveTo = dto.action === 'MOVE_STAGE' ? dto.stage : undefined;
      if (dto.action === 'MOVE_STAGE' && !moveTo)
        throw new BadRequestException('Choose the stage to move back to');
      const done = await tx.enquiry.updateMany({
        where: { id: enquiryId, legacyQuoteReconciledAt: null },
        data: {
          legacyQuoteReconciledAt: new Date(),
          legacyQuoteReconciledById: actor.id,
          legacyQuoteReconcileNote: note,
          ...(moveTo ? { stage: moveTo, stageChangedAt: new Date() } : {}),
        },
      });
      if (!done.count)
        throw new ConflictException('This legacy quote was already reviewed');
      await this.event(
        tx,
        enquiryId,
        'Legacy quote reviewed',
        note,
        actor.id,
        null,
      );
      if (moveTo)
        await this.event(
          tx,
          enquiryId,
          `Moved to ${moveTo}`,
          'Legacy quote had no quotation record',
          actor.id,
          null,
        );
      await this.audit.logAudit({
        tx,
        userId: actor.id,
        module: AuditModule.CRM,
        action: AuditAction.ENQUIRY_UPDATED,
        eventType: AuditEventType.UPDATE,
        recordType: 'Enquiry',
        recordId: enquiryId,
        description: `Legacy quote reviewed on ${enquiry.referenceNumber}`,
        newValues: auditSnapshot({
          action: dto.action,
          stage: moveTo ?? enquiry.stage,
        }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return { message: 'Legacy quote reviewed' };
  }
}
