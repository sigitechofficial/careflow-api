import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<
    { id: string; firstName: string; lastName: string; email: string | null }[]
  >`
    SELECT e.id, pd."firstName", pd."lastName", pd.email
    FROM employees."Employee" e
    JOIN employees."EmployeePersonalDetail" pd ON pd."employeeId" = e.id AND pd."deletedAt" IS NULL
    WHERE e."deletedAt" IS NULL
    ORDER BY pd."lastName", pd."firstName"
  `;
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
