import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { operationalTodayIso } from '../common/utils/operational-day.util';
import { ComplianceReportsService } from '../compliance-reports/compliance-reports.service';
import { ServiceUserCarePlansService } from '../service-user-care-plans/service-user-care-plans.service';
import { ServiceUserAssessmentsService } from '../service-user-assessments/service-user-assessments.service';

export type ChecklistStatus = 'complete' | 'partial' | 'missing';

export type ChecklistItem = {
  key: string;
  label: string;
  description: string;
  status: ChecklistStatus;
  /** For "x of y" items. */
  count?: number;
  total?: number;
  /** For plain counts (e.g. number of charge cards). */
  value?: number;
  /** `value` counts problems (0 = nothing to fix), e.g. overdue measures. */
  problems?: boolean;
  /** Where to fix it (admin route). */
  link: string;
  /** Up to 10 records still missing it, each with its own fix link. */
  missing?: { id: string; name: string; link: string }[];
};

export type ChecklistSection = {
  key: string;
  title: string;
  items: ChecklistItem[];
};

const MISSING_SAMPLE = 10;
const LIVE_FUNDING: Prisma.ServiceUserFundingWhereInput = {
  deletedAt: null,
  isActive: true,
  status: { notIn: ['ENDED', 'REJECTED'] },
};

/** "x of y" → complete when all, missing when none (or nothing to check), partial otherwise. */
function coverageStatus(count: number, total: number): ChecklistStatus {
  if (total === 0 || count === 0) return 'missing';
  return count >= total ? 'complete' : 'partial';
}

const existsStatus = (n: number): ChecklistStatus =>
  n > 0 ? 'complete' : 'missing';

/**
 * Setup checklist: what the organisation has configured for service users, billing,
 * locations, payroll, invoicing and scheduling — and what is still missing.
 */
@Injectable()
export class SetupChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
    private readonly complianceReports: ComplianceReportsService,
    private readonly carePlans: ServiceUserCarePlansService,
    private readonly assessments: ServiceUserAssessmentsService,
  ) {}

  async getChecklist() {
    const activeSu: Prisma.ServiceUserWhereInput = {
      deletedAt: null,
      isActive: true,
    };
    const activeEmp: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      isActive: true,
    };

    const suWith: Record<string, Prisma.ServiceUserWhereInput> = {
      chargeCard: {
        OR: [
          { defaultChargeCardId: { not: null } },
          {
            fundings: {
              some: {
                ...LIVE_FUNDING,
                OR: [
                  { defaultChargeCardId: { not: null } },
                  { funder: { defaultChargeCardId: { not: null } } },
                ],
              },
            },
          },
        ],
      },
      funder: {
        fundings: { some: { ...LIVE_FUNDING, funderId: { not: null } } },
      },
      carePlan: {
        carePlanInstances: {
          some: {
            OR: [{ status: 'PUBLISHED' }, { publishedVersions: { some: {} } }],
          },
        },
      },
      visitPlan: {
        visitPlans: {
          some: { status: 'ACTIVE', isActive: true, deletedAt: null },
        },
      },
      branch: { locationId: { not: null } },
    };
    const empWith: Record<string, Prisma.EmployeeWhereInput> = {
      payCard: {
        employment: {
          is: { deletedAt: null, defaultPayCardId: { not: null } },
        },
      },
      branch: {
        employment: { is: { deletedAt: null, locationId: { not: null } } },
      },
      workingPattern: {
        workingPatterns: {
          some: { isAvailable: true, isActive: true, deletedAt: null },
        },
      },
    };

    const suTotal = await this.prisma.serviceUser.count({ where: activeSu });
    const empTotal = await this.prisma.employee.count({ where: activeEmp });

    const suCoverage = async (key: string, linkFor: (id: string) => string) => {
      const where = { AND: [activeSu, suWith[key]] };
      const [count, missing] = await Promise.all([
        this.prisma.serviceUser.count({ where }),
        this.prisma.serviceUser.findMany({
          where: { AND: [activeSu, { NOT: suWith[key] }] },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
          take: MISSING_SAMPLE,
        }),
      ]);
      return {
        count,
        total: suTotal,
        status: coverageStatus(count, suTotal),
        missing: missing.map((s) => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
          link: linkFor(s.id),
        })),
      };
    };

    const empCoverage = async (key: string) => {
      const where = { AND: [activeEmp, empWith[key]] };
      const [count, missing] = await Promise.all([
        this.prisma.employee.count({ where }),
        this.prisma.employee.findMany({
          where: { AND: [activeEmp, { NOT: empWith[key] }] },
          select: {
            id: true,
            personalDetail: { select: { firstName: true, lastName: true } },
          },
          take: MISSING_SAMPLE,
        }),
      ]);
      return {
        count,
        total: empTotal,
        status: coverageStatus(count, empTotal),
        missing: missing.map((e) => ({
          id: e.id,
          name:
            `${e.personalDetail?.firstName ?? ''} ${e.personalDetail?.lastName ?? ''}`.trim() ||
            'Employee',
          link: `/employee/${e.id}/edit`,
        })),
      };
    };

    const [
      suChargeCard,
      suFunder,
      suCarePlan,
      suVisitPlan,
      suBranch,
      empPayCard,
      empBranch,
      empPattern,
      chargeCards,
      payCards,
      zones,
      locations,
      scheduleAreas,
      employer,
      currentTaxYear,
      schedules,
      payrollReady,
      company,
      funders,
      fundersWithContact,
    ] = await Promise.all([
      suCoverage('chargeCard', (id) => `/service-users/${id}?tab=charge-card`),
      suCoverage('funder', (id) => `/service-users/${id}?tab=funding`),
      suCoverage('carePlan', (id) => `/service-users/${id}/care-plan`),
      suCoverage('visitPlan', (id) => `/service-users/${id}/visit-plan`),
      suCoverage('branch', (id) => `/service-users/${id}`),
      empCoverage('payCard'),
      empCoverage('branch'),
      empCoverage('workingPattern'),
      this.prisma.chargeCard.count({
        where: { deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.payCard.count({
        where: { deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.zone.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.location.count({
        where: { deletedAt: null, isActive: true },
      }),
      this.prisma.scheduleArea.count({
        where: { deletedAt: null, isActive: true },
      }),
      this.prisma.payrollEmployerSettings.findFirst({
        select: { employerPayeReference: true, accountsOfficeReference: true },
      }),
      this.prisma.payrollTaxYear.count({
        where: { deletedAt: null, isCurrent: true, status: 'ACTIVE' },
      }),
      this.prisma.payrollSchedule.count({
        where: { deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.employeePayrollProfile.count({
        where: {
          deletedAt: null,
          status: 'READY',
          employeeId: { in: await this.activeEmployeeIds() },
        },
      }),
      this.prisma.companyProfile.findFirst({
        select: {
          companyName: true,
          email: true,
          phoneNumber: true,
          bankAccountNumber: true,
        },
      }),
      this.prisma.funder.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.funder.count({
        where: {
          deletedAt: null,
          isActive: true,
          email: { not: null },
          addressLine1: { not: null },
          postcode: { not: null },
        },
      }),
    ]);

    const companyComplete = Boolean(
      company?.companyName?.trim() &&
      company.email?.trim() &&
      company.phoneNumber?.trim(),
    );
    const employerComplete = Boolean(
      employer?.employerPayeReference?.trim() &&
      employer.accountsOfficeReference?.trim(),
    );

    const sections: ChecklistSection[] = [
      {
        key: 'service-users',
        title: 'Service users',
        items: [
          {
            key: 'su-charge-card',
            label: 'Service users with a charge card',
            description:
              'Each active service user needs a charge card (on the service user, funding line or funder) to be invoiced.',
            link: '/billing?tab=charge-cards',
            ...suChargeCard,
          },
          {
            key: 'su-funder',
            label: 'Service users with a funder attached',
            description:
              'An active funding line with a funder tells invoicing who pays.',
            link: '/billing?tab=funding-contracts',
            ...suFunder,
          },
          {
            key: 'su-care-plan',
            label: 'Service users with a care plan',
            description:
              'At least one published care plan per active service user.',
            link: '/service-users/all',
            ...suCarePlan,
          },
        ],
      },
      {
        key: 'cards',
        title: 'Charge cards & pay cards',
        items: [
          {
            key: 'charge-cards',
            label: 'Charge cards',
            description:
              'Active charge cards set the rates you invoice funders.',
            link: '/billing?tab=charge-cards',
            value: chargeCards,
            status: existsStatus(chargeCards),
          },
          {
            key: 'pay-cards',
            label: 'Pay cards',
            description: 'Active pay cards set the rates you pay carers.',
            link: '/billing?tab=pay-cards',
            value: payCards,
            status: existsStatus(payCards),
          },
          {
            key: 'emp-pay-card',
            label: 'Employees with a pay card',
            description:
              'Each active employee needs a default pay card for visit pay.',
            link: '/billing?tab=pay-cards',
            ...empPayCard,
          },
        ],
      },
      {
        key: 'locations',
        title: 'Zones & locations',
        items: [
          {
            key: 'zones',
            label: 'Zones',
            description: 'Zones group your branches.',
            link: '/settings/location-management?sub=zones',
            value: zones,
            status: existsStatus(zones),
          },
          {
            key: 'locations',
            label: 'Locations / branches',
            description: 'Branches that service users and staff belong to.',
            link: '/settings/location-management?sub=zones',
            value: locations,
            status: existsStatus(locations),
          },
          {
            key: 'su-branch',
            label: 'Service users linked to a branch',
            description: 'Needed for branch access, scheduling and reports.',
            link: '/settings/location-management?sub=service-users',
            ...suBranch,
          },
        ],
      },
      {
        key: 'payroll',
        title: 'Payroll setup',
        items: [
          {
            key: 'payroll-employer',
            label: 'Employer PAYE details',
            description:
              'Employer PAYE reference and Accounts Office reference.',
            link: '/payroll/employer',
            status: employerComplete ? 'complete' : 'missing',
          },
          {
            key: 'payroll-tax-year',
            label: 'Current tax year active',
            description: 'An active current tax year is needed to run payroll.',
            link: '/payroll/tax-years',
            status: currentTaxYear > 0 ? 'complete' : 'missing',
          },
          {
            key: 'payroll-schedules',
            label: 'Pay schedules',
            description: 'At least one active pay schedule (weekly / monthly).',
            link: '/payroll/schedules',
            value: schedules,
            status: existsStatus(schedules),
          },
          {
            key: 'payroll-profiles',
            label: 'Employees ready for payroll',
            description:
              'Employees whose payroll profile (tax code, NI, bank) is marked Ready.',
            link: '/payroll/employees',
            count: payrollReady,
            total: empTotal,
            status: coverageStatus(payrollReady, empTotal),
          },
        ],
      },
      {
        key: 'invoices',
        title: 'Invoicing essentials',
        items: [
          {
            key: 'company',
            label: 'Company details',
            description: 'Company name, email and phone printed on invoices.',
            link: '/settings/company',
            status: companyComplete ? 'complete' : 'missing',
          },
          {
            key: 'company-bank',
            label: 'Company bank details',
            description:
              'Bank account shown on invoices so funders can pay you.',
            link: '/settings/company',
            status: company?.bankAccountNumber?.trim() ? 'complete' : 'missing',
          },
          {
            key: 'funders',
            label: 'Funders with contact and address',
            description:
              'Active funders need an email and billing address to receive invoices.',
            link: '/billing?tab=funding-contracts',
            count: fundersWithContact,
            total: funders,
            status: coverageStatus(fundersWithContact, funders),
          },
        ],
      },
      {
        key: 'scheduling',
        title: 'Scheduling essentials',
        items: [
          {
            key: 'schedule-areas',
            label: 'Schedule areas',
            description: 'Branch areas used to plan rotas.',
            link: '/settings/location-management?sub=zones',
            value: scheduleAreas,
            status: existsStatus(scheduleAreas),
          },
          {
            key: 'su-visit-plan',
            label: 'Service users with an active visit plan',
            description: 'Visits are only created from active visit plans.',
            link: '/service-users/all',
            ...suVisitPlan,
          },
          {
            key: 'emp-branch',
            label: 'Employees linked to a branch',
            description: 'Staff need a branch to be offered visits there.',
            link: '/settings/location-management?sub=employees',
            ...empBranch,
          },
          {
            key: 'emp-pattern',
            label: 'Employees with working hours',
            description:
              'An available working pattern so they can be allocated visits.',
            link: '/hr/employees',
            ...empPattern,
          },
        ],
      },
    ];

    sections.push(...(await this.moduleSections(suTotal)));
    sections.push(...(await this.peopleSections()));

    const items = sections.flatMap((s) => s.items);
    return {
      message: 'Setup checklist',
      data: {
        sections,
        summary: {
          complete: items.filter((i) => i.status === 'complete').length,
          total: items.length,
        },
      },
    };
  }

  /** Incidents & accidents, surveys and office salaries. */
  private async moduleSections(suTotal: number): Promise<ChecklistSection[]> {
    const openIncident: Prisma.IncidentWhereInput = {
      deletedAt: null,
      isArchived: false,
      status: { not: 'CLOSED' },
    };
    // Branch staff can only see incidents with a branch or a linked service user.
    const noBranch: Prisma.IncidentWhereInput = {
      locationId: null,
      primaryServiceUserId: null,
      involvedServiceUserIds: { isEmpty: true },
    };
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const month = operationalTodayIso(new Date(), timeZone).slice(0, 7);
    const activeUsers = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
    });
    const activeUserIds = activeUsers.map((u) => u.id);

    const [
      categories,
      openTotal,
      openWithOwner,
      ownerless,
      overdueMeasures,
      noBranchCount,
      noBranchSample,
      surveys,
      activeSurveys,
      suWithPortal,
      suWithoutPortal,
      salaries,
      paymentsThisMonth,
    ] = await Promise.all([
      this.prisma.incidentCategory.count({
        where: { deletedAt: null, isActive: true },
      }),
      this.prisma.incident.count({ where: openIncident }),
      this.prisma.incident.count({
        where: { ...openIncident, ownerId: { not: null } },
      }),
      this.prisma.incident.findMany({
        where: { ...openIncident, ownerId: null },
        select: { id: true, referenceNumber: true },
        orderBy: { occurredAt: 'desc' },
        take: MISSING_SAMPLE,
      }),
      this.prisma.incidentAction.count({
        where: {
          deletedAt: null,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          dueDate: { lt: new Date() },
          incident: openIncident,
        },
      }),
      this.prisma.incident.count({ where: { ...openIncident, ...noBranch } }),
      this.prisma.incident.findMany({
        where: { ...openIncident, ...noBranch },
        select: { id: true, referenceNumber: true },
        orderBy: { occurredAt: 'desc' },
        take: MISSING_SAMPLE,
      }),
      this.prisma.survey.count({ where: { deletedAt: null } }),
      this.prisma.survey.count({
        where: { deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.serviceUser.count({
        where: {
          deletedAt: null,
          isActive: true,
          portalAccount: { is: { isEnabled: true, deletedAt: null } },
        },
      }),
      this.prisma.serviceUser.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          NOT: { portalAccount: { is: { isEnabled: true, deletedAt: null } } },
        },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: MISSING_SAMPLE,
      }),
      this.prisma.officeUserSalary.findMany({
        where: { userId: { in: activeUserIds }, isActive: true },
        select: { userId: true, bankSortCode: true, bankAccountNumber: true },
      }),
      this.prisma.officeSalaryPayment.findMany({
        where: { month, userId: { in: activeUserIds } },
        select: { userId: true },
      }),
    ]);

    const incidentRef = (i: { id: string; referenceNumber: string }) => ({
      id: i.id,
      name: i.referenceNumber,
      link: `/incidents/${i.id}`,
    });
    const salaryUserIds = new Set(salaries.map((s) => s.userId));
    const withBank = salaries.filter(
      (s) => s.bankSortCode && s.bankAccountNumber,
    ).length;
    const unsalaried = activeUsers.filter((u) => !salaryUserIds.has(u.id));
    const paidThisMonth = paymentsThisMonth.filter((p) =>
      salaryUserIds.has(p.userId),
    ).length;
    const ownerStatus: ChecklistStatus =
      openTotal === 0 || openWithOwner === openTotal
        ? 'complete'
        : openWithOwner === 0
          ? 'missing'
          : 'partial';

    return [
      {
        key: 'incidents',
        title: 'Incidents & accidents',
        items: [
          {
            key: 'incident-categories',
            label: 'Incident categories',
            description:
              'Active categories (fall, medication, safeguarding…) used when raising incidents.',
            link: '/incidents/raise',
            value: categories,
            status: existsStatus(categories),
          },
          {
            key: 'incident-owners',
            label: 'Open incidents with an owner',
            description:
              'Every open incident should have a manager responsible for it.',
            link: '/incidents/view?open=true',
            count: openWithOwner,
            total: openTotal,
            status: ownerStatus,
            missing: ownerless.map(incidentRef),
          },
          {
            key: 'incident-overdue',
            label: 'Overdue corrective measures',
            description:
              'Corrective measures past their due date on open incidents.',
            link: '/incidents/view?overdue=true',
            value: overdueMeasures,
            problems: true,
            status: overdueMeasures === 0 ? 'complete' : 'missing',
          },
          {
            key: 'incident-no-branch',
            label: 'Open incidents without a branch',
            description:
              'Incidents with no branch or service user are hidden from branch staff.',
            link: '/incidents/view?open=true',
            value: noBranchCount,
            problems: true,
            status: noBranchCount === 0 ? 'complete' : 'missing',
            missing: noBranchSample.map(incidentRef),
          },
        ],
      },
      {
        key: 'surveys',
        title: 'Surveys',
        items: [
          {
            key: 'surveys-created',
            label: 'Surveys created',
            description: 'Survey forms for staff or service-user feedback.',
            link: '/surveys',
            value: surveys,
            status: existsStatus(surveys),
          },
          {
            key: 'surveys-active',
            label: 'Active surveys',
            description: 'Surveys currently open for responses.',
            link: '/surveys',
            value: activeSurveys,
            status: existsStatus(activeSurveys),
          },
          {
            key: 'su-portal',
            label: 'Service users with portal access',
            description:
              'Service-user surveys are answered in the Service User Portal.',
            link: '/admin/service-user-portal',
            count: suWithPortal,
            total: suTotal,
            status: coverageStatus(suWithPortal, suTotal),
            missing: suWithoutPortal.map((s) => ({
              id: s.id,
              name: `${s.firstName} ${s.lastName}`.trim(),
              link: '/admin/service-user-portal',
            })),
          },
        ],
      },
      {
        key: 'office-salaries',
        title: 'Office salaries',
        items: [
          {
            key: 'office-salary-setup',
            label: 'Office users with a salary',
            description:
              'Office users on your payroll need their salary set up (skip anyone you do not pay).',
            link: '/office-salaries',
            count: salaries.length,
            total: activeUsers.length,
            status: coverageStatus(salaries.length, activeUsers.length),
            missing: unsalaried.slice(0, MISSING_SAMPLE).map((u) => ({
              id: u.id,
              name:
                [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
                u.email,
              link: '/office-salaries',
            })),
          },
          {
            key: 'office-salary-paid',
            label: 'Salaries paid this month',
            description: `Active salaries marked as paid for ${month}.`,
            link: '/office-salaries',
            count: paidThisMonth,
            total: salaries.length,
            status: coverageStatus(paidThisMonth, salaries.length),
          },
          {
            key: 'office-salary-bank',
            label: 'Bank details recorded',
            description: 'Sort code and account number for each active salary.',
            link: '/office-salaries',
            count: withBank,
            total: salaries.length,
            status: coverageStatus(withBank, salaries.length),
          },
        ],
      },
    ];
  }

  /** Employee compliance, carer app access, care plan / assessment reviews, roles & users. */
  private async peopleSections(): Promise<ChecklistSection[]> {
    const employees = await this.prisma.employee.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        personalDetail: { select: { firstName: true, lastName: true } },
        portalAccount: {
          select: { isEnabled: true, deletedAt: true, lastLoginAt: true },
        },
      },
      orderBy: { personalDetail: { firstName: 'asc' } },
    });

    const [
      requirements,
      board,
      carePlanQueue,
      assessmentQueue,
      branches,
      users,
    ] = await Promise.all([
      this.prisma.complianceRequirement.count({
        where: { deletedAt: null, isActive: true },
      }),
      // Same rows as the Compliance board (no actor → no report-view audit entry).
      this.complianceReports.board({}),
      this.carePlans.reviewQueue({ status: 'overdue' }),
      this.assessments.reviewQueue({ alertsOnly: true }),
      this.prisma.location.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          name: true,
          userLocations: {
            where: { user: { deletedAt: null, isActive: true } },
            select: { id: true },
            take: 1,
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          userRoles: { select: { id: true }, take: 1 },
        },
        orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
      }),
    ]);

    type Emp = (typeof employees)[number];
    const empRef = (e: Emp, tab: string) => ({
      id: e.id,
      name:
        `${e.personalDetail?.firstName ?? ''} ${e.personalDetail?.lastName ?? ''}`.trim() ||
        'Employee',
      link: `/employee/${e.id}/edit?tab=${tab}`,
    });
    const boardRows = board.data.rows;
    const notCompliant = boardRows.filter(
      (r) => r.overallDisplayStatus !== 'COMPLIANT',
    );
    const compliantCount = boardRows.length - notCompliant.length;
    const expiringWithin30 =
      board.data.summary.expiring7Count + board.data.summary.expiring8To30Count;
    const withApp = employees.filter(
      (e) => e.portalAccount?.isEnabled && !e.portalAccount.deletedAt,
    );
    const withoutApp = employees.filter((e) => !withApp.includes(e));
    const appNeverUsed = withApp.filter((e) => !e.portalAccount?.lastLoginAt);

    const overdueAssessments = assessmentQueue.data.filter(
      (item) => item.review.status === 'overdue',
    );
    const dueSoonAssessments = assessmentQueue.meta.dueSoonCount;
    const dueSoonCarePlans = carePlanQueue.meta.dueSoonCount;

    const branchesWithUser = branches.filter((b) => b.userLocations.length > 0);
    const usersWithoutRole = users.filter((u) => u.userRoles.length === 0);
    const userName = (u: (typeof users)[number]) =>
      [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;

    const appUsed = withApp.length - appNeverUsed.length;

    return [
      {
        key: 'employee-compliance',
        title: 'Employee compliance',
        items: [
          {
            key: 'compliance-requirements',
            label: 'Compliance requirements',
            description:
              'Documents staff must hold (DBS, right to work, …) set up in Settings.',
            link: '/settings?tab=compliance-requirements',
            value: requirements,
            status: existsStatus(requirements),
          },
          {
            key: 'employees-compliant',
            label: 'Employees fully compliant',
            description:
              'Every required document present, approved and in date — as on the Compliance board.',
            link: '/employee/compliance',
            count: compliantCount,
            total: boardRows.length,
            status: coverageStatus(compliantCount, boardRows.length),
            missing: notCompliant.slice(0, MISSING_SAMPLE).map((r) => ({
              id: r.employeeId,
              name: r.employeeName,
              link: `/employee/${r.employeeId}/edit?tab=employment-compliance`,
            })),
          },
          {
            key: 'documents-expiring',
            label: 'Employees with documents expiring in 30 days',
            description: 'Renew these before they expire.',
            link: '/employee/compliance',
            value: expiringWithin30,
            problems: true,
            status: expiringWithin30 === 0 ? 'complete' : 'partial',
          },
        ],
      },
      {
        key: 'carer-app',
        title: 'Carer app access',
        items: [
          {
            key: 'app-access',
            label: 'Employees with carer app access',
            description:
              'An enabled carer app login (set up on the employee Personal Details tab).',
            link: '/employee/staff-list',
            count: withApp.length,
            total: employees.length,
            status: coverageStatus(withApp.length, employees.length),
            missing: withoutApp
              .slice(0, MISSING_SAMPLE)
              .map((e) => empRef(e, 'personal')),
          },
          {
            key: 'app-signed-in',
            label: 'App logins used',
            description:
              'Employees with app access who have signed in at least once.',
            link: '/employee/staff-list',
            count: appUsed,
            total: withApp.length,
            status: coverageStatus(appUsed, withApp.length),
            missing: appNeverUsed
              .slice(0, MISSING_SAMPLE)
              .map((e) => empRef(e, 'personal')),
          },
        ],
      },
      {
        key: 'reviews',
        title: 'Care plan & assessment reviews',
        items: [
          {
            key: 'care-plan-reviews',
            label: 'Overdue care plan reviews',
            description: `Published care plans past their next review date${
              dueSoonCarePlans ? ` · ${dueSoonCarePlans} due soon` : ''
            }.`,
            link: '/care-plans/reviews',
            value: carePlanQueue.meta.overdueCount,
            problems: true,
            status:
              carePlanQueue.meta.overdueCount === 0 ? 'complete' : 'missing',
            missing: carePlanQueue.data
              .slice(0, MISSING_SAMPLE)
              .map((item) => ({
                id: item.instanceId,
                name: `${item.serviceUserName} · ${item.carePlanName}`,
                link: `/service-users/${item.serviceUserId}/care-plan`,
              })),
          },
          {
            key: 'assessment-reviews',
            label: 'Overdue assessment reviews',
            description: `Assessments past their CQC / NICE review schedule${
              dueSoonAssessments ? ` · ${dueSoonAssessments} due soon` : ''
            }.`,
            link: '/assessments/review-queue',
            value: overdueAssessments.length,
            problems: true,
            status: overdueAssessments.length === 0 ? 'complete' : 'missing',
            missing: overdueAssessments
              .slice(0, MISSING_SAMPLE)
              .map((item) => ({
                id: item.assessmentId,
                name: `${item.serviceUserName ?? 'Service user'} · ${item.assessmentTitle}`,
                link: `/service-users/${item.serviceUserId}/care-plan`,
              })),
          },
        ],
      },
      {
        key: 'roles-users',
        title: 'Roles & users',
        items: [
          {
            key: 'branch-users',
            label: 'Branches with an office user',
            description:
              'At least one office user assigned to each branch (Super Admin and Admin see all branches anyway).',
            link: '/settings/roles-permissions?sub=office-users',
            count: branchesWithUser.length,
            total: branches.length,
            status: coverageStatus(branchesWithUser.length, branches.length),
            missing: branches
              .filter((b) => b.userLocations.length === 0)
              .slice(0, MISSING_SAMPLE)
              .map((b) => ({
                id: b.id,
                name: b.name,
                link: '/settings/roles-permissions?sub=office-users',
              })),
          },
          {
            key: 'users-with-role',
            label: 'Office users with a role',
            description: 'A user without a role cannot open any page.',
            link: '/settings/roles-permissions?sub=office-users',
            count: users.length - usersWithoutRole.length,
            total: users.length,
            status: coverageStatus(
              users.length - usersWithoutRole.length,
              users.length,
            ),
            missing: usersWithoutRole.slice(0, MISSING_SAMPLE).map((u) => ({
              id: u.id,
              name: userName(u),
              link: '/settings/roles-permissions?sub=office-users',
            })),
          },
        ],
      },
    ];
  }

  private async activeEmployeeIds(): Promise<string[]> {
    const rows = await this.prisma.employee.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
