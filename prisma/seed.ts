import { ComplianceCategory, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { defaultJobTitles } from './seed-data/default-job-titles';
import { seedInitialAssessmentChecklist } from './seeds/initial-assessment-checklist.seed';

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
    await upsertLookup(prisma.zone, name);
  }

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
    'lookups.read',
    'users.read',
    'users.create',
    'roles.manage',
    'permissions.manage',
    'audit_logs.read',
    'temporary_inspector.session',
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
    'service_users.initial_assessment.read',
    'service_users.initial_assessment.create',
    'service_users.initial_assessment.update',
    'service_users.initial_assessment.delete',
    'service_users.initial_assessment.submit',
    'service_users.initial_assessment.review',
    'service_users.initial_assessment.export',
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
  ];
  const roles = [];
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
    'service_users.initial_assessment.read',
    'service_users.initial_assessment.create',
    'service_users.initial_assessment.update',
    'service_users.initial_assessment.submit',
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

    'funding_types.read',
    'funding_types.create',
    'funding_types.update',
    'funders.read',
    'funders.create',
    'funders.update',
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
  for (const r of [
    roles.find((x) => x.name === 'Admin'),
    roles.find((x) => x.name === 'Manager'),
    roles.find((x) => x.name === 'HR'),
    privacyOfficerRole,
  ]) {
    if (!r) continue;
    for (const p of [complianceReportRead, complianceRead, complianceTypesRead, complianceReqRead]) {
      if (!p) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } },
        update: {},
        create: { roleId: r.id, permissionId: p.id },
      });
    }
  }

  // --- Compliance types & requirements (idempotent) ---
  type Cat = (typeof ComplianceCategory)[keyof typeof ComplianceCategory];
  const complianceTypeDefs: Array<{
    name: string;
    code: string;
    category: Cat;
    hasExpiry: boolean;
    defaultValidityMonths: number | null;
    requiresDocument: boolean;
    requiresVerification: boolean;
  }> = [
    { name: 'DBS Check', code: 'DBS_CHECK', category: ComplianceCategory.SAFEGUARDING, hasExpiry: true, defaultValidityMonths: 36, requiresDocument: true, requiresVerification: true },
    { name: 'Right to Work', code: 'RIGHT_TO_WORK', category: ComplianceCategory.RIGHT_TO_WORK, hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true },
    { name: 'Proof of ID', code: 'PROOF_OF_ID', category: ComplianceCategory.IDENTITY, hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true },
    { name: 'Employment Contract', code: 'EMPLOYMENT_CONTRACT', category: ComplianceCategory.EMPLOYMENT, hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true },
    { name: 'Care Certificate', code: 'CARE_CERTIFICATE', category: ComplianceCategory.TRAINING, hasExpiry: false, defaultValidityMonths: null, requiresDocument: true, requiresVerification: true },
    { name: 'Manual Handling', code: 'MANUAL_HANDLING', category: ComplianceCategory.HEALTH_AND_SAFETY, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'First Aid', code: 'FIRST_AID', category: ComplianceCategory.TRAINING, hasExpiry: true, defaultValidityMonths: 36, requiresDocument: true, requiresVerification: true },
    { name: 'Safeguarding Adults', code: 'SAFEGUARDING_ADULTS', category: ComplianceCategory.SAFEGUARDING, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'Safeguarding Children', code: 'SAFEGUARDING_CHILDREN', category: ComplianceCategory.SAFEGUARDING, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'Medication Training', code: 'MEDICATION_TRAINING', category: ComplianceCategory.CLINICAL, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'Food Hygiene', code: 'FOOD_HYGIENE', category: ComplianceCategory.HEALTH_AND_SAFETY, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'Fire Safety', code: 'FIRE_SAFETY', category: ComplianceCategory.HEALTH_AND_SAFETY, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'Health and Safety', code: 'HEALTH_AND_SAFETY_GEN', category: ComplianceCategory.HEALTH_AND_SAFETY, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'Infection Prevention and Control', code: 'IPC', category: ComplianceCategory.HEALTH_AND_SAFETY, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'Moving and Handling', code: 'MOVING_HANDLING', category: ComplianceCategory.HEALTH_AND_SAFETY, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'Mental Capacity Act', code: 'MCA', category: ComplianceCategory.TRAINING, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'Deprivation of Liberty Safeguards', code: 'DOLS', category: ComplianceCategory.SAFEGUARDING, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'NMC PIN', code: 'NMC_PIN', category: ComplianceCategory.PROFESSIONAL_REGISTRATION, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'Driving Licence', code: 'DRIVING_LICENCE', category: ComplianceCategory.DRIVING, hasExpiry: true, defaultValidityMonths: 120, requiresDocument: true, requiresVerification: true },
    { name: 'Vehicle Insurance', code: 'VEHICLE_INSURANCE', category: ComplianceCategory.DRIVING, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'MOT', code: 'MOT', category: ComplianceCategory.DRIVING, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
    { name: 'Business Insurance', code: 'BUSINESS_INSURANCE', category: ComplianceCategory.DRIVING, hasExpiry: true, defaultValidityMonths: 12, requiresDocument: true, requiresVerification: true },
  ];

  const typeByCode: Record<string, string> = {};
  for (const t of complianceTypeDefs) {
    const row = await prisma.complianceType.upsert({
      where: { name: t.name },
      update: {
        code: t.code,
        category: t.category,
        hasExpiry: t.hasExpiry,
        defaultValidityMonths: t.defaultValidityMonths,
        requiresDocument: t.requiresDocument,
        requiresVerification: t.requiresVerification,
        isActive: true,
        deletedAt: null,
      },
      create: {
        name: t.name,
        code: t.code,
        category: t.category,
        hasExpiry: t.hasExpiry,
        defaultValidityMonths: t.defaultValidityMonths,
        requiresDocument: t.requiresDocument,
        requiresVerification: t.requiresVerification,
      },
    });
    typeByCode[t.code] = row.id;
  }

  const carerRole = await prisma.employeeRoleLookup.findFirst({ where: { name: 'Carer' } });
  const seniorCarerRole = await prisma.employeeRoleLookup.findFirst({ where: { name: 'Senior Carer' } });
  const careArea = await prisma.workArea.findFirst({ where: { name: 'Care' } });
  const kitchenArea = await prisma.workArea.findFirst({ where: { name: 'Kitchen' } });
  const nurseTitle = await prisma.jobTitle.findFirst({ where: { name: 'Senior Carer/Nurse' } });

  async function ensureRequirement(
    code: string,
    filters: {
      roleId?: string | null;
      workAreaId?: string | null;
      jobTitleId?: string | null;
    },
  ) {
    const complianceTypeId = typeByCode[code];
    if (!complianceTypeId) return;
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
        },
      });
    }
  }

  const carerPack = ['DBS_CHECK', 'RIGHT_TO_WORK', 'PROOF_OF_ID', 'CARE_CERTIFICATE', 'MANUAL_HANDLING', 'SAFEGUARDING_ADULTS', 'MEDICATION_TRAINING'];
  for (const code of carerPack) {
    await ensureRequirement(code, { roleId: carerRole?.id ?? null, workAreaId: careArea?.id ?? null });
  }
  if (seniorCarerRole) {
    await ensureRequirement('FIRST_AID', { roleId: seniorCarerRole.id, workAreaId: careArea?.id ?? null });
  }
  if (nurseTitle) {
    await ensureRequirement('NMC_PIN', { jobTitleId: nurseTitle.id });
  }
  if (kitchenArea) {
    await ensureRequirement('FOOD_HYGIENE', { workAreaId: kitchenArea.id });
  }
  const driverRole = carerRole;
  for (const code of ['DRIVING_LICENCE', 'VEHICLE_INSURANCE', 'MOT', 'BUSINESS_INSURANCE']) {
    await ensureRequirement(code, { roleId: driverRole?.id ?? null });
  }

  // eslint-disable-next-line no-console
  console.log('[seed] Compliance types & requirements upserted.');
  const email = 'admin@careadmin.local';
  const password = 'Admin@12345';
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

  for (const row of [
    ['Private', 'PRIVATE'],
    ['Local Authority', 'LOCAL_AUTHORITY'],
    ['NHS', 'NHS'],
    ['Direct Payment', 'DIRECT_PAYMENT'],
    ['Mixed Funding', 'MIXED'],
    ['Unknown', 'FUNDING_UNKNOWN'],
  ]) {
    await prisma.serviceUserFundingType.upsert({
      where: { code: row[1] },
      update: { name: row[0], isActive: true },
      create: { name: row[0], code: row[1] },
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

  const allergyCatalogSeed: Array<[string, string]> = [
    ['ADHESIVE TAPE', 'ADHESIVE_TAPE'],
    ['Air', 'AIR'],
    ['Aledronic Acid', 'ALEDRONIC_ACID'],
    ['allergic to tramadol', 'ALLERGIC_TRAMADOL'],
    ['allopurinol', 'ALLOPURINOL'],
    ['Amlodipine', 'AMLODIPINE'],
    ['Amoxicillin, Clarithromycin', 'AMOXICILLIN_CLARITHROMYCIN'],
    ['Anadin', 'ANADIN'],
    ['Angiotensin Converting Enzyme Inhibitors', 'ACE_INHIBITORS'],
    ['Aspirin', 'ASPIRIN'],
    ['Atorvastatin', 'ATORVASTATIN'],
    ['Bee stings', 'BEE_STINGS'],
    ['Codeine', 'CODEINE'],
    ['Dairy', 'DAIRY'],
    ['Eggs', 'EGGS'],
    ['Ibuprofen', 'IBUPROFEN'],
    ['Latex', 'LATEX'],
    ['Metformin', 'METFORMIN'],
    ['Penicillin', 'PENICILLIN'],
    ['Peanuts', 'PEANUTS'],
    ['Shellfish', 'SHELLFISH'],
    ['Soy', 'SOY'],
    ['Sulphur / Sulfa drugs', 'SULFA_DRUGS'],
    ['Tramadol', 'TRAMADOL'],
    ['Wheat / Gluten', 'WHEAT_GLUTEN'],
    ['Other / not listed', 'OTHER_NOT_LISTED'],
  ];
  for (let i = 0; i < allergyCatalogSeed.length; i++) {
    const [name, code] = allergyCatalogSeed[i]!;
    await prisma.allergyCatalog.upsert({
      where: { code },
      update: { name, sortOrder: i, isActive: true },
      create: { name, code, sortOrder: i },
    });
  }

  const absenceReasonCatalogSeed: Array<[string, string]> = [
    ['Hospital Visit', 'HOSPITAL_VISIT'],
    ['Family Visit', 'FAMILY_VISIT'],
    ['Other', 'OTHER'],
    ['Respite Care', 'RESPITE_CARE'],
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

  for (const name of [
    'Dementia Care',
    'First Aid',
    'Manual Handling',
    'Safeguarding Adults',
    'Medication Administration',
    'Infection control',
    'Epilepsy awareness',
    'Food hygiene',
  ]) {
    await upsertLookup(prisma.skillType, name);
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
    row: { name: string; code: string; description?: string | null; timesPerDay?: number | null; intervalHours?: number | null; time?: string; sortOrder?: number },
  ) {
    const baseMinimal = {
      name: row.name,
      code: row.code,
      isActive: true,
      deletedAt: null,
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
    { name: 'Tablet', code: 'TABLET' },
    { name: 'Capsule', code: 'CAPSULE' },
    { name: 'Liquid', code: 'LIQUID' },
    { name: 'Cream', code: 'CREAM' },
    { name: 'Ointment', code: 'OINTMENT' },
    { name: 'Drops', code: 'DROPS' },
    { name: 'Injection', code: 'INJECTION' },
    { name: 'Inhaler', code: 'INHALER' },
    { name: 'Patch', code: 'PATCH' },
    { name: 'Sachet', code: 'SACHET' },
    { name: 'Other', code: 'OTHER_TYPE' },
  ]) {
    await upsertMedCode(prisma.medicationType, row);
  }
  for (const row of [
    { name: 'Oral', code: 'ORAL' },
    { name: 'Topical', code: 'TOPICAL' },
    { name: 'Inhalation', code: 'INHALATION' },
    { name: 'Injection', code: 'ROUTE_INJECTION' },
    { name: 'Eye', code: 'EYE' },
    { name: 'Ear', code: 'EAR' },
    { name: 'Nasal', code: 'NASAL' },
    { name: 'Rectal', code: 'RECTAL' },
    { name: 'Sublingual', code: 'SUBLINGUAL' },
    { name: 'Other', code: 'OTHER_ROUTE' },
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
    { name: 'Every 1 day', code: 'EVERY_1_DAY', timesPerDay: 1 },
    { name: 'Weekly', code: 'WEEKLY', timesPerDay: null },
    { name: 'Monthly', code: 'MONTHLY', timesPerDay: null },
    { name: 'As Required', code: 'AS_REQUIRED', timesPerDay: null },
    { name: 'Other', code: 'OTHER_FREQUENCY', timesPerDay: null },
  ]) {
    await upsertMedCode(prisma.medicationFrequency, row);
  }
  for (const row of [
    { name: 'Breakfast Round', code: 'BREAKFAST_ROUND', time: '06:00', sortOrder: 10 },
    { name: 'Lunch Round', code: 'LUNCH_ROUND', time: '11:00', sortOrder: 20 },
    { name: 'Tea Round', code: 'TEA_ROUND', time: '15:00', sortOrder: 30 },
    { name: 'Bed Round', code: 'BED_ROUND', time: '18:00', sortOrder: 40 },
  ]) {
    await upsertMedCode(prisma.medicationAdministrationRound, row);
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

  const initialAssessmentReviewPermKeys = ['service_users.initial_assessment.review'];
  const initialAssessmentReviewPerms = await prisma.permission.findMany({
    where: { key: { in: initialAssessmentReviewPermKeys }, deletedAt: null },
  });
  for (const roleName of ['Admin', 'Manager', 'Senior Carer/Nurse']) {
    const r = roles.find((x) => x.name === roleName);
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

