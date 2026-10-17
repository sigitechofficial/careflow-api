import { INCIDENT_LOCATION_LABELS } from '../incidents/incident-workflow.util';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataAccessType } from '@prisma/client';
import { existsSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  getOperationalTimeZone,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { EmployeeComplianceService } from '../employee-compliance/employee-compliance.service';
import { EmployeeAppSalaryService } from './employee-app-salary.service';
import { countLeaveDays, maskTail } from './employee-app-profile-leave.util';

const EMPLOYEE_DOCUMENTS_ROOT = join(process.cwd(), 'uploads', 'employees', 'documents');

function ymd(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function fullName(first?: string | null, last?: string | null): string | null {
  const name = [first, last].filter((p) => p && p.trim()).join(' ').trim();
  return name || null;
}

/**
 * Carer "My profile" — read-only view of everything the office holds about
 * the authenticated carer (personal, job, pay, leave, documents, compliance,
 * training). Always scoped to the JWT employeeId.
 */
@Injectable()
export class EmployeeAppProfileService {
  private readonly logger = new Logger(EmployeeAppProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly compliance: EmployeeComplianceService,
    private readonly salary: EmployeeAppSalaryService,
  ) {}

  async getMyProfile(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: {
        personalDetail: {
          include: { title: true, gender: true, nationality: true, status: true },
        },
        emergencyContacts: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        employment: {
          include: {
            role: true,
            jobTitle: true,
            grade: true,
            contractType: true,
            workArea: true,
            baseLocation: true,
            location: true,
            travelPaymentType: true,
          },
        },
        hrProfile: {
          include: {
            reportingManager: {
              select: { personalDetail: { select: { firstName: true, lastName: true } } },
            },
          },
        },
        portalAccount: { select: { email: true, lastLoginAt: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      select: {
        timezone: true,
        allowWeekendDaysInHoliday: true,
        defaultHolidaysUnit: true,
        appSettingBookHolidaysCareApp: true,
      },
    });

    const [documents, complianceSection, training, certifications, skills, reviews, patterns, leave, earnings] =
      await Promise.all([
        this.documents(employeeId),
        this.complianceSection(employeeId),
        this.training(employeeId),
        this.prisma.employeeWorkCertification.findMany({
          where: { employeeId, deletedAt: null },
          include: { certificationType: true },
          orderBy: { expiryDate: 'asc' },
        }),
        this.prisma.employeeSkill.findMany({
          where: { employeeId, deletedAt: null },
          include: { skillType: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.employeeReview.findMany({
          where: { employeeId, deletedAt: null },
          include: { reviewType: true },
          orderBy: { nextDue: 'asc' },
        }),
        this.prisma.employeeWorkingPattern.findMany({
          where: { employeeId, deletedAt: null },
          orderBy: [{ weekInCycle: 'asc' }, { dayOfWeek: 'asc' }],
        }),
        this.leave(employeeId, settings),
        this.earnings(employeeId),
      ]);

    const pd = employee.personalDetail;
    const emp = employee.employment;
    const hr = employee.hrProfile;
    const manager = hr?.reportingManager?.personalDetail;

    return {
      data: {
        employeeId,
        generatedAt: new Date().toISOString(),
        personal: {
          title: pd?.title?.name ?? null,
          firstName: pd?.firstName ?? null,
          lastName: pd?.lastName ?? null,
          preferredName: hr?.preferredName ?? null,
          legalName: hr?.legalName ?? null,
          gender: pd?.gender?.name ?? null,
          nationality: pd?.nationality?.name ?? null,
          dateOfBirth: ymd(pd?.dateOfBirth),
          email: pd?.email ?? employee.portalAccount?.email ?? null,
          mobile: pd?.mobileTelephone ?? null,
          homePhone: pd?.homeTelephone ?? null,
          photoUrl: pd?.photoUrl ?? null,
          address: {
            line1: pd?.addressLine1 ?? null,
            line2: pd?.addressLine2 ?? null,
            town: pd?.town ?? null,
            county: pd?.county ?? null,
            postcode: pd?.postcode ?? null,
            country: pd?.country ?? null,
          },
        },
        emergencyContacts: employee.emergencyContacts.map((c) => ({
          id: c.id,
          name: fullName(c.firstName, c.lastName),
          relationship: c.relationship,
          phone: c.phone,
        })),
        employment: {
          status: pd?.status?.name ?? null,
          lifecycleStatus: hr?.employeeLifecycleStatus ?? null,
          deploymentStatus: hr?.deploymentStatus ?? null,
          jobTitle: emp?.jobTitle?.name ?? null,
          role: emp?.role?.name ?? null,
          grade: emp?.grade?.name ?? null,
          contractType: emp?.contractType?.name ?? null,
          workArea: emp?.workArea?.name ?? null,
          branch: emp?.location?.name ?? emp?.baseLocation?.name ?? null,
          baseLocation: emp?.baseLocation?.name ?? null,
          team: hr?.branchTeam ?? null,
          reportingManager: fullName(manager?.firstName, manager?.lastName),
          startDate: ymd(emp?.startDate),
          endDate: ymd(emp?.endDate),
          employeeNumber: emp?.employeeNumber ?? null,
          payrollNumber: emp?.payrollNumber ?? null,
          nationalInsuranceMasked: maskTail(emp?.nationalInsuranceNo),
          nmcPinNumber: emp?.nmcPinNumber ?? null,
          contractedWeeklyHours: emp?.contractedWeeklyHours ?? null,
          minimumWeeklyHours: emp?.minimumWeeklyHours ?? null,
          maximumWeeklyHours: emp?.maximumWeeklyHours ?? null,
          optedOutOf48Hours: emp?.optedOutOf48Hours ?? false,
          travelPaymentType: emp?.travelPaymentType?.name ?? null,
          isBankStaff: emp?.isBankStaff ?? false,
          isAgencyStaff: emp?.isAgencyStaff ?? false,
          lastLoginAt: employee.portalAccount?.lastLoginAt?.toISOString() ?? null,
        },
        earnings,
        leave,
        documents,
        compliance: complianceSection,
        training,
        certifications: certifications.map((c) => ({
          id: c.id,
          name: c.certificationType?.name ?? 'Certificate',
          reference: c.reference,
          issueDate: ymd(c.issueDate),
          expiryDate: ymd(c.expiryDate),
          hasFile: Boolean(c.certificateUrl?.trim()),
        })),
        skills: skills.map((s) => ({
          id: s.id,
          name: s.skillType?.name ?? 'Skill',
          expiryDate: ymd(s.expiryDate),
          notes: s.notes,
        })),
        reviews: reviews.map((r) => ({
          id: r.id,
          name: r.reviewType?.name ?? 'Review',
          status: r.status,
          lastDone: ymd(r.lastDone),
          nextDue: ymd(r.nextDue),
        })),
        workingPattern: patterns.map((p) => ({
          weekInCycle: p.weekInCycle,
          dayOfWeek: p.dayOfWeek,
          isAvailable: p.isAvailable,
          startTime: p.startTime,
          endTime: p.endTime,
        })),
        workingPatternCycleWeeks: emp?.workingPatternCycleWeeks ?? 1,
      },
    };
  }

  private async documents(employeeId: string) {
    const rows = await this.prisma.employeeDocument.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: { uploadedDate: 'desc' },
    });
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      documentType: d.documentType,
      status: d.status,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
      uploadedDate: d.uploadedDate.toISOString(),
      expiryDate: ymd(d.expiryDate),
    }));
  }

  private async complianceSection(employeeId: string) {
    const [checklist, all] = await Promise.all([
      this.compliance.getChecklist(employeeId),
      this.compliance.list(employeeId),
    ]);
    type Row = (typeof all.data)[number];
    const mapRecord = (record: Row | null) => ({
      id: record?.id ?? null,
      status: record?.status ?? 'MISSING',
      issueDate: ymd(record?.issueDate),
      expiryDate: ymd(record?.expiryDate),
      rejectionReason: record?.rejectionReason ?? null,
      verifiedAt: record?.verifiedAt?.toISOString() ?? null,
      documents: (record?.documents ?? []).map((doc) => ({
        id: doc.id,
        name: doc.originalName,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        uploadedAt: doc.uploadedAt.toISOString(),
      })),
    });

    const seen = new Set<string>();
    const items = checklist.data.items.map((item) => {
      if (item.record?.id) seen.add(item.record.id);
      return {
        complianceTypeId: item.complianceTypeId,
        name: item.name,
        isMandatory: item.isMandatory,
        ...mapRecord(item.record as Row | null),
      };
    });
    for (const record of all.data) {
      if (seen.has(record.id) || record.status === 'NO_LONGER_REQUIRED') continue;
      items.push({
        complianceTypeId: record.complianceTypeId ?? '',
        name: record.complianceType?.name ?? 'Compliance item',
        isMandatory: false,
        ...mapRecord(record),
      });
    }
    return { items };
  }

  private async training(employeeId: string) {
    const rows = await this.prisma.learningComplianceSnapshot.findMany({
      where: { employeeId, complianceStatus: { not: 'NOT_ASSIGNED' } },
      include: { course: { select: { title: true, code: true } } },
      orderBy: [{ dueAt: 'asc' }, { expiresAt: 'asc' }],
    });
    return rows.map((r) => ({
      courseId: r.courseId,
      title: r.course?.title ?? 'Course',
      code: r.course?.code ?? null,
      status: r.complianceStatus,
      dueAt: ymd(r.dueAt),
      expiresAt: ymd(r.expiresAt),
    }));
  }

  private async leave(
    employeeId: string,
    settings: {
      timezone: string | null;
      allowWeekendDaysInHoliday: boolean;
      defaultHolidaysUnit: string;
      appSettingBookHolidaysCareApp: boolean;
    } | null,
  ) {
    const timeZone = getOperationalTimeZone(settings?.timezone);
    const todayYmd = operationalTodayIso(new Date(), timeZone);
    const year = todayYmd.slice(0, 4);
    const yearStartYmd = `${year}-01-01`;
    const yearEndYmd = `${year}-12-31`;
    // Pad the DB window by a day either side so tz shifts never drop a span.
    const windowFrom = new Date(`${Number(year) - 1}-12-31T00:00:00.000Z`);
    const windowTo = new Date(`${Number(year) + 1}-01-02T00:00:00.000Z`);
    const includeWeekends = settings?.allowWeekendDaysInHoliday ?? true;

    const [holidays, absences] = await Promise.all([
      this.prisma.employeeHoliday.findMany({
        where: {
          employeeId,
          deletedAt: null,
          startDate: { lte: windowTo },
          endDate: { gte: windowFrom },
        },
        orderBy: { startDate: 'asc' },
      }),
      this.prisma.employeeAbsenceRecord.findMany({
        where: {
          employeeId,
          deletedAt: null,
          holidayId: null,
          fromDateTime: { lte: windowTo },
          toDateTime: { gte: windowFrom },
        },
        orderBy: { fromDateTime: 'desc' },
      }),
    ]);

    const common = { todayYmd, yearStartYmd, yearEndYmd, timeZone };
    const holidayDays = countLeaveDays({
      ...common,
      includeWeekends,
      spans: holidays.map((h) => ({ from: h.startDate, to: h.endDate })),
    });
    const sickness = absences.filter((a) => a.sicknessFlag);
    const other = absences.filter((a) => !a.sicknessFlag);
    const sicknessDays = countLeaveDays({
      ...common,
      includeWeekends: true,
      spans: sickness.map((a) => ({ from: a.fromDateTime, to: a.toDateTime })),
    });
    const otherDays = countLeaveDays({
      ...common,
      includeWeekends: true,
      spans: other.map((a) => ({ from: a.fromDateTime, to: a.toDateTime })),
    });

    return {
      year: Number(year),
      unit: settings?.defaultHolidaysUnit ?? 'DAYS',
      weekendsCount: includeWeekends,
      canBookInApp: settings?.appSettingBookHolidaysCareApp ?? false,
      /** No annual entitlement is stored yet, so remaining balance is unknown. */
      entitlementDays: null as number | null,
      remainingDays: null as number | null,
      holidayTakenDays: holidayDays.taken,
      holidayBookedDays: holidayDays.upcoming,
      sicknessDays: sicknessDays.taken + sicknessDays.upcoming,
      otherAbsenceDays: otherDays.taken + otherDays.upcoming,
      holidays: holidays.map((h) => ({
        id: h.id,
        startDate: ymd(h.startDate),
        endDate: ymd(h.endDate),
        notes: h.notes,
        isUpcoming: (ymd(h.endDate) ?? '') >= todayYmd,
      })),
      absences: absences.map((a) => ({
        id: a.id,
        type: a.absenceType,
        isSickness: a.sicknessFlag,
        fromDate: ymd(a.fromDateTime),
        toDate: ymd(a.toDateTime),
        permissionStatus: a.permissionStatus,
        returnToWorkCompleted: a.returnToWorkCompleted,
      })),
    };
  }

  private async earnings(employeeId: string) {
    try {
      const res = await this.salary.getMySalary(employeeId, {});
      const d = res.data;
      return {
        period: d.period,
        periodLabel: d.periodLabel,
        basis: d.basis,
        currency: d.currency,
        netSalaryAmount: d.summary.netSalaryAmount,
        salaryAmount: d.summary.salaryAmount,
        deductionsTotal: d.summary.deductionsTotal,
        salaryVisitCount: d.summary.salaryVisitCount,
        pendingReviewCount: d.summary.pendingReviewCount,
        payCardName: d.payCard?.name ?? null,
      };
    } catch (err) {
      this.logger.warn(`Profile earnings unavailable for ${employeeId}: ${String(err)}`);
      return null;
    }
  }

  /**
   * Incidents this carer reported (Me → My alerts). Read-only status view:
   * reference, category, severity, status and who it was about — no review,
   * investigation or outcome details.
   */
  async getMyIncidents(employeeId: string) {
    const rows = await this.prisma.incident.findMany({
      where: { reporterEmployeeId: employeeId, deletedAt: null },
      orderBy: { reportedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        referenceNumber: true,
        status: true,
        severity: true,
        occurredAt: true,
        reportedAt: true,
        closedAt: true,
        primaryServiceUserId: true,
        primaryPersonName: true,
        description: true,
        createdById: true,
        locationKey: true,
        locationDetail: true,
        specificArea: true,
        category: { select: { label: true } },
        subtype: { select: { label: true } },
      },
    });

    const suIds = [...new Set(rows.map((r) => r.primaryServiceUserId).filter((v): v is string => !!v))];
    const serviceUsers = suIds.length
      ? await this.prisma.serviceUser.findMany({
          where: { id: { in: suIds } },
          select: { id: true, firstName: true, lastName: true, preferredName: true },
        })
      : [];
    const suName = new Map(
      serviceUsers.map((su) => [su.id, fullName(su.preferredName ?? su.firstName, su.lastName)]),
    );

    return {
      data: {
        items: rows.map((r) => ({
          id: r.id,
          reference: r.referenceNumber,
          category: r.category?.label ?? null,
          subtype: r.subtype?.label ?? null,
          severity: r.severity,
          status: r.status,
          aboutName:
            (r.primaryServiceUserId ? suName.get(r.primaryServiceUserId) : null) ??
            r.primaryPersonName ??
            null,
          summary: r.description.length > 140 ? `${r.description.slice(0, 137)}…` : r.description,
          // What the carer reported (read-only) — never the office's review or investigation.
          description: r.description,
          where:
            [
              r.locationKey === 'OTHER'
                ? r.locationDetail
                : r.locationKey
                  ? INCIDENT_LOCATION_LABELS[r.locationKey as keyof typeof INCIDENT_LOCATION_LABELS]
                  : null,
              r.specificArea,
            ]
              .filter(Boolean)
              .join(' · ') || null,
          // The office keyed it in for the carer (phone call, app down…).
          recordedByOffice: Boolean(r.createdById),
          occurredAt: r.occurredAt.toISOString(),
          reportedAt: r.reportedAt.toISOString(),
          closedAt: r.closedAt?.toISOString() ?? null,
        })),
      },
    };
  }

  /** Own HR document (Documents tab in admin). Returns absolute path + names. */
  async getMyDocumentFile(employeeId: string, documentId: string, meta?: RequestAuditMeta) {
    const doc = await this.prisma.employeeDocument.findFirst({
      where: { id: documentId, employeeId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const abs = join(EMPLOYEE_DOCUMENTS_ROOT, doc.fileName);
    if (!existsSync(abs)) throw new NotFoundException('File not found on disk');
    await this.logDownload('EmployeeDocument', AuditModule.EMPLOYEE_DOCUMENT, documentId, employeeId, meta);
    return { path: abs, name: doc.name || doc.fileName, mimeType: doc.mimeType };
  }

  /** Own compliance evidence file (DBS, right to work, etc.). */
  async getMyComplianceDocumentFile(employeeId: string, documentId: string, meta?: RequestAuditMeta) {
    const doc = await this.prisma.employeeComplianceDocument.findFirst({
      where: {
        id: documentId,
        deletedAt: null,
        employeeCompliance: { employeeId, deletedAt: null },
      },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const rel = doc.fileUrl.startsWith('/uploads/')
      ? doc.fileUrl.replace('/uploads/', '')
      : doc.fileUrl.replace(/^\//, '');
    const abs = join(process.cwd(), 'uploads', rel);
    if (!existsSync(abs)) throw new NotFoundException('File not found on disk');
    await this.logDownload(
      'EmployeeComplianceDocument',
      AuditModule.EMPLOYEE_COMPLIANCE,
      documentId,
      employeeId,
      meta,
    );
    return { path: abs, name: doc.originalName, mimeType: doc.mimeType };
  }

  private async logDownload(
    recordType: string,
    module: AuditModule,
    recordId: string,
    employeeId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.audit.logDataAccess({
      userId: undefined,
      module,
      recordType,
      recordId,
      accessType: DataAccessType.DOWNLOAD,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
      metadata: { employeeId, channel: 'employee_app' },
    });
  }
}
