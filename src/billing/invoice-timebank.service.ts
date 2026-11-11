import { Injectable } from '@nestjs/common';
import { InvoiceRunLineType, InvoiceRunStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { ServiceUserTimebankService } from '../service-user-hours/service-user-timebank.service';
import { ServiceUserTimebankLedgerService } from '../service-user-hours/service-user-timebank-ledger.service';
import type { TimebankWeek } from '../service-user-hours/service-user-timebank.util';
import {
  dayKeyInTimeZone,
} from '../common/utils/operational-day.util';
import { formatOrganisationIsoDate } from '../common/utils/organisation-display-format.util';
import { ChargeCardsService } from './billing-cards.service';
import { buildFundingSplits, splitAmount } from './billing-run.util';
import { lateCancellationAmount } from './invoice-late-cancellation.util';
import { standardWeekdayTime } from '../service-user-hours/timebank-day-rule.util';

/** Open runs (not locked): their lines can still change. */
const OPEN_RUN_STATUSES: InvoiceRunStatus[] = [
  InvoiceRunStatus.DRAFT,
  InvoiceRunStatus.CALCULATING,
  InvoiceRunStatus.READY_FOR_REVIEW,
  InvoiceRunStatus.EXCEPTION_FOUND,
  InvoiceRunStatus.APPROVED,
];

const SHORT_LABEL: Record<string, string> = {
  CANCELLED_BY_SERVICE_USER:
    'cancelled by the service user (no cancellation charge)',
  CANCELLED_BY_AGENCY: 'cancelled by us',
  CANCELLED_OTHER: 'cancelled',
  MISSED: 'not delivered (missed)',
  CALLED_OFF: 'called off',
  SHORTER: 'shorter than planned',
  NOT_APPROVED: 'not approved',
};

function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

/** Minutes a line stands for: a split line carries the item's minutes and its share. */
function lineMinutes(line: {
  minutes: number | null;
  splitPercent: unknown;
}): number {
  const pct = line.splitPercent == null ? 100 : Number(line.splitPercent);
  return Math.round(
    ((line.minutes ?? 0) * (Number.isFinite(pct) ? pct : 100)) / 100,
  );
}

/** A recorded timebank charge with the invoice number it is on. */
type ChargeRow = {
  kind: string;
  minutes: number;
  weekStart: string | null;
  amount: number;
  invoiceNumber: string;
};

type Ctx = {
  runId: string;
  lineData: Prisma.InvoiceRunLineCreateManyInput[];
  serviceUserIds: Set<string>;
  funderIds: Set<string>;
  periodEndIso: string;
  runCadence: 'WEEKLY' | 'MONTHLY' | null;
  timeZone: string;
};

/**
 * Timebank hours on the weekly invoice (docs/SU_TIMEBANK_INVOICE_PLAN.md):
 * - TIMEBANK_HOURS: a finished week's timebank hours, priced at each visit's own day and time (hours
 *   never put on the rota at the weekday rate), charged once; a week that later has fewer is credited.
 * - TIMEBANK_USED: the part of a visit paid from timebank hours already charged, so it costs nothing.
 * Locking the run records both in ServiceUserTimebankCharge, so no week or hour is billed twice.
 */
@Injectable()
export class InvoiceTimebankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly timebank: ServiceUserTimebankService,
    private readonly ledger: ServiceUserTimebankLedgerService,
    private readonly chargeCards: ChargeCardsService,
  ) {}

  /** Adds this run's timebank lines; returns how many had a problem. */
  async addLines(ctx: Ctx): Promise<number> {
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    // Off: nothing new is charged, but hours already charged are still credited when a charged
    // week later has fewer timebank hours, or are free when care is paid from them, so they are
    // never paid for twice.
    const creditsOnly = !rules.chargeTimebankOnInvoice;
    const withCharges = creditsOnly
      ? new Set(
          (
            await this.prisma.serviceUserTimebankCharge.findMany({
              where: { kind: 'CHARGED' },
              select: { serviceUserId: true },
              distinct: ['serviceUserId'],
            })
          ).map((c) => c.serviceUserId),
        )
      : null;
    if (withCharges && !withCharges.size) return 0;
    const display = await this.orgSettings.getOperationalDisplaySettings();
    const today = dayKeyInTimeZone(new Date(), ctx.timeZone);
    let from = rules.chargeTimebankFrom;
    if (!from && !creditsOnly) {
      // First run with the setting on: only weeks from today on are charged (never the past bank).
      await this.orgSettings.setChargeTimebankFrom(today);
      from = today;
    }

    const serviceUsers = await this.prisma.serviceUser.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, invoiceBillingFrequency: true },
    });
    const eligible = serviceUsers.filter(
      (s) =>
        (!withCharges || withCharges.has(s.id)) &&
        (!ctx.runCadence ||
          (s.invoiceBillingFrequency ?? 'WEEKLY') === ctx.runCadence),
    );
    // A week already on another open run stays there.
    const claimed = new Set(
      (
        await this.prisma.invoiceRunLine.findMany({
          where: {
            lineType: InvoiceRunLineType.TIMEBANK_HOURS,
            invoiceRunId: { not: ctx.runId },
            invoiceRun: { status: { in: OPEN_RUN_STATUSES } },
          },
          select: { serviceUserId: true, timebankWeekStart: true },
        })
      ).map(
        (l) =>
          `${l.serviceUserId}|${l.timebankWeekStart?.toISOString().slice(0, 10)}`,
      ),
    );

    let exceptions = 0;
    for (const su of eligible) {
      exceptions += await this.addForServiceUser(
        su.id,
        from,
        claimed,
        ctx,
        display.dateDisplayFormat,
        creditsOnly,
      );
    }
    return exceptions;
  }

  private async addForServiceUser(
    serviceUserId: string,
    from: string | null,
    claimed: Set<string>,
    ctx: Ctx,
    dateFormat: Parameters<typeof formatOrganisationIsoDate>[1],
    creditsOnly = false,
  ): Promise<number> {
    const tb = await this.timebank.weeksForServiceUser(serviceUserId);
    if (!tb) return 0;
    const charges: ChargeRow[] = (
      await this.prisma.serviceUserTimebankCharge.findMany({
        where: { serviceUserId },
        include: {
          invoiceRun: {
            select: {
              invoiceNumber: true,
              documents: {
                select: { serviceUserId: true, invoiceNumber: true },
              },
            },
          },
        },
        orderBy: [{ weekStart: 'asc' }, { createdAt: 'asc' }],
      })
    ).map((c) => ({
      kind: c.kind,
      minutes: c.minutes,
      weekStart: c.weekStart?.toISOString().slice(0, 10) ?? null,
      amount: Number(c.amount),
      invoiceNumber:
        c.invoiceRun.documents.find((d) => d.serviceUserId === serviceUserId)
          ?.invoiceNumber ??
        c.invoiceRun.invoiceNumber ??
        'an earlier invoice',
    }));

    // A week already charged keeps getting its credit (or the rest) even when it is before the
    // start day, e.g. after the setting was turned off and on again.
    const chargedWeeks = new Set(
      charges
        .filter((c) => c.kind === 'CHARGED' && c.weekStart)
        .map((c) => c.weekStart),
    );
    const weeks = tb.weeks.filter(
      (w) =>
        (w.status === 'complete' || w.status === 'short') &&
        (creditsOnly
          ? chargedWeeks.has(w.weekStart)
          : (from != null && w.weekStart >= from) ||
            chargedWeeks.has(w.weekStart)) &&
        w.weekEnd <= ctx.periodEndIso &&
        !claimed.has(`${serviceUserId}|${w.weekStart}`),
    );
    let exceptions = 0;
    let addedMinutes = 0;
    const lineCountBefore = ctx.lineData.length;
    for (const week of weeks) {
      const done = charges.filter(
        (c) => c.kind === 'CHARGED' && c.weekStart === week.weekStart,
      );
      const chargedMinutes = done.reduce((s, c) => s + c.minutes, 0);
      const chargedAmount = done.reduce((s, c) => s + c.amount, 0);
      const delta = week.addedToBankMinutes - chargedMinutes;
      if (delta === 0) continue;
      // Off: only the credit of a charged week, never more hours charged.
      if (creditsOnly && (chargedMinutes <= 0 || delta > 0)) continue;
      const weekLabel = formatOrganisationIsoDate(week.weekStart, dateFormat);
      if (chargedMinutes > 0) {
        // Changed after it was charged: the difference at the rate it was charged at.
        const amount =
          Math.round((chargedAmount / chargedMinutes) * delta * 100) / 100;
        const description =
          delta > 0
            ? `Timebank hours — week of ${weekLabel}: ${hm(delta)} more kept in the timebank`
            : `Credit — timebank hours for the week of ${weekLabel} went down by ${hm(-delta)}`;
        exceptions += await this.pushLines(
          serviceUserId,
          week.weekStart,
          [{ minutes: delta, amount, description }],
          ctx,
        );
      } else if (delta > 0) {
        const priced = await this.priceWeek(
          serviceUserId,
          week,
          delta,
          ctx.timeZone,
          weekLabel,
          dateFormat,
        );
        if (priced.issue) exceptions += 1;
        exceptions += await this.pushLines(
          serviceUserId,
          week.weekStart,
          priced.items,
          ctx,
          priced.issue,
        );
      }
      addedMinutes += delta;
    }

    exceptions += await this.addUsedLines(
      serviceUserId,
      charges,
      addedMinutes,
      ctx,
    );
    if (ctx.lineData.length > lineCountBefore)
      ctx.serviceUserIds.add(serviceUserId);
    return exceptions;
  }

  /**
   * A week's timebank hours as priced items: its short visits at their own day and time, the rest
   * (weekly hours never put on the rota) at the weekday rate.
   */
  private async priceWeek(
    serviceUserId: string,
    week: TimebankWeek,
    minutes: number,
    timeZone: string,
    weekLabel: string,
    dateFormat: Parameters<typeof formatOrganisationIsoDate>[1],
  ): Promise<{
    items: Array<{ minutes: number; amount: number; description: string }>;
    issue: string | null;
  }> {
    const card = (await this.chargeCards.resolveForServiceUser(serviceUserId))
      .data.chargeCard;
    // Every timebank hour is priced at the standard weekday rate (decision 10 Nov 2026): 10:00 on
    // the week's first day that is not a bank holiday (Monday unless it is one, e.g. Easter Monday).
    const weekdayAt = await standardWeekdayTime(this.prisma, week.weekStart, timeZone);
    const parts: Array<{ start: Date; minutes: number; description: string }> =
      [];
    let left = minutes;
    for (const v of week.shortVisits) {
      if (left <= 0) break;
      if (v.shortMinutes <= 0 || v.reason === 'CHARGEABLE_CANCELLATION')
        continue;
      const take = Math.min(left, v.shortMinutes);
      left -= take;
      const day = formatOrganisationIsoDate(v.day, dateFormat);
      parts.push({
        start: weekdayAt,
        minutes: take,
        description: `Timebank hours — ${day} ${v.jobName} ${hm(take)} · ${SHORT_LABEL[v.reason] ?? 'not delivered'} · kept in the timebank`,
      });
    }
    if (left > 0) {
      parts.push({
        start: weekdayAt,
        minutes: left,
        description: `Timebank hours — week of ${weekLabel}: ${hm(left)} of weekly hours not booked on the rota · kept in the timebank`,
      });
    }
    if (!card) {
      return {
        items: parts.map((p) => ({
          minutes: p.minutes,
          amount: 0,
          description: p.description,
        })),
        issue: 'Charge card missing',
      };
    }
    // The standard time is never a bank holiday (picked that way above).
    const isBankHolidayFn = () => false;
    let issue: string | null = null;
    const items = parts.map((p) => {
      const amount = lateCancellationAmount({
        rules: card.rules ?? [],
        defaultChargeMethod: card.defaultChargeMethod ?? 'HOURLY_PRO_RATA',
        start: p.start,
        minutes: p.minutes,
        carers: 1,
        percent: 100,
        isBankHolidayFn,
        timeZone,
      });
      if (amount == null)
        issue = 'No charge rate on the charge card for these timebank hours';
      return {
        minutes: p.minutes,
        amount: amount ?? 0,
        description: p.description,
      };
    });
    return { items, issue };
  }

  /** One line per item and funder (like a visit). Returns 1 when there is no funding contract. */
  private async pushLines(
    serviceUserId: string,
    weekStart: string,
    items: Array<{ minutes: number; amount: number; description: string }>,
    ctx: Ctx,
    issue: string | null = null,
  ): Promise<number> {
    const fundingLines = await this.prisma.serviceUserFunding.findMany({
      where: { serviceUserId, deletedAt: null },
      include: { funder: { select: { id: true, name: true } } },
    });
    const splits = buildFundingSplits(fundingLines);
    const base = {
      invoiceRunId: ctx.runId,
      visitReconciliationId: null,
      scheduledJobCancellationId: null,
      serviceUserId,
      lineType: InvoiceRunLineType.TIMEBANK_HOURS,
      timebankWeekStart: new Date(`${weekStart}T00:00:00.000Z`),
    };
    if (!splits.length || issue) {
      for (const item of items) {
        ctx.lineData.push({
          ...base,
          serviceUserFundingId: splits[0]?.id ?? null,
          funderId: splits[0]?.funderId ?? null,
          description: item.description,
          minutes: item.minutes,
          amount: 0,
          exceptionMessage: issue ?? 'No active funding contract',
        });
      }
      return issue ? 0 : 1;
    }
    for (const item of items) {
      for (const split of splitAmount(item.amount, splits)) {
        if (split.amount === 0) continue;
        if (split.funderId) ctx.funderIds.add(split.funderId);
        ctx.lineData.push({
          ...base,
          serviceUserFundingId: split.id,
          funderId: split.funderId,
          description: split.funderName
            ? `${item.description} (${split.funderName})`
            : item.description,
          minutes: item.minutes,
          splitPercent: split.splitPercent,
          amount: split.amount,
          exceptionMessage: null,
        });
      }
    }
    return 0;
  }

  /**
   * Visits on this run paid (in part) from the timebank: the part covered by timebank hours already
   * charged — on a locked invoice or on this run — costs nothing. Hours never charged (before the
   * start day) are billed as normal.
   */
  private async addUsedLines(
    serviceUserId: string,
    charges: ChargeRow[],
    addedThisRun: number,
    ctx: Ctx,
  ): Promise<number> {
    const visitLines = ctx.lineData.filter(
      (l) =>
        l.serviceUserId === serviceUserId &&
        l.lineType === InvoiceRunLineType.VISIT_CHARGE &&
        l.visitReconciliationId &&
        !l.exceptionMessage &&
        Number(l.amount) > 0,
    );
    if (!visitLines.length) return 0;
    const held = await this.ledger.heldByJob(serviceUserId);
    if (!held.size) return 0;
    const chargedTotal = charges
      .filter((c) => c.kind === 'CHARGED')
      .reduce((s, c) => s + c.minutes, 0);
    const usedTotal = charges
      .filter((c) => c.kind === 'USED')
      .reduce((s, c) => s + c.minutes, 0);
    let pool = chargedTotal + addedThisRun - usedTotal;
    if (pool <= 0) return 0;
    // The rate the timebank hours were charged at (decision 10 Nov 2026): care paid from them is
    // taken off at that rate, not the visit's own rate (a weekend visit is dearer than a weekday).
    const thisRun = ctx.lineData.filter(
      (l) =>
        l.serviceUserId === serviceUserId &&
        l.lineType === InvoiceRunLineType.TIMEBANK_HOURS &&
        !l.exceptionMessage,
    );
    const chargedAmount =
      charges
        .filter((c) => c.kind === 'CHARGED')
        .reduce((s, c) => s + c.amount, 0) +
      thisRun.reduce((s, l) => s + Number(l.amount), 0);
    const chargedMinutes =
      chargedTotal + thisRun.reduce((s, l) => s + Number(l.minutes ?? 0), 0);
    const ratePerMinute =
      chargedMinutes > 0 ? Math.max(0, chargedAmount / chargedMinutes) : 0;

    const reconIds = [
      ...new Set(visitLines.map((l) => l.visitReconciliationId as string)),
    ];
    const recons = await this.prisma.visitReconciliation.findMany({
      where: { id: { in: reconIds } },
      select: {
        id: true,
        scheduledJobId: true,
        billableMinutes: true,
        plannedStartDateTime: true,
      },
      orderBy: { plannedStartDateTime: 'asc' },
    });
    const byJob = new Map<string, typeof recons>();
    for (const r of recons) {
      if (!r.scheduledJobId || !held.has(r.scheduledJobId)) continue;
      byJob.set(r.scheduledJobId, [...(byJob.get(r.scheduledJobId) ?? []), r]);
    }
    const sources = this.sourceLabel(charges, usedTotal, addedThisRun);
    for (const [jobId, jobRecons] of byJob) {
      if (pool <= 0) break;
      const jobMinutes = jobRecons.reduce(
        (s, r) => s + (r.billableMinutes ?? 0),
        0,
      );
      if (jobMinutes <= 0) continue;
      const free = Math.min(held.get(jobId)!, pool, jobMinutes);
      pool -= free;
      // What these hours were charged at, never more than the visit costs; shared out across the
      // visit's lines (funders) like the visit amount.
      const jobLines = visitLines.filter((l) =>
        jobRecons.some((r) => r.id === l.visitReconciliationId),
      );
      const visitTotal = jobLines.reduce((s, l) => s + Number(l.amount), 0);
      const takeOff = Math.min(visitTotal, free * ratePerMinute);
      for (const recon of jobRecons) {
        for (const line of visitLines.filter(
          (l) => l.visitReconciliationId === recon.id,
        )) {
          const credit = -Math.min(
            Number(line.amount),
            visitTotal > 0
              ? Math.round(
                  ((Number(line.amount) * takeOff) / visitTotal) * 100,
                ) / 100
              : 0,
          );
          if (credit === 0) continue;
          ctx.lineData.push({
            invoiceRunId: ctx.runId,
            visitReconciliationId: recon.id,
            serviceUserId,
            serviceUserFundingId: line.serviceUserFundingId ?? null,
            funderId: line.funderId ?? null,
            lineType: InvoiceRunLineType.TIMEBANK_USED,
            description: `Used ${hm(free)} of the timebank hours already paid (${sources}) · no charge`,
            minutes: Math.round(
              (free * (recon.billableMinutes ?? 0)) / jobMinutes,
            ),
            splitPercent: line.splitPercent ?? null,
            amount: credit,
            chargeCardId: line.chargeCardId ?? null,
            visitRef: line.visitRef ?? null,
            exceptionMessage: null,
          });
        }
      }
    }
    return 0;
  }

  /** Where the hours being used were charged: the oldest charged invoices not used yet, or this one. */
  private sourceLabel(
    charges: ChargeRow[],
    usedTotal: number,
    addedThisRun: number,
  ): string {
    let skip = usedTotal;
    const numbers: string[] = [];
    for (const c of charges.filter(
      (x) => x.kind === 'CHARGED' && x.minutes > 0,
    )) {
      if (skip >= c.minutes) {
        skip -= c.minutes;
        continue;
      }
      skip = 0;
      if (!numbers.includes(c.invoiceNumber)) numbers.push(c.invoiceNumber);
      if (numbers.length >= 2) break;
    }
    if (!numbers.length && addedThisRun > 0) return 'on this invoice';
    return numbers.join(', ');
  }

  /** On lock: the run's timebank hours and the hours its visits used, recorded so none is billed twice. */
  async recordOnLock(
    tx: Prisma.TransactionClient,
    runId: string,
  ): Promise<void> {
    const lines = await tx.invoiceRunLine.findMany({
      where: {
        invoiceRunId: runId,
        lineType: {
          in: [
            InvoiceRunLineType.TIMEBANK_HOURS,
            InvoiceRunLineType.TIMEBANK_USED,
          ],
        },
        exceptionMessage: null,
      },
      select: {
        serviceUserId: true,
        lineType: true,
        timebankWeekStart: true,
        minutes: true,
        splitPercent: true,
        amount: true,
        visitReconciliation: { select: { scheduledJobId: true } },
      },
    });
    const rows = new Map<
      string,
      Prisma.ServiceUserTimebankChargeCreateManyInput
    >();
    for (const l of lines) {
      const charged = l.lineType === InvoiceRunLineType.TIMEBANK_HOURS;
      const key = charged
        ? `C|${l.serviceUserId}|${l.timebankWeekStart?.toISOString().slice(0, 10)}`
        : `U|${l.serviceUserId}|${l.visitReconciliation?.scheduledJobId}`;
      const row = rows.get(key) ?? {
        serviceUserId: l.serviceUserId,
        kind: charged ? 'CHARGED' : 'USED',
        weekStart: charged ? l.timebankWeekStart : null,
        scheduledJobId: charged
          ? null
          : (l.visitReconciliation?.scheduledJobId ?? null),
        minutes: 0,
        amount: 0,
        invoiceRunId: runId,
      };
      row.minutes = row.minutes + lineMinutes(l);
      row.amount =
        Math.round((Number(row.amount) + Number(l.amount)) * 100) / 100;
      rows.set(key, row);
    }
    if (rows.size)
      await tx.serviceUserTimebankCharge.createMany({
        data: [...rows.values()],
      });
  }
}
