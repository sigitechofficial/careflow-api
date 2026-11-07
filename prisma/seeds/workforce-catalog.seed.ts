import type { PrismaClient } from '@prisma/client';
import { CARE_COMPLIANCE_CATALOG } from '../seed-data/care-compliance-catalog';
import {
  RETIRED_COMPLIANCE_CODES,
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

export async function softRetireComplianceByCode(prisma: PrismaClient, code: string) {
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

/**
 * Review types (supervision, appraisal, probation…) and skill / certification intervals.
 * Runs on every deploy (`prisma db seed`), so it only fills gaps: it creates missing review types,
 * links an existing same-name type to its code, and sets an interval only where none is set.
 * Names and intervals an admin changed in Settings are never overwritten.
 */
export async function seedWorkforceLookupIntervals(prisma: PrismaClient): Promise<{
  reviewTypesCreated: number;
  intervalsFilled: number;
}> {
  let reviewTypesCreated = 0;
  let intervalsFilled = 0;

  for (const rt of WORKFORCE_REVIEW_TYPES) {
    const existing =
      (await prisma.reviewType.findFirst({ where: { code: rt.code } })) ??
      (await prisma.reviewType.findFirst({ where: { name: rt.name } }));
    if (!existing) {
      await prisma.reviewType.create({
        data: {
          name: rt.name,
          code: rt.code,
          description: rt.description ?? null,
          defaultIntervalDays: rt.defaultIntervalDays,
          scheduleKind: rt.scheduleKind ?? 'REPEATING',
          firstDueAfterStartDays: rt.firstDueAfterStartDays ?? null,
          milestoneDays: rt.milestoneDays ?? [],
          audience: rt.audience ?? 'ALL_STAFF',
          isActive: true,
        },
      });
      reviewTypesCreated += 1;
      continue;
    }
    const fill: { code?: string; description?: string; defaultIntervalDays?: number } = {};
    if (!existing.code) fill.code = rt.code;
    if (!existing.description && rt.description) fill.description = rt.description;
    // Only a repeating type with no interval yet gets one; milestone and event types keep theirs.
    if (existing.scheduleKind === 'REPEATING' && existing.defaultIntervalDays == null && rt.defaultIntervalDays != null) {
      fill.defaultIntervalDays = rt.defaultIntervalDays;
      intervalsFilled += 1;
    }
    if (Object.keys(fill).length) {
      await prisma.reviewType.update({ where: { id: existing.id }, data: fill });
    }
  }

  for (const [name, months] of Object.entries(WORKFORCE_SKILL_REFRESH_MONTHS)) {
    if (months == null) continue;
    const { count } = await prisma.skillType.updateMany({
      where: { name, defaultRefreshMonths: null },
      data: { defaultRefreshMonths: months },
    });
    intervalsFilled += count;
  }

  for (const [name, months] of Object.entries(WORKFORCE_CERT_VALIDITY_MONTHS)) {
    if (months == null) continue;
    const { count } = await prisma.certificationType.updateMany({
      where: { name, defaultValidityMonths: null },
      data: { defaultValidityMonths: months },
    });
    intervalsFilled += count;
  }

  return { reviewTypesCreated, intervalsFilled };
}

export async function seedWorkforceCatalog(prisma: PrismaClient): Promise<WorkforceSeedResult> {
  const complianceTypeDefs = [
    ...CARE_COMPLIANCE_CATALOG,
    ...WORKFORCE_COMPLIANCE_SUPPLEMENT,
    ...WORKFORCE_COMPLIANCE_ADDITIONS,
  ];

  const typeByCode: Record<string, string> = {};
  for (const t of complianceTypeDefs) {
    if (t.code && RETIRED_COMPLIANCE_CODES.includes(t.code)) continue;
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
  for (const code of RETIRED_COMPLIANCE_CODES) {
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
      if (RETIRED_COMPLIANCE_CODES.includes(t.code)) continue;
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

  await seedWorkforceLookupIntervals(prisma);

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
