import {
  BadGatewayException,
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
import { BankHolidayQueryDto, CreateBankHolidayDto, UpdateBankHolidayDto } from './dto/wage-types.dto';
import { GOV_UK_DIVISION_REGION, type BankHolidayRegion } from './bank-holiday-regions.util';

export const GOV_UK_BANK_HOLIDAYS_URL = 'https://www.gov.uk/bank-holidays.json';

export type ParsedBankHoliday = { region: BankHolidayRegion; holidayDate: string; name: string };

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
    for (const event of events as Array<{ title?: unknown; date?: unknown }>) {
      const date = typeof event?.date === 'string' ? event.date.slice(0, 10) : '';
      const title = typeof event?.title === 'string' ? event.title.trim() : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title || date < fromDateKey) continue;
      out.push({ region, holidayDate: date, name: title });
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
        const created = await tx.bankHoliday.create({
          data: { holidayDate: toDate(dto.holidayDate), name: dto.name.trim(), region: dto.region },
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
        throw new ConflictException('This date is already a bank holiday for that nation');
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
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.BANK_HOLIDAY_UPDATED,
        recordType: 'BankHoliday',
        recordId: id,
        oldValues: { name: existing.name, isActive: existing.isActive },
        newValues: { name: updated.name, isActive: updated.isActive },
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
   * Northern Ireland. Existing dates (including ones an admin switched off) are left untouched.
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
      select: { holidayDate: true, region: true },
    });
    const seen = new Set(existing.map((r) => `${r.region}|${r.holidayDate.toISOString().slice(0, 10)}`));
    const toCreate = parsed.filter((p) => !seen.has(`${p.region}|${p.holidayDate}`));
    const byRegion: Record<string, number> = {};
    for (const p of toCreate) byRegion[p.region] = (byRegion[p.region] ?? 0) + 1;

    await this.prisma.$transaction(async (tx) => {
      if (toCreate.length) {
        await tx.bankHoliday.createMany({
          data: toCreate.map((p) => ({ holidayDate: toDate(p.holidayDate), name: p.name, region: p.region })),
          skipDuplicates: true,
        });
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.BANK_HOLIDAYS_IMPORTED,
        recordType: 'BankHoliday',
        metadata: { source: GOV_UK_BANK_HOLIDAYS_URL, from: fromKey, added: toCreate.length, byRegion },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return {
      message: toCreate.length
        ? `Added ${toCreate.length} bank holiday${toCreate.length === 1 ? '' : 's'} from GOV.UK`
        : 'Bank holidays are already up to date',
      data: { added: toCreate.length, alreadyPresent: parsed.length - toCreate.length, byRegion, from: fromKey },
    };
  }
}
