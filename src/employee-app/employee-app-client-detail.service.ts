import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AllocationStatus,
  InitialAssessmentRiskStatus,
  InitialAssessmentRiskType,
  MedicationKind,
  MedicationPackStatus,
  MedicationRecordStatus,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  ServiceUserDocumentAccessLevel,
  ServiceUserDocumentRecordStatus,
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
import { resolveJobMedicationRoundCode } from '../scheduled-jobs-housekeeping/visit-job-tasks.util';
import { plannedHowAssistedLabel } from './medication/employee-app-visit-medication-round.util';
import { EmployeeAppClientsService } from './employee-app-clients.service';
import { employeeAppAccessPayload } from './employee-app-access.util';
import {
  gpAsContact,
  mapProfileCommunication,
  mapProfileContact,
  mapProfileGp,
  profileRiskLabel,
} from './employee-app-client-profile.util';
import { buildVisitTaskProgressByJobId } from './visit-task-progress.util';
import { computeCarePlanReviewState } from '../service-user-care-plans/care-plan-review-schedule';
import { sanitizeComposeTextOrNull } from '../service-user-care-plans/compose/compose-html-sanitize.util';
import { mapPublishedCarePlanForCarer } from './employee-app-care-plan-detail.util';

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
        where: { serviceUserId: clientId },
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
          isPrimary: true,
          isEmergencyContact: true,
          relationshipType: { select: { name: true } },
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
    ]);

    const allergyNames = allergies.map((a) => a.allergyName.trim()).filter(Boolean);
    const age = ageFromDob(su.dateOfBirth);
    const fullName = displayName(su.firstName, su.lastName);
    const preferredName = su.preferredName?.trim() || null;
    const forCpr = !(legal?.dnacprInPlace === true);
    const dnacprLocation = !forCpr ? legal?.dnacprPhysicalLocation?.trim() || null : null;
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
    const gp = mapProfileGp(gpPack);
    const contacts = [
      ...nokContacts.map(mapProfileContact),
      ...(gp ? [gpAsContact(gp)] : []),
    ];

    const jobs = todayJobs.map((a) => a.scheduledJob);
    const taskProgress = await this.loadTaskProgress(jobs);
    const todayVisits = jobs.map((job) => {
      const visit = job.visits[0] ?? null;
      const startAt = visit?.scheduledStartDateTime ?? job.scheduledStartDateTime;
      const title = periodTitle(
        visit?.visitName ?? job.jobName,
        visit?.visitPlanSlot ?? null,
        startAt,
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
            id: forCpr ? 'for_cpr' : 'dnacpr',
            label: forCpr ? 'For CPR' : 'DNACPR in place',
            tone: forCpr ? ('success' as Tone) : ('warning' as Tone),
            location: dnacprLocation,
          },
          dnacprLocation,
          conditions,
        },
        todayVisits,
        carePlanEssentials,
        communication,
        contacts,
        gp,
        date,
        access: employeeAppAccessPayload(su.address),
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
      const detailParts = [
        dose,
        route,
        timing,
        howAssisted ? `Support: ${howAssisted}` : null,
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

    const [legal, capacityAssessments] = await Promise.all([
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
              completedBy: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);

    const decisions = capacityAssessments.flatMap((a) => {
      const latest = a.completions[0];
      if (!latest) return [];
      const snap =
        latest.snapshot && typeof latest.snapshot === 'object'
          ? (latest.snapshot as Record<string, unknown>)
          : {};
      const decisionsRaw = Array.isArray(snap.decisions) ? snap.decisions : null;
      if (decisionsRaw?.length) {
        return decisionsRaw.map((d, idx) => mapCapacityDecision(d, idx, latest));
      }
      const intact = snap.capacityIntact === true || /has capacity/i.test(latest.summary ?? '');
      return [
        {
          id: a.assessmentKey,
          title: a.title || 'Mental capacity',
          status: intact ? 'has_capacity' : 'lacks_capacity',
          statusLabel: intact ? 'Has capacity' : 'Lacks capacity',
          tone: intact ? ('success' as Tone) : ('danger' as Tone),
          assessedAt: latest.completedAt.toISOString(),
          assessedLabel: `Assessed ${formatSlashDate(latest.completedAt)}`,
          reviewAt: null as string | null,
          reviewLabel: null as string | null,
          assessor: latest.completedBy
            ? `${latest.completedBy.firstName?.charAt(0) ?? ''}. ${latest.completedBy.lastName ?? ''}`.trim()
            : null,
          note: typeof snap.note === 'string' ? snap.note : null,
        },
      ];
    });

    const lpaInForce = /IN_FORCE|IN_PLACE|ACTIVE/i.test(String(legal?.lpaStatusConfirmation ?? ''));

    return {
      data: {
        client: { clientId: su.id, fullName: displayName(su.firstName, su.lastName) },
        banner: {
          tone: 'info',
          message:
            'Capacity is decision-specific and time-specific — never a person-level yes/no. A refusal is not a lack of capacity.',
        },
        lastingPowerOfAttorney: {
          enabled: lpaInForce || Boolean(legal?.lpaHealthCertificateUrl || legal?.lpaFinanceCertificateUrl),
          typeLabel: 'Health & welfare LPA',
          attorneyName: null,
          attorneyRelationship: null,
          scopeNote: 'Scope: Health & welfare decisions only — NOT property or finances',
          status: legal?.lpaStatusConfirmation ?? 'UNKNOWN',
          registeredAt: null,
          healthCertificateUrl: legal?.lpaHealthCertificateUrl ?? null,
          financeCertificateUrl: legal?.lpaFinanceCertificateUrl ?? null,
        },
        decisionSpecificCapacity: decisions,
      },
    };
  }

  async getCarePlan(employeeId: string, clientId: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);
    const su = await this.loadClientOrThrow(clientId);
    const plans = await this.loadPublishedCarePlanList(clientId);

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

  async getCarePlanDetail(employeeId: string, clientId: string, instanceId: string) {
    await this.clientsService.assertClientOnRound(employeeId, clientId);
    const su = await this.loadClientOrThrow(clientId);

    const instance = await this.prisma.serviceUserCarePlanInstance.findFirst({
      where: {
        id: instanceId,
        serviceUserId: clientId,
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
    const plan = toPublishedPlanListItem(instance, pub);
    const fullSummary = sanitizeComposeTextOrNull(pub.summary);

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
        sections: mapPublishedCarePlanForCarer({
          valuesJson: pub.valuesJson,
          formName: instance.carePathwayForm.name,
          formSections,
        }),
      },
    };
  }

  private async loadPublishedCarePlanList(clientId: string) {
    const instances = await this.prisma.serviceUserCarePlanInstance.findMany({
      where: {
        serviceUserId: clientId,
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
            versionNumber: true,
            summary: true,
            publishedAt: true,
          },
        },
      },
    });

    return instances
      .flatMap((instance) => {
        const pub = instance.publishedVersions[0];
        return pub ? [toPublishedPlanListItem(instance, pub)] : [];
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
      visits: Array<{
        visitPlanSlot: { slotCode: string; medicationRoundCode: string | null } | null;
        scheduledStartDateTime?: Date | null;
      }>;
    }>,
  ) {
    if (!jobs.length) return new Map<string, { completed: number; total: number }>();
    const jobRound = new Map<string, string | null>();
    for (const job of jobs) jobRound.set(job.id, resolveJobMedicationRoundCode(job.visits));
    const rounds = [...new Set([...jobRound.values()].filter((r): r is string => Boolean(r)))];
    const suIds = [...new Set(jobs.map((j) => j.serviceUserId))];

    const [assignments, completions] = await Promise.all([
      rounds.length === 0
        ? Promise.resolve([] as Array<{ id: string; serviceUserId: string; medicationRoundCode: string }>)
        : this.prisma.serviceUserVisitTaskAssignment.findMany({
            where: {
              serviceUserId: { in: suIds },
              medicationRoundCode: { in: rounds },
              deletedAt: null,
              isActive: true,
            },
            select: {
              id: true,
              serviceUserId: true,
              medicationRoundCode: true,
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

    return buildVisitTaskProgressByJobId({ jobs, assignments, completions });
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
  const h = hourInTimeZone(startAt, 'UTC');
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
    const level = score != null && score >= 15 ? 'High' : score != null && score >= 10 ? 'Medium' : 'Low';
    return {
      score,
      level,
      badgeLabel: score != null ? `${score} — ${level}` : level,
      tone: (level === 'High' ? 'danger' : level === 'Medium' ? 'warning' : 'success') as Tone,
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
    return {
      score: null as number | null,
      level: 'Medium',
      badgeLabel: 'Medium',
      tone: 'warning' as Tone,
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

function mapCapacityDecision(
  raw: unknown,
  idx: number,
  latest: {
    completedAt: Date;
    completedBy: { firstName: string | null; lastName: string | null } | null;
  },
) {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const has =
    d.hasCapacity === true ||
    /has/i.test(String(d.status ?? d.capacityStatus ?? '')) ||
    d.capacityIntact === true;
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
    reviewStatus: computeCarePlanReviewState({ nextReviewDueAt: instance.nextReviewDueAt }).status,
    summary,
  };
}
