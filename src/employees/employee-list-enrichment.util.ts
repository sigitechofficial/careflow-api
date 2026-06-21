import type { PrismaService } from '../prisma/prisma.service';

export type EmployeeListHolidaySnapshot = {
  onHolidayToday: boolean;
  holidayEndDate: string | null;
};

export async function loadEmployeeListHolidaySnapshots(
  prisma: PrismaService,
  employeeIds: string[],
  at: Date = new Date(),
): Promise<Map<string, EmployeeListHolidaySnapshot>> {
  if (!employeeIds.length) return new Map();

  const rows = await prisma.employeeHoliday.findMany({
    where: {
      employeeId: { in: employeeIds },
      deletedAt: null,
      startDate: { lte: at },
      endDate: { gte: at },
    },
    select: { employeeId: true, endDate: true },
  });

  const map = new Map<string, EmployeeListHolidaySnapshot>();
  for (const row of rows) {
    map.set(row.employeeId, {
      onHolidayToday: true,
      holidayEndDate: row.endDate.toISOString(),
    });
  }
  return map;
}
