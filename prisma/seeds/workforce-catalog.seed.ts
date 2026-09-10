import type { PrismaClient } from '@prisma/client';
import { CARE_COMPLIANCE_CATALOG } from '../seed-data/care-compliance-catalog';
import {
  DEPRECATED_COMPLIANCE_CODES,
  WORKFORCE_CERTIFICATION_NAMES,
  WORKFORCE_CERT_VALIDITY_MONTHS,
  WORKFORCE_COMPLIANCE_ADDITIONS,
  WORKFORCE_COMPLIANCE_PATCHES,
  WORKFORCE_COMPLIANCE_SUPPLEMENT,
  WORKFORCE_REQUIREMENTS,
  WORKFORCE_REVIEW_TYPES,
  WORKFORCE_SKILL_NAMES,
  WORKFORCE_SKILL_REFRESH_MONTHS,
  type WorkforceComplianceDef,
} from '../seed-data/workforce-catalog';

export type WorkforceSeedResult = {
  typeByCode: Record<string, string>;
  complianceCount: number;
  skillCount: number;
  certificationCount: number;
  reviewTypeCount: number;
  requirementCount: number;
  retiredComplianceCount: number;
};

async function upsertLookupByName(model: { upsert: (args: unknown) => Promise<unknown> }, name: string) {
  return model.upsert({
    where: { name },
    update: { isActive: true, deletedAt: null },
    create: { name, isActive: true },
  });
}

async function upsertSkillType(
  prisma: PrismaClient,
  name: string,
  defaultRefreshMonths: number | null | undefined,
) {
  const data =
    defaultRefreshMonths != null ? { defaultRefreshMonths } : {};
  return prisma.skillType.upsert({
    where: { name },
    update: { isActive: true, deletedAt: null, ...data },
    create: { name, isActive: true, ...data },
  });
}

async function upsertCertificationType(
  prisma: PrismaClient,
  name: string,
  defaultValidityMonths: number | null | undefined,
) {
  const data =
    defaultValidityMonths != null ? { defaultValidityMonths } : {};
  return prisma.certificationType.upsert({
    where: { name },
    update: { isActive: true, deletedAt: null, ...data },
    create: { name, isActive: true, ...data },
  });
}

async function upsertComplianceType(prisma: PrismaClient, t: WorkforceComplianceDef) {
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
    (t.code ? await prisma.complianceType.findFirst({ where: { code: t.code } }) : null) ??
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

async function softRetireComplianceByCode(prisma: PrismaClient, code: string) {
  const row = await prisma.complianceType.findFirst({ where: { code, deletedAt: null } });
  if (!row || !row.isActive) return false;
  const retiredAt = new Date();
  await prisma.complianceType.update({
    where: { id: row.id },
    data: { isActive: false, deletedAt: retiredAt },
  });
  await prisma.complianceRequirement.updateMany({
    where: { complianceTypeId: row.id, deletedAt: null },
    data: { isActive: false, deletedAt: retiredAt },
  });
  return true;
}

export async function seedWorkforceCatalog(prisma: PrismaClient): Promise<WorkforceSeedResult> {
  const complianceTypeDefs = [
    ...CARE_COMPLIANCE_CATALOG,
    ...WORKFORCE_COMPLIANCE_SUPPLEMENT,
    ...WORKFORCE_COMPLIANCE_ADDITIONS,
  ];

  const typeByCode: Record<string, string> = {};
  for (const t of complianceTypeDefs) {
    const row = await upsertComplianceType(prisma, t);
    if (t.code) typeByCode[t.code] = row.id;
  }

  for (const [code, patch] of Object.entries(WORKFORCE_COMPLIANCE_PATCHES)) {
    const id = typeByCode[code];
    if (!id) continue;
    await prisma.complianceType.update({
      where: { id },
      data: {
        ...(patch.name != null ? { name: patch.name } : {}),
        ...(patch.hasExpiry != null ? { hasExpiry: patch.hasExpiry } : {}),
        ...(patch.defaultValidityMonths != null
          ? { defaultValidityMonths: patch.defaultValidityMonths }
          : {}),
      },
    });
  }

  let retiredComplianceCount = 0;
  for (const code of DEPRECATED_COMPLIANCE_CODES) {
    if (await softRetireComplianceByCode(prisma, code)) retiredComplianceCount += 1;
  }

  const retiredAt = new Date();
  await prisma.complianceRequirement.updateMany({
    where: {
      deletedAt: null,
      isActive: true,
      complianceType: { OR: [{ isActive: false }, { deletedAt: { not: null } }] },
    },
    data: { isActive: false, deletedAt: retiredAt },
  });

  const roleByName = Object.fromEntries(
    (await prisma.employeeRoleLookup.findMany({ where: { deletedAt: null } })).map((r) => [r.name, r.id]),
  );
  const workAreaByName = Object.fromEntries(
    (await prisma.workArea.findMany({ where: { deletedAt: null } })).map((w) => [w.name, w.id]),
  );
  const jobTitleByName = Object.fromEntries(
    (await prisma.jobTitle.findMany({ where: { deletedAt: null } })).map((j) => [j.name, j.id]),
  );
  const contractTypeByName = Object.fromEntries(
    (await prisma.contractType.findMany({ where: { deletedAt: null } })).map((c) => [c.name, c.id]),
  );

  let requirementCount = 0;
  async function ensureRequirement(
    code: string,
    filters: {
      roleId?: string | null;
      workAreaId?: string | null;
      jobTitleId?: string | null;
      contractTypeId?: string | null;
      isMandatory?: boolean;
      renewalBeforeDays?: number;
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
      contractTypeId: filters.contractTypeId ?? null,
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
          contractTypeId: filters.contractTypeId ?? undefined,
          isMandatory,
          blocksAllocation: isMandatory,
          renewalBeforeDays: filters.renewalBeforeDays ?? 30,
        },
      });
      requirementCount += 1;
      return;
    }
    await prisma.complianceRequirement.update({
      where: { id: exists.id },
      data: {
        isMandatory,
        blocksAllocation: isMandatory,
        renewalBeforeDays: filters.renewalBeforeDays ?? exists.renewalBeforeDays,
        isActive: true,
        deletedAt: null,
      },
    });
  }

  const careArea = workAreaByName['Care'];
  if (careArea) {
    for (const t of CARE_COMPLIANCE_CATALOG) {
      if (DEPRECATED_COMPLIANCE_CODES.includes(t.code as (typeof DEPRECATED_COMPLIANCE_CODES)[number])) {
        continue;
      }
      await ensureRequirement(t.code, {
        workAreaId: careArea,
        isMandatory: t.isMandatoryByDefault,
        renewalBeforeDays: 30,
      });
    }
  }

  for (const req of WORKFORCE_REQUIREMENTS) {
    await ensureRequirement(req.complianceCode, {
      roleId: req.roleName ? (roleByName[req.roleName] ?? null) : null,
      workAreaId: req.workAreaName ? (workAreaByName[req.workAreaName] ?? null) : null,
      jobTitleId: req.jobTitleName ? (jobTitleByName[req.jobTitleName] ?? null) : null,
      contractTypeId: req.contractTypeName ? (contractTypeByName[req.contractTypeName] ?? null) : null,
      isMandatory: req.isMandatory ?? true,
      renewalBeforeDays: req.renewalBeforeDays ?? 30,
    });
  }

  for (const name of WORKFORCE_SKILL_NAMES) {
    await upsertSkillType(prisma, name, WORKFORCE_SKILL_REFRESH_MONTHS[name]);
  }

  for (const name of WORKFORCE_CERTIFICATION_NAMES) {
    await upsertCertificationType(prisma, name, WORKFORCE_CERT_VALIDITY_MONTHS[name]);
  }

  for (const rt of WORKFORCE_REVIEW_TYPES) {
    const payload = {
      name: rt.name,
      code: rt.code,
      description: rt.description ?? null,
      defaultIntervalDays: rt.defaultIntervalDays,
      isActive: true,
      deletedAt: null as Date | null,
    };
    const byCode = await prisma.reviewType.findFirst({ where: { code: rt.code } });
    const byName = byCode ?? (await prisma.reviewType.findFirst({ where: { name: rt.name } }));
    if (byName) {
      await prisma.reviewType.update({ where: { id: byName.id }, data: payload });
    } else {
      await prisma.reviewType.create({ data: payload });
    }
  }

  const [complianceCount, skillCount, certificationCount, reviewTypeCount] = await Promise.all([
    prisma.complianceType.count({ where: { deletedAt: null, isActive: true } }),
    prisma.skillType.count({ where: { deletedAt: null, isActive: true } }),
    prisma.certificationType.count({ where: { deletedAt: null, isActive: true } }),
    prisma.reviewType.count({ where: { deletedAt: null, isActive: true } }),
  ]);

  return {
    typeByCode,
    complianceCount,
    skillCount,
    certificationCount,
    reviewTypeCount,
    requirementCount,
    retiredComplianceCount,
  };
}
