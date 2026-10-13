import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  AssignChargeCardMatchingDto,
  AssignPayCardMatchingDto,
  BillingCardQueryDto,
  ChangeEmployeePayCardDto,
  PayCardConflictCheckDto,
  PreviewPayDto,
  ChargeCardRuleDto,
  CreateChargeCardDto,
  CreatePayCardDto,
  PayCardRuleDto,
  UpdateChargeCardDto,
  UpdateEmployeeFunderPayAssignmentDto,
  UpdatePayCardDto,
  UpsertEmployeeFunderPayAssignmentDto,
} from './dto/billing-cards.dto';
import {
  assertEmployeeDefaultPayCard,
  buildEmploymentWhereForPayCard,
  describePayCardConflict,
  effectiveEmployeeFunderPayAssignments,
  firstOverlapDay,
  isPayCardEffective,
  matchPayCards,
  normalizePayCardAssignmentInput,
  payCardConflictCard,
  PayCardConflictException,
  payCardListInclude,
  payCardTargetsEqual,
  resolveAssignmentLabel,
} from './pay-card-assignment.util';
import { loadPayCardRulesForDate, payRulesSignature } from './pay-card-version.util';
import {
  addDaysToOperationalIso,
  combineOperationalDateAndHm,
  dayKeyInTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { calculatePayableAmount } from './visit-reconciliation.util';
import {
  BANK_HOLIDAY_REGION_LABELS,
  type BankHolidayRegion,
  DEFAULT_BANK_HOLIDAY_REGION,
  isBankHolidayRegion,
} from './bank-holiday-regions.util';
import { calendarHoldForPay, loadHolidayCalendarStatus, loadPayCalendar } from './holiday-calendar.store';
import { classifyPayRule } from './wage-types.util';
import {
  assignmentsCoveringDay,
  dateOnlyKey,
  parseDateOnlyKey,
  pickAssignmentForDay,
  recordEmployeePayCardChange,
  sortAssignmentsLatestFirst,
} from './employee-pay-card-assignment.util';
import {
  buildChargeCardBulkAssignTarget,
  chargeCardListInclude,
  normalizeChargeCardAssignmentInput,
  pickBestMatchingChargeCard,
  resolveChargeAssignmentLabel,
} from './charge-card-assignment.util';

function parseDateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

async function buildPayCardAssignmentData(
  tx: Prisma.TransactionClient,
  input: {
    assignmentLevel?: CreatePayCardDto['assignmentLevel'];
    assignmentTargetId?: string | null;
    assignmentTargetKey?: string | null;
    assignmentLabel?: string;
  },
) {
  const assignmentLevel = input.assignmentLevel ?? 'ORGANISATION_DEFAULT';
  const targets = normalizePayCardAssignmentInput({
    assignmentLevel,
    assignmentTargetId: input.assignmentTargetId,
    assignmentTargetKey: input.assignmentTargetKey,
  });
  const assignmentLabel =
    input.assignmentLabel?.trim() ||
    (await resolveAssignmentLabel(
      tx,
      assignmentLevel,
      targets.assignmentTargetId,
      targets.assignmentTargetKey,
    ));
  return {
    assignmentLevel,
    assignmentTargetId: targets.assignmentTargetId,
    assignmentTargetKey: targets.assignmentTargetKey,
    assignmentLabel: assignmentLabel?.trim() || null,
  };
}

async function buildChargeCardAssignmentData(
  tx: Prisma.TransactionClient,
  input: {
    assignmentLevel?: CreateChargeCardDto['assignmentLevel'];
    assignmentTargetId?: string | null;
    assignmentTargetKey?: string | null;
    assignmentLabel?: string;
  },
) {
  const assignmentLevel = input.assignmentLevel ?? 'ORGANISATION_DEFAULT';
  const targets = normalizeChargeCardAssignmentInput({
    assignmentLevel,
    assignmentTargetId: input.assignmentTargetId,
    assignmentTargetKey: input.assignmentTargetKey,
  });
  const assignmentLabel =
    input.assignmentLabel?.trim() ||
    (await resolveChargeAssignmentLabel(
      tx,
      assignmentLevel,
      targets.assignmentTargetId,
      targets.assignmentTargetKey,
    ));
  return {
    assignmentLevel,
    assignmentTargetId: targets.assignmentTargetId,
    assignmentTargetKey: targets.assignmentTargetKey,
    assignmentLabel: assignmentLabel?.trim() || null,
  };
}

function mapPayRules(rules?: PayCardRuleDto[]) {
  return (rules ?? []).map((rule, index) => ({
    label: rule.label?.trim() || null,
    serviceType: rule.serviceType?.trim() || null,
    dayType: rule.dayType ?? 'ANY',
    startTime: rule.startTime?.trim() || null,
    endTime: rule.endTime?.trim() || null,
    rateType: rule.rateType ?? 'HOURLY',
    amount: rule.amount,
    multiplier: rule.multiplier ?? null,
    additionalAmount: rule.additionalAmount ?? null,
    percentageUplift: rule.percentageUplift ?? null,
    enhancementMethod: rule.enhancementMethod ?? null,
    minimumMinutes: rule.minimumMinutes ?? null,
    roundingRule: rule.roundingRule?.trim() || null,
    priority: rule.priority ?? 0,
    sortOrder: rule.sortOrder ?? index,
    appliesToVisit: rule.appliesToVisit ?? true,
    appliesToTravel: rule.appliesToTravel ?? false,
    appliesToWaiting: rule.appliesToWaiting ?? false,
    appliesToTraining: rule.appliesToTraining ?? false,
  }));
}

function mapChargeRules(rules?: ChargeCardRuleDto[]) {
  return (rules ?? []).map((rule, index) => ({
    label: rule.label?.trim() || null,
    serviceType: rule.serviceType?.trim() || null,
    dayType: rule.dayType ?? 'ANY',
    startTime: rule.startTime?.trim() || null,
    endTime: rule.endTime?.trim() || null,
    chargeMethod: rule.chargeMethod ?? 'HOURLY_PRO_RATA',
    rateType: rule.rateType ?? 'HOURLY',
    amount: rule.amount,
    multiplier: rule.multiplier ?? null,
    minimumMinutes: rule.minimumMinutes ?? null,
    roundingRule: rule.roundingRule?.trim() || null,
    chargeableFlag: rule.chargeableFlag ?? true,
    priority: rule.priority ?? 0,
    sortOrder: rule.sortOrder ?? index,
  }));
}

/** Card fields recorded in the audit log (rules are kept in the version history instead). */
function payCardAuditValues(card: Record<string, unknown> | null | undefined) {
  if (!card) return {};
  const pick = [
    'name',
    'code',
    'assignmentLevel',
    'assignmentTargetId',
    'assignmentTargetKey',
    'assignmentLabel',
    'status',
    'stackingPolicy',
    'bankHolidayRegion',
    'effectiveFrom',
    'effectiveTo',
    'version',
    'notes',
  ];
  return Object.fromEntries(pick.map((k) => [k, card[k] ?? null]));
}

@Injectable()
export class PayCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async list(query: BillingCardQueryDto) {
    const where: Prisma.PayCardWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s, mode: 'insensitive' } },
        { assignmentLabel: { contains: s, mode: 'insensitive' } },
      ];
    }
    if (query.locationId) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { assignmentLevel: 'BRANCH', assignmentTargetId: query.locationId },
            { assignmentLevel: { not: 'BRANCH' } },
          ],
        },
      ];
    }
    const rows = await this.prisma.payCard.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: payCardListInclude,
    });
    return { data: rows };
  }

  async getById(id: string) {
    const row = await this.prisma.payCard.findFirst({
      where: { id, deletedAt: null },
      include: payCardListInclude,
    });
    if (!row) throw new NotFoundException('Pay card not found');
    return { data: row };
  }

  /** Codes stay unique across cards even though `@@unique([code, version])` allows reuse once a card is versioned. */
  private async assertPayCardCodeFree(code: string, exceptId?: string) {
    const clash = await this.prisma.payCard.findFirst({
      where: { code, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException('A pay card with this code already exists');
  }

  async create(userId: string, dto: CreatePayCardDto, _meta?: RequestAuditMeta) {
    await this.assertPayCardCodeFree(dto.code.trim().toUpperCase());
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const assignment = await buildPayCardAssignmentData(tx, dto);
        const card = await tx.payCard.create({
          data: {
            name: dto.name.trim(),
            code: dto.code.trim().toUpperCase(),
            ...assignment,
            currency: dto.currency?.trim() || 'GBP',
            status: dto.status ?? 'DRAFT',
            stackingPolicy: (dto.stackingPolicy as 'PRIORITY' | 'HIGHEST' | 'STACK') ?? 'PRIORITY',
            nation: dto.nation?.trim() || 'ENG',
            payFrequency: dto.payFrequency ?? 'WEEKLY',
            holidayPayMethod: (dto.holidayPayMethod as
              | 'ACCRUAL_WHEN_TAKEN'
              | 'ROLLED_UP_12_07'
              | 'REFERENCE_52_WEEK'
              | 'CONTRACTUAL_ABOVE_STATUTORY'
              | undefined) ?? null,
            travelInheritsTimeBands: dto.travelInheritsTimeBands ?? false,
            useUkMileageRates: dto.useUkMileageRates ?? true,
            bankHolidayRegion: dto.bankHolidayRegion ?? null,
            mileageVehicleType: (dto.mileageVehicleType as
              | 'CAR_VAN'
              | 'MOTORCYCLE'
              | 'BICYCLE'
              | 'COMPANY_VEHICLE'
              | 'PUBLIC_TRANSPORT'
              | undefined) ?? 'CAR_VAN',
            effectiveFrom: parseDateOnly(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null,
            notes: dto.notes?.trim() || null,
            createdById: userId,
            rules: { create: mapPayRules(dto.rules) as Prisma.PayCardRuleCreateWithoutPayCardInput[] },
            versions: {
              create: { version: 1, effectiveFrom: parseDateOnly(dto.effectiveFrom), createdById: userId },
            },
          } as Prisma.PayCardCreateInput,
          include: payCardListInclude,
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.BILLING,
          action: AuditAction.PAY_CARD_CREATED,
          recordType: 'PayCard',
          recordId: card.id,
          newValues: payCardAuditValues(card as unknown as Record<string, unknown>),
          metadata: { rulesCount: card.rules.length },
          ipAddress: _meta?.ipAddress ?? undefined,
          userAgent: _meta?.userAgent ?? undefined,
        });
        return card;
      });
      return { message: 'Pay card created', data: created };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A pay card with this code already exists');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdatePayCardDto, _meta?: RequestAuditMeta) {
    const existing = await this.prisma.payCard.findFirst({
      where: { id, deletedAt: null },
      include: { rules: { where: { supersededAt: null } } },
    });
    if (!existing) throw new NotFoundException('Pay card not found');
    if (dto.code !== undefined) await this.assertPayCardCodeFree(dto.code.trim().toUpperCase(), id);

    // Rates only change when the submitted rules differ from the current version's rules.
    const nextRules = dto.rules ? mapPayRules(dto.rules) : null;
    const rulesChanged =
      !!nextRules &&
      payRulesSignature(existing.rules as unknown as Array<Record<string, unknown>>) !==
        payRulesSignature(nextRules as unknown as Array<Record<string, unknown>>);
    // Draft cards are not used for pay yet, so their rules are edited in place.
    const createsVersion = rulesChanged && existing.status !== 'DRAFT';
    const nextVersion = createsVersion ? existing.version + 1 : existing.version;
    let versionEffectiveFrom: Date | null = null;
    if (createsVersion) {
      versionEffectiveFrom = parseDateOnly(dto.versionEffectiveFrom ?? dayKeyInTimeZone(new Date()));
      const current = await this.prisma.payCardVersion.findUnique({
        where: { payCardId_version: { payCardId: id, version: existing.version } },
        select: { effectiveFrom: true },
      });
      const currentFrom = current?.effectiveFrom ?? existing.effectiveFrom;
      if (versionEffectiveFrom < currentFrom) {
        throw new BadRequestException(
          `New rates must apply on or after ${currentFrom.toISOString().slice(0, 10)}, when version ${existing.version} started.`,
        );
      }
      const cardEnd =
        dto.effectiveTo !== undefined
          ? dto.effectiveTo
            ? parseDateOnly(dto.effectiveTo)
            : null
          : existing.effectiveTo;
      if (cardEnd && versionEffectiveFrom > cardEnd) {
        throw new BadRequestException('New rates cannot start after the card ends.');
      }
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (nextRules && rulesChanged) {
          if (createsVersion) {
            // Keep the previous version's rules; they still price visits dated before the new version.
            await tx.payCardRule.updateMany({
              where: { payCardId: id, supersededAt: null },
              data: { supersededAt: new Date() },
            });
            await tx.payCardVersion.create({
              data: {
                payCardId: id,
                version: nextVersion,
                effectiveFrom: versionEffectiveFrom!,
                changeNote: dto.versionNote?.trim() || null,
                createdById: userId,
              },
            });
          } else {
            await tx.payCardRule.deleteMany({ where: { payCardId: id, supersededAt: null } });
          }
        }

        const assignmentTouched =
          dto.assignmentLevel !== undefined ||
          dto.assignmentTargetId !== undefined ||
          dto.assignmentTargetKey !== undefined ||
          dto.assignmentLabel !== undefined;

        const assignment = assignmentTouched
          ? await buildPayCardAssignmentData(tx, {
              assignmentLevel: dto.assignmentLevel ?? existing.assignmentLevel,
              assignmentTargetId:
                dto.assignmentTargetId !== undefined
                  ? dto.assignmentTargetId
                  : existing.assignmentTargetId,
              assignmentTargetKey:
                dto.assignmentTargetKey !== undefined
                  ? dto.assignmentTargetKey
                  : existing.assignmentTargetKey,
              assignmentLabel: dto.assignmentLabel ?? existing.assignmentLabel ?? undefined,
            })
          : null;

        const card = await tx.payCard.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
            ...(assignment ?? {}),
            ...(dto.currency !== undefined ? { currency: dto.currency.trim() } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            ...(dto.stackingPolicy !== undefined
              ? { stackingPolicy: dto.stackingPolicy as 'PRIORITY' | 'HIGHEST' | 'STACK' }
              : {}),
            ...(dto.nation !== undefined ? { nation: dto.nation.trim() || null } : {}),
            ...(dto.payFrequency !== undefined ? { payFrequency: dto.payFrequency } : {}),
            ...(dto.holidayPayMethod !== undefined
              ? {
                  holidayPayMethod: (dto.holidayPayMethod as
                    | 'ACCRUAL_WHEN_TAKEN'
                    | 'ROLLED_UP_12_07'
                    | 'REFERENCE_52_WEEK'
                    | 'CONTRACTUAL_ABOVE_STATUTORY'
                    | null) ?? null,
                }
              : {}),
            ...(dto.travelInheritsTimeBands !== undefined
              ? { travelInheritsTimeBands: dto.travelInheritsTimeBands }
              : {}),
            ...(dto.useUkMileageRates !== undefined ? { useUkMileageRates: dto.useUkMileageRates } : {}),
            ...(dto.bankHolidayRegion !== undefined ? { bankHolidayRegion: dto.bankHolidayRegion || null } : {}),
            ...(dto.mileageVehicleType !== undefined
              ? {
                  mileageVehicleType: dto.mileageVehicleType as
                    | 'CAR_VAN'
                    | 'MOTORCYCLE'
                    | 'BICYCLE'
                    | 'COMPANY_VEHICLE'
                    | 'PUBLIC_TRANSPORT',
                }
              : {}),
            ...(dto.effectiveFrom !== undefined ? { effectiveFrom: parseDateOnly(dto.effectiveFrom) } : {}),
            ...(dto.effectiveTo !== undefined
              ? { effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
            updatedById: userId,
            ...(createsVersion ? { version: nextVersion } : {}),
            ...(nextRules && rulesChanged
              ? {
                  rules: {
                    create: nextRules.map((rule) => ({
                      ...rule,
                      version: nextVersion,
                    })) as Prisma.PayCardRuleCreateWithoutPayCardInput[],
                  },
                }
              : {}),
          } as Prisma.PayCardUpdateInput,
          include: payCardListInclude,
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.BILLING,
          action: createsVersion ? AuditAction.PAY_CARD_RATES_VERSIONED : AuditAction.PAY_CARD_UPDATED,
          recordType: 'PayCard',
          recordId: id,
          oldValues: payCardAuditValues(existing as unknown as Record<string, unknown>),
          newValues: payCardAuditValues(card as unknown as Record<string, unknown>),
          metadata: {
            ratesChanged: rulesChanged,
            ...(createsVersion
              ? {
                  newVersion: nextVersion,
                  versionEffectiveFrom: versionEffectiveFrom?.toISOString().slice(0, 10),
                  versionNote: dto.versionNote?.trim() || null,
                }
              : {}),
          },
          ipAddress: _meta?.ipAddress ?? undefined,
          userAgent: _meta?.userAgent ?? undefined,
        });
        return card;
      });
      return {
        message: createsVersion ? `Pay card updated — rates saved as version ${nextVersion}` : 'Pay card updated',
        data: updated,
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A pay card with this code already exists');
      }
      throw e;
    }
  }

  /** Last day of a locked/exported visit pay run that paid this carer (changes must start after it). */
  private async lastLockedPayPeriodEnd(employeeId: string): Promise<Date | null> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { status: { in: ['LOCKED', 'EXPORTED'] }, lines: { some: { employeeId } } },
      orderBy: { periodEnd: 'desc' },
      select: { periodEnd: true },
    });
    return run?.periodEnd ?? null;
  }

  /** Dated history of a carer's own pay card, newest first, plus the earliest date a change may use. */
  async getEmployeePayCardHistory(employeeId: string) {
    const rows = await this.prisma.employeePayCardAssignment.findMany({
      where: { employeeId },
      include: {
        payCard: {
          select: { id: true, name: true, code: true, status: true, version: true, assignmentLevel: true },
        },
      },
    });
    const sorted = sortAssignmentsLatestFirst(rows);
    const creatorIds = [...new Set(sorted.map((r) => r.createdById).filter((v): v is string => !!v))];
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const creatorName = new Map(
      creators.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]),
    );
    const todayKey = dayKeyInTimeZone(new Date());
    const current = pickAssignmentForDay(sorted, todayKey);
    const lockedEnd = await this.lastLockedPayPeriodEnd(employeeId);
    const latestFrom = sorted[0]?.effectiveFrom ? dateOnlyKey(sorted[0].effectiveFrom) : null;
    const afterLocked = lockedEnd
      ? dateOnlyKey(new Date(lockedEnd.getTime() + 24 * 60 * 60 * 1000))
      : null;
    const earliestEffectiveFrom =
      [latestFrom, afterLocked].filter((v): v is string => !!v).sort().pop() ?? null;
    return {
      data: {
        history: sorted.map((r) => ({
          id: r.id,
          payCard: r.payCard,
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
          reason: r.reason,
          createdAt: r.createdAt,
          createdByName: r.createdById ? (creatorName.get(r.createdById) ?? null) : null,
          isCurrent: current?.id === r.id,
          isScheduled: !!r.effectiveFrom && dateOnlyKey(r.effectiveFrom) > todayKey,
        })),
        earliestEffectiveFrom,
        lastLockedPayPeriodEnd: lockedEnd,
      },
    };
  }

  /**
   * Move one carer to a different pay card from a date (e.g. promotion) without touching the card
   * other carers use. Either picks an existing card or creates a personal (INDIVIDUAL) card.
   */
  async changeEmployeePayCard(userId: string, employeeId: string, dto: ChangeEmployeePayCardDto) {
    if (!!dto.payCardId === !!dto.personalCard) {
      throw new BadRequestException('Choose an existing pay card or create a personal card.');
    }
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('Reason is required.');
    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId, deletedAt: null, employee: { deletedAt: null } },
      include: {
        employee: { select: { personalDetail: { select: { firstName: true, lastName: true } } } },
        grade: { select: { id: true, name: true } },
      },
    });
    if (!employment) throw new NotFoundException('Employee employment record not found');

    // Optional grade change made with the promotion (grades are a single current value, no date).
    const gradeChange =
      dto.gradeId && dto.gradeId !== employment.gradeId
        ? await this.prisma.grade.findFirst({
            where: { id: dto.gradeId, deletedAt: null, isActive: true },
            select: { id: true, name: true },
          })
        : null;
    if (dto.gradeId && dto.gradeId !== employment.gradeId && !gradeChange) {
      throw new BadRequestException('Selected grade was not found.');
    }
    const historyReason = gradeChange
      ? `${reason} · Grade: ${employment.grade?.name ?? 'none'} → ${gradeChange.name}`
      : reason;

    const from = parseDateOnlyKey(dto.effectiveFrom);
    const fromKey = dateOnlyKey(from);
    const lockedEnd = await this.lastLockedPayPeriodEnd(employeeId);
    if (lockedEnd && fromKey <= dateOnlyKey(lockedEnd)) {
      throw new BadRequestException(
        `Pay up to ${dateOnlyKey(lockedEnd)} is already in a locked pay run. Choose a date after it.`,
      );
    }

    const employeeName =
      [employment.employee?.personalDetail?.firstName, employment.employee?.personalDetail?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || 'carer';
    const matchInput = {
      employeeId,
      roleId: employment.roleId,
      locationId: employment.locationId,
      baseLocationId: employment.baseLocationId,
      contractTypeId: employment.contractTypeId,
      isAgencyStaff: employment.isAgencyStaff,
      isBankStaff: employment.isBankStaff,
    };

    let personalCode: string | null = null;
    let baseCard: Awaited<ReturnType<PayCardsService['resolveForEmployee']>>['data']['payCard'] = null;
    if (dto.personalCard) {
      if (!dto.personalCard.rules?.length) throw new BadRequestException('Add at least one pay rate.');
      // Settings (stacking, mileage, frequency…) are copied from the card the carer is on today.
      // A carer whose card cannot be decided (PC-32) can still be given a personal card.
      baseCard =
        (
          await this.resolveForEmployee(employeeId, new Date()).catch((err) => {
            if (err instanceof PayCardConflictException) return null;
            throw err;
          })
        )?.data.payCard ?? null;
      const requested = dto.personalCard.code?.trim().toUpperCase();
      if (requested) {
        await this.assertPayCardCodeFree(requested);
        personalCode = requested;
      } else {
        const stem = `IND-${(employment.employeeNumber?.trim() || employeeId.slice(0, 8)).toUpperCase()}`;
        for (let n = 1; !personalCode; n += 1) {
          const candidate = n === 1 ? stem : `${stem}-${n}`;
          const clash = await this.prisma.payCard.findFirst({ where: { code: candidate }, select: { id: true } });
          if (!clash) personalCode = candidate;
        }
      }
    }

    const newCardId = await this.prisma.$transaction(async (tx) => {
      let cardId: string;
      if (dto.personalCard) {
        const base = baseCard as (typeof baseCard & Record<string, unknown>) | null;
        const created = await tx.payCard.create({
          data: {
            name: dto.personalCard.name.trim(),
            code: personalCode!,
            assignmentLevel: 'INDIVIDUAL',
            assignmentTargetId: employeeId,
            assignmentLabel: `Individual: ${employeeName}`,
            currency: base?.currency ?? 'GBP',
            nation: base?.nation ?? 'ENG',
            payFrequency: base?.payFrequency ?? 'WEEKLY',
            stackingPolicy: base?.stackingPolicy ?? 'PRIORITY',
            holidayPayMethod: base?.holidayPayMethod ?? null,
            travelInheritsTimeBands: base?.travelInheritsTimeBands ?? false,
            mileageVehicleType: base?.mileageVehicleType ?? 'CAR_VAN',
            useUkMileageRates: base?.useUkMileageRates ?? true,
            bankHolidayRegion: base?.bankHolidayRegion ?? null,
            status: 'ACTIVE',
            effectiveFrom: from,
            effectiveTo: null,
            notes: `Personal pay card for ${employeeName}. ${reason}`,
            createdById: userId,
            rules: {
              create: mapPayRules(dto.personalCard.rules) as Prisma.PayCardRuleCreateWithoutPayCardInput[],
            },
            versions: { create: { version: 1, effectiveFrom: from, createdById: userId, changeNote: reason } },
          } as Prisma.PayCardCreateInput,
        });
        cardId = created.id;
      } else {
        const card = await tx.payCard.findFirst({ where: { id: dto.payCardId!, deletedAt: null } });
        if (!card) throw new BadRequestException('Selected pay card was not found');
        if (card.status !== 'ACTIVE') throw new BadRequestException('Choose an active pay card.');
        await assertEmployeeDefaultPayCard(tx, card.id, matchInput);
        if (dateOnlyKey(card.effectiveFrom) > fromKey || (card.effectiveTo && dateOnlyKey(card.effectiveTo) < fromKey)) {
          throw new BadRequestException(`Pay card "${card.code}" is not in force on ${fromKey}.`);
        }
        cardId = card.id;
      }

      const latest = sortAssignmentsLatestFirst(
        await tx.employeePayCardAssignment.findMany({ where: { employeeId } }),
      )[0];
      if (latest && latest.payCardId === cardId && !latest.effectiveTo) {
        throw new BadRequestException('This carer is already on that pay card.');
      }
      await recordEmployeePayCardChange(tx, {
        employeeId,
        payCardId: cardId,
        effectiveFrom: from,
        reason: historyReason,
        userId,
      });
      await tx.employeeEmployment.update({
        where: { id: employment.id },
        data: {
          defaultPayCardId: cardId,
          ...(gradeChange ? { gradeId: gradeChange.id } : {}),
          updatedById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.EMPLOYEE_PAY_CARD_CHANGED,
        recordType: 'EmployeeEmployment',
        recordId: employment.id,
        oldValues: { defaultPayCardId: employment.defaultPayCardId, gradeId: employment.gradeId },
        newValues: { defaultPayCardId: cardId, gradeId: gradeChange?.id ?? employment.gradeId },
        metadata: {
          employeeId,
          effectiveFrom: fromKey,
          reason: historyReason,
          personalCard: !!dto.personalCard,
        },
      });
      return cardId;
    });

    // Completed visits since the date that were already priced on the old card (not yet in a pay run).
    const affectedPricedVisitCount = await this.prisma.visitReconciliation.count({
      where: {
        employeeId,
        plannedStartDateTime: { gte: operationalDayBounds(fromKey).start },
        payableAmount: { not: null },
        includedInPayrollRunId: null,
        NOT: { payCardId: newCardId },
      },
    });

    return {
      message: dto.personalCard
        ? `Personal pay card created and applied from ${fromKey}`
        : `Pay card changed from ${fromKey}`,
      data: {
        payCardId: newCardId,
        effectiveFrom: fromKey,
        affectedPricedVisitCount,
        gradeName: gradeChange?.name ?? null,
      },
    };
  }

  /**
   * Pay preview: prices a sample visit with the rules shown in the form, using the same calculation as
   * live visit pricing (time bands, stacking, bank holiday calendar). Nothing is written.
   */
  async previewPay(dto: PreviewPayDto) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const date = dto.date.slice(0, 10);
    const start = combineOperationalDateAndHm(date, dto.startTime, timeZone);
    const endDay = dto.endTime <= dto.startTime ? addDaysToOperationalIso(date, 1) : date;
    const end = combineOperationalDateAndHm(endDay, dto.endTime, timeZone);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Enter start and end times as HH:mm.');
    }
    const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    if (minutes <= 0 || minutes > 24 * 60) {
      throw new BadRequestException('The sample visit must last between 1 minute and 24 hours.');
    }

    const region = dto.bankHolidayRegion || DEFAULT_BANK_HOLIDAY_REGION;
    const holidays = await this.prisma.bankHoliday.findMany({
      where: {
        isActive: true,
        region,
        holidayDate: { gte: new Date(`${date}T00:00:00.000Z`), lte: new Date(`${endDay}T00:00:00.000Z`) },
      },
      select: { holidayDate: true, name: true },
    });
    // The same calendar and weekend-holiday policy as live pricing (PC-22 to PC-24).
    const payCalendar = await loadPayCalendar(this.prisma, start, end, region);
    const holidayKeys = payCalendar.bankHolidayKeys;
    const rules = mapPayRules(dto.rules);
    const stackingPolicy = (dto.stackingPolicy as 'PRIORITY' | 'HIGHEST' | 'STACK' | undefined) ?? 'PRIORITY';
    // R-27: live pricing holds a visit on a day that is normally a bank holiday when the calendar
    // has no entry for it. The preview says the same instead of showing an ordinary-day amount.
    const calendarHold = await calendarHoldForPay(this.prisma, {
      region,
      rules,
      start,
      end,
      dayOf: (instant) => dayKeyInTimeZone(instant, timeZone),
    });
    const result = calendarHold ? null : calculatePayableAmount(
      rules,
      start,
      minutes,
      holidayKeys.has(dayKeyInTimeZone(start, timeZone)),
      {
        start,
        end,
        stackingPolicy,
        isBankHolidayFn: (d) => holidayKeys.has(dayKeyInTimeZone(d, timeZone)),
        timeZone,
        calendar: payCalendar.calendar,
      },
      dto.nightDuty ?? null,
      minutes,
    );

    const warnings: string[] = [];
    if (calendarHold) warnings.push(calendarHold);
    // A year with dates missing prices its holidays as ordinary days without saying so.
    const year = Number(date.slice(0, 4));
    const calendarStatus = isBankHolidayRegion(region)
      ? (await loadHolidayCalendarStatus(this.prisma, [year])).regions
          .find((r) => r.region === region)
          ?.years.find((y) => y.year === year)
      : null;
    if (calendarStatus && !calendarStatus.complete) {
      warnings.push(
        `The ${BANK_HOLIDAY_REGION_LABELS[region as BankHolidayRegion]} bank holiday calendar for ${year} is not complete: ${calendarStatus.issues.join(' ')}`,
      );
    }
    if (rules.some((r) => r.dayType === 'EASTER')) {
      warnings.push(
        'This card has an Easter rate, but no day is classified as Easter: Good Friday and Easter Monday are paid as bank holidays. The Easter rate is not used until the organisation decides which days it covers.',
      );
    }
    if (!result && !calendarHold) {
      warnings.push(
        dto.nightDuty === 'SLEEPING_NIGHT'
          ? 'No sleeping night rate on this pay card.'
          : dto.nightDuty === 'WAKING_NIGHT'
            ? 'No waking night rate on this pay card.'
            : 'No rate covers all of this visit — the visit would be held as "rate missing", not paid £0.',
      );
    }
    const premiumRules = rules.filter(
      (r) =>
        r.enhancementMethod &&
        r.enhancementMethod !== 'ABSOLUTE_HOURLY' &&
        r.rateType !== 'SLEEP_IN' &&
        r.rateType !== 'WAKING_NIGHT',
    );
    const hasWeekdayBase = rules.some(
      (r) =>
        (r.rateType === 'HOURLY' || r.rateType === 'BANDED') &&
        (r.dayType === 'WEEKDAY' || r.dayType === 'ANY') &&
        (!r.enhancementMethod || r.enhancementMethod === 'ABSOLUTE_HOURLY'),
    );
    if (premiumRules.length && !hasWeekdayBase) {
      warnings.push('Premium, percentage and multiplier rates are added to the weekday base rate, but this card has no weekday hourly base rate.');
    }

    return {
      data: {
        amount: result?.amount ?? null,
        minutes,
        method: result?.label ?? null,
        explanation: result?.explanation ?? null,
        segments: result?.segments ?? [],
        start,
        end,
        timeZone,
        stackingPolicy,
        bankHolidayRegion: region,
        bankHolidays: holidays.map((h) => ({ date: h.holidayDate.toISOString().slice(0, 10), name: h.name })),
        wageTypes: [...new Set(rules.map((r) => classifyPayRule(r)))],
        warnings,
      },
    };
  }

  /** Rate history: every version (newest first) with its own rules and the date range it priced. */
  async listVersions(id: string) {
    const card = await this.prisma.payCard.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, version: true, effectiveTo: true },
    });
    if (!card) throw new NotFoundException('Pay card not found');
    const [versions, rules] = await Promise.all([
      this.prisma.payCardVersion.findMany({ where: { payCardId: id }, orderBy: { version: 'asc' } }),
      this.prisma.payCardRule.findMany({
        where: { payCardId: id },
        orderBy: [{ version: 'asc' }, { sortOrder: 'asc' }],
      }),
    ]);
    const creatorIds = [...new Set(versions.map((v) => v.createdById).filter((v): v is string => !!v))];
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const creatorName = new Map(
      creators.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]),
    );
    const DAY_MS = 24 * 60 * 60 * 1000;
    const data = versions.map((v, index) => {
      const next = versions[index + 1];
      return {
        id: v.id,
        version: v.version,
        effectiveFrom: v.effectiveFrom,
        // Last day this version priced: the day before the next version starts (or the card end).
        effectiveTo: next ? new Date(next.effectiveFrom.getTime() - DAY_MS) : card.effectiveTo,
        isCurrent: v.version === card.version,
        changeNote: v.changeNote,
        createdAt: v.createdAt,
        createdByName: v.createdById ? (creatorName.get(v.createdById) ?? null) : null,
        rules: rules.filter((r) => r.version === v.version),
      };
    });
    return { data: data.reverse() };
  }

  async getAssignmentPreview(id: string) {
    const card = await this.prisma.payCard.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw new NotFoundException('Pay card not found');
    const where = buildEmploymentWhereForPayCard(card);
    const [matchingCount, unassignedCount, assignedCount] = await Promise.all([
      this.prisma.employeeEmployment.count({ where }),
      this.prisma.employeeEmployment.count({
        where: { ...where, defaultPayCardId: null },
      }),
      this.prisma.employeeEmployment.count({
        where: { ...where, defaultPayCardId: id },
      }),
    ]);
    return {
      data: {
        matchingCount,
        unassignedCount,
        assignedCount,
      },
    };
  }

  async assignToMatchingEmployees(
    userId: string,
    id: string,
    dto: AssignPayCardMatchingDto,
    _meta?: RequestAuditMeta,
  ) {
    const card = await this.prisma.payCard.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw new NotFoundException('Pay card not found');
    const onlyUnassigned = dto.onlyUnassigned ?? true;
    const where = buildEmploymentWhereForPayCard(card);
    if (onlyUnassigned) {
      where.defaultPayCardId = null;
    }
    const targets = await this.prisma.employeeEmployment.findMany({
      where,
      select: { id: true, employeeId: true },
    });
    let assigned = 0;
    await this.prisma.$transaction(
      async (tx) => {
        for (const target of targets) {
          try {
            // Bulk assignment applies from today; carers with a future-dated change are skipped.
            await recordEmployeePayCardChange(tx, {
              employeeId: target.employeeId,
              payCardId: id,
              reason: `Bulk-assigned from pay card ${card.code}`,
              userId,
            });
          } catch (e) {
            if (e instanceof BadRequestException) continue;
            throw e;
          }
          await tx.employeeEmployment.update({
            where: { id: target.id },
            data: { defaultPayCardId: id, updatedById: userId },
          });
          assigned += 1;
        }
      },
      { timeout: 120_000 },
    );
    return {
      message: `Assigned pay card to ${assigned} carer${assigned === 1 ? '' : 's'}`,
      data: { assignedCount: assigned },
    };
  }

  async unassignEmployee(
    userId: string,
    id: string,
    employeeId: string,
    _meta?: RequestAuditMeta,
  ) {
    const card = await this.prisma.payCard.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw new NotFoundException('Pay card not found');

    const employment = await this.prisma.employeeEmployment.findFirst({
      where: {
        employeeId,
        deletedAt: null,
        employee: { deletedAt: null },
        defaultPayCardId: id,
      },
    });
    if (!employment) {
      throw new NotFoundException('Carer is not assigned to this pay card');
    }

    await this.prisma.$transaction(async (tx) => {
      await recordEmployeePayCardChange(tx, {
        employeeId,
        payCardId: null,
        reason: `Unassigned from pay card ${card.code}`,
        userId,
      });
      await tx.employeeEmployment.update({
        where: { id: employment.id },
        data: { defaultPayCardId: null, updatedById: userId },
      });
    });

    return {
      message: 'Carer unassigned from pay card',
      data: { employeeId },
    };
  }

  /**
   * Resolve pay card for a carer.
   * When `funderId` is provided (visit context), employee+funder overrides win over the
   * employment default and role/branch matching. Charge cards are never consulted.
   *
   * Order: funder override, the carer's own dated card, then matching by level (individual, role,
   * branch, employment type, worker type, organisation default). PC-32: when a step finds more
   * than one card for the day and nothing ranks them, a PayCardConflictException (409) names the
   * cards instead of one of them being chosen.
   */
  async resolveForEmployee(
    employeeId: string,
    at?: Date,
    options?: { funderId?: string | null },
  ) {
    const instant = at ?? new Date();
    const funderId = options?.funderId?.trim() || null;
    // PC-19: cards and assignments are in force on calendar days; the day is the local day of
    // the moment being priced (00:15 local in summer time is still the previous day in UTC).
    const dayKey = dayKeyInTimeZone(instant, await this.orgSettings.getOperationalTimezone());
    const asOf = parseDateOnlyKey(dayKey);

    if (funderId) {
      const funderOverride = await this.findEffectiveFunderPayCard(employeeId, funderId, asOf);
      if (funderOverride) {
        return {
          data: {
            source: 'EMPLOYEE_FUNDER' as const,
            payCard: funderOverride,
            matchedLevel: null,
            funderId,
          },
        };
      }
    }

    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId, deletedAt: null, employee: { deletedAt: null } },
      include: {
        defaultPayCard: { include: payCardListInclude },
      },
    });
    if (!employment) throw new NotFoundException('Employee employment record not found');

    // Dated history of the carer's own card: the row covering the visit day wins (e.g. promotion date).
    const history = await this.prisma.employeePayCardAssignment.findMany({
      where: { employeeId },
      include: { payCard: { include: payCardListInclude } },
    });
    if (history.length) {
      const covering = assignmentsCoveringDay(history, dayKey);
      if (new Set(covering.map((row) => row.payCardId)).size > 1) {
        throw new PayCardConflictException({
          kind: 'OWN_CARD',
          level: null,
          day: dayKey,
          cards: covering.flatMap((row) => (row.payCard ? [payCardConflictCard(row.payCard)] : [])),
        });
      }
      const card = covering[0]?.payCard;
      if (card && !card.deletedAt && card.status === 'ACTIVE' && isPayCardEffective(card, asOf)) {
        return {
          data: {
            source: 'EXPLICIT' as const,
            payCard: card,
            matchedLevel: null,
            funderId,
          },
        };
      }
      // No own card that day (or it is inactive / not effective): fall back to matching.
    } else if (employment.defaultPayCard) {
      const card = employment.defaultPayCard;
      if (card.deletedAt) {
        // fall through to matching
      } else if (
        card.status === 'ACTIVE' &&
        isPayCardEffective(card, asOf)
      ) {
        return {
          data: {
            source: 'EXPLICIT' as const,
            payCard: card,
            matchedLevel: null,
            funderId,
          },
        };
      }
      // Expired / inactive explicit card: fall back to hierarchy rather than silently use it.
    }

    const cards = await this.prisma.payCard.findMany({
      where: { deletedAt: null },
      include: payCardListInclude,
    });
    const { card: matched, conflicting } = matchPayCards(
      {
        employeeId,
        roleId: employment.roleId,
        locationId: employment.locationId,
        baseLocationId: employment.baseLocationId,
        contractTypeId: employment.contractTypeId,
        isAgencyStaff: employment.isAgencyStaff,
        isBankStaff: employment.isBankStaff,
      },
      cards,
      { at: asOf },
    );
    if (conflicting.length) {
      throw new PayCardConflictException({
        kind: 'MATCHED_LEVEL',
        level: conflicting[0].assignmentLevel,
        day: dayKey,
        cards: conflicting.map(payCardConflictCard),
      });
    }

    if (!matched) {
      return {
        data: {
          source: 'NONE' as const,
          payCard: null,
          matchedLevel: null,
          funderId,
        },
      };
    }

    return {
      data: {
        source: 'MATCHED' as const,
        payCard: matched,
        matchedLevel: matched.assignmentLevel,
        funderId,
      },
    };
  }

  /**
   * Active carers who have no card of their own in force on `day`, so their card comes from
   * matching. Only they can be caught between two cards at the same level.
   */
  private async carersRelyingOnMatching(day: Date, dayKey: string, locationId?: string) {
    const employments = await this.prisma.employeeEmployment.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        employee: { deletedAt: null, isActive: true },
        ...(locationId ? { OR: [{ locationId }, { baseLocationId: locationId }] } : {}),
      },
      select: {
        employeeId: true,
        employeeNumber: true,
        roleId: true,
        locationId: true,
        baseLocationId: true,
        contractTypeId: true,
        isAgencyStaff: true,
        isBankStaff: true,
        defaultPayCard: {
          select: { status: true, effectiveFrom: true, effectiveTo: true, deletedAt: true },
        },
        employee: { select: { personalDetail: { select: { firstName: true, lastName: true } } } },
      },
    });
    const history = await this.prisma.employeePayCardAssignment.findMany({
      where: { employeeId: { in: employments.map((e) => e.employeeId) } },
      include: {
        payCard: { select: { status: true, effectiveFrom: true, effectiveTo: true, deletedAt: true } },
      },
    });
    const historyByEmployee = new Map<string, typeof history>();
    for (const row of history) {
      historyByEmployee.set(row.employeeId, [...(historyByEmployee.get(row.employeeId) ?? []), row]);
    }
    return employments
      .filter((employment) => {
        const rows = historyByEmployee.get(employment.employeeId) ?? [];
        const own = rows.length
          ? assignmentsCoveringDay(rows, dayKey)[0]?.payCard
          : employment.defaultPayCard;
        return !(own && !own.deletedAt && own.status === 'ACTIVE' && isPayCardEffective(own, day));
      })
      .map((employment) => ({
        ...employment,
        name:
          [employment.employee?.personalDetail?.firstName, employment.employee?.personalDetail?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() ||
          employment.employeeNumber ||
          'Carer',
      }));
  }

  /**
   * PC-32: carers whose pay card cannot be decided today because two or more cards match them at
   * the same level. Their pay is held until the office acts; this is the list to act on.
   */
  async listConflicts(locationId?: string) {
    const dayKey = dayKeyInTimeZone(new Date(), await this.orgSettings.getOperationalTimezone());
    const day = parseDateOnlyKey(dayKey);
    const [carers, cards] = await Promise.all([
      this.carersRelyingOnMatching(day, dayKey, locationId),
      this.prisma.payCard.findMany({ where: { deletedAt: null, status: 'ACTIVE' } }),
    ]);
    const groups = new Map<
      string,
      { cards: typeof cards; carers: Array<{ employeeId: string; name: string }> }
    >();
    for (const carer of carers) {
      const { conflicting } = matchPayCards(carer, cards, { at: day });
      if (!conflicting.length) continue;
      const key = conflicting.map((card) => card.id).join('|');
      const group = groups.get(key) ?? { cards: conflicting, carers: [] };
      group.carers.push({ employeeId: carer.employeeId, name: carer.name });
      groups.set(key, group);
    }
    const data = [...groups.values()].map((group) => {
      const conflict = {
        kind: 'MATCHED_LEVEL' as const,
        level: group.cards[0].assignmentLevel,
        day: dayKey,
        cards: group.cards.map(payCardConflictCard),
      };
      return {
        ...conflict,
        message: describePayCardConflict(conflict),
        carerCount: group.carers.length,
        carers: group.carers.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25),
      };
    });
    return {
      data: {
        day: dayKey,
        carerCount: data.reduce((sum, group) => sum + group.carerCount, 0),
        groups: data,
      },
    };
  }

  /**
   * PC-32, for the pay card form: would the card as entered leave any carer between two cards?
   * Other active cards for the same carers and dates are listed, with the carers who have no card
   * of their own and would therefore be held. Nothing is saved and saving is not refused: several
   * cards at one level are normal when carers are given their card individually.
   */
  async checkConflicts(dto: PayCardConflictCheckDto, locationId?: string) {
    const empty = { day: null, overlapping: [], affectedCarerCount: 0, affectedCarers: [], message: null };
    let target: ReturnType<typeof normalizePayCardAssignmentInput>;
    try {
      target = normalizePayCardAssignmentInput(dto);
    } catch (err) {
      // The target is not chosen yet: nothing to check.
      if (err instanceof BadRequestException) return { data: empty };
      throw err;
    }
    const candidate = {
      id: dto.id ?? 'candidate',
      code: '',
      assignmentLevel: dto.assignmentLevel ?? ('ORGANISATION_DEFAULT' as const),
      ...target,
      effectiveFrom: parseDateOnly(dto.effectiveFrom),
      effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null,
      status: 'ACTIVE' as const,
    };
    const todayKey = dayKeyInTimeZone(new Date(), await this.orgSettings.getOperationalTimezone());
    const today = parseDateOnlyKey(todayKey);
    const others = await this.prisma.payCard.findMany({
      where: { deletedAt: null, status: 'ACTIVE', ...(dto.id ? { NOT: { id: dto.id } } : {}) },
    });
    const overlapping = others.flatMap((card) => {
      if (!payCardTargetsEqual(card, candidate)) return [];
      const from = firstOverlapDay(card, candidate);
      if (!from || (card.effectiveTo && card.effectiveTo < today)) return [];
      return [{ ...payCardConflictCard(card), overlapFrom: dateOnlyKey(from) }];
    });

    // Who would be held: judged on the first day the card is in force from today onwards.
    const day = candidate.effectiveFrom > today ? candidate.effectiveFrom : today;
    const dayKey = dateOnlyKey(day);
    const inForce = !candidate.effectiveTo || candidate.effectiveTo >= day;
    const affected: Array<{ employeeId: string; name: string; cards: string[] }> = [];
    if (inForce) {
      const carers = await this.carersRelyingOnMatching(day, dayKey, locationId);
      const pool = [...others, candidate as unknown as (typeof others)[number]];
      for (const carer of carers) {
        const { conflicting } = matchPayCards(carer, pool, { at: day });
        if (!conflicting.some((card) => card.id === candidate.id)) continue;
        affected.push({
          employeeId: carer.employeeId,
          name: carer.name,
          cards: conflicting.filter((card) => card.id !== candidate.id).map((card) => card.code),
        });
      }
    }
    const codes = [...new Set([...overlapping.map((c) => c.code), ...affected.flatMap((a) => a.cards)])];
    const message = affected.length
      ? `From ${dayKey}, ${affected.length} carer${affected.length === 1 ? '' : 's'} without a pay card of their own would match this card and ${codes.join(', ')} at the same level. Their pay would be held until one card is chosen: end the other card before this one starts, or give those carers their own pay card.`
      : overlapping.length
        ? `${codes.join(', ')} ${codes.length === 1 ? 'is' : 'are'} in force for the same carers and dates at this level. No carer relies on matching at the moment, so nobody's pay is held; a carer without their own pay card would be.`
        : null;
    return {
      data: {
        day: dayKey,
        overlapping,
        affectedCarerCount: affected.length,
        affectedCarers: affected.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25),
        message,
      },
    };
  }

  /** As `resolveForEmployee`, for screens: a conflict is returned as data, not as an error. */
  async describeForEmployee(employeeId: string, options?: { funderId?: string | null }) {
    try {
      const resolved = await this.resolveForEmployee(employeeId, undefined, options);
      return { data: { ...resolved.data, conflict: null, message: null } };
    } catch (err) {
      if (!(err instanceof PayCardConflictException)) throw err;
      return {
        data: {
          source: 'CONFLICT' as const,
          payCard: null,
          matchedLevel: err.conflict.level,
          funderId: options?.funderId?.trim() || null,
          conflict: err.conflict,
          message: err.message,
        },
      };
    }
  }

  /**
   * The carer's pay card on a date and the rules of the card version in force that day
   * (used for non-visit pay: training, on-call, live-in, overtime). Null when no card applies.
   */
  async resolveRulesForEmployeeAt(employeeId: string, at: Date) {
    const resolved = await this.resolveForEmployee(employeeId, at);
    const card = resolved.data.payCard;
    if (!card) return null;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const { version, rules } = await loadPayCardRulesForDate(this.prisma, card.id, at, timeZone);
    return { card, version: version ?? card.version, rules, source: resolved.data.source };
  }

  private async findEffectiveFunderPayCard(employeeId: string, funderId: string, asOf: Date) {
    const rows = await this.prisma.employeeFunderPayAssignment.findMany({
      where: {
        employeeId,
        funderId,
        deletedAt: null,
      },
      include: {
        payCard: { include: payCardListInclude },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const effective = effectiveEmployeeFunderPayAssignments(rows, asOf);
    if (new Set(effective.map((row) => row.payCardId)).size > 1) {
      throw new PayCardConflictException({
        kind: 'FUNDER_OVERRIDE',
        level: null,
        day: dateOnlyKey(asOf),
        cards: effective.map((row) => payCardConflictCard(row.payCard)),
      });
    }
    const picked = effective[0] ?? null;
    if (!picked?.payCard || picked.payCard.deletedAt) return null;
    if (picked.payCard.status !== 'ACTIVE') return null;
    if (!isPayCardEffective(picked.payCard, asOf)) return null;
    return picked.payCard;
  }

  async listEmployeeFunderAssignments(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const rows = await this.prisma.employeeFunderPayAssignment.findMany({
      where: { employeeId, deletedAt: null },
      include: { payCard: { include: payCardListInclude } },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const funderIds = [...new Set(rows.map((r) => r.funderId))];
    const funders = funderIds.length
      ? await this.prisma.funder.findMany({
          where: { id: { in: funderIds }, deletedAt: null },
          select: { id: true, name: true, code: true },
        })
      : [];
    const funderById = new Map(funders.map((f) => [f.id, f]));

    return {
      data: rows.map((row) => ({
        id: row.id,
        employeeId: row.employeeId,
        funderId: row.funderId,
        funder: funderById.get(row.funderId) ?? null,
        payCardId: row.payCardId,
        payCard: row.payCard,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  }

  async upsertEmployeeFunderAssignment(
    userId: string,
    dto: UpsertEmployeeFunderPayAssignmentDto,
    _meta?: RequestAuditMeta,
  ) {
    const employeeId = dto.employeeId.trim();
    const funderId = dto.funderId.trim();
    const payCardId = dto.payCardId.trim();

    const [employee, funder, payCard] = await Promise.all([
      this.prisma.employee.findFirst({
        where: { id: employeeId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.funder.findFirst({
        where: { id: funderId, deletedAt: null },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.payCard.findFirst({
        where: { id: payCardId, deletedAt: null },
        include: payCardListInclude,
      }),
    ]);
    if (!employee) throw new NotFoundException('Employee not found');
    if (!funder) throw new NotFoundException('Funder not found');
    if (!payCard) throw new NotFoundException('Pay card not found');
    if (payCard.status !== 'ACTIVE' && payCard.status !== 'DRAFT') {
      throw new BadRequestException('Pay card must be active (or draft) to assign');
    }

    const effectiveFrom = dto.effectiveFrom
      ? parseDateOnly(dto.effectiveFrom)
      : new Date(
          Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate(),
          ),
        );
    const effectiveTo =
      dto.effectiveTo === undefined || dto.effectiveTo === null || dto.effectiveTo === ''
        ? null
        : parseDateOnly(dto.effectiveTo);
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }

    // PC-32: one override per carer and funder. Two requests at once used to both find none and
    // both create one, leaving two overrides for the same day; the lock makes them take turns.
    const { existing, row } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-funder-pay:${employeeId}:${funderId}`}))`;
      const existing = await tx.employeeFunderPayAssignment.findFirst({
        where: { employeeId, funderId, deletedAt: null },
      });
      const row = existing
        ? await tx.employeeFunderPayAssignment.update({
            where: { id: existing.id },
            data: {
              payCardId,
              effectiveFrom,
              effectiveTo,
              notes: dto.notes === undefined ? existing.notes : dto.notes?.trim() || null,
              updatedById: userId,
            },
            include: { payCard: { include: payCardListInclude } },
          })
        : await tx.employeeFunderPayAssignment.create({
            data: {
              employeeId,
              funderId,
              payCardId,
              effectiveFrom,
              effectiveTo,
              notes: dto.notes?.trim() || null,
              createdById: userId,
              updatedById: userId,
            },
            include: { payCard: { include: payCardListInclude } },
          });
      return { existing, row };
    });

    return {
      message: existing ? 'Funder pay card assignment updated' : 'Funder pay card assignment created',
      data: {
        id: row.id,
        employeeId: row.employeeId,
        funderId: row.funderId,
        funder,
        payCardId: row.payCardId,
        payCard: row.payCard,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    };
  }

  async updateEmployeeFunderAssignment(
    userId: string,
    id: string,
    dto: UpdateEmployeeFunderPayAssignmentDto,
    _meta?: RequestAuditMeta,
  ) {
    const existing = await this.prisma.employeeFunderPayAssignment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Funder pay card assignment not found');

    let payCardId = existing.payCardId;
    if (dto.payCardId !== undefined) {
      const payCard = await this.prisma.payCard.findFirst({
        where: { id: dto.payCardId.trim(), deletedAt: null },
        select: { id: true, status: true },
      });
      if (!payCard) throw new NotFoundException('Pay card not found');
      payCardId = payCard.id;
    }

    const effectiveFrom =
      dto.effectiveFrom !== undefined ? parseDateOnly(dto.effectiveFrom) : existing.effectiveFrom;
    const effectiveTo =
      dto.effectiveTo === undefined
        ? existing.effectiveTo
        : dto.effectiveTo === null || dto.effectiveTo === ''
          ? null
          : parseDateOnly(dto.effectiveTo);
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }

    const row = await this.prisma.employeeFunderPayAssignment.update({
      where: { id },
      data: {
        payCardId,
        effectiveFrom,
        effectiveTo,
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        updatedById: userId,
      },
      include: { payCard: { include: payCardListInclude } },
    });

    const funder = await this.prisma.funder.findFirst({
      where: { id: row.funderId, deletedAt: null },
      select: { id: true, name: true, code: true },
    });

    return {
      message: 'Funder pay card assignment updated',
      data: {
        id: row.id,
        employeeId: row.employeeId,
        funderId: row.funderId,
        funder,
        payCardId: row.payCardId,
        payCard: row.payCard,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    };
  }

  async removeEmployeeFunderAssignment(userId: string, id: string, _meta?: RequestAuditMeta) {
    const existing = await this.prisma.employeeFunderPayAssignment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Funder pay card assignment not found');

    await this.prisma.employeeFunderPayAssignment.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
    });

    return { message: 'Funder pay card assignment removed', data: { id } };
  }

  async remove(userId: string, id: string, _meta?: RequestAuditMeta) {
    const existing = await this.prisma.payCard.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Pay card not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.payCard.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: userId },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.PAY_CARD_DELETED,
        recordType: 'PayCard',
        recordId: id,
        oldValues: payCardAuditValues(existing as unknown as Record<string, unknown>),
        ipAddress: _meta?.ipAddress ?? undefined,
        userAgent: _meta?.userAgent ?? undefined,
      });
    });
    return { message: 'Pay card deleted' };
  }
}

@Injectable()
export class ChargeCardsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: BillingCardQueryDto) {
    const where: Prisma.ChargeCardWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s, mode: 'insensitive' } },
        { assignmentLabel: { contains: s, mode: 'insensitive' } },
      ];
    }
    if (query.locationId) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            {
              assignmentLevel: 'BRANCH_REGION',
              assignmentTargetId: query.locationId,
            },
            { assignmentLevel: { not: 'BRANCH_REGION' } },
          ],
        },
      ];
    }
    const rows = await this.prisma.chargeCard.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: chargeCardListInclude,
    });
    return { data: rows };
  }

  async getById(id: string) {
    const row = await this.prisma.chargeCard.findFirst({
      where: { id, deletedAt: null },
      include: chargeCardListInclude,
    });
    if (!row) throw new NotFoundException('Charge card not found');
    return { data: row };
  }

  async create(userId: string, dto: CreateChargeCardDto, _meta?: RequestAuditMeta) {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const assignment = await buildChargeCardAssignmentData(tx, dto);
        return tx.chargeCard.create({
          data: {
            name: dto.name.trim(),
            code: dto.code.trim().toUpperCase(),
            ...assignment,
            currency: dto.currency?.trim() || 'GBP',
            billingFrequency: dto.billingFrequency ?? 'WEEKLY',
            paymentTerms: dto.paymentTerms?.trim() || null,
            taxTreatment: dto.taxTreatment?.trim() || null,
            invoiceGroupingRule: dto.invoiceGroupingRule?.trim() || null,
            defaultChargeMethod: dto.defaultChargeMethod ?? 'HOURLY_PRO_RATA',
            status: dto.status ?? 'DRAFT',
            effectiveFrom: parseDateOnly(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null,
            notes: dto.notes?.trim() || null,
            createdById: userId,
            rules: { create: mapChargeRules(dto.rules) },
          },
          include: chargeCardListInclude,
        });
      });
      return { message: 'Charge card created', data: created };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A charge card with this code already exists');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateChargeCardDto, _meta?: RequestAuditMeta) {
    const existing = await this.prisma.chargeCard.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Charge card not found');
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.rules) {
          await tx.chargeCardRule.deleteMany({ where: { chargeCardId: id } });
        }

        const assignmentTouched =
          dto.assignmentLevel !== undefined ||
          dto.assignmentTargetId !== undefined ||
          dto.assignmentTargetKey !== undefined ||
          dto.assignmentLabel !== undefined;

        const assignment = assignmentTouched
          ? await buildChargeCardAssignmentData(tx, {
              assignmentLevel: dto.assignmentLevel ?? existing.assignmentLevel,
              assignmentTargetId:
                dto.assignmentTargetId !== undefined
                  ? dto.assignmentTargetId
                  : existing.assignmentTargetId,
              assignmentTargetKey:
                dto.assignmentTargetKey !== undefined
                  ? dto.assignmentTargetKey
                  : existing.assignmentTargetKey,
              assignmentLabel: dto.assignmentLabel ?? existing.assignmentLabel ?? undefined,
            })
          : null;

        return tx.chargeCard.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
            ...(assignment ?? {}),
            ...(dto.currency !== undefined ? { currency: dto.currency.trim() } : {}),
            ...(dto.billingFrequency !== undefined ? { billingFrequency: dto.billingFrequency } : {}),
            ...(dto.paymentTerms !== undefined ? { paymentTerms: dto.paymentTerms?.trim() || null } : {}),
            ...(dto.taxTreatment !== undefined ? { taxTreatment: dto.taxTreatment?.trim() || null } : {}),
            ...(dto.invoiceGroupingRule !== undefined
              ? { invoiceGroupingRule: dto.invoiceGroupingRule?.trim() || null }
              : {}),
            ...(dto.defaultChargeMethod !== undefined ? { defaultChargeMethod: dto.defaultChargeMethod } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            ...(dto.effectiveFrom !== undefined ? { effectiveFrom: parseDateOnly(dto.effectiveFrom) } : {}),
            ...(dto.effectiveTo !== undefined
              ? { effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
            updatedById: userId,
            ...(dto.rules ? { rules: { create: mapChargeRules(dto.rules) } } : {}),
          },
          include: chargeCardListInclude,
        });
      });
      return { message: 'Charge card updated', data: updated };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A charge card with this code already exists');
      }
      throw e;
    }
  }

  async getAssignmentPreview(id: string) {
    const card = await this.prisma.chargeCard.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw new NotFoundException('Charge card not found');
    const target = buildChargeCardBulkAssignTarget(card);
    if (target.entity === 'none') {
      return { data: { matchingCount: 0, unassignedCount: 0, assignedCount: 0 } };
    }

    const assignedField = { defaultChargeCardId: id };
    const unassignedField = { defaultChargeCardId: null };

    if (target.entity === 'funder') {
      const [matchingCount, unassignedCount, assignedCount] = await Promise.all([
        this.prisma.funder.count({ where: target.where }),
        this.prisma.funder.count({ where: { ...target.where, ...unassignedField } }),
        this.prisma.funder.count({ where: { ...target.where, ...assignedField } }),
      ]);
      return { data: { matchingCount, unassignedCount, assignedCount } };
    }

    if (target.entity === 'serviceUserFunding') {
      const [matchingCount, unassignedCount, assignedCount] = await Promise.all([
        this.prisma.serviceUserFunding.count({ where: target.where }),
        this.prisma.serviceUserFunding.count({ where: { ...target.where, ...unassignedField } }),
        this.prisma.serviceUserFunding.count({ where: { ...target.where, ...assignedField } }),
      ]);
      return { data: { matchingCount, unassignedCount, assignedCount } };
    }

    const [matchingCount, unassignedCount, assignedCount] = await Promise.all([
      this.prisma.serviceUser.count({ where: target.where }),
      this.prisma.serviceUser.count({ where: { ...target.where, ...unassignedField } }),
      this.prisma.serviceUser.count({ where: { ...target.where, ...assignedField } }),
    ]);
    return { data: { matchingCount, unassignedCount, assignedCount } };
  }

  async assignToMatching(
    userId: string,
    id: string,
    dto: AssignChargeCardMatchingDto,
    _meta?: RequestAuditMeta,
  ) {
    const card = await this.prisma.chargeCard.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw new NotFoundException('Charge card not found');
    const onlyUnassigned = dto.onlyUnassigned ?? true;
    const target = buildChargeCardBulkAssignTarget(card);
    if (target.entity === 'none') {
      return { message: 'This attach-to level cannot be bulk-assigned', data: { assignedCount: 0 } };
    }

    const where = { ...target.where } as Record<string, unknown>;
    if (onlyUnassigned) where.defaultChargeCardId = null;

    let assignedCount = 0;
    if (target.entity === 'funder') {
      const result = await this.prisma.funder.updateMany({
        where: where as Prisma.FunderWhereInput,
        data: { defaultChargeCardId: id, updatedById: userId },
      });
      assignedCount = result.count;
    } else if (target.entity === 'serviceUserFunding') {
      const result = await this.prisma.serviceUserFunding.updateMany({
        where: where as Prisma.ServiceUserFundingWhereInput,
        data: { defaultChargeCardId: id, updatedById: userId },
      });
      assignedCount = result.count;
    } else {
      const result = await this.prisma.serviceUser.updateMany({
        where: where as Prisma.ServiceUserWhereInput,
        data: { defaultChargeCardId: id, updatedById: userId },
      });
      assignedCount = result.count;
    }

    const label =
      target.entity === 'funder'
        ? 'funder'
        : target.entity === 'serviceUserFunding'
          ? 'funding contract'
          : 'service user';
    return {
      message: `Assigned charge card to ${assignedCount} ${label}${assignedCount === 1 ? '' : 's'}`,
      data: { assignedCount },
    };
  }

  async resolveForServiceUser(serviceUserId: string) {
    const serviceUser = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      include: {
        defaultChargeCard: { include: chargeCardListInclude },
        currentFunding: {
          include: {
            defaultChargeCard: { include: chargeCardListInclude },
            funder: {
              include: {
                defaultChargeCard: { include: chargeCardListInclude },
              },
            },
          },
        },
      },
    });
    if (!serviceUser) throw new NotFoundException('Service user not found');

    if (serviceUser.currentFunding?.defaultChargeCard) {
      return {
        data: {
          source: 'EXPLICIT_FUNDING' as const,
          chargeCard: serviceUser.currentFunding.defaultChargeCard,
          matchedLevel: null,
        },
      };
    }

    if (serviceUser.defaultChargeCard) {
      return {
        data: {
          source: 'EXPLICIT_SERVICE_USER' as const,
          chargeCard: serviceUser.defaultChargeCard,
          matchedLevel: null,
        },
      };
    }

    if (serviceUser.currentFunding?.funder?.defaultChargeCard) {
      return {
        data: {
          source: 'EXPLICIT_FUNDER' as const,
          chargeCard: serviceUser.currentFunding.funder.defaultChargeCard,
          matchedLevel: null,
        },
      };
    }

    const cards = await this.prisma.chargeCard.findMany({
      where: { deletedAt: null },
      include: chargeCardListInclude,
    });
    const matched = pickBestMatchingChargeCard(
      {
        serviceUserId: serviceUser.id,
        locationId: serviceUser.locationId,
        fundingId: serviceUser.currentFunding?.id ?? null,
        funderId: serviceUser.currentFunding?.funderId ?? null,
        packageName: serviceUser.currentFunding?.packageName ?? null,
        householdKey: null,
        serviceTypeKey: null,
      },
      cards,
    );

    if (!matched) {
      return {
        data: {
          source: 'NONE' as const,
          chargeCard: null,
          matchedLevel: null,
        },
      };
    }

    return {
      data: {
        source: 'MATCHED' as const,
        chargeCard: matched,
        matchedLevel: matched.assignmentLevel,
      },
    };
  }

  async remove(userId: string, id: string, _meta?: RequestAuditMeta) {
    const existing = await this.prisma.chargeCard.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Charge card not found');
    await this.prisma.chargeCard.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
    });
    return { message: 'Charge card deleted' };
  }
}
