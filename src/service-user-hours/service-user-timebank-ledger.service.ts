import { Injectable } from '@nestjs/common';
import { Prisma, ScheduledJobStatus, ServiceUserTimebankEntryKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
import { ServiceUserTimebankService } from './service-user-timebank.service';
import { mondayOfOperationalIso } from './service-user-timebank.util';
import { isTimebankChargeableCancellation } from '../scheduled-jobs-housekeeping/visit-cancellation-policy.util';

type LedgerClient = Prisma.TransactionClient | PrismaService;

export type TimebankEntryReason =
  | 'NEW_VISIT'
  | 'LONGER_VISIT'
  | 'VISIT_CANCELLED'
  | 'VISIT_REMOVED'
  | 'WEEK_NEEDED_LESS'
  | 'NOT_DELIVERED';

export type TimebankReservation = {
  serviceUserId: string;
  scheduledJobId: string;
  weekStart: string;
  minutes: number;
  reason: 'NEW_VISIT' | 'LONGER_VISIT';
  note?: string | null;
  userId?: string | null;
};

/**
 * What the bank can still pay for while new visits are checked against the weekly hours. A week
 * counts as having its weekly hours plus the minutes already reserved in it. `cover` takes the
 * hours over from the bank only when it has all of them (all or nothing, decided 3 Nov 2026).
 */
export class TimebankBudget {
  constructor(
    /** Settings → Dom Rules "Use timebank hours automatically". */
    readonly enabled: boolean,
    private available: number,
    private readonly reserved: Map<string, number>,
  ) {}

  static none(): TimebankBudget {
    return new TimebankBudget(false, 0, new Map());
  }

  get availableMinutes(): number {
    return this.available;
  }

  reservedIn(weekStart: string): number {
    return this.reserved.get(weekStart) ?? 0;
  }

  cover(weekStart: string, overMinutes: number): boolean {
    if (!this.enabled || overMinutes <= 0 || overMinutes > this.available) return false;
    this.available -= overMinutes;
    this.reserved.set(weekStart, this.reservedIn(weekStart) + overMinutes);
    return true;
  }
}

type NetByJob = Map<string | null, { minutes: number; weekStart: string }>;

/**
 * Service user timebank ledger (docs/SU_TIMEBANK_USE_PLAN.md): hours taken from the bank for a
 * visit over the weekly hours (RESERVED) and given back (RETURNED). Earned hours are worked out by
 * the Timebank report; available = earned − what visits still hold. Rows are only added.
 */
@Injectable()
export class ServiceUserTimebankLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly timebank: ServiceUserTimebankService,
  ) {}

  rules() {
    return this.orgSettings.getServiceUserWeeklyHoursSettings();
  }

  /** Settle first, then what the bank can pay for now. */
  async budget(serviceUserId: string): Promise<TimebankBudget> {
    const rules = await this.orgSettings.getServiceUserWeeklyHoursSettings();
    const balance = await this.balance(serviceUserId);
    return new TimebankBudget(rules.useTimebank, Math.max(0, balance.availableMinutes), balance.reservedByWeek);
  }

  /** Earned (finished weeks), held by visits and available, after giving back what is no longer used. */
  async balance(serviceUserId: string): Promise<{
    earnedMinutes: number;
    reservedMinutes: number;
    availableMinutes: number;
    reservedByWeek: Map<string, number>;
  }> {
    const earned = await this.settle(serviceUserId);
    const net = await this.netByJob(this.prisma, serviceUserId);
    const reservedByWeek = new Map<string, number>();
    let reservedMinutes = 0;
    for (const row of net.values()) {
      if (row.minutes <= 0) continue;
      reservedMinutes += row.minutes;
      reservedByWeek.set(row.weekStart, (reservedByWeek.get(row.weekStart) ?? 0) + row.minutes);
    }
    return { earnedMinutes: earned, reservedMinutes, availableMinutes: earned - reservedMinutes, reservedByWeek };
  }

  async reserve(client: LedgerClient, rows: TimebankReservation[]): Promise<void> {
    const data = rows
      .filter((r) => r.minutes > 0)
      .map((r) => ({
        serviceUserId: r.serviceUserId,
        scheduledJobId: r.scheduledJobId,
        weekStart: new Date(`${r.weekStart}T00:00:00Z`),
        kind: ServiceUserTimebankEntryKind.RESERVED,
        minutes: r.minutes,
        reason: r.reason,
        note: r.note ?? null,
        createdById: r.userId ?? null,
      }));
    if (data.length) await client.serviceUserTimebankEntry.createMany({ data });
  }

  /** Every entry of one service user, newest first, with its visit. */
  async entries(serviceUserId: string) {
    return this.prisma.serviceUserTimebankEntry.findMany({
      where: { serviceUserId },
      orderBy: [{ createdAt: 'desc' }, { kind: 'asc' }],
      select: {
        id: true,
        kind: true,
        minutes: true,
        reason: true,
        note: true,
        weekStart: true,
        createdAt: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        scheduledJob: {
          select: { id: true, jobName: true, scheduledStartDateTime: true, scheduledEndDateTime: true, status: true },
        },
      },
    });
  }

  /** One visit's entries (visit workspace), oldest first, and what it still holds. */
  async forJob(scheduledJobId: string) {
    const rows = await this.prisma.serviceUserTimebankEntry.findMany({
      where: { scheduledJobId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, minutes: true, reason: true, note: true, createdAt: true },
    });
    const heldMinutes = rows.reduce(
      (s, r) => s + (r.kind === ServiceUserTimebankEntryKind.RESERVED ? r.minutes : -r.minutes),
      0,
    );
    return { heldMinutes: Math.max(0, heldMinutes), entries: rows };
  }

  /**
   * Gives back reserved time a visit no longer uses, and returns the earned bank:
   * - visit cancelled or deleted → all of it, except a visit cancelled with a Charge decision (kept: it is paid for);
   * - this week or later: the week needs only (rota minutes − weekly hours) → the rest, latest visits first;
   * - finished week: it needed only (care counted − weekly hours) → the rest (missed, shorter, not approved).
   */
  async settle(serviceUserId: string): Promise<number> {
    const tb = await this.timebank.weeksForServiceUser(serviceUserId);
    if (!tb) return 0;
    const net = await this.netByJob(this.prisma, serviceUserId);
    const held = [...net.entries()].filter(([, v]) => v.minutes > 0);
    if (!held.length) return tb.earnedMinutes;

    const jobIds = held.map(([id]) => id).filter((id): id is string => id != null);
    const jobs = await this.prisma.scheduledJob.findMany({
      where: { id: { in: jobIds } },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        scheduledStartDateTime: true,
        cancellation: {
          select: { cancelledAt: true, chargeDecision: true, policySnapshot: true, reinstatedAt: true },
        },
      },
    });
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const returns: Prisma.ServiceUserTimebankEntryCreateManyInput[] = [];
    const giveBack = (
      jobId: string | null,
      weekStart: string,
      minutes: number,
      reason: TimebankEntryReason,
      note: string,
      at?: Date | null,
    ) => {
      if (minutes <= 0) return;
      returns.push({
        serviceUserId,
        scheduledJobId: jobId,
        weekStart: new Date(`${weekStart}T00:00:00Z`),
        kind: ServiceUserTimebankEntryKind.RETURNED,
        minutes,
        reason,
        note,
        ...(at ? { createdAt: at } : {}),
      });
    };

    // Still held, per week: [jobId, minutes, start] (latest first when a week needs less).
    const stillHeld = new Map<string, Array<{ jobId: string; minutes: number; start: Date }>>();
    // Held by visits cancelled with a Charge decision: they keep the hours (never given back), per week.
    const heldByChargeable = new Map<string, number>();
    for (const [jobId, row] of held) {
      const job = jobId ? jobById.get(jobId) : undefined;
      if (!job) {
        giveBack(jobId, row.weekStart, row.minutes, 'VISIT_REMOVED', 'Visit removed from the rota');
        continue;
      }
      if (job.deletedAt) {
        giveBack(job.id, row.weekStart, row.minutes, 'VISIT_REMOVED', 'Visit removed from the rota', job.deletedAt);
        continue;
      }
      if (
        (job.status === ScheduledJobStatus.CANCELLED || job.status === ScheduledJobStatus.CALLED_OFF) &&
        job.cancellation &&
        isTimebankChargeableCancellation(job.cancellation)
      ) {
        heldByChargeable.set(row.weekStart, (heldByChargeable.get(row.weekStart) ?? 0) + row.minutes);
        continue;
      }
      if (job.status === ScheduledJobStatus.CANCELLED) {
        const at = job.cancellation?.cancelledAt ?? null;
        giveBack(job.id, row.weekStart, row.minutes, 'VISIT_CANCELLED', 'Visit cancelled', at);
        continue;
      }
      const list = stillHeld.get(row.weekStart) ?? [];
      list.push({ jobId: job.id, minutes: row.minutes, start: job.scheduledStartDateTime });
      stillHeld.set(row.weekStart, list);
    }

    const limitMinutes = tb.currentWeeklyHours != null ? Math.round(tb.currentWeeklyHours * 60) : null;
    for (const [weekStart, list] of stillHeld) {
      const week = tb.weeks.find((w) => w.weekStart === weekStart);
      const finished = week != null && (week.status === 'complete' || week.status === 'short');
      let needed: number;
      if (finished) {
        const covered =
          week.deliveredMinutes +
          week.pendingMinutes +
          week.scheduledMinutes +
          week.awaitingMinutes +
          week.chargeableCancelMinutes;
        needed = Math.max(0, covered - week.setMinutes - (heldByChargeable.get(weekStart) ?? 0));
      } else if (week && limitMinutes != null) {
        needed = Math.max(0, week.createdMinutes - limitMinutes);
      } else {
        // No weekly hours any more: nothing is over, so nothing needs the bank.
        needed = 0;
      }
      let excess = list.reduce((s, x) => s + x.minutes, 0) - needed;
      for (const item of [...list].sort((a, b) => b.start.getTime() - a.start.getTime())) {
        if (excess <= 0) break;
        const back = Math.min(item.minutes, excess);
        giveBack(
          item.jobId,
          weekStart,
          back,
          finished ? 'NOT_DELIVERED' : 'WEEK_NEEDED_LESS',
          finished ? 'Not used: the visit was not delivered in full' : 'Not needed: the week is within its weekly hours',
        );
        excess -= back;
      }
    }

    if (returns.length) await this.prisma.serviceUserTimebankEntry.createMany({ data: returns });
    return tb.earnedMinutes;
  }

  /** Settle every service user that has timebank entries (nightly run). */
  async settleAll(): Promise<void> {
    const rows = await this.prisma.serviceUserTimebankEntry.findMany({
      distinct: ['serviceUserId'],
      select: { serviceUserId: true },
    });
    for (const r of rows) await this.settle(r.serviceUserId);
  }

  /**
   * Timebank minutes each visit still holds (reserved − returned), for the invoice: the part of a
   * visit paid from bank hours already charged costs nothing (docs/SU_TIMEBANK_INVOICE_PLAN.md).
   */
  async heldByJob(serviceUserId: string): Promise<Map<string, number>> {
    const net = await this.netByJob(this.prisma, serviceUserId);
    const out = new Map<string, number>();
    for (const [jobId, row] of net) {
      if (jobId && row.minutes > 0) out.set(jobId, row.minutes);
    }
    return out;
  }

  /** Reserved − returned per visit (null = a visit deleted for good). */
  private async netByJob(client: LedgerClient, serviceUserId: string): Promise<NetByJob> {
    const rows = await client.serviceUserTimebankEntry.findMany({
      where: { serviceUserId },
      select: { scheduledJobId: true, kind: true, minutes: true, weekStart: true },
    });
    const net: NetByJob = new Map();
    for (const r of rows) {
      const cur = net.get(r.scheduledJobId) ?? { minutes: 0, weekStart: r.weekStart.toISOString().slice(0, 10) };
      cur.minutes += r.kind === ServiceUserTimebankEntryKind.RESERVED ? r.minutes : -r.minutes;
      net.set(r.scheduledJobId, cur);
    }
    return net;
  }
}

/** Monday of a rota job's week (org day), as the ledger stores it. */
export function timebankWeekOf(start: Date, timeZone: string): string {
  return mondayOfOperationalIso(dayKeyInTimeZone(start, timeZone));
}
