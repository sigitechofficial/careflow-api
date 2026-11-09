import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
import { carerPhotoConsent, carerSharingNotes, communicationNeedsWords } from '../service-user-privacy/service-user-privacy.util';
import {
  prnLimitLabels,
  prnLimitsFromMedication,
} from '../medications/medication-prn-limits.util';
import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { carerAuthorityCards } from '../service-user-documents/legal-authority-coverage.util';
import {
  AllocationStatus,
  InitialAssessmentStatus,
  InitialAssessmentRiskStatus,
  InitialAssessmentRiskType,
  MedicationKind,
  MedicationPackStatus,
  MedicationRecordStatus,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  ServiceUserDocumentAccessLevel,
  ServiceUserDocumentRecordStatus,
  ServiceUserMedicalConditionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  formatHmInTimeZone,
  hourInTimeZone,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { formatUkDateLabel } from '../common/utils/uk-date-label.util';
import { plannedHowAssistedLabel } from './medication/employee-app-visit-medication-round.util';
import { EmployeeAppClientsService } from './employee-app-clients.service';
import { employeeAppAccessPayload } from './employee-app-access.util';
import {
  gpAsContact,
  gpContactAsContact,
  isGpContact,
  mapProfileCommunication,
  mapProfileContact,
  mapProfileGp,
  profileRiskLabel,
} from './employee-app-client-profile.util';
import { buildVisitTaskProgressByJobId } from './visit-task-progress.util';
import { computeCarePlanReviewState } from '../service-user-care-plans/care-plan-review-schedule';
import { sanitizeComposeTextOrNull } from '../service-user-care-plans/compose/compose-html-sanitize.util';
import { mapPublishedCarePlanForCarer } from './employee-app-care-plan-detail.util';
import { resolveCprStatus, loadCprIaReport } from './employee-app-cpr-status.util';
import { CARER_VISIBLE_RISK_WHERE, withoutUnreviewedIaRows } from './employee-app-ia-source.util';
import {
  loadVisitTaskPlacement,
} from '../visit-tasks/visit-task-window.util';

const ACTIVE_ALLOCATION: AllocationStatus[] = [
  AllocationStatus.PENDING_CONFIRMATION,
  AllocationStatus.ALLOCATED,
  AllocationStatus.CONFIRMED,
];

const EXCLUDED_JOB_STATUSES: ScheduledJobStatus[] = [
  ScheduledJobStatus.CANCELLED,
  ScheduledJobStatus.CALLED_OFF,
  ScheduledJobStatus.DRAFT,
];

type Tone = 'danger' | 'warning' | 'primary' | 'success' | 'neutral';


@Injectable()
export class EmployeeAppClientDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientsService: EmployeeAppClientsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    @Optional() private readonly audit?: AuditLogsService,
  ) {}

  async getProfile(employeeId: string, clientId: string, dateParam?: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const date = dateParam?.trim() || operationalTodayIso(new Date(), timeZone);
    const { start, end } = operationalDayBounds(date, timeZone);

    const su = await this.loadClientOrThrow(clientId);
    const [
      allergies,
      legal,
      openRisks,
      todayJobs,
      carePlans,
      ia,
      asRef,
      nokContacts,
      gpPack,
      medicalConditions,
      reasonableAdjustments,
      medicalAlerts,
    ] = await Promise.all([
      this.prisma.serviceUserAllergy.findMany({
        where: { serviceUserId: clientId, deletedAt: null, isActive: true },
        select: { id: true, allergyName: true },
        orderBy: { allergyName: 'asc' },
      }),
      this.prisma.serviceUserLegalDocument.findUnique({
        where: { serviceUserId: clientId },
        select: {
          dnacprInPlace: true,
          dnacprStatusConfirmation: true,
          dnacprPhysicalLocation: true,
          dnacprCertificateUrl: true,
        },
      }),
      this.prisma.initialAssessmentRiskRecord.findMany({
        where: {
          serviceUserId: clientId,
          status: InitialAssessmentRiskStatus.OPEN,
          ...CARER_VISIBLE_RISK_WHERE,
          riskType: {
            in: [
              InitialAssessmentRiskType.FALLS,
              InitialAssessmentRiskType.HYDRATION,
              InitialAssessmentRiskType.SKIN_INTEGRITY,
              InitialAssessmentRiskType.MOVING_HANDLING,
            ],
          },
        },
        select: { riskType: true },
      }),
      this.prisma.jobAllocation.findMany({
        where: {
          employeeId,
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
          scheduledJob: {
            serviceUserId: clientId,
            deletedAt: null,
            isActive: true,
            scheduledStartDateTime: { gte: start, lte: end },
            status: { notIn: EXCLUDED_JOB_STATUSES },
          },
        },
        orderBy: { scheduledJob: { scheduledStartDateTime: 'asc' } },
        include: {
          scheduledJob: {
            include: {
              visits: {
                where: { deletedAt: null, isActive: true },
                orderBy: { scheduledStartDateTime: 'asc' },
                select: {
                  id: true,
                  visitName: true,
                  status: true,
                  scheduledStartDateTime: true,
                  scheduledEndDateTime: true,
                  visitPlanSlot: {
                    select: { slotCode: true, medicationRoundCode: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.serviceUserCarePlanInstance.findMany({
        // Suspended / archived plans are not current instructions for carers.
        where: { serviceUserId: clientId, lifecycleStatus: 'ACTIVE' },
        take: 8,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          status: true,
          nextReviewDueAt: true,
          carePathwayForm: { select: { id: true, name: true } },
          publishedVersions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            select: { versionNumber: true, summary: true, publishedAt: true, valuesJson: true },
          },
        },
      }),
      this.prisma.serviceUserInitialAssessment.findFirst({
        where: { serviceUserId: clientId, deletedAt: null },
        select: { previousMedicalHistory: true, careInstructions: true },
      }),
      this.prisma.serviceUserReference.findFirst({
        where: {
          serviceUserId: clientId,
          deletedAt: null,
          referenceType: { equals: 'AS_NUMBER', mode: 'insensitive' },
        },
        select: { referenceValue: true },
      }),
      this.prisma.serviceUserContact.findMany({
        where: { serviceUserId: clientId, deletedAt: null, isActive: true },
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          mobile: true,
          address: true,
          isPrimary: true,
          isEmergencyContact: true,
          relationshipType: { select: { name: true, code: true } },
        },
        orderBy: [{ isEmergencyContact: 'desc' }, { isPrimary: 'desc' }, { firstName: 'asc' }],
        take: 8,
      }),
      this.prisma.medicationPack.findFirst({
        where: {
          serviceUserId: clientId,
          deletedAt: null,
          status: { in: [MedicationPackStatus.ACTIVE, MedicationPackStatus.DRAFT] },
          OR: [{ gpName: { not: '' } }, { gpSurgery: { not: '' } }],
        },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        select: { gpName: true, gpSurgery: true },
      }),
      this.prisma.serviceUserMedicalCondition.findMany({
        where: {
          serviceUserId: clientId,
          deletedAt: null,
          isActive: true,
          status: ServiceUserMedicalConditionStatus.ACTIVE,
        },
        select: {
          id: true,
          notes: true,
          sourceSubmissionId: true,
          condition: { select: { code: true, name: true, category: true } },
        },
        orderBy: { condition: { name: 'asc' } },
      }).then((rows) => withoutUnreviewedIaRows(this.prisma, rows)),
      this.prisma.serviceUserReasonableAdjustment.findMany({
        where: { serviceUserId: clientId, deletedAt: null, isActive: true },
        select: { id: true, type: true, description: true, notes: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.serviceUserMedicalAlert.findMany({
        where: {
          serviceUserId: clientId,
          deletedAt: null,
          isActive: true,
        },
        select: {
          id: true,
          title: true,
          category: true,
          severity: true,
          description: true,
          actionForCarer: true,
          notes: true,
        },
        orderBy: [{ severity: 'asc' }, { updatedAt: 'desc' }],
      }),
    ]);

    const allergyNames = allergies.map((a) => a.allergyName.trim()).filter(Boolean);
    const age = ageFromDob(su.dateOfBirth);
    const fullName = displayName(su.firstName, su.lastName);
    const preferredName = su.preferredName?.trim() || null;
    const cpr = resolveCprStatus(legal, await loadCprIaReport(this.prisma, clientId));
    const dnacprLocation = cpr.location;
    const historyText = `${ia?.previousMedicalHistory ?? ''} ${ia?.careInstructions ?? ''}`.toLowerCase();
    const conditions: Array<{ id: string; label: string }> = [];
    if (/diabet/.test(historyText) || carePlans.some((p) => /diabet/i.test(p.carePathwayForm.name))) {
      conditions.push({ id: 'diabetes', label: 'Diabetes' });
    }
    if (/dement/.test(historyText) || carePlans.some((p) => /dement/i.test(p.carePathwayForm.name))) {
      conditions.push({ id: 'early_dementia', label: 'Early dementia' });
    }
    const seenRisks = new Set<InitialAssessmentRiskType>();
    for (const risk of openRisks) {
      if (seenRisks.has(risk.riskType)) continue;
      seenRisks.add(risk.riskType);
      conditions.push({ id: risk.riskType.toLowerCase(), label: profileRiskLabel(risk.riskType) });
    }
    const communication = mapProfileCommunication(ia?.careInstructions);
    // Profile → Privacy: how they need information, and who carers may (or must not) tell what.
    const [needsRow, sharingRows, photoConsentRow] = await Promise.all([
      this.prisma.serviceUserCommunicationNeeds.findUnique({
        where: { serviceUserId: clientId },
        select: {
          interpreterNeeded: true,
          interpreterLanguage: true,
          formats: true,
          hearing: true,
          sight: true,
          notes: true,
          contactVia: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.serviceUserSharingAgreement.findMany({
        where: { serviceUserId: clientId, deletedAt: null },
        select: { recipientName: true, recipientRole: true, contactId: true, categories: true, conditions: true, startsOn: true, endsOn: true, stoppedAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.serviceUserConsentChange.findFirst({
        where: { serviceUserId: clientId, topic: 'PHOTOGRAPHY' },
        select: { answer: true, details: true, decidedOn: true },
        orderBy: [{ decidedOn: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);
    const photoConsent = carerPhotoConsent(photoConsentRow);
    const informationNeeds = needsRow
      ? {
          summary: communicationNeedsWords({
            ...needsRow,
            contactViaName: needsRow.contactVia ? [needsRow.contactVia.firstName, needsRow.contactVia.lastName].filter(Boolean).join(' ') : null,
          }),
          hearing: needsRow.hearing || null,
          sight: needsRow.sight || null,
          notes: needsRow.notes || null,
        }
      : null;
    const sharingNotes = carerSharingNotes(sharingRows, dayKeyInTimeZone(new Date(), timeZone));
    // The GP on Contacts is the person's GP. The medicine pack's GP (what the pharmacy printed) is only used
    // when no GP has been added to Contacts.
    const hasGpContact = nokContacts.some(isGpContact);
    const gp = hasGpContact ? null : mapProfileGp(gpPack);
    const contacts = [
      ...nokContacts.map((c) => (isGpContact(c) ? gpContactAsContact(c) : mapProfileContact(c))),
      ...(gp ? [gpAsContact(gp)] : []),
    ];

    const jobs = todayJobs.map((a) => a.scheduledJob);
    const taskProgress = await this.loadTaskProgress(jobs, timeZone);
    const todayVisits = jobs.map((job) => {
      const visit = job.visits[0] ?? null;
      const startAt = visit?.scheduledStartDateTime ?? job.scheduledStartDateTime;
      const title = periodTitle(
        visit?.visitName ?? job.jobName,
        visit?.visitPlanSlot ?? null,
        startAt,
        timeZone,
      );
      const progress = taskProgress.get(job.id) ?? { completed: 0, total: 0 };
      return {
        visitId: visit?.id ?? job.id,
        jobId: job.id,
        title,
        iconType: iconForPeriod(title),
        scheduledStart: formatHmInTimeZone(startAt, timeZone),
        scheduledEnd: visit?.scheduledEndDateTime
          ? formatHmInTimeZone(visit.scheduledEndDateTime, timeZone)
          : null,
        tasksDone: progress.completed,
        tasksTotal: progress.total,
        taskProgressLabel: `${progress.completed}/${progress.total}`,
        status: mapVisitStatus(job.status, visit?.status ?? null),
      };
    });

    const carePlanEssentials = carePlans
      .map((plan) => {
        const pub = plan.publishedVersions[0];
        if (!pub) return null;
        const summary =
          (typeof pub.summary === 'string' && pub.summary.trim()) ||
          extractCarePlanBlurb(pub.valuesJson) ||
          null;
        return {
          id: plan.id,
          carePathwayFormId: plan.carePathwayForm.id,
          title: plan.carePathwayForm.name,
          description: summary,
          iconType: iconForCarePlan(plan.carePathwayForm.name),
          versionNumber: pub.versionNumber,
          nextReviewDueAt: plan.nextReviewDueAt?.toISOString() ?? null,
        };
      })
      .filter(Boolean);

    return {
      data: {
        client: {
          clientId: su.id,
          fullName,
          firstName: su.firstName,
          lastName: su.lastName,
          preferredName,
          initials: initialsFromName(su.firstName, su.lastName),
          age,
          nhsNumber: su.nhsNumber,
          nhsNumberLabel: su.nhsNumber ? `NHS ${su.nhsNumber}` : null,
          asNumber: asRef?.referenceValue ?? su.socialServicesRef ?? null,
          subtitle: [
            preferredName && preferredName !== fullName ? fullName : null,
            age != null ? `${age} yrs` : null,
            su.nhsNumber ? `NHS ${su.nhsNumber}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          careType: su.careType
            ? { id: su.careType.id, name: su.careType.name, code: su.careType.code }
            : null,
        },
        allergies: {
          label: 'ALLERGIES',
          tone: 'danger' as Tone,
          items: allergyNames,
        },
        safetyAtAGlance: {
          cprStatus: {
            id: cpr.id,
            label: cpr.label,
            tone: cpr.tone as Tone,
            location: dnacprLocation,
            actionLine: cpr.actionLine,
            verified: cpr.verified,
          },
          dnacprLocation,
          conditions,
        },
        todayVisits,
        carePlanEssentials,
        communication,
        /** Profile → Privacy: how they need information given (null when nothing is recorded). */
        informationNeeds,
        /** Who carers may tell what, and who not to share with (Profile → Privacy). */
        sharingNotes,
        /** Profile → Privacy → Consent record: their standing answer about photographs (null when not recorded). */
        photoConsent,
        contacts,
        gp,
        date,
        access: employeeAppAccessPayload(su.address),
        medicalConditions: medicalConditions
          .filter((c) => c.condition)
          .map((c) => ({
            name: c.condition!.name,
            category: c.condition!.category,
            notes: c.notes?.trim() || null,
          })),
        reasonableAdjustments: reasonableAdjustments.map((a) => ({
          type: a.type,
          description: a.description,
          notes: a.notes?.trim() || null,
        })),
        medicalAlerts: medicalAlerts.map((a) => ({
          id: a.id,
          title: a.title,
          category: a.category,
          severity: a.severity,
          description: a.description?.trim() || null,
          actionForCarer: a.actionForCarer?.trim() || null,
          notes: a.notes?.trim() || null,
        })),
      },
    };
  }

  async getDocuments(employeeId: string, clientId: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);
    const su = await this.loadClientOrThrow(clientId);

    const docs = await this.prisma.serviceUserDocumentRecord.findMany({
      where: {
        serviceUserId: clientId,
        deletedAt: null,
        isActive: true,
        status: { in: [ServiceUserDocumentRecordStatus.ACTIVE, ServiceUserDocumentRecordStatus.SUPERSEDED] },
        accessLevel: {
          in: [ServiceUserDocumentAccessLevel.CARER_SUMMARY, ServiceUserDocumentAccessLevel.ALL_USERS],
        },
      },
      orderBy: [{ documentDate: 'desc' }, { uploadedAt: 'desc' }],
      select: {
        id: true,
        title: true,
        documentDate: true,
        status: true,
        fileUrl: true,
        fileName: true,
        mimeType: true,
        documentType: { select: { code: true, name: true } },
      },
    });

    const legal = await this.prisma.serviceUserLegalDocument.findUnique({
      where: { serviceUserId: clientId },
      select: {
        dnacprCertificateUrl: true,
        dnacprInPlace: true,
        dnacprStartDate: true,
        lpaHealthCertificateUrl: true,
        lpaFinanceCertificateUrl: true,
        lpaStatusConfirmation: true,
      },
    });

    const documents = docs.map((d) => {
      const category = d.documentType.name;
      const warning =
        /respect|dnacpr|dna\s*cpr|emergency/i.test(d.title) ||
        /emergency/i.test(category);
      return {
        id: d.id,
        title: d.title,
        category,
        categoryCode: d.documentType.code,
        dateLabel: formatDisplayDate(d.documentDate),
        connectivityStatus: 'offline',
        subtitle: `${category} · ${formatDisplayDate(d.documentDate)} · offline`,
        iconType: iconForDocument(category, d.title),
        hasWarning: warning,
        viewUrl: d.fileUrl,
        downloadUrl: d.fileUrl,
        fileName: d.fileName,
        mimeType: d.mimeType,
      };
    });

    if (legal?.dnacprCertificateUrl) {
      documents.unshift({
        id: 'legal-dnacpr',
        title: 'ReSPECT / DNACPR',
        category: 'Emergency',
        categoryCode: 'emergency',
        dateLabel: legal.dnacprStartDate ? formatDisplayDate(legal.dnacprStartDate) : 'On file',
        connectivityStatus: 'offline',
        subtitle: `Emergency · ${
          legal.dnacprStartDate ? formatDisplayDate(legal.dnacprStartDate) : 'On file'
        } · offline`,
        iconType: 'emergency',
        hasWarning: true,
        viewUrl: legal.dnacprCertificateUrl,
        downloadUrl: legal.dnacprCertificateUrl,
        fileName: null,
        mimeType: null,
      });
    }

    return {
      data: {
        client: { clientId: su.id, fullName: displayName(su.firstName, su.lastName) },
        banner: {
          tone: 'success',
          message: 'These documents are cached for offline access at the point of care.',
        },
        documents,
      },
    };
  }

  async getMedications(employeeId: string, clientId: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);
    const su = await this.loadClientOrThrow(clientId);

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 7);

    const [allergies, medications, events] = await Promise.all([
      this.prisma.serviceUserAllergy.findMany({
        where: { serviceUserId: clientId, deletedAt: null, isActive: true },
        select: { allergyName: true },
        orderBy: { allergyName: 'asc' },
      }),
      this.prisma.serviceUserMedication.findMany({
        where: {
          serviceUserId: clientId,
          deletedAt: null,
          isActive: true,
          status: { in: [MedicationRecordStatus.ACTIVE, MedicationRecordStatus.PAUSED] },
        },
        orderBy: { medicationName: 'asc' },
        select: {
          id: true,
          medicationName: true,
          dose: true,
          strength: true,
          frequencyText: true,
          medicationKind: true,
          isControlledMedication: true,
          prnMinGapHours: true,
          prnMaxDosesIn24Hours: true,
          prnMaxDosePerTime: true,
          timeCritical: true,
          instructions: true,
          howAssisted: true,
          route: { select: { name: true } },
          frequency: { select: { name: true } },
          schedules: {
            where: { deletedAt: null, isActive: true },
            select: {
              dueTime: true,
              round: { select: { code: true, name: true } },
            },
            take: 3,
          },
          medicationPack: { select: { adminRules: true } },
        },
      }),
      this.prisma.medicationAdministrationEvent.findMany({
        where: {
          serviceUserId: clientId,
          deletedAt: null,
          OR: [
            { scheduledDateTime: { gte: since } },
            { actualDateTime: { gte: since } },
          ],
        },
        orderBy: { actualDateTime: 'desc' },
        take: 40,
        select: {
          id: true,
          status: true,
          scheduledDateTime: true,
          actualDateTime: true,
          isPrn: true,
          medication: { select: { id: true, medicationName: true } },
        },
      }),
    ]);

    const allergyNames = allergies.map((a) => a.allergyName.trim()).filter(Boolean);
    const allergyLower = allergyNames.map((a) => a.toLowerCase());

    const list = medications.map((m) => {
      const isPrn = m.medicationKind === MedicationKind.PRN;
      const timing =
        m.schedules[0]?.round?.name ||
        m.schedules[0]?.dueTime ||
        (isPrn ? 'PRN' : m.frequencyText || m.frequency?.name || null);
      const adminRules =
        m.medicationPack?.adminRules && typeof m.medicationPack.adminRules === 'object'
          ? (m.medicationPack.adminRules as Record<string, unknown>)
          : {};
      const isCovert = Boolean(adminRules.covert);
      const timeCritical =
        Boolean(m.timeCritical) ||
        Boolean(adminRules.timeCritical) ||
        /insulin|lantus/i.test(m.medicationName);
      const allergyHit = allergyLower.some((a) => m.medicationName.toLowerCase().includes(a));
      const tags: Array<{ id: string; label: string; tone: Tone }> = [];
      if (timeCritical) tags.push({ id: 'time_critical', label: 'Time-critical', tone: 'warning' });
      if (isCovert) tags.push({ id: 'covert', label: 'Covert', tone: 'neutral' });
      if (isPrn) tags.push({ id: 'prn', label: 'PRN', tone: 'neutral' });
      if (allergyHit) tags.push({ id: 'allergy', label: 'Allergy', tone: 'danger' });
      if (m.isControlledMedication) tags.push({ id: 'cd', label: 'CD', tone: 'warning' });

      const dose = [m.dose, m.strength].filter(Boolean).join(' ') || null;
      const route = m.route?.name ?? null;
      const howAssisted = plannedHowAssistedLabel(m.howAssisted);
      const prnLimits = isPrn ? prnLimitsFromMedication(m) : null;
      const detailParts = [
        dose,
        route,
        timing,
        howAssisted ? `Support: ${howAssisted}` : null,
        // PRN limits set by the office, when any (shown for information).
        ...(prnLimits ? Object.values(prnLimitLabels(prnLimits)) : []),
      ].filter(Boolean);

      return {
        id: m.id,
        name: m.medicationName,
        dose,
        route,
        timing,
        howAssisted,
        detail: detailParts.join(' · '),
        isPrn,
        isControlled: m.isControlledMedication,
        prnLimits,
        tags,
      };
    });

    const given = events.filter((e) => e.status === 'GIVEN').length;
    const dueLike = events.filter((e) =>
      ['GIVEN', 'MISSED', 'NOT_GIVEN', 'REFUSED'].includes(e.status),
    ).length;
    const compliancePercent = dueLike === 0 ? null : Math.round((given / dueLike) * 100);

    return {
      data: {
        client: { clientId: su.id, fullName: displayName(su.firstName, su.lastName) },
        allergies: {
          label: 'ALLERGIES',
          tone: 'danger' as Tone,
          items: allergyNames,
        },
        summary: {
          medicinesCount: list.length,
          prnCount: list.filter((m) => m.isPrn).length,
          compliance7DayPercent: compliancePercent,
          complianceLabel: compliancePercent != null ? `${compliancePercent}%` : '—',
        },
        currentMedicines: list,
        administrationHistory: events.map((e) => ({
          id: e.id,
          medicationId: e.medication?.id ?? null,
          medicationName: e.medication?.medicationName ?? null,
          status: e.status,
          scheduledAt: e.scheduledDateTime?.toISOString() ?? null,
          administeredAt: e.actualDateTime?.toISOString() ?? null,
          isPrn: e.isPrn,
        })),
      },
    };
  }

  async getAssessments(employeeId: string, clientId: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);
    const su = await this.loadClientOrThrow(clientId);

    const since30 = new Date();
    since30.setUTCDate(since30.getUTCDate() - 30);

    const [assessments, continuityAllocs, personal] = await Promise.all([
      this.prisma.serviceUserAssessment.findMany({
        where: { serviceUserId: clientId },
        select: {
          id: true,
          assessmentKey: true,
          title: true,
          completions: {
            orderBy: { completedAt: 'desc' },
            take: 1,
            select: {
              completedAt: true,
              summary: true,
              snapshot: true,
              completedBy: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.jobAllocation.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          status: { in: ACTIVE_ALLOCATION },
          scheduledJob: {
            serviceUserId: clientId,
            deletedAt: null,
            isActive: true,
            scheduledStartDateTime: { gte: since30 },
            status: { notIn: EXCLUDED_JOB_STATUSES },
          },
        },
        select: {
          employeeId: true,
          isLeadCarer: true,
          employee: {
            select: { personalDetail: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
      this.prisma.employeePersonalDetail.findFirst({
        where: { employeeId, deletedAt: null },
        select: { firstName: true, lastName: true },
      }),
    ]);

    const mapped = assessments
      .map((a) => {
        const latest = a.completions[0];
        if (!latest) return null;
        const scoreInfo = extractAssessmentScore(a.assessmentKey, latest.snapshot);
        const by = latest.completedBy
          ? `${latest.completedBy.firstName?.charAt(0) ?? ''}. ${latest.completedBy.lastName ?? ''}`.trim()
          : null;
        return {
          id: a.id,
          assessmentKey: a.assessmentKey,
          title: humanAssessmentTitle(a.assessmentKey, a.title),
          score: scoreInfo.score,
          level: scoreInfo.level,
          badgeLabel: scoreInfo.badgeLabel,
          tone: scoreInfo.tone,
          updatedAt: latest.completedAt.toISOString(),
          updatedLabel: `Updated ${formatSlashDate(latest.completedAt)}${by ? ` · ${by}` : ''}`,
          actions: scoreInfo.canUpdate
            ? [
                { id: 'update', label: 'Update reading' },
                { id: 'flag', label: 'Flag for review' },
              ]
            : [{ id: 'flag', label: 'Flag for review' }],
        };
      })
      .filter(Boolean);

    const uniqueCarers = new Set(continuityAllocs.map((a) => a.employeeId));
    const lead = continuityAllocs.find((a) => a.isLeadCarer);
    const leadName = lead
      ? displayName(
          lead.employee.personalDetail?.firstName ?? '',
          lead.employee.personalDetail?.lastName ?? '',
        )
      : null;
    const youName = displayName(personal?.firstName ?? '', personal?.lastName ?? '');
    const isYouLead = lead?.employeeId === employeeId;

    return {
      data: {
        client: { clientId: su.id, fullName: displayName(su.firstName, su.lastName) },
        continuity: {
          visits30d: continuityAllocs.length,
          carersCount: uniqueCarers.size,
          regularTeam: uniqueCarers.size > 0 && uniqueCarers.size <= 5,
          regularTeamLabel: uniqueCarers.size > 0 && uniqueCarers.size <= 5 ? 'Yes' : 'No',
          leadCarerName: leadName,
          leadCarerIsYou: isYouLead,
          lastGapLabel: 'None',
          footer: `Lead carer: ${leadName ?? 'Unassigned'}${
            isYouLead ? ' (you)' : youName ? '' : ''
          } · last gap: None`,
        },
        assessments: mapped,
        disclaimer:
          'You can complete, update or flag assessments — clinical determinations stay with the assessor.',
      },
    };
  }

  async getHistoryTrends(employeeId: string, clientId: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);
    const su = await this.loadClientOrThrow(clientId);

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 28);

    const observations = await this.prisma.serviceUserObservation.findMany({
      where: {
        serviceUserId: clientId,
        deletedAt: null,
        recordedAt: { gte: since },
      },
      orderBy: { recordedAt: 'asc' },
      select: {
        recordedAt: true,
        numericValue: true,
        unit: true,
        payload: true,
        observationType: { select: { code: true, name: true } },
        wellbeingScores: {
          select: {
            level: true,
            dimension: { select: { code: true } },
          },
        },
      },
    });

    const bpPoints = [];
    const fluidPoints = [];
    const weightPoints = [];
    const moodPoints = [];
    const fluidTargetMl = 1500;

    for (const obs of observations) {
      const code = obs.observationType.code.toUpperCase();
      const day = weekdayLabel(obs.recordedAt);
      const payload =
        obs.payload && typeof obs.payload === 'object' ? (obs.payload as Record<string, unknown>) : {};

      if (code === 'BLOOD_PRESSURE' || code === 'BP') {
        const systolic =
          numberOrNull(payload.systolic) ??
          numberOrNull(payload.systolicMmHg) ??
          numberOrNull(obs.numericValue);
        const diastolic = numberOrNull(payload.diastolic) ?? numberOrNull(payload.diastolicMmHg);
        if (systolic != null) {
          bpPoints.push({
            label: day,
            value: systolic,
            systolic,
            diastolic,
            recordedAt: obs.recordedAt.toISOString(),
          });
        }
      } else if (code === 'FLUID_MONITOR' || code === 'FLUID' || code === 'FLUID_INTAKE') {
        const ml =
          numberOrNull(payload.intakeMl) ??
          numberOrNull(payload.totalMl) ??
          numberOrNull(obs.numericValue);
        if (ml != null) {
          const met = ml >= fluidTargetMl;
          fluidPoints.push({
            label: day,
            value: ml,
            metTarget: met,
            tone: met ? ('primary' as Tone) : ('warning' as Tone),
            recordedAt: obs.recordedAt.toISOString(),
          });
        }
      } else if (code === 'WEIGHT') {
        const kg = numberOrNull(obs.numericValue) ?? numberOrNull(payload.kg);
        if (kg != null) {
          weightPoints.push({
            label: weekBucket(obs.recordedAt, since),
            value: kg,
            recordedAt: obs.recordedAt.toISOString(),
          });
        }
      } else if (code === 'WELLBEING' || code === 'MOOD') {
        const emotional =
          obs.wellbeingScores.find((s) => s.dimension.code === 'EMOTIONAL')?.level ??
          numberOrNull(obs.numericValue) ??
          numberOrNull(payload.mood) ??
          numberOrNull(payload.level);
        if (emotional != null) {
          moodPoints.push({
            label: day,
            value: emotional,
            recordedAt: obs.recordedAt.toISOString(),
          });
        }
      }
    }

    const latestBp = bpPoints.length ? bpPoints[bpPoints.length - 1] : null;

    return {
      data: {
        client: { clientId: su.id, fullName: displayName(su.firstName, su.lastName) },
        charts: [
          {
            id: 'blood_pressure_systolic',
            label: 'Blood pressure (systolic)',
            unit: 'mmHg',
            points: collapseByLabel(bpPoints),
            summaryText:
              latestBp != null
                ? `Latest ${latestBp.systolic}${
                    latestBp.diastolic != null ? `/${latestBp.diastolic}` : ''
                  } mmHg`
                : null,
          },
          {
            id: 'fluid_intake',
            label: 'Fluid intake (ml)',
            unit: 'ml',
            target: fluidTargetMl,
            footer: `Target ${fluidTargetMl}ml · amber = below`,
            points: collapseByLabel(fluidPoints),
            summaryText: null,
          },
          {
            id: 'weight',
            label: 'Weight (kg)',
            unit: 'kg',
            points: collapseByLabel(weightPoints),
            summaryText: null,
          },
          {
            id: 'mood',
            label: 'Mood (1-5)',
            unit: null,
            points: collapseByLabel(moodPoints),
            summaryText: null,
          },
        ],
      },
    };
  }

  async getConsentCapacity(employeeId: string, clientId: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);
    const su = await this.loadClientOrThrow(clientId);

    const [legal, capacityAssessments, authorityRows] = await Promise.all([
      this.prisma.serviceUserLegalDocument.findUnique({
        where: { serviceUserId: clientId },
      }),
      this.prisma.serviceUserAssessment.findMany({
        where: {
          serviceUserId: clientId,
          assessmentKey: { in: ['mental-capacity-checklist', 'mca-screening'] },
        },
        select: {
          assessmentKey: true,
          title: true,
          completions: {
            orderBy: { completedAt: 'desc' },
            take: 1,
            select: {
              completedAt: true,
              summary: true,
              snapshot: true,
              source: true,
              sourceSubmissionId: true,
              completedBy: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.serviceUserLegalAuthority.findMany({
        where: { serviceUserId: clientId, deletedAt: null },
        select: {
          id: true,
          category: true,
          holderName: true,
          holderRelationship: true,
          verificationStatus: true,
          expiresOn: true,
          isActive: true,
        },
      }),
    ]);
    const legalAuthorities = carerAuthorityCards(
      authorityRows.map((a) => ({ ...a, expiresOn: a.expiresOn ? a.expiresOn.toISOString() : null })),
      new Date().toISOString().slice(0, 10),
    );

    // Decisions promoted from an IA reach carers only once a manager has reviewed that IA.
    const iaSourceIds = capacityAssessments
      .map((a) => a.completions[0])
      .filter((c) => c?.source === 'INITIAL_ASSESSMENT' && c.sourceSubmissionId)
      .map((c) => c!.sourceSubmissionId as string);
    const reviewedIaIds = new Set(
      iaSourceIds.length
        ? (
            await this.prisma.initialAssessmentSubmission.findMany({
              where: { id: { in: iaSourceIds }, status: InitialAssessmentStatus.REVIEWED, deletedAt: null },
              select: { id: true },
            })
          ).map((r) => r.id)
        : [],
    );
    let awaitingReview = false;

    // Capacity is decision-specific: only records that name a decision and state an outcome are
    // shown. A screening/checklist without named decisions is never turned into a person-level
    // "has / lacks capacity" badge — carers are told it is not recorded and to ask the office.
    const decisions: ReturnType<typeof mapCapacityDecision>[] = [];
    let unnamedScreeningAt: Date | null = null;
    for (const a of capacityAssessments) {
      const latest = a.completions[0];
      if (!latest) continue;
      if (
        latest.source === 'INITIAL_ASSESSMENT' &&
        latest.sourceSubmissionId &&
        !reviewedIaIds.has(latest.sourceSubmissionId)
      ) {
        awaitingReview = true;
        continue;
      }
      const snap =
        latest.snapshot && typeof latest.snapshot === 'object'
          ? (latest.snapshot as Record<string, unknown>)
          : {};
      const mapped = (Array.isArray(snap.decisions) ? snap.decisions : [])
        .map((d, idx) => mapCapacityDecision(d, idx, latest))
        .filter((d): d is NonNullable<typeof d> => d != null);
      if (mapped.length) decisions.push(...mapped);
      else if (!unnamedScreeningAt || latest.completedAt > unnamedScreeningAt) {
        unnamedScreeningAt = latest.completedAt;
      }
    }

    const bannerMessage = [
      'Capacity is decision-specific and time-specific — never a person-level yes/no. A refusal is not a lack of capacity.',
      unnamedScreeningAt && !decisions.length
        ? `A capacity screening was recorded on ${formatSlashDate(unnamedScreeningAt)}, but the decision it relates to is not recorded — capacity decision not recorded, see office.`
        : null,
      awaitingReview && !decisions.length
        ? 'A capacity assessment is awaiting manager review — see office.'
        : null,
    ]
      .filter(Boolean)
      .join(' ');

    return {
      data: {
        client: { clientId: su.id, fullName: displayName(su.firstName, su.lastName) },
        banner: { tone: 'info', message: bannerMessage },
        // Register first (only evidenced authorities); the old single LPA fields as a fallback.
        lastingPowerOfAttorney: carerLpaCardFromRegister(legalAuthorities, authorityRows) ?? carerLpaCard(legal),
        legalAuthorities,
        decisionSpecificCapacity: decisions,
      },
    };
  }

  async getCarePlan(employeeId: string, clientId: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);
    const su = await this.loadClientOrThrow(clientId);
    const plans = await this.loadPublishedCarePlanList(clientId, employeeId);

    return {
      data: {
        client: {
          clientId: su.id,
          fullName: displayName(su.firstName, su.lastName),
        },
        plans,
      },
    };
  }

  /**
   * The carer confirms they have read this exact published version. Idempotent; a superseded
   * version cannot be acknowledged. Reading the plan never depends on this.
   */
  async acknowledgeCarePlan(
    employeeId: string,
    userId: string,
    clientId: string,
    instanceId: string,
    publishedVersionId: string,
  ) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);
    const instance = await this.prisma.serviceUserCarePlanInstance.findFirst({
      where: { id: instanceId, serviceUserId: clientId, lifecycleStatus: 'ACTIVE', publishedVersions: { some: {} } },
      select: {
        id: true,
        publishedVersions: {
          where: { supersededAt: null },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { id: true, versionNumber: true },
        },
      },
    });
    const current = instance?.publishedVersions[0];
    if (!instance || !current) throw new NotFoundException('Published care plan not found');
    if (current.id !== publishedVersionId) {
      throw new ConflictException('A newer version of this care plan has been published. Open it and acknowledge that one.');
    }
    const row = await this.prisma.carePlanVersionAcknowledgement.upsert({
      where: { publishedVersionId_employeeId: { publishedVersionId: current.id, employeeId } },
      create: {
        publishedVersionId: current.id,
        carePlanInstanceId: instance.id,
        serviceUserId: clientId,
        employeeId,
      },
      update: {},
    });
    let acknowledgedAt = row.acknowledgedAt;
    if (!acknowledgedAt) {
      const now = new Date();
      const claimed = await this.prisma.carePlanVersionAcknowledgement.updateMany({
        where: { id: row.id, acknowledgedAt: null },
        data: { acknowledgedAt: now, acknowledgedById: userId },
      });
      if (claimed.count === 1) {
        acknowledgedAt = now;
        await this.audit?.logAudit({
          userId,
          module: AuditModule.CARE_PLAN,
          action: AuditAction.CARE_PLAN_ACKNOWLEDGED,
          recordType: 'CarePlanVersionAcknowledgement',
          recordId: row.id,
          newValues: {
            employeeId,
            publishedVersionId: current.id,
            versionNumber: current.versionNumber,
            acknowledgedAt: now.toISOString(),
          },
          metadata: { serviceUserId: clientId, carePlanInstanceId: instance.id, publishedVersionId: current.id },
        });
      } else {
        acknowledgedAt =
          (await this.prisma.carePlanVersionAcknowledgement.findUnique({ where: { id: row.id } }))?.acknowledgedAt ?? now;
      }
    }
    return {
      data: {
        carePlanInstanceId: instance.id,
        publishedVersionId: current.id,
        versionNumber: current.versionNumber,
        acknowledgedAt: acknowledgedAt.toISOString(),
      },
    };
  }

  /** Whether this carer still has to acknowledge each current published version. */
  private async acknowledgementByVersionId(employeeId: string, versionIds: string[]) {
    const rows = versionIds.length
      ? await this.prisma.carePlanVersionAcknowledgement.findMany({
          where: { employeeId, publishedVersionId: { in: versionIds } },
          select: { publishedVersionId: true, acknowledgedAt: true },
        })
      : [];
    const byId = new Map(rows.map((r) => [r.publishedVersionId, r.acknowledgedAt]));
    return (versionId: string) => {
      const at = byId.get(versionId) ?? null;
      return { required: !at, acknowledgedAt: at?.toISOString() ?? null, publishedVersionId: versionId };
    };
  }

  async getCarePlanDetail(employeeId: string, clientId: string, instanceId: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);
    const su = await this.loadClientOrThrow(clientId);

    const instance = await this.prisma.serviceUserCarePlanInstance.findFirst({
      where: {
        id: instanceId,
        serviceUserId: clientId,
        lifecycleStatus: 'ACTIVE',
        publishedVersions: { some: {} },
      },
      select: {
        ...publishedCarePlanSelect,
        carePathwayFormVersion: { select: carePlanFormVersionForCarerSelect },
        carePathwayForm: {
          select: {
            name: true,
            currentVersion: { select: carePlanFormVersionForCarerSelect },
          },
        },
      },
    });

    const pub = instance?.publishedVersions[0];
    if (!instance || !pub) {
      throw new NotFoundException('Published care plan not found');
    }

    const formSections = (
      instance.carePathwayFormVersion?.sections?.length
        ? instance.carePathwayFormVersion.sections
        : instance.carePathwayForm.currentVersion?.sections
    ) ?? [];
    const plan = toPublishedPlanListItem(instance, pub, (await this.orgSettings.getReviewSettings()).carePlanDueSoonDays);
    const fullSummary = sanitizeComposeTextOrNull(pub.summary);
    const acknowledgement = (await this.acknowledgementByVersionId(employeeId, [pub.id]))(pub.id);

    return {
      data: {
        client: {
          clientId: su.id,
          fullName: displayName(su.firstName, su.lastName),
        },
        plan: {
          ...plan,
          summary: fullSummary ?? plan.summary,
        },
        acknowledgement,
        sections: mapPublishedCarePlanForCarer({
          valuesJson: pub.valuesJson,
          formName: instance.carePathwayForm.name,
          formSections,
        }),
      },
    };
  }

  private async loadPublishedCarePlanList(clientId: string, employeeId?: string) {
    const instances = await this.prisma.serviceUserCarePlanInstance.findMany({
      where: {
        serviceUserId: clientId,
        lifecycleStatus: 'ACTIVE',
        publishedVersions: { some: {} },
      },
      select: {
        id: true,
        nextReviewDueAt: true,
        carePathwayForm: { select: { name: true } },
        publishedVersions: {
          orderBy: [{ versionNumber: 'desc' }, { publishedAt: 'desc' }],
          take: 1,
          select: {
            id: true,
            versionNumber: true,
            summary: true,
            publishedAt: true,
          },
        },
      },
    });
    const ackFor = employeeId
      ? await this.acknowledgementByVersionId(
          employeeId,
          instances.flatMap((i) => (i.publishedVersions[0] ? [i.publishedVersions[0].id] : [])),
        )
      : null;
    const { carePlanDueSoonDays } = await this.orgSettings.getReviewSettings();

    return instances
      .flatMap((instance) => {
        const pub = instance.publishedVersions[0];
        return pub
          ? [{ ...toPublishedPlanListItem(instance, pub, carePlanDueSoonDays), ...(ackFor ? { acknowledgement: ackFor(pub.id) } : {}) }]
          : [];
      })
      .sort((a, b) => {
        const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return tb - ta;
      });
  }

  private async loadClientOrThrow(clientId: string) {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: clientId, deletedAt: null, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        dateOfBirth: true,
        nhsNumber: true,
        socialServicesRef: true,
        careType: { select: { id: true, name: true, code: true } },
        address: {
          select: {
            addressLine1: true,
            addressLine2: true,
            town: true,
            postcode: true,
            keySafeNumber: true,
            accessInstructions: true,
            accessMethod: true,
            keySafeLocation: true,
            deletedAt: true,
          },
        },
      },
    });
    if (!su) throw new NotFoundException('Client not found');
    return su;
  }

  private async loadTaskProgress(
    jobs: Array<{
      id: string;
      serviceUserId: string;
      scheduledStartDateTime?: Date | null;
      scheduledEndDateTime?: Date | null;
      visits: Array<{
        visitPlanSlot: { slotCode: string; medicationRoundCode: string | null } | null;
        scheduledStartDateTime?: Date | null;
        scheduledEndDateTime?: Date | null;
      }>;
    }>,
    timeZone: string,
  ) {
    if (!jobs.length) return new Map<string, { completed: number; total: number }>();
    const suIds = [...new Set(jobs.map((j) => j.serviceUserId))];

    // Tasks attach by visit clock window (like medicines), so load every task for the clients.
    // Organisation timezone is passed in by the caller (azure); no second lookup here.
    const [assignments, completions] = await Promise.all([
      this.prisma.serviceUserVisitTaskAssignment.findMany({
        where: {
          serviceUserId: { in: suIds },
          deletedAt: null,
          isActive: true,
        },
        select: {
          id: true,
          serviceUserId: true,
          medicationRoundCode: true,
          dueTime: true,
          daysOfWeek: true,
          scheduleFrequency: true,
          repeatEvery: true,
          repeatUnit: true,
          timeCritical: true,
          timeToleranceMinutes: true,
          monthlyDayMode: true,
          monthlyDaysOfMonth: true,
          monthlyPatternOrdinal: true,
          monthlyPatternWeekday: true,
          task: { select: { name: true, flagsJson: true } },
        },
      }),
      this.prisma.scheduledVisitTaskCompletion.findMany({
        where: { scheduledJobId: { in: jobs.map((j) => j.id) } },
        select: {
          scheduledJobId: true,
          assignmentId: true,
          isCompleted: true,
          recordedValue: true,
          notes: true,
        },
      }),
    ]);

    // Each task sits on one visit of the client's day: covering visit, else nearest.
    const { byJob } = await loadVisitTaskPlacement(
      this.prisma,
      jobs.map((j) => ({
        id: j.id,
        serviceUserId: j.serviceUserId,
        start: j.visits[0]?.scheduledStartDateTime ?? j.scheduledStartDateTime ?? new Date(),
        end: j.visits[0]?.scheduledEndDateTime ?? j.scheduledEndDateTime ?? null,
      })),
      timeZone,
    );

    return buildVisitTaskProgressByJobId({
      jobs,
      assignments,
      completions,
      timeZone,
      placedAssignmentIdsByJob: new Map(
        [...byJob].map(([jobId, list]) => [jobId, new Set(list.map((p) => p.assignmentId))]),
      ),
    });
  }
}

function displayName(first: string, last: string) {
  return [first, last].filter(Boolean).join(' ').trim() || 'Service user';
}

function initialsFromName(firstName: string, lastName: string): string {
  return `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase() || '?';
}

function ageFromDob(dob: Date | null): number | null {
  if (!dob) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function formatDisplayDate(date: Date): string {
  return formatUkDateLabel(date);
}

function formatSlashDate(date: Date): string {
  return formatUkDateLabel(date);
}

function weekdayLabel(date: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
}

function weekBucket(date: Date, since: Date): string {
  const diff = Math.floor((date.getTime() - since.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `W${Math.min(4, Math.max(1, diff + 1))}`;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function collapseByLabel<T extends { label: string; value: number }>(points: T[]): T[] {
  const map = new Map<string, T>();
  for (const p of points) map.set(p.label, p);
  return [...map.values()];
}

function mapVisitStatus(
  jobStatus: ScheduledJobStatus,
  visitStatus: ScheduledVisitStatus | null,
): string {
  if (jobStatus === ScheduledJobStatus.IN_PROGRESS || visitStatus === ScheduledVisitStatus.STARTED) {
    return 'in_progress';
  }
  if (
    jobStatus === ScheduledJobStatus.COMPLETED ||
    visitStatus === ScheduledVisitStatus.COMPLETED
  ) {
    return 'completed';
  }
  return 'upcoming';
}

function periodTitle(
  visitName: string | null,
  slot: { slotCode: string; medicationRoundCode: string | null } | null,
  startAt: Date,
  timeZone: string,
): string {
  const code = (slot?.medicationRoundCode ?? slot?.slotCode ?? '').toUpperCase();
  if (code.includes('MORNING') || code === 'AM') return 'Morning visit';
  if (code.includes('LUNCH')) return 'Lunch visit';
  if (code.includes('TEA')) return 'Tea visit';
  if (code.includes('BED') || code.includes('NIGHT')) return 'Bedtime visit';
  const name = (visitName ?? '').toLowerCase();
  if (name.includes('morning')) return 'Morning visit';
  if (name.includes('lunch')) return 'Lunch visit';
  if (name.includes('tea')) return 'Tea visit';
  if (name.includes('bed')) return 'Bedtime visit';
  const h = hourInTimeZone(startAt, timeZone);
  if (h < 11) return 'Morning visit';
  if (h < 14) return 'Lunch visit';
  if (h < 18) return 'Tea visit';
  return 'Bedtime visit';
}

function iconForPeriod(title: string): string {
  if (/morning/i.test(title)) return 'sunrise';
  if (/lunch/i.test(title)) return 'sun';
  if (/tea|afternoon/i.test(title)) return 'sunset';
  return 'moon';
}

function iconForCarePlan(name: string): string {
  if (/diabet|med/i.test(name)) return 'pill';
  if (/memory|dement|cognit/i.test(name)) return 'brain';
  if (/hydrat|nutrition/i.test(name)) return 'droplet';
  return 'care';
}

function iconForDocument(category: string, title: string): string {
  const t = `${category} ${title}`.toLowerCase();
  if (/med|mar/.test(t)) return 'pill';
  if (/emergency|respect|dnacpr/.test(t)) return 'heart';
  if (/skin|body map|waterlow/.test(t)) return 'skin';
  if (/risk/.test(t)) return 'warning';
  if (/log|diary/.test(t)) return 'diary';
  return 'document';
}

function extractCarePlanBlurb(valuesJson: unknown): string | null {
  if (!valuesJson || typeof valuesJson !== 'object') return null;
  const obj = valuesJson as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim().length > 20) return v.trim().slice(0, 280);
  }
  return null;
}

function extractAssessmentScore(key: string, snapshot: unknown) {
  const snap = snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, any>) : {};
  const k = key.toLowerCase();
  if (k.includes('waterlow')) {
    const score = numberOrNull(snap.waterlow?.score ?? snap.score);
    // Waterlow bands: 10+ at risk, 15+ high, 20+ very high.
    const level =
      score == null
        ? 'Recorded'
        : score >= 20
          ? 'Very high'
          : score >= 15
            ? 'High'
            : score >= 10
              ? 'At risk'
              : 'Low';
    return {
      score,
      level,
      badgeLabel: score != null ? `${score} — ${level}` : level,
      tone: (score != null && score >= 15 ? 'danger' : score != null && score >= 10 ? 'warning' : 'neutral') as Tone,
      canUpdate: true,
    };
  }
  if (k.includes('must') || k.includes('malnutrition')) {
    const score = numberOrNull(snap.must?.score ?? snap.score);
    const level =
      String(snap.must?.riskLevel ?? snap.riskLevel ?? (score != null && score >= 2 ? 'High' : score === 1 ? 'Medium' : 'Low'));
    const nice = level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
    return {
      score,
      level: nice,
      badgeLabel: score != null ? `${score} — ${nice}` : nice,
      tone: (nice === 'High' ? 'danger' : nice === 'Medium' ? 'warning' : 'success') as Tone,
      canUpdate: true,
    };
  }
  if (k.includes('falls')) {
    // Falls is case-finding + a multifactorial screen — there is no falls risk "level" to show.
    return {
      score: null as number | null,
      level: null as string | null,
      badgeLabel: 'Screen recorded',
      tone: 'neutral' as Tone,
      canUpdate: false,
    };
  }
  return {
    score: null as number | null,
    level: null as string | null,
    badgeLabel: 'Recorded',
    tone: 'neutral' as Tone,
    canUpdate: false,
  };
}

function humanAssessmentTitle(key: string, title: string): string {
  if (/waterlow/i.test(key) || /waterlow/i.test(title)) return 'Waterlow (pressure risk)';
  if (/must/i.test(key) || /malnutrition/i.test(title)) return 'Malnutrition (MUST)';
  if (/falls/i.test(key) || /falls/i.test(title)) return 'Falls (multifactorial)';
  return title || key;
}

/**
 * Lasting power of attorney card for carers. Property & finance LPAs never give authority over
 * care or health decisions, and their certificate is not sent to the app. No record → no card.
 */
export function carerLpaCard(
  legal: {
    lpaStatusConfirmation: string | null;
    lpaHealthCertificateUrl: string | null;
    lpaFinanceCertificateUrl: string | null;
  } | null,
) {
  if (!legal) return null;
  const status = String(legal.lpaStatusConfirmation ?? 'UNKNOWN');
  const inForce = /IN_FORCE|IN_PLACE|ACTIVE/i.test(status);
  const health = Boolean(legal.lpaHealthCertificateUrl);
  const finance = Boolean(legal.lpaFinanceCertificateUrl);
  if (!health && !finance && !inForce) return null;
  const base = {
    enabled: true,
    attorneyName: null,
    attorneyRelationship: null,
    status,
    registeredAt: null,
    financeCertificateUrl: null,
  };
  if (health) {
    return {
      ...base,
      typeLabel: 'Health & welfare LPA',
      scopeNote: inForce
        ? 'Health & welfare decisions only, and only for decisions the person lacks capacity to make — NOT property or finances.'
        : 'Health & welfare LPA on file but not confirmed in force — check with the office before relying on it.',
      healthCertificateUrl: legal.lpaHealthCertificateUrl,
    };
  }
  if (finance) {
    return {
      ...base,
      typeLabel: 'Property & financial affairs LPA',
      scopeNote:
        'Finances only — this does NOT give anyone authority over care or health decisions.',
      healthCertificateUrl: null,
    };
  }
  return {
    ...base,
    typeLabel: 'LPA recorded — type not confirmed',
    scopeNote: 'Check with the office which decisions this LPA covers before relying on it.',
    healthCertificateUrl: null,
  };
}

/** Old single-card shape (carer app `ClientLpaInfo`) from the register — a care authority wins. */
export function carerLpaCardFromRegister(
  cards: ReturnType<typeof carerAuthorityCards>,
  rows: Array<{ id: string; holderRelationship: string }>,
) {
  const card = cards.find((c) => c.coversCare) ?? cards[0];
  if (!card) return null;
  return {
    enabled: true,
    attorneyName: card.holderName,
    attorneyRelationship: rows.find((r) => r.id === card.id)?.holderRelationship || null,
    status: 'VERIFIED',
    registeredAt: null,
    financeCertificateUrl: null,
    healthCertificateUrl: null,
    typeLabel: card.typeLabel,
    scopeNote: card.scopeNote,
  };
}

export function mapCapacityDecision(
  raw: unknown,
  idx: number,
  latest: {
    completedAt: Date;
    completedBy: { firstName: string | null; lastName: string | null } | null;
  },
) {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const statusText = String(d.status ?? d.capacityStatus ?? '');
  const has =
    d.hasCapacity === true || d.capacityIntact === true || /^has/i.test(statusText)
      ? true
      : d.hasCapacity === false || d.capacityIntact === false || /lack/i.test(statusText)
        ? false
        : null;
  // No stated outcome → not shown (never defaulted to "lacks capacity").
  if (has == null) return null;
  return {
    id: String(d.id ?? `decision-${idx}`),
    title: String(d.title ?? d.decision ?? `Decision ${idx + 1}`),
    status: has ? 'has_capacity' : 'lacks_capacity',
    statusLabel: has ? 'Has capacity' : 'Lacks capacity',
    tone: has ? ('success' as Tone) : ('danger' as Tone),
    assessedAt: latest.completedAt.toISOString(),
    assessedLabel: `Assessed ${formatSlashDate(latest.completedAt)}`,
    reviewAt: typeof d.reviewAt === 'string' ? d.reviewAt : null,
    reviewLabel: typeof d.reviewAt === 'string' ? `Review ${d.reviewAt}` : null,
    assessor: latest.completedBy
      ? `${latest.completedBy.firstName?.charAt(0) ?? ''}. ${latest.completedBy.lastName ?? ''}`.trim()
      : typeof d.assessor === 'string'
        ? d.assessor
        : null,
    note: typeof d.note === 'string' ? d.note : null,
  };
}

const carePlanFormVersionForCarerSelect = {
  sections: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      title: true,
      description: true,
      sortOrder: true,
      fields: {
        where: { deletedAt: null, isActive: true },
        orderBy: { sortOrder: 'asc' as const },
        select: {
          id: true,
          sectionId: true,
          fieldKey: true,
          label: true,
          fieldType: true,
          conditionalLogicJson: true,
          sortOrder: true,
        },
      },
    },
  },
};

const publishedCarePlanSelect = {
  id: true,
  nextReviewDueAt: true,
  carePathwayForm: { select: { name: true } },
  publishedVersions: {
    orderBy: [{ versionNumber: 'desc' as const }, { publishedAt: 'desc' as const }],
    take: 1,
    select: {
      id: true,
      versionNumber: true,
      summary: true,
      publishedAt: true,
      valuesJson: true,
    },
  },
};

function toPublishedPlanListItem(
  instance: { id: string; nextReviewDueAt: Date | null; carePathwayForm: { name: string } },
  pub: { versionNumber: number; summary: string | null; publishedAt: Date; valuesJson?: unknown },
  carePlanDueSoonDays: number,
) {
  const fromSummary =
    typeof pub.summary === 'string' && pub.summary.trim() ? pub.summary.trim().slice(0, 180) : null;
  const summary =
    fromSummary ??
    (pub.valuesJson != null ? extractCarePlanBlurb(pub.valuesJson)?.slice(0, 180) ?? null : null);

  return {
    id: instance.id,
    formName: instance.carePathwayForm.name,
    versionNumber: pub.versionNumber,
    publishedAt: pub.publishedAt.toISOString(),
    nextReviewDueAt: instance.nextReviewDueAt?.toISOString() ?? null,
    reviewStatus: computeCarePlanReviewState({
      nextReviewDueAt: instance.nextReviewDueAt,
      dueSoonDays: carePlanDueSoonDays,
    }).status,
    summary,
  };
}
