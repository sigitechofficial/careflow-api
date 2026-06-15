import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<
    { role_name: string | null; job_title_name: string | null; cnt: number }[]
  >`
    SELECT er.name AS role_name, jt.name AS job_title_name, COUNT(*)::int AS cnt
    FROM employees."Employee" e
    JOIN employees."EmployeeEmployment" ee ON ee."employeeId" = e.id AND ee."deletedAt" IS NULL
    LEFT JOIN lookups."EmployeeRoleLookup" er ON er.id = ee."roleId"
    LEFT JOIN lookups."JobTitle" jt ON jt.id = ee."jobTitleId"
    WHERE e."deletedAt" IS NULL
    GROUP BY er.name, jt.name
    ORDER BY cnt DESC
  `;
  console.log('Distribution:', JSON.stringify(rows, null, 2));

  const missing = await prisma.$queryRaw<{ cnt: number }[]>`
    SELECT COUNT(*)::int AS cnt
    FROM employees."EmployeeEmployment" ee
    JOIN employees."Employee" e ON e.id = ee."employeeId" AND e."deletedAt" IS NULL
    WHERE ee."deletedAt" IS NULL AND ee."roleId" IS NULL
  `;
  console.log('Missing roleId:', missing[0]?.cnt ?? 0);

  const roles = await prisma.employeeRoleLookup.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  console.log('Available roles:', roles);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
