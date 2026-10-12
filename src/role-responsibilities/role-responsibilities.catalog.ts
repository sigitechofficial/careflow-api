/**
 * Plain-language jobs ("Create payroll", "Manage visits & rota") mapped to permission keys.
 *
 * - `view`: needed to open the pages. Given to the chosen roles; never removed from others
 *   (read access is shared across modules).
 * - `act`: needed to do the job. Given to the chosen roles and removed from every other role
 *   except Super Admin / Admin, who always keep everything.
 */
export type RoleResponsibility = {
  key: string;
  label: string;
  description: string;
  view: string[];
  act: string[];
  /**
   * Financial authorisation: not held by Super Admin / Admin automatically. Only the roles chosen
   * here get it, and an admin role can be chosen like any other.
   */
  explicitOnly?: boolean;
};

export const ROLE_RESPONSIBILITIES: RoleResponsibility[] = [
  {
    key: 'approve-pay',
    label: 'Approve pay and record payments',
    description:
      'Approve and lock carer pay runs, close or reopen UK payroll runs, approve payout batches and record the bank payment. Must be a different person from the one who prepared them.',
    view: [
      'billing.payroll_runs.read',
      'billing.employee_payouts.read',
      'billing.visit_reconciliations.read',
      'payroll.runs.read',
    ],
    act: [
      'billing.payroll_runs.approve',
      'billing.employee_payouts.approve',
      'billing.employee_payouts.settle',
      'payroll.runs.close',
      'payroll.runs.reopen',
      // These records cover every branch, so approving them needs organisation-wide pay access.
      'payroll.scope.organisation',
    ],
    explicitOnly: true,
  },
  {
    key: 'payroll',
    label: 'Create payroll (UK payroll)',
    description: 'Run payroll, manage pay periods and employee payroll setup.',
    view: [
      'payroll.runs.read',
      'payroll.periods.read',
      'payroll.employees.read',
      'payroll.settings.read',
    ],
    act: [
      'payroll.runs.manage',
      'payroll.periods.manage',
      'payroll.employees.manage',
    ],
  },
  {
    key: 'carer-pay',
    label: 'Carer pay & payouts',
    description: 'Carer pay runs, employee payouts and pay cards.',
    view: [
      'billing.payroll_runs.read',
      'billing.employee_payouts.read',
      'billing.pay_cards.read',
    ],
    act: [
      'billing.payroll_runs.manage',
      'billing.employee_payouts.manage',
      'billing.pay_cards.manage',
    ],
  },
  {
    key: 'office-salaries',
    label: 'Office salaries',
    description: 'Set office user salaries and record monthly payments.',
    view: [],
    act: ['office_salaries.manage'],
  },
  {
    key: 'invoices',
    label: 'Invoices & funder billing',
    description: 'Invoice runs, invoice templates, charge cards and payments.',
    view: [
      'billing.invoice_runs.read',
      'billing.invoice_templates.read',
      'billing.charge_cards.read',
      'billing.payments.read',
      'billing.funding_contracts.read',
    ],
    act: [
      'billing.invoice_runs.manage',
      'billing.invoice_templates.manage',
      'billing.charge_cards.manage',
      'billing.payments.manage',
    ],
  },
  {
    key: 'visit-reconciliation',
    label: 'Visit reconciliation',
    description: 'Review completed visits before pay and invoicing.',
    view: ['billing.visit_reconciliations.read'],
    act: ['billing.visit_reconciliations.manage'],
  },
  {
    key: 'visits-rota',
    label: 'Manage visits & rota',
    description:
      'Create and change visits, allocate carers, rota runs and call-offs.',
    view: [
      'schedules.read',
      'schedules.status.read',
      'scheduled_jobs.read',
      'scheduled_visits.read',
      'schedule_timelines.read',
      'schedule_areas.read',
      'schedule_runs.read',
      'job_allocations.read',
      'call_off_visits.read',
      'schedule_filters.carers',
      'schedule_filters.customers',
      'schedule_filters.jobs',
      'schedule_reports.read',
    ],
    act: [
      'scheduled_jobs.create',
      'scheduled_jobs.update',
      'scheduled_jobs.status.update',
      'scheduled_visits.create',
      'scheduled_visits.update',
      'scheduled_visits.status.update',
      'schedule_runs.create',
      'schedule_runs.update',
      'job_allocations.create',
      'job_allocations.confirm',
      'job_allocations.delete',
      'call_off_visits.create',
      'call_off_visits.update',
      'call_off_visits.approve',
      'call_off_visits.reject',
    ],
  },
  {
    key: 'service-users',
    label: 'Add & update service users',
    description: 'Add new service users and edit their details.',
    view: ['service_users.read'],
    act: ['service_users.create', 'service_users.update'],
  },
  {
    key: 'care-plans',
    label: 'Care plans & visit plans',
    description: 'Assessments, care plan text, visit plans and visit tasks.',
    view: [
      'service_users.read',
      'service_users.assessments.read',
      'care_plan_text.read',
      'service_users.visit_plan.read',
      'service_users.visit_tasks.read',
    ],
    act: [
      'service_users.assessments.create',
      'service_users.assessments.link',
      'care_plan_text.create',
      'care_plan_text.update',
      'service_users.visit_plan.write',
      'service_users.visit_plan.activate',
      'service_users.visit_tasks.write',
    ],
  },
  {
    key: 'employees',
    label: 'Add & update employees',
    description: 'Add new employees and edit their details and status.',
    view: ['employees.read'],
    act: ['employees.create', 'employees.update', 'employees.status.update'],
  },
  {
    key: 'staff-compliance',
    label: 'Staff compliance documents',
    description:
      'Upload, verify and reject DBS, right to work and other staff documents.',
    view: [
      'employees.read',
      'employees.compliance.read',
      'employees.compliance.reports.read',
    ],
    act: [
      'employees.compliance.create',
      'employees.compliance.update',
      'employees.compliance.verify',
      'employees.compliance.reject',
      'employees.compliance.delete',
      'employees.compliance.documents.upload',
      'employees.compliance.documents.download',
      'employees.compliance.documents.delete',
      'employees.compliance.reports.export',
    ],
  },
  {
    key: 'recruitment',
    label: 'Recruitment',
    description:
      'Vacancies, candidates and converting candidates to employees.',
    view: ['hr.read', 'hr.vacancies.read', 'hr.candidates.read'],
    act: [
      'hr.vacancies.create',
      'hr.vacancies.update',
      'hr.candidates.create',
      'hr.candidates.update',
      'hr.candidates.convert',
      'hr.profile.create',
      'hr.profile.update',
      'hr.documents.upload',
      'hr.documents.delete',
    ],
  },
  {
    key: 'hours-approvals',
    label: 'Approve extra hours',
    description: 'Approve or reject over-contracted-hours requests.',
    view: ['hours_approvals.read'],
    act: ['hours_approvals.manage'],
  },
  {
    key: 'training',
    label: 'Training (Learning)',
    description: 'Courses, assignments, training events and certificates.',
    view: [
      'learning.dashboard.read',
      'learning.courses.read',
      'learning.assignments.read',
    ],
    act: [
      'learning.courses.manage',
      'learning.assignments.manage',
      'learning.training_events.manage',
      'learning.certificates.manage',
    ],
  },
  {
    key: 'incidents',
    label: 'Manage incidents',
    description:
      'Assign, investigate, review and close incidents (anyone can still raise one).',
    view: ['incidents.read'],
    act: [
      'incidents.update',
      'incidents.assign',
      'incidents.investigate',
      'incidents.review',
      'incidents.close',
      'incidents.reopen',
    ],
  },
  {
    key: 'complaints',
    label: 'Complaints & compliments',
    description:
      'Record complaints and compliments, acknowledge, investigate, respond and close complaints.',
    view: ['complaints.read'],
    act: ['complaints.manage'],
  },
  {
    key: 'surveys',
    label: 'Surveys',
    description: 'Build, send and review staff and service user surveys.',
    view: ['surveys.read'],
    act: ['surveys.manage'],
  },
  {
    key: 'survey_responses',
    label: 'Record survey responses',
    description:
      'Record survey answers by telephone, from paper or in person, on someone\'s behalf or anonymously.',
    view: ['surveys.read'],
    act: ['surveys.responses.record'],
  },
];

/**
 * Which permission rows to add and remove when a responsibility is given to `selectedRoleIds`.
 * Admin roles always get everything and never lose anything.
 */
export function planResponsibilityChange(
  responsibility: Pick<RoleResponsibility, 'view' | 'act'>,
  allRoleIds: string[],
  selectedRoleIds: string[],
  adminRoleIds: string[],
): {
  grant: Array<{ roleId: string; keys: string[] }>;
  revoke: Array<{ roleId: string; keys: string[] }>;
} {
  const owners = new Set([...selectedRoleIds, ...adminRoleIds]);
  const allKeys = [...new Set([...responsibility.view, ...responsibility.act])];
  return {
    grant: [...owners].map((roleId) => ({ roleId, keys: allKeys })),
    revoke: allRoleIds
      .filter((roleId) => !owners.has(roleId))
      .map((roleId) => ({ roleId, keys: responsibility.act })),
  };
}
