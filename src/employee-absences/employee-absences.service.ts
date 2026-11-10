import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { resolveEnterpriseVisaMeta } from '../organisation-general-settings/employee-visa-catalog.constants';
import {
  MAX_PARENTAL_LEAVE_WEEKS,
  PARENTAL_LEAVE_TYPES,
} from './dto/employee-absence.dto';
import type {
  CreateEmployeeAbsenceDto,
  ListEmployeeAbsencesQueryDto,
  UpdateEmployeeAbsenceDto,
} from './dto/employee-absence.dto';

/** Continuous unauthorised working days that trigger a UKVI SMS report. */
const SMS_TRIGGER_CONTINUOUS_DAYS = 10;
/** Working days allowed to submit the SMS report after the trigger. */
const SMS_REPORT_WINDOW_WORKING_DAYS = 10;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Inclusive calendar-day span, e.g. 28 May 00:00 → 28 May 23:55 = 1. */
function inclusiveDaySpan(from: Date, to: Date): number {
  const diff = utcDateOnly(to).getTime() - utcDateOnly(from).getTime();
  return Math.max(1, Math.round(diff / 86_400_000) + 1);
}

/** Adds N working days (Mon–Fri) to a date. */
function addWorkingDays(start: Date, workingDays: number): Date {
  const d = utcDateOnly(start);
  let remaining = workingDays;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d;
}

function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Compliance items whose expiry is the person's permission to work in the UK. */
export const RIGHT_TO_WORK_EXPIRY_CODES = ['BIOMETRIC_CARD', 'EMPLOYEE_SHARE_CODE', 'HOME_OFFICE_LETTER', 'RIGHT_TO_WORK'];

/**
 * Visa / right-to-work expiry for an absence, from the employee's Right to Work compliance (the latest expiry
 * held), so it is not typed again on each absence. Older absences with a typed value keep it only when no
 * compliance expiry is recorded.
 */
export function rightToWorkExpiry(
  compliance: { expiryDate: Date | null }[],
  typedOnAbsence: string | null,
): { value: string | null; fromCompliance: boolean } {
  const latest = compliance
    .map((c) => c.expiryDate)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (latest) return { value: latest.toISOString().slice(0, 10), fromCompliance: true };
  return { value: typedOnAbsence?.trim() || null, fromCompliance: false };
}

const EMPLOYEE_INCLUDE = {
  employee: {
    select: {
      id: true,
      isActive: true,
      personalDetail: { select: { firstName: true, lastName: true } },
      employment: { select: { employeeNumber: true, visaTypeId: true } },
      complianceRecords: {
        where: { deletedAt: null, complianceType: { code: { in: RIGHT_TO_WORK_EXPIRY_CODES } } },
        select: { expiryDate: true },
      },
    },
  },
} satisfies Prisma.EmployeeAbsenceRecordInclude;

type AbsenceWithEmployee = Prisma.EmployeeAbsenceRecordGetPayload<{ include: typeof EMPLOYEE_INCLUDE }>;

@Injectable()
export class EmployeeAbsencesService {
  private readonly logger = new Logger(EmployeeAbsencesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly mail?: MailService,
  ) {}

  private serialize(record: AbsenceWithEmployee) {
    const firstName = record.employee.personalDetail?.firstName ?? '';
    const surname = record.employee.personalDetail?.lastName ?? '';
    const fullName = [firstName, surname].filter(Boolean).join(' ').trim() || 'Unknown';

    const visa = resolveEnterpriseVisaMeta(record.employee.employment?.visaTypeId);
    const sponsored = visa?.sponsored ?? false;
    const rtw = rightToWorkExpiry(record.employee.complianceRecords ?? [], record.visaRtwExpiry);

    const durationDays = inclusiveDaySpan(record.fromDateTime, record.toDateTime);
    const durationHours = round2(
      Math.max(0, record.toDateTime.getTime() - record.fromDateTime.getTime()) / 3_600_000,
    );

    const monthName = new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      timeZone: 'UTC',
    }).format(record.fromDateTime);
    const monthShort = new Intl.DateTimeFormat('en-GB', {
      month: 'short',
      timeZone: 'UTC',
    }).format(record.fromDateTime);
    const year = record.fromDateTime.getUTCFullYear();

    const continuousDays = record.continuousWorkingDaysAbsent ?? durationDays;
    const unauthorised = record.permissionStatus === 'Unauthorised';
    const smsTriggered =
      sponsored && (unauthorised || continuousDays >= SMS_TRIGGER_CONTINUOUS_DAYS);

    const smsTrigger = !sponsored
      ? 'No trigger identified'
      : smsTriggered
        ? unauthorised
          ? 'Unauthorised absence — report via SMS'
          : `Continuous absence ≥ ${SMS_TRIGGER_CONTINUOUS_DAYS} working days — report via SMS`
        : 'No trigger identified';
    const smsDeadline = smsTriggered
      ? isoDate(addWorkingDays(record.toDateTime, SMS_REPORT_WINDOW_WORKING_DAYS))
      : null;

    const riskRating = !sponsored
      ? 'Not sponsored'
      : smsTriggered
        ? record.smsReported
          ? 'MEDIUM - trigger reported'
          : 'HIGH - SMS report required'
        : 'LOW - no SMS trigger';
    const ukviActionRequired = !sponsored
      ? 'No UKVI sponsor action needed for this row.'
      : smsTriggered
        ? record.smsReported
          ? 'Reported via SMS — retain evidence and monitor.'
          : `Report via SMS within ${SMS_REPORT_WINDOW_WORKING_DAYS} working days and retain evidence.`
        : 'Keep evidence on HR file and close review.';

    return {
      id: record.id,
      recordId: `ABS-${String(record.recordNo).padStart(4, '0')}`,
      recordNo: record.recordNo,
      employeeId: record.employeeId,
      holidayId: record.holidayId,
      employeeActive: record.employee.isActive,
      workerNumber: record.employee.employment?.employeeNumber ?? null,
      firstName,
      surname,
      employeeName: fullName,
      absenceType: record.absenceType,
      fromDateTime: record.fromDateTime.toISOString(),
      toDateTime: record.toDateTime.toISOString(),
      durationDays,
      durationHours,
      month: monthName,
      year,
      monthYear: `${monthShort}-${year}`,
      monthKey: `${year}-${String(record.fromDateTime.getUTCMonth() + 1).padStart(2, '0')}`,
      sicknessFlag: record.sicknessFlag,
      lastMinuteFlag: record.lastMinuteFlag,
      notes: record.notes,
      countryVisited: record.countryVisited,
      trackerStatus: record.trackerStatus,
      returnToWorkCompleted: record.returnToWorkCompleted,
      evidenceNotesStatus: record.evidenceNotesStatus,
      managerAction: record.managerAction,
      comments: record.comments,
      sponsored,
      immigrationLabel: visa?.label ?? null,
      cosWorkerRef: record.cosWorkerRef,
      // From Right to Work compliance (not typed per absence).
      visaRtwExpiry: rtw.value,
      visaRtwExpiryFromCompliance: rtw.fromCompliance,
      permissionStatus: record.permissionStatus,
      evidenceTypeRequired: record.evidenceTypeRequired,
      evidenceHeld: record.evidenceHeld,
      evidenceReceivedDate: isoDate(record.evidenceReceivedDate),
      continuousWorkingDaysAbsent: continuousDays,
      continuousDaysOverridden: record.continuousWorkingDaysAbsent != null,
      smsTrigger,
      smsTriggered,
      smsDeadline,
      smsReported: record.smsReported,
      smsReportDate: isoDate(record.smsReportDate),
      riskRating,
      ukviActionRequired,
      responsiblePerson: record.responsiblePerson,
      nextReviewDate: isoDate(record.nextReviewDate),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async list(query: ListEmployeeAbsencesQueryDto) {
    const where: Prisma.EmployeeAbsenceRecordWhereInput = { deletedAt: null };
    if (query.month) {
      const [y, m] = query.month.split('-').map(Number);
      where.fromDateTime = {
        gte: new Date(Date.UTC(y!, m! - 1, 1)),
        lte: new Date(Date.UTC(y!, m!, 0, 23, 59, 59, 999)),
      };
    }
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.locationId) {
      where.employee = {
        employment: {
          OR: [
            { accessAllZones: true },
            { locationId: query.locationId },
            { floorLocations: { some: { locationId: query.locationId } } },
          ],
        },
      };
    }
    if (query.absenceType) where.absenceType = query.absenceType;
    if (query.permissionStatus) where.permissionStatus = query.permissionStatus;
    if (query.sicknessOnly) where.sicknessFlag = true;
    if (query.lastMinuteOnly) where.lastMinuteFlag = true;

    const records = await this.prisma.employeeAbsenceRecord.findMany({
      where,
      include: EMPLOYEE_INCLUDE,
      orderBy: [{ fromDateTime: 'desc' }, { recordNo: 'desc' }],
      take: 2000,
    });

    let rows = records.map((r) => this.serialize(r));

    const search = query.search?.trim().toLowerCase() ?? '';
    if (search) {
      rows = rows.filter(
        (r) =>
          r.employeeName.toLowerCase().includes(search) ||
          r.recordId.toLowerCase().includes(search) ||
          (r.notes?.toLowerCase().includes(search) ?? false) ||
          (r.cosWorkerRef?.toLowerCase().includes(search) ?? false),
      );
    }
    if (query.sponsoredOnly) rows = rows.filter((r) => r.sponsored);
    if (query.smsTriggerOnly) rows = rows.filter((r) => r.smsTriggered);

    const totals = rows.reduce(
      (acc, r) => {
        acc.durationDays += r.durationDays;
        acc.durationHours += r.durationHours;
        if (r.sicknessFlag) acc.sicknessCount += 1;
        if (r.lastMinuteFlag) acc.lastMinuteCount += 1;
        if (r.permissionStatus === 'Unauthorised') acc.unauthorisedCount += 1;
        if (r.smsTriggered) acc.smsTriggerCount += 1;
        if (r.sponsored) acc.sponsoredCount += 1;
        return acc;
      },
      {
        durationDays: 0,
        durationHours: 0,
        sicknessCount: 0,
        lastMinuteCount: 0,
        unauthorisedCount: 0,
        smsTriggerCount: 0,
        sponsoredCount: 0,
      },
    );

    return {
      data: {
        recordCount: rows.length,
        totals: {
          durationDays: totals.durationDays,
          durationHours: round2(totals.durationHours),
          sicknessCount: totals.sicknessCount,
          lastMinuteCount: totals.lastMinuteCount,
          unauthorisedCount: totals.unauthorisedCount,
          smsTriggerCount: totals.smsTriggerCount,
          sponsoredCount: totals.sponsoredCount,
        },
        rows,
      },
    };
  }

  private static parseSpan(fromIso: string, toIso: string): { from: Date; to: Date } {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('toDateTime must be after fromDateTime');
    }
    return { from, to };
  }

  /** Maternity/Paternity leave cannot be approved for longer than the statutory cap. */
  private static enforceParentalLeaveCap(absenceType: string, from: Date, to: Date): void {
    if (!(PARENTAL_LEAVE_TYPES as readonly string[]).includes(absenceType)) return;
    const maxMs = MAX_PARENTAL_LEAVE_WEEKS * 7 * 86_400_000;
    if (to.getTime() - from.getTime() > maxMs) {
      throw new BadRequestException(
        `${absenceType} leave cannot exceed ${MAX_PARENTAL_LEAVE_WEEKS} weeks.`,
      );
    }
  }

  private static optionalDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined;
    return value ? new Date(value) : null;
  }

  async create(userId: string, dto: CreateEmployeeAbsenceDto) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, deletedAt: null },
      select: {
        id: true,
        personalDetail: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const { from, to } = EmployeeAbsencesService.parseSpan(dto.fromDateTime, dto.toDateTime);
    EmployeeAbsencesService.enforceParentalLeaveCap(dto.absenceType, from, to);

    const record = await this.prisma.employeeAbsenceRecord.create({
      data: {
        employeeId: dto.employeeId,
        absenceType: dto.absenceType,
        fromDateTime: from,
        toDateTime: to,
        sicknessFlag: dto.sicknessFlag ?? dto.absenceType === 'Sickness',
        lastMinuteFlag: dto.lastMinuteFlag ?? false,
        notes: dto.notes?.trim() || null,
        countryVisited: dto.countryVisited?.trim() || null,
        trackerStatus: dto.trackerStatus?.trim() || null,
        returnToWorkCompleted: dto.returnToWorkCompleted ?? false,
        evidenceNotesStatus: dto.evidenceNotesStatus?.trim() || null,
        managerAction: dto.managerAction?.trim() || 'No action unless required',
        comments: dto.comments?.trim() || null,
        cosWorkerRef: dto.cosWorkerRef?.trim() || null,
        // Right-to-work expiry comes from compliance; it is no longer typed per absence.
        visaRtwExpiry: null,
        permissionStatus: dto.permissionStatus ?? 'Authorised',
        evidenceTypeRequired: dto.evidenceTypeRequired?.trim() || null,
        evidenceHeld: dto.evidenceHeld ?? false,
        evidenceReceivedDate: EmployeeAbsencesService.optionalDate(dto.evidenceReceivedDate) ?? null,
        continuousWorkingDaysAbsent: dto.continuousWorkingDaysAbsent ?? null,
        smsReported: dto.smsReported ?? null,
        smsReportDate: EmployeeAbsencesService.optionalDate(dto.smsReportDate) ?? null,
        responsiblePerson: dto.responsiblePerson?.trim() || 'HR / Compliance',
        nextReviewDate: EmployeeAbsencesService.optionalDate(dto.nextReviewDate) ?? null,
        createdById: userId,
        updatedById: userId,
      },
      include: EMPLOYEE_INCLUDE,
    });

    if (dto.notifyByEmail) {
      await this.notifyCarerByEmail(employee.personalDetail, dto.absenceType, from, to, dto.notes);
    }

    return { data: this.serialize(record) };
  }

  /** Best-effort email to the carer that an absence was recorded. Never fails the create. */
  private async notifyCarerByEmail(
    personalDetail:
      | { firstName: string; lastName: string; email: string | null }
      | null,
    absenceType: string,
    from: Date,
    to: Date,
    notes?: string | null,
  ): Promise<void> {
    if (!this.mail) {
      this.logger.warn('notifyByEmail requested but mail is not configured.');
      return;
    }
    const email = personalDetail?.email?.trim();
    if (!email) {
      this.logger.warn('notifyByEmail requested but the carer has no email on file.');
      return;
    }
    const name =
      [personalDetail?.firstName, personalDetail?.lastName].filter(Boolean).join(' ').trim() ||
      'there';
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(d);
    const text =
      `Hi ${name},\n\n` +
      `An absence has been recorded on your profile:\n` +
      `- Type: ${absenceType}\n` +
      `- From: ${fmt(from)}\n` +
      `- To: ${fmt(to)}\n` +
      (notes?.trim() ? `- Notes: ${notes.trim()}\n` : '') +
      `\nIf anything looks wrong, please contact your manager.\n`;
    try {
      await this.mail.send({ to: email, subject: `Absence recorded: ${absenceType}`, text });
    } catch (e) {
      this.logger.warn(
        `Failed to send absence notification: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async update(userId: string, id: string, dto: UpdateEmployeeAbsenceDto) {
    const existing = await this.prisma.employeeAbsenceRecord.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Absence record not found');

    // Holiday-linked records mirror the booking; the span/type must be changed on the holiday.
    if (existing.holidayId) {
      const spanChanged =
        (dto.fromDateTime != null &&
          new Date(dto.fromDateTime).getTime() !== existing.fromDateTime.getTime()) ||
        (dto.toDateTime != null &&
          new Date(dto.toDateTime).getTime() !== existing.toDateTime.getTime());
      const typeChanged = dto.absenceType != null && dto.absenceType !== existing.absenceType;
      if (spanChanged || typeChanged) {
        throw new BadRequestException(
          'This record is linked to a holiday booking. Change the dates on the holiday record instead; compliance fields can still be edited here.',
        );
      }
    }

    const fromIso = dto.fromDateTime ?? existing.fromDateTime.toISOString();
    const toIso = dto.toDateTime ?? existing.toDateTime.toISOString();
    const { from, to } = EmployeeAbsencesService.parseSpan(fromIso, toIso);
    EmployeeAbsencesService.enforceParentalLeaveCap(
      dto.absenceType ?? existing.absenceType,
      from,
      to,
    );

    const data: Prisma.EmployeeAbsenceRecordUncheckedUpdateInput = {
      fromDateTime: from,
      toDateTime: to,
      updatedById: userId,
    };
    if (dto.absenceType !== undefined) data.absenceType = dto.absenceType;
    if (dto.sicknessFlag !== undefined) data.sicknessFlag = dto.sicknessFlag;
    if (dto.lastMinuteFlag !== undefined) data.lastMinuteFlag = dto.lastMinuteFlag;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (dto.countryVisited !== undefined) data.countryVisited = dto.countryVisited?.trim() || null;
    if (dto.trackerStatus !== undefined) data.trackerStatus = dto.trackerStatus?.trim() || null;
    if (dto.returnToWorkCompleted !== undefined) {
      data.returnToWorkCompleted = dto.returnToWorkCompleted;
    }
    if (dto.evidenceNotesStatus !== undefined) {
      data.evidenceNotesStatus = dto.evidenceNotesStatus?.trim() || null;
    }
    if (dto.managerAction !== undefined) data.managerAction = dto.managerAction?.trim() || null;
    if (dto.comments !== undefined) data.comments = dto.comments?.trim() || null;
    if (dto.cosWorkerRef !== undefined) data.cosWorkerRef = dto.cosWorkerRef?.trim() || null;
    if (dto.permissionStatus !== undefined) data.permissionStatus = dto.permissionStatus;
    if (dto.evidenceTypeRequired !== undefined) {
      data.evidenceTypeRequired = dto.evidenceTypeRequired?.trim() || null;
    }
    if (dto.evidenceHeld !== undefined) data.evidenceHeld = dto.evidenceHeld;
    if (dto.evidenceReceivedDate !== undefined) {
      data.evidenceReceivedDate = EmployeeAbsencesService.optionalDate(dto.evidenceReceivedDate);
    }
    if (dto.continuousWorkingDaysAbsent !== undefined) {
      data.continuousWorkingDaysAbsent = dto.continuousWorkingDaysAbsent;
    }
    if (dto.smsReported !== undefined) data.smsReported = dto.smsReported;
    if (dto.smsReportDate !== undefined) {
      data.smsReportDate = EmployeeAbsencesService.optionalDate(dto.smsReportDate);
    }
    if (dto.responsiblePerson !== undefined) {
      data.responsiblePerson = dto.responsiblePerson?.trim() || null;
    }
    if (dto.nextReviewDate !== undefined) {
      data.nextReviewDate = EmployeeAbsencesService.optionalDate(dto.nextReviewDate);
    }

    const record = await this.prisma.employeeAbsenceRecord.update({
      where: { id },
      data,
      include: EMPLOYEE_INCLUDE,
    });
    return { data: this.serialize(record) };
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.employeeAbsenceRecord.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Absence record not found');
    await this.prisma.employeeAbsenceRecord.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedById: userId },
    });
    return { data: { id, deleted: true } };
  }
}
