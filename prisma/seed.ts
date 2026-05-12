import { ComplianceCategory, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_JOB_TITLES } from '../src/lookups/default-job-titles';

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

  for (const name of DEFAULT_JOB_TITLES) await upsertLookup(prisma.jobTitle, name);

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

