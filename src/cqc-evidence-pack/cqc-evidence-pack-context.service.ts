import { Injectable } from '@nestjs/common';
import {
  CqcNotificationStatus,
  EmployeeComplianceStatus,
  EmployeeLifecycleStatus,
  FeedbackStatus,
  FeedbackType,
  ComplaintOutcome,
  IncidentSeverity,
  Prisma,
  SafeguardingStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { OrgScope } from '../common/org-scope/org-scope.types';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { allowedPrivacyLevels } from '../incidents/incident-access.util';
import type {
  PackKeyData,
  PackKeyGroup,
  PackServiceDetails,
} from './cqc-evidence-pack-pdf.util';

const SUPER_ADMIN = 'Super Admin';
/** Key data covers the last 12 months. */
const KEY_DATA_MONTHS = 12;

const RATING_WORDS: Record<string, string> = {
  OUTSTANDING: 'Outstanding',
  GOOD: 'Good',
  REQUIRES_IMPROVEMENT: 'Requires improvement',
  INADEQUATE: 'Inadequate',
};

/** "1 Main St, Croydon, CR0 1AA": the parts that are filled in. */
export function joinAddress(parts: Array<string | null | undefined>) {
  const text = parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(', ');
  return text || null;
}

/** "75% (30 of 40)", or "No records" when there is nothing to count. */
export function percentOf(part: number, whole: number) {
  if (!whole) return 'No records';
  return `${Math.round((part / whole) * 100)}% (${part} of ${whole})`;
}

/**
 * What an inspector asks for first, for the CQC evidence pack: the service's CQC registration (provider and each
 * registered branch) and key figures from the last 12 months (people supported, staff, incidents, safeguarding,
 * complaints, CQC notifications, training and checks). Counts only, no names. Each figure follows the same branch
 * scope as the pack and is left out when the user may not see its source.
 */
@Injectable()
export class CqcEvidencePackContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
  ) {}

  private can(user: RequestUser, ...permissions: string[]) {
    return (
      Boolean(user.roles?.includes(SUPER_ADMIN)) ||
      permissions.some((p) => user.permissions?.includes(p))
    );
  }

  /** The branches the pack covers: the one chosen, else the user's (null = every branch). */
  private branchIds(scope: OrgScope, locationId?: string) {
    return locationId ? [locationId] : scope.locationIds;
  }

  // ─── Service details ──────────────────────────────────────────────────────

  async serviceDetails(
    scope: OrgScope,
    locationId?: string,
  ): Promise<PackServiceDetails> {
    const ids = this.branchIds(scope, locationId);
    const [profile, areas] = await Promise.all([
      this.prisma.companyProfile.findFirst({
        select: {
          companyName: true,
          legalName: true,
          cqcProviderId: true,
          registeredAddressLine1: true,
          registeredAddressLine2: true,
          registeredTown: true,
          registeredCounty: true,
          registeredPostcode: true,
        },
      }),
      this.prisma.scheduleArea.findMany({
        where: {
          deletedAt: null,
          cqcLocationId: { not: null },
          ...(ids === null ? {} : { locationId: { in: ids } }),
        },
        orderBy: { name: 'asc' },
        select: {
          name: true,
          officialCqcName: true,
          cqcLocationId: true,
          address: true,
          addressLine1: true,
          addressLine2: true,
          town: true,
          county: true,
          postcode: true,
          phone: true,
          email: true,
          registeredManagers: true,
          nominatedIndividual: true,
          regulatedActivities: true,
          serviceTypes: true,
          cqcRegistrationDate: true,
          cqcRating: true,
          cqcRatingStatus: true,
        },
      }),
    ]);
    return {
      provider: {
        name: profile?.companyName ?? '',
        legalName: profile?.legalName ?? null,
        cqcProviderId: profile?.cqcProviderId ?? null,
        address: profile
          ? joinAddress([
              profile.registeredAddressLine1,
              profile.registeredAddressLine2,
              profile.registeredTown,
              profile.registeredCounty,
              profile.registeredPostcode,
            ])
          : null,
      },
      locations: areas.map((a) => ({
        name: a.officialCqcName || a.name,
        cqcLocationId: a.cqcLocationId,
        address:
          joinAddress([
            a.addressLine1,
            a.addressLine2,
            a.town,
            a.county,
            a.postcode,
          ]) ?? a.address,
        contact: joinAddress([a.phone, a.email]),
        registeredManagers: a.registeredManagers,
        nominatedIndividual: a.nominatedIndividual,
        regulatedActivities: a.regulatedActivities,
        serviceTypes: a.serviceTypes,
        registeredSince: a.cqcRegistrationDate,
        rating: a.cqcRating
          ? (RATING_WORDS[a.cqcRating] ?? a.cqcRating)
          : a.cqcRatingStatus === 'NOT_YET_RATED'
            ? 'Not yet rated'
            : null,
      })),
    };
  }

  // ─── Key data ─────────────────────────────────────────────────────────────

  async keyData(
    user: RequestUser,
    scope: OrgScope,
    locationId: string | undefined,
    now: Date,
  ): Promise<PackKeyData> {
    const from = new Date(now);
    from.setUTCMonth(from.getUTCMonth() - KEY_DATA_MONTHS);
    const ids = this.branchIds(scope, locationId);
    const branchScope: OrgScope = { ...scope, locationIds: ids };
    const inPeriod = { gte: from, lte: now };
    const byLocation = ids === null ? {} : { locationId: { in: ids } };

    const groups: PackKeyGroup[] = [];
    const hidden: string[] = [];
    const add = (
      title: string,
      allowed: boolean,
      load: () => Promise<PackKeyGroup['figures']>,
    ) => {
      if (!allowed) {
        hidden.push(title);
        return Promise.resolve();
      }
      return load().then((figures) => {
        groups.push({ title, figures });
      });
    };

    const staffWhere = (): Prisma.EmployeeWhereInput => ({
      AND: [
        { deletedAt: null, isActive: true },
        {
          OR: [
            { hrProfile: { is: null } },
            {
              hrProfile: {
                is: {
                  employeeLifecycleStatus: {
                    in: [
                      EmployeeLifecycleStatus.ACTIVE,
                      EmployeeLifecycleStatus.ACTIVE_PAUSED,
                      EmployeeLifecycleStatus.LEAVING,
                    ],
                  },
                },
              },
            },
          ],
        },
        (this.orgScope.employeeEmploymentScopeWhere(
          branchScope,
        ) as Prisma.EmployeeWhereInput) ?? {},
      ],
    });

    // One group at a time, in the order they are shown.
    await add(
      'People and staff',
      this.can(user, 'service_users.read') || this.can(user, 'employees.read'),
      async () => {
        const figures: PackKeyGroup['figures'] = [];
        if (this.can(user, 'service_users.read')) {
          const people = await this.prisma.serviceUser.count({
            where: {
              AND: [
                {
                  deletedAt: null,
                  isActive: true,
                  status: { is: { code: 'ACTIVE' } },
                },
                (this.orgScope.serviceUserScopeWhere(
                  branchScope,
                ) as Prisma.ServiceUserWhereInput) ?? {},
              ],
            },
          });
          figures.push({
            label: 'People supported now',
            value: String(people),
          });
        }
        if (this.can(user, 'employees.read')) {
          const staff = await this.prisma.employee.count({
            where: staffWhere(),
          });
          figures.push({ label: 'Staff employed now', value: String(staff) });
        }
        return figures;
      },
    );

    await add('Incidents', this.can(user, 'incidents.read'), async () => {
      const scoped = await this.orgScope.incidentScopeWhere(branchScope);
      const base: Prisma.IncidentWhereInput = {
        AND: [
          {
            deletedAt: null,
            isArchived: false,
            occurredAt: inPeriod,
            ...(user.roles?.includes(SUPER_ADMIN)
              ? {}
              : { privacyLevel: { in: allowedPrivacyLevels(user) } }),
          },
          (scoped as Prisma.IncidentWhereInput) ?? {},
        ],
      };
      const count = (extra: Prisma.IncidentWhereInput) =>
        this.prisma.incident.count({ where: { AND: [base, extra] } });
      const [all, serious, falls, medication] = await Promise.all([
        count({}),
        count({
          severity: {
            in: [IncidentSeverity.HIGH, IncidentSeverity.CRITICAL],
          },
        }),
        count({ subtype: { is: { key: 'FALL' } } }),
        count({ category: { is: { key: 'MEDICATION' } } }),
      ]);
      return [
        { label: 'Incidents reported', value: String(all) },
        { label: 'High or critical', value: String(serious) },
        { label: 'Falls', value: String(falls) },
        { label: 'Medication incidents', value: String(medication) },
      ];
    });

    await add(
      'Safeguarding',
      this.can(user, 'safeguarding.read', 'safeguarding.manage'),
      async () => {
        const where: Prisma.SafeguardingCaseWhereInput = {
          deletedAt: null,
          raisedAt: inPeriod,
          ...byLocation,
        };
        const [raised, open] = await Promise.all([
          this.prisma.safeguardingCase.count({ where }),
          this.prisma.safeguardingCase.count({
            where: { ...where, status: { not: SafeguardingStatus.CLOSED } },
          }),
        ]);
        return [
          {
            label: 'Concerns raised',
            value: String(raised),
            note: raised ? `${open} still open` : undefined,
          },
        ];
      },
    );

    await add(
      'Complaints and compliments',
      this.can(user, 'complaints.read'),
      async () => {
        const where: Prisma.FeedbackRecordWhereInput = {
          deletedAt: null,
          receivedAt: inPeriod,
          ...byLocation,
        };
        const complaint = { ...where, type: FeedbackType.COMPLAINT };
        const [complaints, upheld, open, compliments] = await Promise.all([
          this.prisma.feedbackRecord.count({ where: complaint }),
          this.prisma.feedbackRecord.count({
            where: {
              ...complaint,
              outcome: {
                in: [
                  ComplaintOutcome.UPHELD,
                  ComplaintOutcome.PARTIALLY_UPHELD,
                ],
              },
            },
          }),
          this.prisma.feedbackRecord.count({
            where: { ...complaint, status: { not: FeedbackStatus.CLOSED } },
          }),
          this.prisma.feedbackRecord.count({
            where: { ...where, type: FeedbackType.COMPLIMENT },
          }),
        ]);
        return [
          {
            label: 'Complaints',
            value: String(complaints),
            note: complaints
              ? `${upheld} upheld or partly upheld, ${open} still open`
              : undefined,
          },
          { label: 'Compliments', value: String(compliments) },
        ];
      },
    );

    await add(
      'CQC notifications',
      this.can(user, 'cqc_notifications.read'),
      async () => {
        const [rows, overdue] = await Promise.all([
          this.prisma.cqcNotification.findMany({
            where: {
              becameAwareAt: inPeriod,
              submittedAt: { not: null },
              ...byLocation,
            },
            select: { submittedAt: true, dueAt: true },
          }),
          this.prisma.cqcNotification.count({
            where: {
              status: {
                in: [CqcNotificationStatus.DRAFT, CqcNotificationStatus.READY],
              },
              dueAt: { lt: now },
              ...byLocation,
            },
          }),
        ]);
        const onTime = rows.filter(
          (r) => r.submittedAt!.getTime() <= r.dueAt.getTime(),
        ).length;
        return [
          {
            label: 'Sent to CQC',
            value: String(rows.length),
            note: rows.length ? `${onTime} on time` : undefined,
          },
          {
            label: 'Late and not sent yet',
            value: String(overdue),
          },
        ];
      },
    );

    await add(
      'Staff training and checks',
      this.can(
        user,
        'employees.compliance.reports.read',
        'employees.compliance.read',
        'employees.read',
      ),
      async () => {
        const record = (
          extra: Prisma.EmployeeComplianceWhereInput,
        ): Prisma.EmployeeComplianceWhereInput => ({
          deletedAt: null,
          employee: staffWhere(),
          status: {
            notIn: [
              EmployeeComplianceStatus.NOT_REQUIRED,
              EmployeeComplianceStatus.NO_LONGER_REQUIRED,
            ],
          },
          ...extra,
        });
        const inDate = {
          status: {
            in: [
              EmployeeComplianceStatus.VALID,
              EmployeeComplianceStatus.EXPIRING_SOON,
            ],
          },
        };
        const training = { complianceType: { is: { category: 'TRAINING' } } };
        const dbs = {
          complianceType: { is: { code: { in: ['DBS', 'DBS_CODE'] } } },
        } as Prisma.EmployeeComplianceWhereInput;
        const [trainingAll, trainingOk, dbsAll, dbsOk, supervisions] =
          await Promise.all([
            this.prisma.employeeCompliance.count({
              where: record(training as Prisma.EmployeeComplianceWhereInput),
            }),
            this.prisma.employeeCompliance.count({
              where: {
                AND: [
                  record(training as Prisma.EmployeeComplianceWhereInput),
                  inDate,
                ],
              },
            }),
            this.prisma.employeeCompliance.count({ where: record(dbs) }),
            this.prisma.employeeCompliance.count({
              where: { AND: [record(dbs), inDate] },
            }),
            this.prisma.supervisionSession.count({
              where: {
                deletedAt: null,
                completedAt: inPeriod,
                attendees: { some: { employee: staffWhere() } },
              },
            }),
          ]);
        return [
          {
            label: 'Required training in date',
            value: percentOf(trainingOk, trainingAll),
          },
          { label: 'DBS checks in date', value: percentOf(dbsOk, dbsAll) },
          { label: 'Supervisions held', value: String(supervisions) },
        ];
      },
    );

    return {
      from,
      to: now,
      groups: groups.filter((g) => g.figures.length),
      hidden,
    };
  }
}
