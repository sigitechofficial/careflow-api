import { PrismaClient } from '@prisma/client';
import { WORKFORCE_CATALOG_MINIMUMS } from '../seed-data/workforce-catalog';

const prisma = new PrismaClient();

async function main() {
  const [skills, certs, compliance, reviews, requirements] = await Promise.all([
    prisma.skillType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.certificationType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.complianceType.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
    prisma.reviewType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.complianceRequirement.count({ where: { deletedAt: null, isActive: true } }),
  ]);

  const byCategory = compliance.reduce<Record<string, string[]>>((acc, c) => {
    const k = c.category;
    if (!acc[k]) acc[k] = [];
    acc[k].push(c.name);
    return acc;
  }, {});

  const checks = {
    complianceTypes: compliance.length >= WORKFORCE_CATALOG_MINIMUMS.complianceTypes,
    skillTypes: skills.length >= WORKFORCE_CATALOG_MINIMUMS.skillTypes,
    certificationTypes: certs.length >= WORKFORCE_CATALOG_MINIMUMS.certificationTypes,
    reviewTypes: reviews.length >= WORKFORCE_CATALOG_MINIMUMS.reviewTypes,
    requirements: requirements > 0,
  };

  const allPass = Object.values(checks).every(Boolean);

  console.log(
    JSON.stringify(
      {
        ok: allPass,
        minimums: WORKFORCE_CATALOG_MINIMUMS,
        counts: {
          skillTypes: skills.length,
          certificationTypes: certs.length,
          complianceTypes: compliance.length,
          reviewTypes: reviews.length,
          complianceRequirements: requirements,
        },
        checks,
        skillTypes: { names: skills.map((s) => s.name) },
        certificationTypes: { names: certs.map((c) => c.name) },
        reviewTypes: reviews.map((r) => ({
          name: r.name,
          code: r.code,
          defaultIntervalDays: r.defaultIntervalDays,
        })),
        complianceTypes: {
          mandatoryDefault: compliance.filter((c) => c.isMandatoryByDefault).map((c) => c.name),
          byCategory,
        },
      },
      null,
      2,
    ),
  );

  if (!allPass) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
