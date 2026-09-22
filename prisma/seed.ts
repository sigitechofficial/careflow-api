import { ComplianceCategory, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { defaultJobTitles } from './seed-data/default-job-titles';
import { WORKFORCE_CERTIFICATION_NAMES, WORKFORCE_SKILL_NAMES } from './seed-data/workforce-catalog';
import { DEFAULT_INCIDENT_CATEGORIES } from './seed-data/incident-categories';
import { CARE_COMPLIANCE_CATALOG } from './seed-data/care-compliance-catalog';
import { seedInitialAssessmentChecklist } from './seeds/initial-assessment-checklist.seed';
import { seedInitialAssessmentEnterprise } from './seeds/initial-assessment-enterprise.seed';
import { seedBodyMapRecordTypeCatalog } from './seeds/body-map-record-type-catalog.seed';
import { seedScheduleAreas } from './seeds/schedule-areas.seed';
import { seedServiceUserAreas } from './seeds/service-user-areas.seed';
import { seedServiceUserObservations } from './seeds/service-user-observations.seed';
import { seedCompanyProfile } from './seeds/company-profile.seed';
import { seedOrganisationGeneralSettings } from './seeds/organisation-general-settings.seed';
import { seedCarePathway } from './seeds/care-pathway.seed';
import { seedTaskCatalogue } from './seeds/task-catalogue.seed';
import { seedInitialAssessmentCarePlanRules } from './seeds/initial-assessment-care-plan-rules.seed';
import { seedDemoServiceUserData } from './seeds/demo-service-user-data.seed';
import { resetAndSeedBodyMapDemo } from './seeds/body-map-demo.seed';
import { seedInitialAssessmentDemoServiceUser } from './seeds/initial-assessment-demo-service-user.seed';
import { seedServiceUserPersonas } from './seeds/service-user-personas.seed';
import { seedGreenwichBranchUsers } from './seeds/greenwich-branch-users.seed';
import { seedGreenwichServiceUsers } from './seeds/greenwich-service-users.seed';
import { seedGreenwichManagerAttention } from './seeds/greenwich-manager-attention.seed';
import { seedServiceUserDocumentTypeCatalog } from './seeds/service-user-document-type-catalog.seed';
import { seedPersonaSchedule } from './seeds/persona-schedule.seed';
import { applyCarePlanIaDemoOverlay } from './seeds/care-plan-ia-demo-overlay.seed';
import { seedAllergyCatalog } from './seeds/allergy-catalog.seed';
import { seedMedicalConditionCatalog } from './seeds/medical-condition-catalog.seed';
import { seedVitalAcceptedRanges } from './seeds/vital-accepted-ranges.seed';
import { seedEcmThresholdLookups } from './seeds/ecm-threshold-lookups.seed';
import { seedServiceUserFundingTypes } from './seeds/service-user-funding-types.seed';
import { seedBillingCards } from './seeds/billing-cards.seed';
import { seedInvoiceTemplates } from './seeds/invoice-templates.seed';
import { seedLearningCatalog } from './seeds/learning.seed';
import { DEFAULT_MEDICATION_STATUS_CODES } from './seed-data/medication-status-codes.defaults';
import { DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS } from './seed-data/medication-administration-rounds.defaults';
import {
  DEFAULT_SERVICE_USER_ETHNICITIES,
  DEFAULT_SERVICE_USER_LANGUAGES,
} from './seed-data/service-user-ethnicity-language.defaults';
import { DEFAULT_VISIT_STATUS_REASONS } from './seed-data/visit-status-reasons.defaults';
import {
  ensureSuperAdminAllPermissions,
  seedDemoOfficeUsers,
} from './seeds/demo-office-users.seed';

const prisma = new PrismaClient();

async function upsertLookup(model: any, name: string) {
  return model.upsert({
    where: { name },
    update: { isActive: true, deletedAt: null },
    create: { name, isActive: true },
  });
}

async function main() {
  // Lookups
  const titles = [
    'Mr',
    'Mrs',
    'Miss',
    'Ms',
    'Dr',
    'Professor',
    'Lord',
    'Lady',
    'Sir',
    'Dame',
    'Captain',
    'Earl',
  ];
  for (const name of titles) await upsertLookup(prisma.title, name);

  for (const name of ['Female', 'Male', 'Other'])
    await upsertLookup(prisma.gender, name);

  for (const name of ['Active', 'Inactive'])
    await upsertLookup(prisma.employeeStatus, name);

  for (const name of ['Care', 'Kitchen', 'Domestic', 'Maintenance', 'Administration'])
    await upsertLookup(prisma.workArea, name);

  for (const name of ['Carer', 'Senior Carer'])
    await upsertLookup(prisma.employeeRoleLookup, name);

  for (const name of defaultJobTitles) await upsertLookup(prisma.jobTitle, name);

  for (const name of [
    'Group Administrator',
    'Administrator',
    'Manager',
    'Privacy Officer',
    'Operation Management',
    'Staff Allocation',
    'Master Staff Allocation',
    'Branch Administrator',
    'Senior Carer/Nurse',
    'Carer/Domestic',
  ])
    await upsertLookup(prisma.rBACLevel, name);

  for (const name of [
    'Dismissal',
    'Left without notice',
    'Unknown',
    'New Job',
    'Personal Reasons',
    'Resigned',
    'Terminated',
    'Other',
  ])
    await upsertLookup(prisma.leavingReason, name);

  for (const name of DEFAULT_VISIT_STATUS_REASONS)
    await upsertLookup(prisma.visitStatusReason, name);

  for (const name of [
    'Grade1',
    'Grade 1',
    'Grade 2',
    'Grade 3',
    'Grade 4',
    'Grade 5',
    'Grade 6',
    'Grade 7',
  ])
    await upsertLookup(prisma.grade, name);

  for (const name of ['Salaried', 'Hourly paid', 'Voluntary', 'Bank staff', 'Agency'])
    await upsertLookup(prisma.contractType, name);

  for (const name of ['Driver', 'Passenger', 'Walker'])
    await upsertLookup(prisma.travelPaymentType, name);

  for (const name of [
    'Sickness',
    'Self Isolation',
    'Non working time',
    'Last Minute sickness',
  ])
    await upsertLookup(prisma.nonCoreActivityReason, name);

  for (const name of [
    'Croydon - Croydon 1',
    'Croydon - Croydon 2',
    'Croydon - Croydon 3',
    'Croydon - Croydon 4',
    'Croydon - Croydon 5',
    'Merton - Merton',
    'Hackney - Harrow 1',
    'Haringey - Haringey',
    'Croydon Private - Croydon 1 Private',
    'Croydon admin - Croydon office',
    'Bexley ISF - Bexley',
    'Cleaners - Cleaning 1',
    'ALF Private - ALF Private',
    'Greenwich council - Greenwich',
    'Transport - Croydon Transport',
  ]) {
    await upsertLookup(prisma.location, name);
  }

  // Location-management zones = cities (not “Zone - Branch” location labels).
  const CITY_ZONES: Array<{ name: string; country: string; city: string }> = [
    { name: 'London', country: 'United Kingdom', city: 'London' },
    { name: 'Birmingham', country: 'United Kingdom', city: 'Birmingham' },
    { name: 'Manchester', country: 'United Kingdom', city: 'Manchester' },
    { name: 'Leeds', country: 'United Kingdom', city: 'Leeds' },
    { name: 'Glasgow', country: 'United Kingdom', city: 'Glasgow' },
    { name: 'Edinburgh', country: 'United Kingdom', city: 'Edinburgh' },
    { name: 'Liverpool', country: 'United Kingdom', city: 'Liverpool' },
    { name: 'Bristol', country: 'United Kingdom', city: 'Bristol' },
    { name: 'Sheffield', country: 'United Kingdom', city: 'Sheffield' },
    { name: 'Newcastle', country: 'United Kingdom', city: 'Newcastle' },
    { name: 'Cardiff', country: 'United Kingdom', city: 'Cardiff' },
    { name: 'Belfast', country: 'United Kingdom', city: 'Belfast' },
  ];
  for (const zone of CITY_ZONES) {
    await prisma.zone.upsert({
      where: { name: zone.name },
      update: {
        country: zone.country,
        city: zone.city,
        isActive: true,
        deletedAt: null,
      },
      create: {
        name: zone.name,
        country: zone.country,
        city: zone.city,
        isActive: true,
      },
    });
  }

  // Soft-deactivate legacy zone rows that were seeded as location labels / borough names.
  const legacyZoneNames = [
    'Croydon - Croydon 1',
    'Croydon - Croydon 2',
    'Croydon - Croydon 3',
    'Croydon - Croydon 4',
    'Croydon - Croydon 5',
    'Merton - Merton',
    'Hackney - Harrow 1',
    'Haringey - Haringey',
    'Croydon Private - Croydon 1 Private',
    'Croydon admin - Croydon office',
    'Bexley ISF - Bexley',
    'Cleaners - Cleaning 1',
    'ALF Private - ALF Private',
    'Greenwich council - Greenwich',
    'Transport - Croydon Transport',
    'Croydon',
    'Merton',
    'Haringey',
    'Bexley',
    'Greenwich',
    'Transport',
    'Hackney',
    'ALF Private',
    'Cleaners',
    'Croydon Private',
    'Croydon admin',
  ];
  await prisma.zone.updateMany({
    where: {
      name: { in: legacyZoneNames },
      deletedAt: null,
    },
    data: { isActive: false, deletedAt: new Date() },
  });

  // Core permissions
  const permissionKeys = [
    'employees.read',
    'employees.create',
    'employees.update',
    'employees.delete',
    'employees.status.update',
    'employees.documents.read',
    'employees.documents.upload',
    'employees.documents.delete',
    'employees.compliance.read',
    'employees.compliance.create',
    'employees.compliance.update',
    'employees.compliance.delete',
    'employees.compliance.verify',
    'employees.compliance.reject',
    'employees.compliance.documents.upload',
    'employees.compliance.documents.download',
    'employees.compliance.documents.delete',
    'employees.compliance.reports.read',
    'employees.compliance.reports.export',
    'compliance_types.read',
    'compliance_types.create',
    'compliance_types.update',
    'compliance_types.delete',
    'compliance_requirements.read',
    'compliance_requirements.create',
    'compliance_requirements.update',
    'compliance_requirements.delete',
    'employees.reports.read',
    'hr.read',
    'hr.profile.create',
    'hr.profile.update',
    'hr.documents.upload',
    'hr.documents.delete',
    'hr.vacancies.read',
    'hr.vacancies.create',
    'hr.vacancies.update',
    'hr.candidates.read',
    'hr.candidates.create',
    'hr.candidates.update',
    'hr.candidates.convert',
    'lookups.read',
    'lookups.manage',
    'settings.company.read',
    'settings.company.update',
    'users.read',
    'users.create',
    'roles.manage',
    'permissions.manage',
    'audit_logs.read',
    'audit_logs.delete',
    'temporary_inspector.session',
    'service_user.portal.session',
    'service_users.portal.read',
    'service_users.portal.manage',
    'service_users.read',
    'service_users.create',
    'service_users.update',
    'service_users.delete',
    'service_users.status.update',
    'service_users.contacts.read',
    'service_users.contacts.create',
    'service_users.contacts.update',
    'service_users.contacts.delete',
    'service_users.address.read',
    'service_users.address.update',
    'service_users.assignments.read',
    'service_users.assignments.update',
    'service_users.photos.upload',
    'service_users.photos.delete',
    'service_users.lookups.read',
    'service_users.inventory.read',
    'service_users.inventory.create',
    'service_users.inventory.update',
    'service_users.inventory.delete',
    'service_users.allergies.read',
    'service_users.allergies.create',
    'service_users.allergies.update',
    'service_users.allergies.delete',
    'service_users.medical_conditions.read',
    'service_users.medical_conditions.create',
    'service_users.medical_conditions.update',
    'service_users.medical_conditions.delete',
    'service_users.medical_adjustments.read',
    'service_users.medical_adjustments.create',
    'service_users.medical_adjustments.update',
    'service_users.medical_adjustments.delete',
    'service_users.medical_history.read',
    'service_users.medical_history.create',
    'service_users.medical_history.update',
    'service_users.medical_history.delete',
    'service_users.medical_monitoring.read',
    'service_users.medical_monitoring.update',
    'service_users.medical_usual_parameters.read',
    'service_users.medical_usual_parameters.update',
    'service_users.documents.read',
    'service_users.documents.update',
    'service_users.documents.delete',
    'service_users.absences.read',
    'service_users.absences.create',
    'service_users.absences.update',
    'service_users.absences.delete',
    'service_users.calendar.read',
    'service_users.calendar.create',
    'service_users.calendar.update',
    'service_users.calendar.delete',
    'service_users.calendar.status.update',
    'service_users.calendar.export',
    'service_users.calendar_event_types.read',
    'service_users.calendar_event_types.create',
    'service_users.calendar_event_types.update',
    'service_users.calendar_event_types.delete',
    'service_users.dom_care.read',
    'service_users.dom_care.update',
    'service_users.visit_plan.read',
    'service_users.visit_plan.write',
    'service_users.visit_plan.activate',
    'task_catalogue.read',
    'task_catalogue.manage',
    'service_users.visit_tasks.read',
    'service_users.visit_tasks.write',
    'scheduling.generate_from_visit_plan',
    'service_users.initial_assessment.read',
    'service_users.initial_assessment.create',
    'service_users.initial_assessment.update',
    'service_users.initial_assessment.delete',
    'service_users.initial_assessment.submit',
    'service_users.initial_assessment.review',
    'service_users.initial_assessment.export',
    'service_users.assessments.read',
    'service_users.assessments.create',
    'service_users.assessments.link',
    'initial_assessment_templates.read',
    'initial_assessment_templates.create',
    'initial_assessment_templates.update',
    'initial_assessment_templates.delete',
    'initial_assessment_templates.manage_default',
    'service_users.funding.read',
    'service_users.funding.update',
    'service_users.funding.create',
    'service_users.funding.delete',
    'service_users.funding.status.update',
    'service_users.funding.approve',
    'service_users.funding.set_primary',
    'funding_types.read',
    'funding_types.create',
    'funding_types.update',
    'funding_types.delete',
    'funders.read',
    'funders.create',
    'funders.update',
    'funders.delete',
    'billing.pay_cards.read',
    'billing.pay_cards.manage',
    'billing.charge_cards.read',
    'billing.charge_cards.manage',
    'billing.funding_contracts.read',
    'billing.invoice_templates.read',
    'billing.invoice_templates.manage',
    'billing.visit_reconciliations.read',
    'billing.visit_reconciliations.manage',
    'billing.payroll_runs.read',
    'billing.payroll_runs.manage',
    'billing.employee_payouts.read',
    'billing.employee_payouts.manage',
    'billing.invoice_runs.read',
    'billing.invoice_runs.manage',
    'billing.payments.read',
    'billing.payments.manage',
    'ecm.read',
    'ecm.monitor',
    'ecm.exceptions.manage',
    'ecm.attendance.amend',
    'ecm.reports.export',
    'ecm.settings.manage',
    'payroll.settings.read',
    'payroll.settings.manage',
    'payroll.employees.read',
    'payroll.employees.manage',
    'payroll.periods.read',
    'payroll.periods.manage',
    'payroll.runs.read',
    'payroll.runs.manage',
    'learning.dashboard.read',
    'learning.categories.read',
    'learning.categories.manage',
    'learning.courses.read',
    'learning.courses.manage',
    'learning.assignments.read',
    'learning.assignments.manage',
    'learning.compliance.read',
    'learning.compliance.export',
    'learning.competencies.read',
    'learning.competencies.manage',
    'learning.training_events.read',
    'learning.training_events.manage',
    'learning.certificates.read',
    'learning.certificates.manage',
    'learning.external_training.read',
    'learning.external_training.manage',
    'learning.reports.read',
    'learning.reports.export',
    'learning.settings.manage',
    'learning.me.read',
    'learning.me.progress',
    'policies.read',
    'policies.create',
    'policies.update',
    'policies.submit',
    'policies.review',
    'policies.approve',
    'policies.publish',
    'policies.archive',
    'policies.categories.manage',
    'policies.links.manage',
    'policies.audit.read',
    'policies.acknowledgements.manage',
    'policies.acknowledgements.me',
    'service_users.live_in_profile.read',
    'service_users.live_in_profile.create',
    'service_users.live_in_profile.update',
    'service_users.live_in_profile.delete',
    'service_users.live_in_profile.status.update',
    'service_users.live_in_profile.carers.read',
    'service_users.live_in_profile.carers.manage',
    'service_users.live_in_profile.documents.read',
    'service_users.live_in_profile.documents.upload',
    'service_users.live_in_profile.documents.download',
    'service_users.live_in_profile.documents.delete',
    'service_users.live_in_profile.lookups.read',
    'notifications.read',
    'notifications.update',
    'notifications.dismiss',
    'notifications.preferences.read',
    'notifications.preferences.update',
    'notifications.create',

    'service_users.medications.read',
    'service_users.medications.create',
    'service_users.medications.update',
    'service_users.medications.delete',
    'service_users.medications.status.update',
    'service_users.medications.administer',
    'service_users.medications.events.read',
    'service_users.medications.chart.read',
    'service_users.medications.prn.read',
    'service_users.medications.allergies.read',
    'service_users.medications.allergies.manage',
    'service_users.medications.support_profile.read',
    'service_users.medications.support_profile.update',
    'service_users.medications.reviews.read',
    'service_users.medications.reviews.create',
    'service_users.medications.reviews.update',
    'service_users.medications.reviews.delete',
    'service_users.medications.reports.read',
    'service_users.medications.reports.export',
    'service_users.medications.lookups.read',
    'service_users.medications.packs.publish',
    'service_users.medications.packs.deliver',
    'service_users.medications.packs.supersede',

    'service_users.observations.read',
    'service_users.observations.create',
    'service_users.observations.update',
    'service_users.observations.delete',
    'service_users.observations.lookups.read',

    'service_users.body_map.read',
    'service_users.body_map.create',
    'service_users.body_map.update',
    'service_users.body_map.review',
    'service_users.body_map.close',
    'service_users.body_map.export',

    'service_users.flash_message.read',
    'service_users.flash_message.update',
    'service_users.flash_message.delete',
    'service_users.flash_message.history.read',

    'schedules.read',
    'schedules.create',
    'schedules.update',
    'schedules.delete',
    'schedules.build',
    'schedules.status.read',
    'schedule_areas.read',
    'schedule_areas.create',
    'schedule_areas.update',
    'schedule_areas.delete',

    'scheduled_jobs.read',
    'scheduled_jobs.create',
    'scheduled_jobs.update',
    'scheduled_jobs.delete',
    'scheduled_jobs.status.update',
    'scheduled_visits.read',
    'scheduled_visits.create',
    'scheduled_visits.update',
    'scheduled_visits.delete',
    'scheduled_visits.status.update',
    'schedule_runs.read',
    'schedule_runs.create',
    'schedule_runs.update',
    'schedule_runs.delete',
    'visit_actions.read',
    'visit_actions.create',
    'visit_actions.update',
    'visit_actions.delete',

    'job_allocations.read',
    'job_allocations.create',
    'job_allocations.delete',
    'job_allocations.confirm',

    'schedule_timelines.read',
    'schedule_filters.jobs',
    'schedule_filters.carers',
    'schedule_filters.customers',
    'employee_capacity.read',

    'scheduled_jobs_housekeeping.read',
    'scheduled_jobs_housekeeping.complete',
    'scheduled_jobs_housekeeping.cancel',
    'call_off_visits.read',
    'call_off_visits.create',
    'call_off_visits.update',
    'call_off_visits.delete',
    'call_off_visits.approve',
    'call_off_visits.reject',

    'schedule_reports.read',
    'schedule_reports.export',

    'care_pathway.read',
    'form_selection.read',
    'form_selection.update',
    'form_builder.read',
    'form_builder.create',
    'form_builder.update',
    'form_builder.delete',
    'form_builder.publish',
    'care_plan_text.read',
    'care_plan_text.create',
    'care_plan_text.update',
    'care_plan_text.delete',
    'care_plan_text.preview',
    'pathway_checklists.read',
    'pathway_checklists.create',
    'pathway_checklists.update',
    'pathway_checklists.delete',
    'pathway_checklists.items.manage',
    'pathway_actions.read',
    'pathway_actions.create',
    'pathway_actions.update',
    'pathway_actions.delete',
    'pathway_actions.checklists.manage',
    'picture_gallery.read',
    'picture_gallery.upload',
    'picture_gallery.update',
    'picture_gallery.delete',

    'billing.pay_cards.read',
    'billing.pay_cards.manage',
    'billing.charge_cards.read',
    'billing.charge_cards.manage',
    'billing.funding_contracts.read',
    'billing.invoice_templates.read',
    'billing.invoice_templates.manage',
    'billing.visit_reconciliations.read',
    'billing.visit_reconciliations.manage',
    'billing.payroll_runs.read',
    'billing.payroll_runs.manage',
    'billing.employee_payouts.read',
    'billing.employee_payouts.manage',
    'billing.invoice_runs.read',
    'billing.invoice_runs.manage',
    'billing.payments.read',
    'billing.payments.manage',
    // Incident Management
    'incidents.read',
    'incidents.create',
    'incidents.update',
    'incidents.review',
    'incidents.investigate',
    'incidents.assign',
    'incidents.manage_actions',
    'incidents.close',
    'incidents.reopen',
    'incidents.delete',
    'incidents.view_confidential',
    'incidents.view_highly_confidential',
    'incidents.view_analytics',
    'incidents.manage_settings',
    // Surveys
    'surveys.read',
    'surveys.manage',
    'surveys.respond',
    // Employee hours approvals (over-contracted-hours workflow)
    'hours_approvals.read',
    'hours_approvals.manage',
  ];

  for (const key of permissionKeys) {
    await prisma.permission.upsert({
      where: { key },
      update: { isActive: true, deletedAt: null },
      create: { key, isActive: true },
    });
  }

  // Roles
  const roleNames = [
    'Super Admin',
    'Admin',
    'Manager',
    'Care Coordinator',
    'HR',
    'Staff Allocation',
    'Senior Carer/Nurse',
    'Carer/Domestic',
    'CQC Inspector',
  ];
  const roles: Awaited<ReturnType<typeof prisma.role.upsert>>[] = [];
  for (const name of roleNames) {
    roles.push(
      await prisma.role.upsert({
        where: { name },
        update: { isActive: true, deletedAt: null },
        create: { name, isActive: true },
      }),
    );
  }

  // Assign all permissions to Super Admin
  const superAdminRole = roles.find((r) => r.name === 'Super Admin');
  if (superAdminRole) {
    const permissions = await prisma.permission.findMany({
      where: { deletedAt: null, isActive: true },
    });

    for (const p of permissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: superAdminRole.id, permissionId: p.id },
        },
        update: {},
        create: { roleId: superAdminRole.id, permissionId: p.id },
      });
    }
  }

  // Incident Management — role assignments.
  // Frontline carers can report and view; managers/admin get the full workflow.
  const incidentFrontlineKeys = ['incidents.read', 'incidents.create'];
  const incidentManagerKeys = [
    'incidents.read',
    'incidents.create',
    'incidents.update',
    'incidents.review',
    'incidents.investigate',
    'incidents.assign',
    'incidents.manage_actions',
    'incidents.close',
    'incidents.reopen',
    'incidents.view_confidential',
    'incidents.view_analytics',
  ];
  const incidentAdminKeys = [
    ...incidentManagerKeys,
    'incidents.delete',
    'incidents.view_highly_confidential',
    'incidents.manage_settings',
  ];
  await assignPermKeys('Carer/Domestic', incidentFrontlineKeys);
  await assignPermKeys('Senior Carer/Nurse', incidentFrontlineKeys);
  await assignPermKeys('Care Coordinator', [...incidentFrontlineKeys, 'incidents.manage_actions', 'incidents.view_analytics']);
  await assignPermKeys('Manager', incidentManagerKeys);

  // Surveys — managers build/send, coordinators can read
  await assignPermKeys('Care Coordinator', ['surveys.read']);
  await assignPermKeys('Manager', ['surveys.read', 'surveys.manage']);

  // Hours approvals — managers approve/reject over-contracted-hours requests
  await assignPermKeys('Care Coordinator', ['hours_approvals.read']);
  await assignPermKeys('Manager', ['hours_approvals.read', 'hours_approvals.manage']);
  await assignPermKeys('Admin', incidentAdminKeys);

  // Incident Management — configurable categories & subtypes (idempotent).
  for (let ci = 0; ci < DEFAULT_INCIDENT_CATEGORIES.length; ci++) {
    const cat = DEFAULT_INCIDENT_CATEGORIES[ci];
    const category = await prisma.incidentCategory.upsert({
      where: { key: cat.key },
      update: { label: cat.label, description: cat.description ?? null, isSystem: true },
      create: {
        key: cat.key,
        label: cat.label,
        description: cat.description ?? null,
        isSystem: true,
        sortOrder: ci,
      },
    });
    for (let si = 0; si < cat.subtypes.length; si++) {
      const sub = cat.subtypes[si];
      await prisma.incidentSubtype.upsert({
        where: { categoryId_key: { categoryId: category.id, key: sub.key } },
        update: { label: sub.label },
        create: { categoryId: category.id, key: sub.key, label: sub.label, sortOrder: si },
      });
    }
  }

  const serviceUserCoordinatorPermKeys = [
    'service_users.read',
    'service_users.create',
    'service_users.update',
    'service_users.contacts.read',
    'service_users.contacts.create',
    'service_users.contacts.update',
    'service_users.address.read',
    'service_users.address.update',
    'service_users.assignments.read',
    'service_users.assignments.update',
    'service_users.photos.upload',
    'service_users.lookups.read',
    'service_users.inventory.read',
    'service_users.inventory.create',
    'service_users.inventory.update',
    'service_users.allergies.read',
    'service_users.allergies.create',
    'service_users.allergies.update',
    'service_users.allergies.delete',
    'service_users.medical_conditions.read',
    'service_users.medical_conditions.create',
    'service_users.medical_conditions.update',
    'service_users.medical_conditions.delete',
    'service_users.medical_adjustments.read',
    'service_users.medical_adjustments.create',
    'service_users.medical_adjustments.update',
    'service_users.medical_adjustments.delete',
    'service_users.medical_history.read',
    'service_users.medical_history.create',
    'service_users.medical_history.update',
    'service_users.medical_history.delete',
    'service_users.medical_monitoring.read',
    'service_users.medical_monitoring.update',
    'service_users.medical_usual_parameters.read',
    'service_users.medical_usual_parameters.update',
    'service_users.documents.read',
    'service_users.documents.update',
    'service_users.documents.delete',
    'service_users.absences.read',
    'service_users.absences.create',
    'service_users.absences.update',
    'service_users.absences.delete',
    'service_users.calendar.read',
    'service_users.calendar.create',
    'service_users.calendar.update',
    'service_users.calendar.status.update',
    'service_users.calendar_event_types.read',
    'service_users.dom_care.read',
    'service_users.dom_care.update',
    'service_users.visit_plan.read',
    'service_users.visit_plan.write',
    'service_users.visit_plan.activate',
    'task_catalogue.read',
    'task_catalogue.manage',
    'service_users.visit_tasks.read',
    'service_users.visit_tasks.write',
    'scheduling.generate_from_visit_plan',
    'service_users.initial_assessment.read',
    'service_users.initial_assessment.create',
    'service_users.initial_assessment.update',
    'service_users.initial_assessment.submit',
    'service_users.assessments.read',
    'service_users.assessments.create',
    'service_users.assessments.link',
    'initial_assessment_templates.read',
    'service_users.funding.read',
    'service_users.funding.update',
    'service_users.funding.create',
    'service_users.funding.status.update',
    'service_users.funding.set_primary',
    'service_users.live_in_profile.read',
    'service_users.live_in_profile.create',
    'service_users.live_in_profile.update',
    'service_users.live_in_profile.status.update',
    'service_users.live_in_profile.carers.read',
    'service_users.live_in_profile.carers.manage',
    'service_users.live_in_profile.documents.read',
    'service_users.live_in_profile.documents.upload',
    'service_users.live_in_profile.documents.download',
    'service_users.live_in_profile.documents.delete',
    'service_users.live_in_profile.lookups.read',

    'service_users.medications.read',
    'service_users.medications.events.read',
    'service_users.medications.chart.read',
    'service_users.medications.prn.read',
    'service_users.medications.allergies.read',
    'service_users.medications.support_profile.read',
    'service_users.medications.reviews.read',
    'service_users.medications.lookups.read',
    'service_users.medications.reports.read',

    'service_users.medications.create',
    'service_users.medications.update',
    'service_users.medications.status.update',
    'service_users.medications.allergies.manage',
    'service_users.medications.support_profile.update',
    'service_users.medications.reviews.create',
    'service_users.medications.reviews.update',
    'service_users.medications.packs.publish',
    'service_users.medications.packs.deliver',
    'service_users.medications.packs.supersede',
    'audit_logs.read',

    'funding_types.read',
    'funding_types.create',
    'funding_types.update',
    'funders.read',
    'funders.create',
    'funders.update',
    'billing.pay_cards.read',
    'billing.pay_cards.manage',
    'billing.charge_cards.read',
    'billing.charge_cards.manage',
    'billing.funding_contracts.read',
    'billing.invoice_templates.read',
    'billing.invoice_templates.manage',
    'billing.visit_reconciliations.read',
    'billing.visit_reconciliations.manage',
    'billing.payroll_runs.read',
    'billing.payroll_runs.manage',
    'billing.employee_payouts.read',
    'billing.employee_payouts.manage',
    'billing.invoice_runs.read',
    'billing.invoice_runs.manage',
    'billing.payments.read',
    'billing.payments.manage',

    'service_users.flash_message.read',
    'service_users.flash_message.update',

    'service_users.observations.read',
    'service_users.observations.create',
    'service_users.observations.update',
    'service_users.observations.delete',
    'service_users.observations.lookups.read',

    'service_users.body_map.read',
    'service_users.body_map.create',
    'service_users.body_map.update',
    'service_users.body_map.review',
    'service_users.body_map.close',
    'service_users.body_map.export',
  ];
  const suCoordPerms = await prisma.permission.findMany({
    where: { key: { in: serviceUserCoordinatorPermKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager', 'Care Coordinator']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of suCoordPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  // ECM monitoring for Admin / Manager / Care Coordinator
  const ecmCoordPermKeys = [
    'ecm.read',
    'ecm.monitor',
    'ecm.exceptions.manage',
    'ecm.attendance.amend',
    'ecm.reports.export',
  ];
  const ecmCoordPerms = await prisma.permission.findMany({
    where: { key: { in: ecmCoordPermKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager', 'Care Coordinator']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of ecmCoordPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }
  const ecmSettingsPerms = await prisma.permission.findMany({
    where: { key: { in: ['ecm.settings.manage'] }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of ecmSettingsPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  // Learning module — Admin only (Super Admin already receives all permissions)
  const learningAdminKeys = [
    'learning.dashboard.read',
    'learning.categories.read',
    'learning.categories.manage',
    'learning.courses.read',
    'learning.courses.manage',
    'learning.assignments.read',
    'learning.assignments.manage',
    'learning.compliance.read',
    'learning.compliance.export',
    'learning.competencies.read',
    'learning.competencies.manage',
    'learning.training_events.read',
    'learning.training_events.manage',
    'learning.certificates.read',
    'learning.certificates.manage',
    'learning.external_training.read',
    'learning.external_training.manage',
    'learning.reports.read',
    'learning.reports.export',
    'learning.settings.manage',
    'learning.me.read',
    'learning.me.progress',
  ];
  await assignPermKeys('Admin', learningAdminKeys);

  // Policy Management — Super Admin already receives all permissions above
  const policyAdminKeys = [
    'policies.read',
    'policies.create',
    'policies.update',
    'policies.submit',
    'policies.review',
    'policies.approve',
    'policies.publish',
    'policies.archive',
    'policies.categories.manage',
    'policies.links.manage',
    'policies.audit.read',
    'policies.acknowledgements.manage',
    'policies.acknowledgements.me',
  ];
  const policyCoordinatorKeys = [
    'policies.read',
    'policies.create',
    'policies.update',
    'policies.submit',
    'policies.review',
  ];
  const policyReadAndAckKeys = ['policies.read', 'policies.acknowledgements.me'];
  const policyInspectorKeys = ['policies.read', 'policies.audit.read'];
  await assignPermKeys('Admin', policyAdminKeys);
  await assignPermKeys('Manager', policyCoordinatorKeys);
  await assignPermKeys('Care Coordinator', policyCoordinatorKeys);
  await assignPermKeys('HR', policyReadAndAckKeys);
  await assignPermKeys('Senior Carer/Nurse', policyReadAndAckKeys);
  await assignPermKeys('Carer/Domestic', policyReadAndAckKeys);
  await assignPermKeys('CQC Inspector', policyInspectorKeys);

  // Native UK Payroll foundation — Admin / Manager (distinct from billing.payroll_runs.*)
  const payrollPermKeys = [
    'payroll.settings.read',
    'payroll.settings.manage',
    'payroll.employees.read',
    'payroll.employees.manage',
    'payroll.periods.read',
    'payroll.periods.manage',
    'payroll.runs.read',
    'payroll.runs.manage',
  ];
  const payrollPerms = await prisma.permission.findMany({
    where: { key: { in: payrollPermKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of payrollPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  const seniorNurseMedicationKeys = [
    'service_users.medications.read',
    'service_users.medications.events.read',
    'service_users.medications.chart.read',
    'service_users.medications.prn.read',
    'service_users.medications.allergies.read',
    'service_users.medications.allergies.manage',
    'service_users.medications.support_profile.read',
    'service_users.medications.support_profile.update',
    'service_users.medications.reviews.read',
    'service_users.medications.reviews.create',
    'service_users.medications.reviews.update',
    'service_users.medications.lookups.read',
    'service_users.medications.reports.read',
    'service_users.medications.create',
    'service_users.medications.update',
    'service_users.medications.status.update',
    'service_users.medications.administer',
    'service_users.medications.packs.publish',
    'service_users.medications.packs.deliver',
    'service_users.medications.packs.supersede',
    'service_users.flash_message.read',
    'service_users.flash_message.update',
  ];
  const seniorNurseMedPerms = await prisma.permission.findMany({
    where: { key: { in: seniorNurseMedicationKeys }, deletedAt: null },
  });
  const seniorNurseRole = roles.find((x) => x.name === 'Senior Carer/Nurse');
  if (seniorNurseRole) {
    for (const p of seniorNurseMedPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: seniorNurseRole.id, permissionId: p.id } },
        update: {},
        create: { roleId: seniorNurseRole.id, permissionId: p.id },
      });
    }
  }

  const carerMedicationKeys = [
    'service_users.medications.read',
    'service_users.medications.events.read',
    'service_users.medications.chart.read',
    'service_users.medications.prn.read',
    'service_users.medications.lookups.read',
    'service_users.medications.administer',
    'service_users.medications.packs.deliver',
  ];
  const carerMedPerms = await prisma.permission.findMany({
    where: { key: { in: carerMedicationKeys }, deletedAt: null },
  });
  const carerDomesticRole = roles.find((x) => x.name === 'Carer/Domestic');
  if (carerDomesticRole) {
    for (const p of carerMedPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: carerDomesticRole.id, permissionId: p.id } },
        update: {},
        create: { roleId: carerDomesticRole.id, permissionId: p.id },
      });
    }
  }

  const cqcInspectorKeys = [
    'service_users.read',
    'service_users.body_map.read',
    'service_users.body_map.export',
    'audit.read',
    'audit_logs.read',
  ];
  const cqcInspectorPerms = await prisma.permission.findMany({
    where: { key: { in: cqcInspectorKeys }, deletedAt: null },
  });
  const cqcInspectorRole = roles.find((x) => x.name === 'CQC Inspector');
  if (cqcInspectorRole) {
    for (const p of cqcInspectorPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: cqcInspectorRole.id, permissionId: p.id } },
        update: {},
        create: { roleId: cqcInspectorRole.id, permissionId: p.id },
      });
    }
  }

  const medicationManagerDeleteKeys = [
    'service_users.medications.delete',
    'service_users.medications.reviews.delete',
    'service_users.medications.reports.export',
  ];
  const medicationManagerDeletePerms = await prisma.permission.findMany({
    where: { key: { in: medicationManagerDeleteKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of medicationManagerDeletePerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  const managerFundingPermKeys = [
    'service_users.funding.delete',
    'service_users.funding.approve',
    'funding_types.delete',
    'funders.delete',
  ];
  const managerFundingPerms = await prisma.permission.findMany({
    where: { key: { in: managerFundingPermKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of managerFundingPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  const managerLiveInDeleteKeys = ['service_users.live_in_profile.delete'];
  const managerLiveInDeletePerms = await prisma.permission.findMany({
    where: { key: { in: managerLiveInDeleteKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of managerLiveInDeletePerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  const flashMessageDeleteKeys = ['service_users.flash_message.delete'];
  const flashMessageDeletePerms = await prisma.permission.findMany({
    where: { key: { in: flashMessageDeleteKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager', 'Care Coordinator']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of flashMessageDeletePerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  const flashMessageHistoryKeys = ['service_users.flash_message.history.read'];
  const flashMessageHistoryPerms = await prisma.permission.findMany({
    where: { key: { in: flashMessageHistoryKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of flashMessageHistoryPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  const privacyOfficerRole = await prisma.role.upsert({
    where: { name: 'Privacy Officer' },
    update: { isActive: true, deletedAt: null },
    create: { name: 'Privacy Officer', description: 'Privacy reviews and audit log access' },
  });

  const auditReadPerm = await prisma.permission.findFirst({ where: { key: 'audit_logs.read' } });
  if (auditReadPerm && privacyOfficerRole) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: privacyOfficerRole.id, permissionId: auditReadPerm.id },
      },
      update: {},
      create: { roleId: privacyOfficerRole.id, permissionId: auditReadPerm.id },
    });
  }

  if (privacyOfficerRole && flashMessageHistoryPerms.length) {
    for (const p of flashMessageHistoryPerms) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: privacyOfficerRole.id, permissionId: p.id },
        },
        update: {},
        create: { roleId: privacyOfficerRole.id, permissionId: p.id },
      });
    }
  }

  const adminRole = roles.find((r) => r.name === 'Admin');
  if (auditReadPerm && adminRole) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: adminRole.id, permissionId: auditReadPerm.id },
      },
      update: {},
      create: { roleId: adminRole.id, permissionId: auditReadPerm.id },
    });
  }
  const auditDeletePerm = await prisma.permission.findFirst({ where: { key: 'audit_logs.delete' } });
  if (auditDeletePerm && adminRole) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: adminRole.id, permissionId: auditDeletePerm.id },
      },
      update: {},
      create: { roleId: adminRole.id, permissionId: auditDeletePerm.id },
    });
  }

  const notificationEndUserKeys = [
    'notifications.read',
    'notifications.update',
    'notifications.dismiss',
    'notifications.preferences.read',
    'notifications.preferences.update',
  ];
  const notificationEndUserPerms = await prisma.permission.findMany({
    where: { key: { in: notificationEndUserKeys }, deletedAt: null },
  });
  const rolesForInAppNotifications = [...roles, privacyOfficerRole].filter(Boolean);
  for (const r of rolesForInAppNotifications) {
    if (!r || (superAdminRole && r.id === superAdminRole.id)) continue;
    for (const p of notificationEndUserPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  const notifCreatePerm = await prisma.permission.findFirst({
    where: { key: 'notifications.create', deletedAt: null },
  });
  if (notifCreatePerm && adminRole) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: adminRole.id, permissionId: notifCreatePerm.id },
      },
      update: {},
      create: { roleId: adminRole.id, permissionId: notifCreatePerm.id },
    });
  }

  const complianceReportRead = await prisma.permission.findFirst({
    where: { key: 'employees.compliance.reports.read' },
  });
  const complianceRead = await prisma.permission.findFirst({
    where: { key: 'employees.compliance.read' },
  });
  const complianceTypesRead = await prisma.permission.findFirst({
    where: { key: 'compliance_types.read' },
  });
  const complianceReqRead = await prisma.permission.findFirst({
    where: { key: 'compliance_requirements.read' },
  });
  const complianceTypesCreate = await prisma.permission.findFirst({
    where: { key: 'compliance_types.create' },
  });
  const complianceTypesUpdate = await prisma.permission.findFirst({
    where: { key: 'compliance_types.update' },
  });
  const complianceTypesDelete = await prisma.permission.findFirst({
    where: { key: 'compliance_types.delete' },
  });
  const lookupsManage = await prisma.permission.findFirst({
    where: { key: 'lookups.manage' },
  });
  const settingsCompanyRead = await prisma.permission.findFirst({
    where: { key: 'settings.company.read' },
  });
  const settingsCompanyUpdate = await prisma.permission.findFirst({
    where: { key: 'settings.company.update' },
  });
  for (const r of [
    roles.find((x) => x.name === 'Admin'),
    roles.find((x) => x.name === 'Manager'),
    roles.find((x) => x.name === 'HR'),
    privacyOfficerRole,
  ]) {
    if (!r) continue;
    for (const p of [
      complianceReportRead,
      complianceRead,
      complianceTypesRead,
      complianceTypesCreate,
      complianceTypesUpdate,
      complianceTypesDelete,
      complianceReqRead,
      lookupsManage,
      settingsCompanyRead,
      settingsCompanyUpdate,
    ]) {
      if (!p) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  const taskCatalogueManage = await prisma.permission.findFirst({
    where: { key: 'task_catalogue.manage' },
  });
  for (const r of [
    roles.find((x) => x.name === 'Admin'),
    roles.find((x) => x.name === 'Manager'),
    roles.find((x) => x.name === 'HR'),
    privacyOfficerRole,
  ]) {
    if (!r || !taskCatalogueManage) continue;
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: r.id, permissionId: taskCatalogueManage.id },
      },
      update: {},
      create: { roleId: r.id, permissionId: taskCatalogueManage.id },
    });
  }

  const carePathwayReadKeys = [
    'care_pathway.read',
    'form_builder.read',
    'form_selection.read',
    'care_plan_text.read',
    'care_plan_text.preview',
    'pathway_checklists.read',
    'pathway_actions.read',
    'picture_gallery.read',
  ];
  const carePathwayManageKeys = [
    ...carePathwayReadKeys,
    'form_builder.create',
    'form_builder.update',
    'form_builder.publish',
    'form_selection.update',
    'care_plan_text.create',
    'care_plan_text.update',
    'pathway_checklists.create',
    'pathway_checklists.update',
    'pathway_checklists.items.manage',
    'pathway_actions.create',
    'pathway_actions.update',
    'pathway_actions.checklists.manage',
    'picture_gallery.upload',
    'picture_gallery.update',
  ];
  const carePathwayAdminKeys = [
    ...carePathwayManageKeys,
    'form_builder.delete',
    'care_plan_text.delete',
    'pathway_checklists.delete',
    'pathway_actions.delete',
    'picture_gallery.delete',
  ];

  async function assignPermKeys(roleName: string, keys: string[]) {
    const role = roles.find((r) => r.name === roleName);
    if (!role) return;
    const perms = await prisma.permission.findMany({
      where: { key: { in: keys }, deletedAt: null },
    });
    for (const p of perms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        update: {},
        create: { roleId: role.id, permissionId: p.id },
      });
    }
  }

  await assignPermKeys('Care Coordinator', carePathwayReadKeys);
  await assignPermKeys('Manager', carePathwayManageKeys);
  await assignPermKeys('Admin', carePathwayAdminKeys);

  // Company Admin: office user directory + role/branch assignment (Users & access).
  await assignPermKeys('Admin', ['users.read', 'users.create', 'roles.manage']);

  // --- Compliance types & requirements (legacy Care checklist + driving pack) ---
  const complianceTypeDefs = [
    ...CARE_COMPLIANCE_CATALOG,
    { name: 'Right to Work', code: 'RIGHT_TO_WORK', category: ComplianceCategory.RIGHT_TO_WORK, hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
    { name: 'Care Certificate', code: 'CARE_CERTIFICATE', category: ComplianceCategory.TRAINING, hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
    { name: 'Manual Handling', code: 'MANUAL_HANDLING', category: ComplianceCategory.HEALTH_AND_SAFETY, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
    { name: 'Safeguarding Adults', code: 'SAFEGUARDING_ADULTS', category: ComplianceCategory.SAFEGUARDING, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
    { name: 'Medication Training', code: 'MEDICATION_TRAINING', category: ComplianceCategory.CLINICAL, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: true },
    { name: 'Driving Licence', code: 'DRIVING_LICENCE', category: ComplianceCategory.DRIVING, hasExpiry: true, defaultValidityMonths: 120, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: false },
    { name: 'Vehicle Insurance', code: 'VEHICLE_INSURANCE', category: ComplianceCategory.DRIVING, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true, isMandatoryByDefault: false },
  ];

  /** Upsert by stable `code` first — avoids P2002 when legacy rows used different display names. */
  async function upsertComplianceType(t: (typeof complianceTypeDefs)[number]) {
    const payload = {
      name: t.name,
      code: t.code,
      category: t.category,
      hasExpiry: t.hasExpiry,
      defaultValidityMonths: t.defaultValidityMonths,
      requiresDocument: t.requiresDocument,
      requiresVerification: t.requiresVerification,
      isMandatoryByDefault: t.isMandatoryByDefault ?? false,
      isActive: true,
      deletedAt: null as Date | null,
    };

    let row =
      (t.code
        ? await prisma.complianceType.findFirst({ where: { code: t.code } })
        : null) ??
      (await prisma.complianceType.findFirst({ where: { name: t.name } }));

    if (row && t.code) {
      const codeOwner = await prisma.complianceType.findFirst({ where: { code: t.code } });
      if (codeOwner && codeOwner.id !== row.id) {
        await prisma.complianceType.update({
          where: { id: row.id },
          data: { isActive: false, deletedAt: new Date() },
        });
        row = codeOwner;
      }
    }

    if (row) {
      return prisma.complianceType.update({ where: { id: row.id }, data: payload });
    }
    return prisma.complianceType.create({ data: payload });
  }

  const typeByCode: Record<string, string> = {};
  for (const t of complianceTypeDefs) {
    const row = await upsertComplianceType(t);
    if (t.code) typeByCode[t.code] = row.id;
  }

  const carerRole = await prisma.employeeRoleLookup.findFirst({ where: { name: 'Carer' } });
  const careArea = await prisma.workArea.findFirst({ where: { name: 'Care' } });
  const kitchenArea = await prisma.workArea.findFirst({ where: { name: 'Kitchen' } });

  async function ensureRequirement(
    code: string,
    filters: {
      roleId?: string | null;
      workAreaId?: string | null;
      jobTitleId?: string | null;
      isMandatory?: boolean;
    },
  ) {
    const complianceTypeId = typeByCode[code];
    if (!complianceTypeId) return;
    const isMandatory = filters.isMandatory ?? true;
    const where = {
      complianceTypeId,
      roleId: filters.roleId ?? null,
      workAreaId: filters.workAreaId ?? null,
      jobTitleId: filters.jobTitleId ?? null,
      contractTypeId: null as string | null,
      locationId: null as string | null,
      zoneId: null as string | null,
      deletedAt: null,
    };
    const exists = await prisma.complianceRequirement.findFirst({ where });
    if (!exists) {
      await prisma.complianceRequirement.create({
        data: {
          complianceTypeId,
          roleId: filters.roleId ?? undefined,
          workAreaId: filters.workAreaId ?? undefined,
          jobTitleId: filters.jobTitleId ?? undefined,
          isMandatory,
          blocksAllocation: isMandatory,
        },
      });
      return;
    }
    await prisma.complianceRequirement.update({
      where: { id: exists.id },
      data: {
        isMandatory,
        blocksAllocation: isMandatory,
        isActive: true,
        deletedAt: null,
      },
    });
  }

  if (careArea) {
    for (const t of CARE_COMPLIANCE_CATALOG) {
      await ensureRequirement(t.code, {
        workAreaId: careArea.id,
        isMandatory: t.isMandatoryByDefault,
      });
    }
    for (const code of ['RIGHT_TO_WORK', 'CARE_CERTIFICATE', 'MANUAL_HANDLING', 'SAFEGUARDING_ADULTS', 'MEDICATION_TRAINING']) {
      if (typeByCode[code]) {
        await ensureRequirement(code, { workAreaId: careArea.id, isMandatory: true });
      }
    }
  }
  if (carerRole && careArea) {
    await ensureRequirement('MEDICATION_TRAINING', { roleId: carerRole.id, workAreaId: careArea.id });
  }
  if (carerRole) {
    for (const code of ['DRIVING_LICENCE', 'VEHICLE_INSURANCE']) {
      if (typeByCode[code]) await ensureRequirement(code, { roleId: carerRole.id, isMandatory: false });
    }
  }

  // eslint-disable-next-line no-console
  console.log('[seed] Compliance types & requirements upserted.');
  const email = process.env.ADMIN_SEED_EMAIL?.trim() || 'admin@careadmin.local';
  const password = process.env.ADMIN_SEED_PASSWORD?.trim() || 'Admin@12345';
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      isActive: true,
      deletedAt: null,
    },
    create: {
      email,
      username: 'superadmin',
      passwordHash,
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true,
    },
  });

  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: superAdminRole.id } },
      update: {},
      create: { userId: user.id, roleId: superAdminRole.id },
    });
  }

  for (const row of [
    { name: 'Active', code: 'ACTIVE', description: 'Currently receiving service' },
    { name: 'Inactive', code: 'INACTIVE', description: 'Not active' },
    { name: 'Pending', code: 'PENDING', description: 'Pending admission or setup' },
    { name: 'Pre-admission', code: 'PRE_ADMISSION', description: 'Pre-admission assessment or setup before service starts' },
    { name: 'Discharged', code: 'DISCHARGED', description: 'Discharged from service' },
    { name: 'Deceased', code: 'DECEASED', description: null },
    { name: 'On Hold', code: 'ON_HOLD', description: 'Service temporarily on hold' },
  ]) {
    await prisma.serviceUserStatus.upsert({
      where: { code: row.code },
      update: { name: row.name, description: row.description, isActive: true },
      create: { name: row.name, code: row.code, description: row.description ?? undefined },
    });
  }

  for (const row of [
    ['Mr', 'MR'],
    ['Mrs', 'MRS'],
    ['Miss', 'MISS'],
    ['Ms', 'MS'],
    ['Dr', 'DR'],
    ['Professor', 'PROFESSOR'],
    ['Lord', 'LORD'],
    ['Lady', 'LADY'],
    ['Sir', 'SIR'],
    ['Dame', 'DAME'],
  ]) {
    await prisma.serviceUserTitle.upsert({
      where: { code: row[1] },
      update: { name: row[0], isActive: true },
      create: { name: row[0], code: row[1] },
    });
  }

  for (const row of [
    ['Female', 'FEMALE'],
    ['Male', 'MALE'],
    ['Other', 'OTHER'],
    ['Prefer not to say', 'PREFER_NOT_TO_SAY'],
  ]) {
    await prisma.serviceUserGender.upsert({
      where: { code: row[1] },
      update: { name: row[0], isActive: true },
      create: { name: row[0], code: row[1] },
    });
  }

  for (const row of [
    ['Single', 'SINGLE'],
    ['Married', 'MARRIED'],
    ['Divorced', 'DIVORCED'],
    ['Widowed', 'WIDOWED'],
    ['Separated', 'SEPARATED'],
    ['Civil Partnership', 'CIVIL_PARTNERSHIP'],
    ['Unknown', 'MARITAL_UNKNOWN'],
  ]) {
    await prisma.serviceUserMaritalStatus.upsert({
      where: { code: row[1] },
      update: { name: row[0], isActive: true },
      create: { name: row[0], code: row[1] },
    });
  }

  for (const row of [
    ['Residential Care', 'RESIDENTIAL'],
    ['Domiciliary Care', 'DOMICILIARY'],
    ['Nursing Care', 'NURSING'],
    ['Supported Living', 'SUPPORTED_LIVING'],
    ['Respite Care', 'RESPITE'],
    ['Day Care', 'DAY_CARE'],
    ['Transport', 'TRANSPORT'],
  ]) {
    await prisma.serviceUserCareType.upsert({
      where: { code: row[1] },
      update: { name: row[0], isActive: true },
      create: { name: row[0], code: row[1] },
    });
  }

  const fundingTypeCount = await seedServiceUserFundingTypes(prisma);
  await seedBillingCards(prisma);
  await seedInvoiceTemplates(prisma);
  await seedLearningCatalog(prisma);
  console.log(`Service user funding types seeded (${fundingTypeCount} entries).`);

  for (const row of DEFAULT_SERVICE_USER_ETHNICITIES) {
    await prisma.serviceUserEthnicity.upsert({
      where: { code: row.code },
      update: { name: row.name, isActive: true },
      create: { name: row.name, code: row.code },
    });
  }

  for (const row of DEFAULT_SERVICE_USER_LANGUAGES) {
    await prisma.serviceUserLanguage.upsert({
      where: { code: row.code },
      update: { name: row.name, isActive: true },
      create: { name: row.name, code: row.code },
    });
  }

  for (const row of [
    ['Low', 'LOW', 'green'],
    ['Medium', 'MEDIUM', 'amber'],
    ['High', 'HIGH', 'red'],
    ['Critical', 'CRITICAL', 'dark red'],
  ]) {
    await prisma.serviceUserRiskLevel.upsert({
      where: { code: row[1] },
      update: { name: row[0], color: row[2], isActive: true },
      create: { name: row[0], code: row[1], color: row[2] },
    });
  }

  const relationshipDefs = [
    'Mother',
    'Father',
    'Son',
    'Daughter',
    'Brother',
    'Sister',
    'Husband',
    'Wife',
    'Partner',
    'Friend',
    'Next of Kin',
    'Power of Attorney',
    'Guardian',
    'Social Worker',
    'GP',
    'Other',
  ];
  for (const name of relationshipDefs) {
    const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    await prisma.relationshipType.upsert({
      where: { code },
      update: { name, isActive: true },
      create: { name, code },
    });
  }

  const allergyCount = await seedAllergyCatalog(prisma);
  console.log(`Allergy catalogue seeded (${allergyCount} entries).`);

  const medicalConditionCount = await seedMedicalConditionCatalog(prisma);
  console.log(`Medical condition catalogue seeded (${medicalConditionCount} entries).`);

  const vitalRangeCount = await seedVitalAcceptedRanges(prisma);
  console.log(`Vital accepted ranges seeded (${vitalRangeCount} entries).`);
  const ecmThresholdCount = await seedEcmThresholdLookups(prisma);
  console.log(`ECM threshold lookups seeded (${ecmThresholdCount} entries).`);

  const absenceReasonCatalogSeed: Array<[string, string]> = [
    ['Hospital Visit', 'HOSPITAL_VISIT'],
    ['Hospitalised', 'HOSPITALISED'],
    ['Family Visit', 'FAMILY_VISIT'],
    ['Respite Care', 'RESPITE_CARE'],
    ['Deceased', 'DECEASED'],
    ['Other', 'OTHER'],
  ];
  const absenceCatalog = prisma as unknown as {
    absenceReasonCatalog: {
      upsert: (args: object) => Promise<unknown>;
      updateMany: (args: object) => Promise<unknown>;
    };
  };
  for (let i = 0; i < absenceReasonCatalogSeed.length; i++) {
    const [name, code] = absenceReasonCatalogSeed[i]!;
    await absenceCatalog.absenceReasonCatalog.upsert({
      where: { code },
      update: { name, sortOrder: i, isActive: true },
      create: { name, code, sortOrder: i },
    });
  }
  await absenceCatalog.absenceReasonCatalog.updateMany({
    where: { code: { notIn: absenceReasonCatalogSeed.map(([, c]) => c) } },
    data: { isActive: false },
  });

  const fundingTypeRows: Array<{ name: string; code: string; description?: string | null }> = [
    { name: 'Private', code: 'PRIVATE', description: null },
    { name: 'Local Authority', code: 'LOCAL_AUTHORITY', description: null },
    { name: 'NHS', code: 'NHS', description: null },
    { name: 'Direct Payment', code: 'DIRECT_PAYMENT', description: null },
    { name: 'Mixed Funding', code: 'MIXED', description: null },
    { name: 'Self-Funded', code: 'SELF_FUNDED', description: null },
    { name: 'Family Funded', code: 'FAMILY_FUNDED', description: null },
    { name: 'Unknown', code: 'UNKNOWN', description: null },
  ];
  for (const row of fundingTypeRows) {
    await prisma.fundingType.upsert({
      where: { code: row.code },
      update: {
        name: row.name,
        description: row.description ?? undefined,
        isActive: true,
        deletedAt: null,
      },
      create: { name: row.name, code: row.code, description: row.description ?? undefined },
    });
  }

  const typeId = async (code: string) => {
    const t = await prisma.fundingType.findFirst({ where: { code, deletedAt: null } });
    return t?.id ?? null;
  };

  const funderDefs: Array<{ name: string; code: string; fundingTypeCode: string }> = [
    { name: 'Croydon Council', code: 'CROYDON_COUNCIL', fundingTypeCode: 'LOCAL_AUTHORITY' },
    { name: 'NHS Continuing Healthcare', code: 'NHS_CHC', fundingTypeCode: 'NHS' },
    { name: 'Private / Self-Funded', code: 'PRIVATE_SELF_FUNDED', fundingTypeCode: 'SELF_FUNDED' },
    { name: 'Direct Payment', code: 'DIRECT_PAYMENT_FUNDER', fundingTypeCode: 'DIRECT_PAYMENT' },
    { name: 'Family Funded', code: 'FAMILY_FUNDED_FUNDER', fundingTypeCode: 'FAMILY_FUNDED' },
    { name: 'Unknown', code: 'UNKNOWN_FUNDER', fundingTypeCode: 'UNKNOWN' },
  ];
  for (const f of funderDefs) {
    const ftId = await typeId(f.fundingTypeCode);
    if (!ftId) continue;
    await prisma.funder.upsert({
      where: { code: f.code },
      update: { name: f.name, fundingTypeId: ftId, isActive: true, deletedAt: null },
      create: { name: f.name, code: f.code, fundingTypeId: ftId },
    });
  }

  // eslint-disable-next-line no-console
  console.log('[seed] Enterprise funding types and funders upserted.');

  // eslint-disable-next-line no-console
  console.log('[seed] Service user lookups upserted.');

  // Nationalities (lookup); extend as needed — re-seed to refresh existing DBs
  for (const name of [
    'British',
    'Irish',
    'Indian',
    'Pakistani',
    'Bangladeshi',
    'Polish',
    'Romanian',
    'Nigerian',
    'Ghanaian',
    'South African',
    'Australian',
    'New Zealander',
    'American',
    'Canadian',
    'French',
    'German',
    'Spanish',
    'Italian',
    'Portuguese',
    'Dutch',
    'Belgian',
    'Greek',
    'Turkish',
    'Ukrainian',
    'Filipino',
    'Chinese',
    'Other',
  ]) {
    await upsertLookup(prisma.nationality, name);
  }

  for (const name of WORKFORCE_SKILL_NAMES) {
    await upsertLookup(prisma.skillType, name);
  }

  for (const name of WORKFORCE_CERTIFICATION_NAMES) {
    await upsertLookup(prisma.certificationType, name);
  }

  const skillTypes = await prisma.skillType.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { name: 'asc' },
  });
  const adminForSeed = await prisma.user.findFirst({
    where: { email: 'admin@careadmin.local', deletedAt: null },
  });
  const employeesForSkills = await prisma.employee.findMany({
    where: { deletedAt: null },
    take: 15,
    orderBy: { createdAt: 'asc' },
  });
  if (skillTypes.length > 0 && employeesForSkills.length > 0) {
    let seeded = 0;
    for (let i = 0; i < employeesForSkills.length; i++) {
      const emp = employeesForSkills[i];
      const nSkills = 1 + (i % 3);
      for (let k = 0; k < nSkills; k++) {
        const st = skillTypes[(i + k) % skillTypes.length];
        const exists = await prisma.employeeSkill.findFirst({
          where: { employeeId: emp.id, skillTypeId: st.id, deletedAt: null },
        });
        if (!exists) {
          await prisma.employeeSkill.create({
            data: {
              employeeId: emp.id,
              skillTypeId: st.id,
              notes: 'Seeded for development',
              createdById: adminForSeed?.id,
            },
          });
          seeded += 1;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[seed] Employee skills: ${seeded} new row(s) (idempotent per employee + skill type).`);
  } else {
    // eslint-disable-next-line no-console
    console.log('[seed] Employee skills: skipped (no employees or no skill types).');
  }

  const liveInServiceTypeDefs: Array<{ name: string; code: string; sortOrder: number }> = [
    { name: 'Personal Care', code: 'PERSONAL_CARE', sortOrder: 10 },
    { name: 'Waking Night', code: 'WAKING_NIGHT', sortOrder: 20 },
    { name: 'Sleep-in Night', code: 'SLEEP_IN_NIGHT', sortOrder: 30 },
    { name: 'Live-in care', code: 'LIVE_IN_CARE', sortOrder: 40 },
    { name: 'Domestic call', code: 'DOMESTIC_CALL', sortOrder: 50 },
    { name: 'Shopping Call', code: 'SHOPPING_CALL', sortOrder: 60 },
    { name: 'Drivers', code: 'DRIVERS', sortOrder: 70 },
    { name: 'Passenger Assistance', code: 'PASSENGER_ASSISTANCE', sortOrder: 80 },
    { name: 'Cleaning Job', code: 'CLEANING_JOB', sortOrder: 90 },
    { name: 'Home First', code: 'HOME_FIRST', sortOrder: 100 },
    { name: 'Children services', code: 'CHILDREN_SERVICES', sortOrder: 110 },
    { name: 'Family Support', code: 'FAMILY_SUPPORT', sortOrder: 120 },
    {
      name: 'Support Disabled children & young People',
      code: 'SUPPORT_DISABLED_CHILDREN_YOUNG_PEOPLE',
      sortOrder: 130,
    },
    { name: 'Support Young People', code: 'SUPPORT_YOUNG_PEOPLE', sortOrder: 140 },
    { name: 'Contact Supervision', code: 'CONTACT_SUPERVISION', sortOrder: 150 },
    { name: 'Outreach', code: 'OUTREACH', sortOrder: 160 },
    { name: 'Training', code: 'TRAINING', sortOrder: 170 },
  ];
  for (const row of liveInServiceTypeDefs) {
    await prisma.liveInServiceType.upsert({
      where: { code: row.code },
      update: { name: row.name, sortOrder: row.sortOrder, isActive: true, deletedAt: null },
      create: { name: row.name, code: row.code, sortOrder: row.sortOrder, isActive: true },
    });
  }

  for (const row of [
    { name: 'A', code: 'A', sortOrder: 10 },
    { name: 'B', code: 'B', sortOrder: 20 },
    { name: 'C', code: 'C', sortOrder: 30 },
  ]) {
    await prisma.liveInLevelOfCare.upsert({
      where: { code: row.code },
      update: { name: row.name, sortOrder: row.sortOrder, isActive: true, deletedAt: null },
      create: { name: row.name, code: row.code, sortOrder: row.sortOrder, isActive: true },
    });
  }

  for (const row of [
    { name: 'None', code: 'NONE', sortOrder: 10 },
    { name: 'QR or Barcode', code: 'QR_OR_BARCODE', sortOrder: 20 },
    { name: 'NFC', code: 'NFC', sortOrder: 30 },
  ]) {
    await prisma.liveInScanType.upsert({
      where: { code: row.code },
      update: { name: row.name, sortOrder: row.sortOrder, isActive: true, deletedAt: null },
      create: { name: row.name, code: row.code, sortOrder: row.sortOrder, isActive: true },
    });
  }

  async function upsertMedCode<T extends { upsert: (args: any) => Promise<any> }>(
    model: T,
    row: {
      name: string
      code: string
      description?: string | null
      requiresBodyMapSite?: boolean
      timesPerDay?: number | null
      intervalHours?: number | null
      time?: string
      sortOrder?: number
    },
  ) {
    const bodyMapFlag =
      row.requiresBodyMapSite !== undefined ? { requiresBodyMapSite: row.requiresBodyMapSite } : {}
    const baseMinimal = {
      name: row.name,
      code: row.code,
      isActive: true,
      deletedAt: null,
      ...bodyMapFlag,
    };
    const baseWithDesc = {
      ...baseMinimal,
      description: row.description ?? null,
    };
    const where = { code: row.code };
    if ('timesPerDay' in row) {
      await model.upsert({
        where,
        update: { ...baseWithDesc, timesPerDay: row.timesPerDay ?? null, intervalHours: row.intervalHours ?? null },
        create: { ...baseWithDesc, timesPerDay: row.timesPerDay ?? null, intervalHours: row.intervalHours ?? null },
      });
    } else if ('time' in row && row.time !== undefined) {
      await model.upsert({
        where,
        update: { ...baseMinimal, time: row.time, sortOrder: row.sortOrder ?? 0 },
        create: { ...baseMinimal, time: row.time, sortOrder: row.sortOrder ?? 0 },
      });
    } else {
      await model.upsert({
        where,
        update: { ...baseWithDesc },
        create: { ...baseWithDesc },
      });
    }
  }

  for (const row of [
    { name: 'Tablet', code: 'TABLET', requiresBodyMapSite: false },
    { name: 'Capsule', code: 'CAPSULE', requiresBodyMapSite: false },
    { name: 'Liquid', code: 'LIQUID', requiresBodyMapSite: false },
    { name: 'Cream', code: 'CREAM', requiresBodyMapSite: true },
    { name: 'Ointment', code: 'OINTMENT', requiresBodyMapSite: true },
    { name: 'Lotion', code: 'LOTION', requiresBodyMapSite: true },
    { name: 'Drops', code: 'DROPS', requiresBodyMapSite: false },
    { name: 'Injection', code: 'INJECTION', requiresBodyMapSite: true },
    { name: 'Inhaler', code: 'INHALER', requiresBodyMapSite: false },
    { name: 'Patch', code: 'PATCH', requiresBodyMapSite: true },
    { name: 'Spray', code: 'SPRAY', requiresBodyMapSite: true },
    { name: 'Sachet', code: 'SACHET', requiresBodyMapSite: false },
    { name: 'Other', code: 'OTHER_TYPE', requiresBodyMapSite: false },
  ]) {
    await upsertMedCode(prisma.medicationType, row);
  }
  for (const row of [
    { name: 'Oral', code: 'ORAL', requiresBodyMapSite: false },
    { name: 'Topical', code: 'TOPICAL', requiresBodyMapSite: true },
    { name: 'Transdermal / Patch', code: 'TRANSDERMAL', requiresBodyMapSite: true },
    { name: 'Inhalation', code: 'INHALATION', requiresBodyMapSite: false },
    { name: 'Injection', code: 'ROUTE_INJECTION', requiresBodyMapSite: true },
    { name: 'Eye', code: 'EYE', requiresBodyMapSite: false },
    { name: 'Ear', code: 'EAR', requiresBodyMapSite: false },
    { name: 'Nasal', code: 'NASAL', requiresBodyMapSite: false },
    { name: 'Rectal', code: 'RECTAL', requiresBodyMapSite: false },
    { name: 'Sublingual', code: 'SUBLINGUAL', requiresBodyMapSite: false },
    { name: 'Other', code: 'OTHER_ROUTE', requiresBodyMapSite: false },
  ]) {
    await upsertMedCode(prisma.medicationRoute, row);
  }
  for (const row of [
    { name: 'General', code: 'GENERAL' },
    { name: 'Controlled Drug', code: 'CONTROLLED_DRUG' },
    { name: 'Diabetes', code: 'DIABETES' },
    { name: 'Blood Pressure', code: 'BLOOD_PRESSURE' },
    { name: 'Anticoagulant', code: 'ANTICOAGULANT' },
    { name: 'Pain Relief', code: 'PAIN_RELIEF' },
    { name: 'Antibiotic', code: 'ANTIBIOTIC' },
    { name: 'Mental Health', code: 'MENTAL_HEALTH' },
    { name: 'PRN', code: 'PRN_CATEGORY' },
    { name: 'Other', code: 'OTHER_CATEGORY' },
  ]) {
    await upsertMedCode(prisma.medicationCategory, row);
  }
  for (const row of [
    { name: 'Once Daily', code: 'ONCE_DAILY', timesPerDay: 1 },
    { name: 'Twice Daily', code: 'TWICE_DAILY', timesPerDay: 2 },
    { name: 'Three Times Daily', code: 'THREE_TIMES_DAILY', timesPerDay: 3 },
    { name: 'Four Times Daily', code: 'FOUR_TIMES_DAILY', timesPerDay: 4 },
    { name: 'Five Times Daily', code: 'FIVE_TIMES_DAILY', timesPerDay: 5 },
    { name: 'Every 1 day', code: 'EVERY_1_DAY', timesPerDay: 1 },
    { name: 'Weekly', code: 'WEEKLY', timesPerDay: null },
    { name: 'Monthly', code: 'MONTHLY', timesPerDay: null },
    { name: 'As Required', code: 'AS_REQUIRED', timesPerDay: null },
    { name: 'Other', code: 'OTHER_FREQUENCY', timesPerDay: null },
  ]) {
    await upsertMedCode(prisma.medicationFrequency, row);
  }
  for (const row of DEFAULT_MEDICATION_ADMINISTRATION_ROUNDS) {
    await prisma.medicationAdministrationRound.upsert({
      where: { code: row.code },
      update: {
        name: row.name,
        time: row.time,
        windowStart: row.windowStart,
        windowEnd: row.windowEnd,
        sortOrder: row.sortOrder,
        isActive: true,
        deletedAt: null,
      },
      create: {
        name: row.name,
        code: row.code,
        time: row.time,
        windowStart: row.windowStart,
        windowEnd: row.windowEnd,
        sortOrder: row.sortOrder,
        isActive: true,
      },
    });
  }
  for (const row of [
    { name: 'Refused', code: 'REFUSED' },
    { name: 'Not Available', code: 'NOT_AVAILABLE' },
    { name: 'Service User Away', code: 'SU_AWAY' },
    { name: 'Sleeping', code: 'SLEEPING' },
    { name: 'Vomited', code: 'VOMITED' },
    { name: 'Withheld by Clinician', code: 'WITHHELD_CLINICIAN' },
    { name: 'Missed Visit', code: 'MISSED_VISIT' },
    { name: 'Other', code: 'OTHER_REASON' },
  ]) {
    await upsertMedCode(prisma.medicationNotGivenReason, row);
  }

  for (const row of DEFAULT_MEDICATION_STATUS_CODES) {
    await prisma.medicationStatusCode.upsert({
      where: { code: row.code },
      update: {
        label: row.label,
        color: row.color,
        textColor: row.textColor,
        category: row.category,
        administrationStatus: row.administrationStatus,
        reasonRequirement: row.reasonRequirement,
        managerReviewRequirement: row.managerReviewRequirement,
        sortOrder: row.sortOrder,
        isActive: true,
        deletedAt: null,
      },
      create: {
        code: row.code,
        label: row.label,
        color: row.color,
        textColor: row.textColor,
        category: row.category,
        administrationStatus: row.administrationStatus,
        reasonRequirement: row.reasonRequirement,
        managerReviewRequirement: row.managerReviewRequirement,
        sortOrder: row.sortOrder,
        isActive: true,
      },
    });
  }

  const calendarEventTypes = [
    { name: 'Customer Event', code: 'CUSTOMER_EVENT', color: '#0D9488', sortOrder: 5 },
    { name: 'Birthday', code: 'BIRTHDAY', color: '#F59E0B', sortOrder: 10 },
    { name: 'Appointment', code: 'APPOINTMENT', color: '#3B82F6', sortOrder: 20 },
    { name: 'GP Appointment', code: 'GP_APPOINTMENT', color: '#2563EB', sortOrder: 30 },
    { name: 'Hospital Appointment', code: 'HOSPITAL_APPOINTMENT', color: '#DC2626', sortOrder: 40 },
    { name: 'Care Review', code: 'CARE_REVIEW', color: '#7C3AED', sortOrder: 50 },
    { name: 'Medication Review', code: 'MEDICATION_REVIEW', color: '#16A34A', sortOrder: 60 },
    { name: 'Family Visit', code: 'FAMILY_VISIT', color: '#EC4899', sortOrder: 70 },
    { name: 'Social Activity', code: 'SOCIAL_ACTIVITY', color: '#14B8A6', sortOrder: 80 },
    { name: 'Assessment', code: 'ASSESSMENT', color: '#6366F1', sortOrder: 90 },
    { name: 'Care Plan Review', code: 'CARE_PLAN_REVIEW', color: '#9333EA', sortOrder: 100 },
    { name: 'Reminder', code: 'REMINDER', color: '#64748B', sortOrder: 110 },
    { name: 'Other', code: 'OTHER', color: '#6B7280', sortOrder: 120 },
  ];
  for (const row of calendarEventTypes) {
    await prisma.calendarEventType.upsert({
      where: { code: row.code },
      update: {
        name: row.name,
        color: row.color,
        sortOrder: row.sortOrder,
        isActive: true,
        deletedAt: null,
      },
      create: {
        name: row.name,
        code: row.code,
        color: row.color,
        sortOrder: row.sortOrder,
        isActive: true,
      },
    });
  }

  const calendarDeletePermKeys = [
    'service_users.calendar.delete',
    'service_users.calendar_event_types.create',
    'service_users.calendar_event_types.update',
    'service_users.calendar_event_types.delete',
  ];
  const calendarDeletePerms = await prisma.permission.findMany({
    where: { key: { in: calendarDeletePermKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of calendarDeletePerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }
  const adminOnlyCalendarTypeKeys = ['service_users.calendar_event_types.create', 'service_users.calendar_event_types.update', 'service_users.calendar_event_types.delete'];
  const adminOnlyCalendarTypePerms = await prisma.permission.findMany({
    where: { key: { in: adminOnlyCalendarTypeKeys }, deletedAt: null },
  });
  const adminRoleForCalendarTypes = roles.find((x) => x.name === 'Admin');
  if (adminRoleForCalendarTypes) {
    for (const p of adminOnlyCalendarTypePerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRoleForCalendarTypes.id, permissionId: p.id } },
        update: {},
        create: { roleId: adminRoleForCalendarTypes.id, permissionId: p.id },
      });
    }
  }
  const calendarEventTypesReadPerm = await prisma.permission.findFirst({
    where: { key: 'service_users.calendar_event_types.read' },
  });
  if (calendarEventTypesReadPerm) {
    for (const roleName of ['Admin', 'Manager', 'Care Coordinator']) {
      const r = roles.find((x) => x.name === roleName);
      if (!r) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: calendarEventTypesReadPerm.id } },
        update: {},
        create: { roleId: r.id, permissionId: calendarEventTypesReadPerm.id },
      });
    }
  }

  const demoSu = await prisma.serviceUser.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } });
  if (demoSu) {
    const birthdayType = await prisma.calendarEventType.findFirst({ where: { code: 'BIRTHDAY' } });
    const careReviewType = await prisma.calendarEventType.findFirst({ where: { code: 'CARE_REVIEW' } });
    const existingCal = await prisma.serviceUserCalendarEvent.findFirst({
      where: { serviceUserId: demoSu.id, title: 'Demo birthday reminder', deletedAt: null },
    });
    if (!existingCal && birthdayType) {
      await prisma.serviceUserCalendarEvent.create({
        data: {
          serviceUserId: demoSu.id,
          eventTypeId: birthdayType.id,
          title: 'Demo birthday reminder',
          startDateTime: new Date('2026-05-17T09:00:00.000Z'),
          allDay: true,
          status: 'SCHEDULED',
        },
      });
    }
    if (careReviewType) {
      const existingReview = await prisma.serviceUserCalendarEvent.findFirst({
        where: { serviceUserId: demoSu.id, title: 'Annual care review', deletedAt: null },
      });
      if (!existingReview) {
        await prisma.serviceUserCalendarEvent.create({
          data: {
            serviceUserId: demoSu.id,
            eventTypeId: careReviewType.id,
            title: 'Annual care review',
            startDateTime: new Date('2026-05-25T14:00:00.000Z'),
            endDateTime: new Date('2026-05-25T15:00:00.000Z'),
            location: 'Office',
            status: 'SCHEDULED',
          },
        });
      }
    }
  }

  if (demoSu) {
    const existingPack = await prisma.medicationPack.findFirst({
      where: { serviceUserId: demoSu.id, name: 'Blister Pack 2025', deletedAt: null },
    });
    if (!existingPack) {
      const pack = await prisma.medicationPack.create({
        data: {
          serviceUserId: demoSu.id,
          name: 'Blister Pack 2025',
          description: 'Demo blister pack contents',
          startDate: new Date('2025-09-20T00:00:00.000Z'),
        },
      });
      const items = [
        'Amlodipine 10mg tablets',
        'Atorvastatin 80mg tablets',
        'Bisoprolol 2.5mg tablets',
        'Clopidogrel 75mg tablets',
        'Doxazosin 4mg tablets',
        'Lansoprazole 30mg gastro-resistant capsules',
        'Metformin 500mg tablets',
        'Sitagliptin 100mg tablets',
      ];
      let order = 0;
      for (const line of items) {
        await prisma.medicationPackItem.create({
          data: { medicationPackId: pack.id, medicationName: line, sortOrder: order++ },
        });
      }
      // eslint-disable-next-line no-console
      console.log('[seed] Medication demo pack created for first service user.');
    }
  }

  await seedInitialAssessmentChecklist(prisma);
  await seedBodyMapRecordTypeCatalog(prisma);
  await seedInitialAssessmentEnterprise(prisma);

  const initialAssessmentReviewPermKeys = ['service_users.initial_assessment.review'];
  const initialAssessmentReviewPerms = await prisma.permission.findMany({
    where: { key: { in: initialAssessmentReviewPermKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager', 'Branch Admin', 'Senior Carer/Nurse']) {
    const r =
      roles.find((x) => x.name === roleName) ??
      (await prisma.role.findFirst({ where: { name: roleName, deletedAt: null } }));
    if (!r) continue;
    for (const p of initialAssessmentReviewPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  const templateAdminPermKeys = [
    'initial_assessment_templates.create',
    'initial_assessment_templates.update',
    'initial_assessment_templates.delete',
    'initial_assessment_templates.manage_default',
  ];
  const templateAdminPerms = await prisma.permission.findMany({
    where: { key: { in: templateAdminPermKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of templateAdminPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  await seedScheduleAreas(prisma);
  try {
    const sua = await seedServiceUserAreas(prisma);
    console.log(
      `[seed] Service user areas: branches=${sua.branches} areas=${sua.areas} postcodes=${sua.postcodes}`,
    );
  } catch (err) {
    console.warn(
      '[seed] Service user areas skipped (non-fatal):',
      err instanceof Error ? err.message : err,
    );
  }

  // Greenwich staff + in-service caseload. Always-on and idempotent so production
  // deploy (`SEED_DEMO_DATA=false`) still creates the branch roster. Location is
  // resolved by name — server UUIDs will not match local.
  try {
    await seedGreenwichBranchUsers(prisma);
  } catch (err) {
    console.warn(
      '[seed] Greenwich branch users skipped (non-fatal):',
      err instanceof Error ? err.message : err,
    );
  }
  try {
    await seedGreenwichServiceUsers(prisma);
  } catch (err) {
    console.warn(
      '[seed] Greenwich service users skipped (non-fatal):',
      err instanceof Error ? err.message : err,
    );
  }

  await seedServiceUserObservations(prisma);
  await seedCompanyProfile(prisma);
  await seedOrganisationGeneralSettings(prisma);
  await seedServiceUserDocumentTypeCatalog(prisma);

  await seedCarePathway(prisma);
  try {
    await seedGreenwichManagerAttention(prisma);
  } catch (err) {
    console.warn(
      '[seed] Greenwich manager attention skipped (non-fatal):',
      err instanceof Error ? err.message : err,
    );
  }
  await seedTaskCatalogue(prisma);
  try {
    await seedInitialAssessmentCarePlanRules(prisma);
  } catch (err) {
    console.warn(
      '[seed] Initial assessment care plan recommendation rules skipped (non-fatal):',
      err instanceof Error ? err.message : err,
    );
  }

  // Demo / sample seeding is for dev & test only. It creates demo service users and RESETS
  // body-map data, so it must NEVER run against production — otherwise a deploy that runs
  // `prisma db seed` would inject demo data into the live DB. Default OFF on production:
  // an explicit SEED_DEMO_DATA flag wins; otherwise demo seeds everywhere EXCEPT production.
  const seedDemoData =
    process.env.SEED_DEMO_DATA === 'true' ||
    (process.env.SEED_DEMO_DATA !== 'false' && process.env.NODE_ENV !== 'production');

  if (seedDemoData) {
    // Demo service user for initial-assessment enterprise testing (Margaret Hughes, SU-1042)
    const demoSuId = await seedInitialAssessmentDemoServiceUser(prisma);

    // Demo service-user data (medications, observations, allergies, inventory, etc.)
    await seedDemoServiceUserData(prisma, demoSuId ? { serviceUserId: demoSuId } : {});

    await resetAndSeedBodyMapDemo(prisma, {
      serviceUserId: demoSuId ?? undefined,
      includeSecondServiceUser: true,
    });

    if (process.env.SEED_SERVICE_USER_PERSONAS !== 'false') {
      await seedServiceUserPersonas(prisma);
    }

    try {
      const overlay = await applyCarePlanIaDemoOverlay(prisma);
      for (const person of overlay.people) {
        if (person.skipped) {
          console.warn(
            `[seed] Care Plan IA demo overlay skipped ${person.displayName} (${person.serviceUserNumber}): ${person.skipped}`,
          );
          continue;
        }
        console.log(
          `[seed] Care Plan IA demo overlay ${person.displayName} (${person.serviceUserNumber}): ${person.upserted} answers, aboutMe=${person.aboutMeUpdated}`,
        );
        if (person.unmatched.length > 0) {
          console.warn(
            `[seed] Care Plan IA demo overlay unmatched questions for ${person.serviceUserNumber}:`,
            person.unmatched.join(', '),
          );
        }
      }
    } catch (err) {
      console.warn(
        '[seed] Care Plan IA demo overlay skipped (non-fatal):',
        err instanceof Error ? err.message : err,
      );
    }

    if (process.env.SEED_PERSONA_SCHEDULE !== 'false' && process.env.SEED_SERVICE_USER_PERSONAS !== 'false') {
      await seedPersonaSchedule(prisma);
    }
  } else {
    console.log(
      '[seed] Demo seeding disabled (SEED_DEMO_DATA!=true or NODE_ENV=production) — skipping demo service users, body-map reset, and personas. Reference/catalog/care-plan-form seeding still runs.',
    );
  }

  const scheduleOperatorPermKeys = [
    'schedules.read',
    'schedules.build',
    'schedules.status.read',
    'scheduled_jobs.read',
    'scheduled_jobs.create',
    'scheduled_jobs.update',
    'scheduled_jobs.status.update',
    'scheduled_visits.read',
    'scheduled_visits.create',
    'scheduled_visits.update',
    'scheduled_visits.status.update',
    'schedule_runs.read',
    'schedule_runs.create',
    'schedule_runs.update',
    'visit_actions.read',
    'visit_actions.create',
    'visit_actions.update',
    'job_allocations.read',
    'job_allocations.create',
    'job_allocations.delete',
    'job_allocations.confirm',
    'schedule_timelines.read',
    'schedule_filters.jobs',
    'schedule_filters.carers',
    'schedule_filters.customers',
    'employee_capacity.read',
    'scheduled_jobs_housekeeping.read',
    'scheduled_jobs_housekeeping.complete',
    'scheduled_jobs_housekeeping.cancel',
    'call_off_visits.read',
    'call_off_visits.create',
    'call_off_visits.update',
    'call_off_visits.approve',
    'call_off_visits.reject',
    'schedule_reports.read',
    'schedule_reports.export',
  ];
  const scheduleOperatorPerms = await prisma.permission.findMany({
    where: { key: { in: scheduleOperatorPermKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager', 'Care Coordinator', 'Staff Allocation']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of scheduleOperatorPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  const scheduleAdminPermKeys = [
    'schedule_areas.read',
    'schedule_areas.create',
    'schedule_areas.update',
    'schedule_areas.delete',
    'schedules.read',
    'schedules.create',
    'schedules.update',
    'schedules.delete',
    'schedules.build',
    'schedules.status.read',
    'scheduled_jobs.read',
    'scheduled_jobs.create',
    'scheduled_jobs.update',
    'scheduled_jobs.delete',
    'scheduled_jobs.status.update',
    'scheduled_visits.read',
    'scheduled_visits.create',
    'scheduled_visits.update',
    'scheduled_visits.delete',
    'scheduled_visits.status.update',
    'schedule_runs.read',
    'schedule_runs.create',
    'schedule_runs.update',
    'schedule_runs.delete',
    'visit_actions.read',
    'visit_actions.create',
    'visit_actions.update',
    'visit_actions.delete',
    'job_allocations.read',
    'job_allocations.create',
    'job_allocations.delete',
    'job_allocations.confirm',
    'schedule_timelines.read',
    'schedule_filters.jobs',
    'schedule_filters.carers',
    'schedule_filters.customers',
    'employee_capacity.read',
    'scheduled_jobs_housekeeping.read',
    'scheduled_jobs_housekeeping.complete',
    'scheduled_jobs_housekeeping.cancel',
    'call_off_visits.read',
    'call_off_visits.create',
    'call_off_visits.update',
    'call_off_visits.delete',
    'call_off_visits.approve',
    'call_off_visits.reject',
    'schedule_reports.read',
    'schedule_reports.export',
  ];
  const scheduleAdminPerms = await prisma.permission.findMany({
    where: { key: { in: scheduleAdminPermKeys }, deletedAt: null },
  });
  if (adminRole) {
    for (const p of scheduleAdminPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: p.id } },
        update: {},
        create: { roleId: adminRole.id, permissionId: p.id },
      });
    }
  }

  const hrFullPermKeys = [
    'hr.read',
    'hr.profile.create',
    'hr.profile.update',
    'hr.documents.upload',
    'hr.documents.delete',
    'hr.vacancies.read',
    'hr.vacancies.create',
    'hr.vacancies.update',
    'hr.candidates.read',
    'hr.candidates.create',
    'hr.candidates.update',
    'hr.candidates.convert',
    // Branch-scoped office use: list staff + service users (API enforces location ACL).
    'employees.read',
    'employees.documents.read',
    'employees.compliance.read',
    'service_users.read',
    'service_users.lookups.read',
    'lookups.read',
  ];
  const hrReadPermKeys = [
    'hr.read',
    'hr.vacancies.read',
    'hr.candidates.read',
  ];
  const hrFullPerms = await prisma.permission.findMany({
    where: { key: { in: hrFullPermKeys }, deletedAt: null },
  });
  const hrReadPerms = await prisma.permission.findMany({
    where: { key: { in: hrReadPermKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'HR']) {
    const r = roles.find((x) => x.name === roleName);
    if (!r) continue;
    for (const p of hrFullPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }
  const managerRole = roles.find((x) => x.name === 'Manager');
  if (managerRole) {
    for (const p of hrReadPerms) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: managerRole.id, permissionId: p.id },
        },
        update: {},
        create: { roleId: managerRole.id, permissionId: p.id },
      });
    }
  }

  // --- Approach A: hierarchical org roles (additive; existing roles unchanged) ---
  const branchAdminRole = await prisma.role.upsert({
    where: { name: 'Branch Admin' },
    update: {
      isActive: true,
      deletedAt: null,
      description:
        'Branch-scoped administrator. Job titles (e.g. Registered Branch Manager) remain separate.',
    },
    create: {
      name: 'Branch Admin',
      description:
        'Branch-scoped administrator. Job titles (e.g. Registered Branch Manager) remain separate.',
      isActive: true,
    },
  });
  const masterAllocRole = await prisma.role.upsert({
    where: { name: 'Master Staff Allocation' },
    update: {
      isActive: true,
      deletedAt: null,
      description: 'Company-wide staff allocation across all branches (not full Company Admin).',
    },
    create: {
      name: 'Master Staff Allocation',
      description: 'Company-wide staff allocation across all branches (not full Company Admin).',
      isActive: true,
    },
  });
  roles.push(branchAdminRole, masterAllocRole);

  const branchAdminPermKeys = [
    'employees.read',
    'employees.create',
    'employees.update',
    'employees.status.update',
    'employees.documents.read',
    'employees.documents.upload',
    'employees.compliance.read',
    'employees.reports.read',
    'lookups.read',
    ...serviceUserCoordinatorPermKeys,
    ...incidentManagerKeys,
    ...scheduleOperatorPermKeys,
    ...ecmCoordPermKeys,
    'notifications.read',
    'users.read',
    'users.create',
    'roles.manage',
  ];
  await assignPermKeys('Branch Admin', branchAdminPermKeys);

  const masterAllocPermKeys = [
    'employees.read',
    'service_users.read',
    'service_users.assignments.read',
    'lookups.read',
    ...scheduleOperatorPermKeys,
    'schedule_areas.read',
    'notifications.read',
  ];
  await assignPermKeys('Master Staff Allocation', masterAllocPermKeys);

  // Ensure Staff Allocation can view staff/SUs needed for allocation (additive).
  await assignPermKeys('Staff Allocation', [
    'employees.read',
    'service_users.read',
    'service_users.assignments.read',
    'lookups.read',
  ]);

  // Optional employment RBAC levels (job title sync → identity role). Does not replace job titles.
  for (const name of ['Branch Administrator', 'Master Staff Allocation']) {
    await prisma.rBACLevel.upsert({
      where: { name },
      update: { isActive: true, deletedAt: null },
      create: { name, isActive: true },
    });
  }

  // Platform Super Admin = every permission; plus demo users for each hierarchy role.
  await ensureSuperAdminAllPermissions(prisma);
  await seedDemoOfficeUsers(prisma);

  const policyCategories: Array<{ name: string; code: string; displayOrder: number }> = [
    { name: 'Safeguarding', code: 'SAFEGUARDING', displayOrder: 10 },
    { name: 'Health and safety', code: 'HEALTH_AND_SAFETY', displayOrder: 20 },
    { name: 'Medication', code: 'MEDICATION', displayOrder: 30 },
    { name: 'HR', code: 'HR', displayOrder: 40 },
  ];
  for (const cat of policyCategories) {
    const existing = await prisma.policyCategory.findFirst({ where: { code: cat.code, deletedAt: null } });
    if (!existing) {
      await prisma.policyCategory.create({
        data: {
          name: cat.name,
          code: cat.code,
          displayOrder: cat.displayOrder,
          createdById: adminForSeed?.id,
          updatedById: adminForSeed?.id,
        },
      });
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

