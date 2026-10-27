import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
import {
  BankHolidayQueryDto,
  CreateBankHolidayDto,
  SetDayTypePriorityDto,
  SetHolidayPremiumBasisDto,
  UpdateBankHolidayDto,
} from './dto/wage-types.dto';
import { GOV_UK_DIVISION_REGION, type BankHolidayRegion } from './bank-holiday-regions.util';
import { ORGANISATION_SPECIAL_DAY_REGION, substituteDayInfo } from './holiday-calendar.util';
import {
  DEFAULT_DAY_TYPE_PRIORITY,
  PAY_DAY_TYPES,
  loadDayTypePriority,
  loadHolidayCalendarStatus,
  loadHolidayPremiumBasis,
} from './holiday-calendar.store';

/** The official UK government dataset of bank holidays for the three calendars. */
export const GOV_UK_BANK_HOLIDAYS_URL = 'https://www.gov.uk/bank-holidays.json';

export type ParsedBankHoliday = {
  region: BankHolidayRegion;
  holidayDate: string;
  name: string;
  /** A weekday given in place of a holiday that fell on a weekend, and the date it stands for. */
  isSubstitute: boolean;
  substituteForDate: string | null;
};

/**
 * Parse GOV.UK bank-holidays.json into rows for our regions, keeping dates on or after `fromDateKey`
 * (past dates are skipped so historical visit pricing is never changed by an import).
 */
export function parseGovUkBankHolidays(json: unknown, fromDateKey: string): ParsedBankHoliday[] {
  const out: ParsedBankHoliday[] = [];
  if (!json || typeof json !== 'object') return out;
  for (const [division, region] of Object.entries(GOV_UK_DIVISION_REGION)) {
    const events = (json as Record<string, { events?: unknown }>)[division]?.events;
    if (!Array.isArray(events)) continue;
    for (const event of events as Array<{ title?: unknown; date?: unknown; notes?: unknown }>) {
      const date = typeof event?.date === 'string' ? event.date.slice(0, 10) : '';
      const title = typeof event?.title === 'string' ? event.title.trim() : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title || date < fromDateKey) continue;
      const notes = typeof event?.notes === 'string' ? event.notes : null;
      out.push({ region, holidayDate: date, name: title, ...substituteDayInfo(title, date, notes) });
    }
  }
  return out;
}

const toDate = (key: string) => new Date(`${key.slice(0, 10)}T00:00:00.000Z`);

@Injectable()
export class BankHolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(query: BankHolidayQueryDto) {
    const where: Prisma.BankHolidayWhereInput = {};
    if (query.region) where.region = query.region;
    const year = Number(query.year);
    if (Number.isInteger(year) && year > 1900 && year < 3000) {
      where.holidayDate = { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) };
    }
    const rows = await this.prisma.bankHoliday.findMany({
      where,
      orderBy: [{ holidayDate: 'asc' }, { region: 'asc' }],
    });
    return { data: rows };
  }

  async create(userId: string, dto: CreateBankHolidayDto, meta?: RequestAuditMeta) {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // An organisation special day is not a bank holiday and has no substitute day.
        const substitute =
          dto.region === ORGANISATION_SPECIAL_DAY_REGION
            ? { isSubstitute: false, substituteForDate: null }
            : dto.substituteForDate
              ? { isSubstitute: true, substituteForDate: dto.substituteForDate.slice(0, 10) }
              : substituteDayInfo(dto.name, dto.holidayDate.slice(0, 10));
        const created = await tx.bankHoliday.create({
          data: {
            holidayDate: toDate(dto.holidayDate),
            name: dto.name.trim(),
            region: dto.region,
            isSubstitute: substitute.isSubstitute,
            substituteForDate: substitute.substituteForDate
              ? toDate(substitute.substituteForDate)
              : null,
            source: 'MANUAL',
          },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.BILLING,
          action: AuditAction.BANK_HOLIDAY_CREATED,
          recordType: 'BankHoliday',
          recordId: created.id,
          newValues: { holidayDate: dto.holidayDate, name: created.name, region: created.region },
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
        return created;
      });
      return { message: 'Bank holiday added', data: row };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This date is already in that calendar');
      }
      throw e;
    }
  }

  /** Rename or switch a date on/off. Rows are deactivated rather than deleted. */
  async update(userId: string, id: string, dto: UpdateBankHolidayDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.bankHoliday.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Bank holiday not found');
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.bankHoliday.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.substituteForDate !== undefined
            ? {
                isSubstitute: dto.substituteForDate !== null,
                substituteForDate: dto.substituteForDate ? toDate(dto.substituteForDate) : null,
              }
            : {}),
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.BANK_HOLIDAY_UPDATED,
        recordType: 'BankHoliday',
        recordId: id,
        oldValues: {
          name: existing.name,
          isActive: existing.isActive,
          substituteForDate: existing.substituteForDate?.toISOString().slice(0, 10) ?? null,
        },
        newValues: {
          name: updated.name,
          isActive: updated.isActive,
          substituteForDate: updated.substituteForDate?.toISOString().slice(0, 10) ?? null,
        },
        metadata: { holidayDate: existing.holidayDate.toISOString().slice(0, 10), region: existing.region },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return updated;
    });
    return { message: 'Bank holiday updated', data: row };
  }

  /**
   * Adds GOV.UK dates from 1 January of the current year onwards for England & Wales, Scotland and
   * Northern Ireland. Existing dates (including ones an admin switched off) stay as they are; the
   * only thing recorded on them is whether they are substitute days, where that was not known.
   */
  async importFromGovUk(userId: string, meta?: RequestAuditMeta) {
    let json: unknown;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(GOV_UK_BANK_HOLIDAYS_URL, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (e) {
      throw new BadGatewayException(
        `Could not download bank holidays from GOV.UK (${e instanceof Error ? e.message : 'network error'}). Add dates manually instead.`,
      );
    }
    const fromKey = `${dayKeyInTimeZone(new Date()).slice(0, 4)}-01-01`;
    const parsed = parseGovUkBankHolidays(json, fromKey);
    if (!parsed.length) {
      throw new BadGatewayException('GOV.UK returned no bank holidays. Add dates manually instead.');
    }
    const existing = await this.prisma.bankHoliday.findMany({
      where: { holidayDate: { gte: toDate(fromKey) } },
      select: { id: true, holidayDate: true, region: true, isSubstitute: true, substituteForDate: true },
    });
    const byKey = new Map(
      existing.map((r) => [`${r.region}|${r.holidayDate.toISOString().slice(0, 10)}`, r]),
    );
    const seen = new Set(byKey.keys());
    const toCreate = parsed.filter((p) => !seen.has(`${p.region}|${p.holidayDate}`));
    const toMark = parsed.flatMap((p) => {
      const row = byKey.get(`${p.region}|${p.holidayDate}`);
      if (!row || !p.isSubstitute) return [];
      if (row.isSubstitute && (row.substituteForDate || !p.substituteForDate)) return [];
      return [{ id: row.id, substituteForDate: p.substituteForDate }];
    });
    const byRegion: Record<string, number> = {};
    for (const p of toCreate) byRegion[p.region] = (byRegion[p.region] ?? 0) + 1;

    await this.prisma.$transaction(async (tx) => {
      if (toCreate.length) {
        await tx.bankHoliday.createMany({
          data: toCreate.map((p) => ({
            holidayDate: toDate(p.holidayDate),
            name: p.name,
            region: p.region,
            isSubstitute: p.isSubstitute,
            substituteForDate: p.substituteForDate ? toDate(p.substituteForDate) : null,
            source: 'GOV_UK',
          })),
          skipDuplicates: true,
        });
      }
      for (const mark of toMark) {
        await tx.bankHoliday.update({
          where: { id: mark.id },
          data: {
            isSubstitute: true,
            ...(mark.substituteForDate ? { substituteForDate: toDate(mark.substituteForDate) } : {}),
          },
        });
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.BANK_HOLIDAYS_IMPORTED,
        recordType: 'BankHoliday',
        metadata: {
          source: GOV_UK_BANK_HOLIDAYS_URL,
          from: fromKey,
          added: toCreate.length,
          markedAsSubstitute: toMark.length,
          byRegion,
        },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return {
      message: toCreate.length
        ? `Added ${toCreate.length} bank holiday${toCreate.length === 1 ? '' : 's'} from GOV.UK`
        : 'Bank holidays are already up to date',
      data: {
        added: toCreate.length,
        alreadyPresent: parsed.length - toCreate.length,
        markedAsSubstitute: toMark.length,
        byRegion,
        from: fromKey,
      },
    };
  }

  /**
   * Whether each nation's calendar is complete for this year and next (or the years asked for),
   * and the organisation's policy for holidays that fall on a weekend.
   */
  async status(yearsParam?: string) {
    const thisYear = Number(dayKeyInTimeZone(new Date()).slice(0, 4));
    const asked = (yearsParam ?? '')
      .split(',')
      .map((y) => Number(y.trim()))
      .filter((y) => Number.isInteger(y) && y > 1900 && y < 3000)
      .slice(0, 6);
    const years = asked.length ? [...new Set(asked)].sort() : [thisYear, thisYear + 1];
    return { data: { years, ...(await loadHolidayCalendarStatus(this.prisma, years)) } };
  }

  /**
   * PC-24: which day carries the pay card's holiday rate when a holiday falls on a weekend. A
   * policy of the organisation: changing it changes carer pay for visits priced from then on, so
   * it needs a reason and is audited. Visits already approved or paid keep their amounts.
   */
  async setPremiumBasis(userId: string, dto: SetHolidayPremiumBasisDto, meta?: RequestAuditMeta) {
    const previous = await loadHolidayPremiumBasis(this.prisma);
    if (previous === dto.basis) {
      return { message: 'The holiday pay basis is already set to that', data: { basis: previous } };
    }
    await this.prisma.$transaction(async (tx) => {
      const settings = await tx.organisationGeneralSettings.findFirst({ select: { id: true } });
      if (settings) {
        await tx.organisationGeneralSettings.update({
          where: { id: settings.id },
          data: { holidayPremiumBasis: dto.basis },
        });
      } else {
        await tx.organisationGeneralSettings.create({ data: { holidayPremiumBasis: dto.basis } });
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.HOLIDAY_PREMIUM_BASIS_CHANGED,
        recordType: 'OrganisationGeneralSettings',
        recordId: settings?.id,
        oldValues: { holidayPremiumBasis: previous },
        newValues: { holidayPremiumBasis: dto.basis },
        metadata: { reason: dto.reason.trim() },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return { message: 'Holiday pay basis updated', data: { basis: dto.basis } };
  }

  /** Carer pay: priority per day type, and whether the organisation has set its own. */
  async getDayTypePriority() {
    const saved = await loadDayTypePriority(this.prisma);
    return {
      data: {
        custom: saved != null,
        priorities: { ...DEFAULT_DAY_TYPE_PRIORITY, ...(saved ?? {}) },
        defaults: DEFAULT_DAY_TYPE_PRIORITY,
      },
    };
  }

  /**
   * Organisation policy: which day's rate wins when rules for different days compete. Changes carer
   * pay for visits priced from then on, so it needs a reason and is audited. Null = built-in order.
   */
  async setDayTypePriority(userId: string, dto: SetDayTypePriorityDto, meta?: RequestAuditMeta) {
    let next: Record<string, number> | null = null;
    if (dto.priorities) {
      next = {};
      for (const d of PAY_DAY_TYPES) {
        const v = dto.priorities[d];
        if (!Number.isInteger(v) || v < 0 || v > 1000) {
          throw new BadRequestException(`Give every day a whole-number priority from 0 to 1000 (${d})`);
        }
        next[d] = v;
      }
      const extra = Object.keys(dto.priorities).filter((k) => !(PAY_DAY_TYPES as readonly string[]).includes(k));
      if (extra.length) throw new BadRequestException(`Unknown day type: ${extra.join(', ')}`);
    }
    const previous = await loadDayTypePriority(this.prisma);
    await this.prisma.$transaction(async (tx) => {
      const settings = await tx.organisationGeneralSettings.findFirst({ select: { id: true } });
      const data = { payDayTypePriority: next ?? Prisma.DbNull };
      if (settings) {
        await tx.organisationGeneralSettings.update({ where: { id: settings.id }, data });
      } else {
        await tx.organisationGeneralSettings.create({ data });
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.PAY_DAY_PRIORITY_CHANGED,
        recordType: 'OrganisationGeneralSettings',
        recordId: settings?.id,
        oldValues: { payDayTypePriority: previous },
        newValues: { payDayTypePriority: next },
        metadata: { reason: dto.reason.trim() },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return {
      message: next ? 'Day priority updated' : 'Day priority reset to the built-in order',
      data: (await this.getDayTypePriority()).data,
    };
  }
}
