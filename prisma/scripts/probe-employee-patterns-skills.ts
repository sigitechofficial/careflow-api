import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [empCount, empActive, withEmployment, withPatterns, patternRows, skillTypes, skillRows, empsWithSkills] =
    await Promise.all([
      prisma.employee.count({ where: { deletedAt: null } }),
      prisma.employee.count({ where: { deletedAt: null, isActive: true } }),
      prisma.employeeEmployment.count({ where: { deletedAt: null } }),
      prisma.employee.count({
        where: { deletedAt: null, workingPatterns: { some: { deletedAt: null } } },
      }),
      prisma.employeeWorkingPattern.count({ where: { deletedAt: null } }),
      prisma.skillType.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.employeeSkill.count({ where: { deletedAt: null } }),
      prisma.employee.count({
        where: { deletedAt: null, skills: { some: { deletedAt: null } } },
      }),
    ]);

  const patternsByDay = await prisma.employeeWorkingPattern.groupBy({
    by: ['dayOfWeek', 'isAvailable'],
    where: { deletedAt: null },
    _count: { _all: true },
  });

  const skillsPerEmp = await prisma.employeeSkill.groupBy({
    by: ['employeeId'],
    where: { deletedAt: null },
    _count: { _all: true },
  });

  const skillBreakdown = await prisma.employeeSkill.groupBy({
    by: ['skillTypeId'],
    where: { deletedAt: null, skillTypeId: { not: null } },
    _count: { _all: true },
  });
  const skillTypeMap = Object.fromEntries(skillTypes.map((s) => [s.id, s.name]));
  const skillUsage = skillBreakdown
    .map((r) => ({ name: skillTypeMap[r.skillTypeId!] ?? r.skillTypeId, count: r._count._all }))
    .sort((a, b) => b.count - a.count);

  const empsNoPattern = await prisma.employee.findMany({
    where: { deletedAt: null, workingPatterns: { none: { deletedAt: null } } },
    include: {
      personalDetail: { select: { firstName: true, lastName: true } },
      employment: {
        select: {
          location: { select: { name: true } },
          role: { select: { name: true } },
          accessAllZones: true,
        },
      },
    },
    orderBy: { personalDetail: { lastName: 'asc' } },
  });

  const empsNoSkills = await prisma.employee.findMany({
    where: { deletedAt: null, skills: { none: { deletedAt: null } } },
    include: { personalDetail: { select: { firstName: true, lastName: true } } },
    orderBy: { personalDetail: { lastName: 'asc' } },
  });

  const patternProfiles = await prisma.employee.findMany({
    where: { deletedAt: null, workingPatterns: { some: { deletedAt: null } } },
    include: {
      personalDetail: { select: { firstName: true, lastName: true } },
      workingPatterns: { where: { deletedAt: null }, orderBy: { dayOfWeek: 'asc' } },
    },
    take: 10,
    orderBy: { createdAt: 'asc' },
  });

  const holidays = await prisma.employeeHoliday.count({ where: { deletedAt: null } });
  const nonCore = await prisma.employeeNonCoreActivity.count({ where: { deletedAt: null } });
  const certTypes = await prisma.certificationType.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { name: 'asc' },
    select: { name: true },
  });

  const locations = await prisma.location.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { name: 'asc' },
    select: { name: true },
  });

  const soleEmployee = await prisma.employee.findFirst({
    where: { deletedAt: null },
    include: {
      personalDetail: true,
      employment: {
        include: {
          location: true,
          role: true,
          jobTitle: true,
          grade: true,
          floorLocations: { include: { location: true } },
          baseLocations: { include: { location: true } },
        },
      },
      skills: { where: { deletedAt: null }, include: { skillType: true } },
    },
  });

  console.log(
    JSON.stringify(
      {
        employees: {
          total: empCount,
          active: empActive,
          withEmployment,
          withWorkingPatterns: withPatterns,
          withoutWorkingPatterns: empCount - withPatterns,
          withSkills: empsWithSkills,
          withoutSkills: empCount - empsWithSkills,
        },
        workingPatterns: {
          totalRows: patternRows,
          avgRowsPerEmployeeWithPattern:
            withPatterns > 0 ? (patternRows / withPatterns).toFixed(1) : '0',
          byDayAvailability: patternsByDay,
          holidays,
          nonCoreActivities: nonCore,
        },
        skills: {
          skillTypeCount: skillTypes.length,
          skillTypes: skillTypes.map((s) => s.name),
          totalAssignments: skillRows,
          usageByType: skillUsage,
          perEmployee:
            skillsPerEmp.length > 0
              ? {
                  min: Math.min(...skillsPerEmp.map((s) => s._count._all)),
                  max: Math.max(...skillsPerEmp.map((s) => s._count._all)),
                  avg: (skillsPerEmp.reduce((a, s) => a + s._count._all, 0) / skillsPerEmp.length).toFixed(1),
                }
              : null,
        },
        certificationTypes: certTypes.map((c) => c.name),
        locations: locations.map((l) => l.name),
        soleEmployeeDetail: soleEmployee
          ? {
              name: [soleEmployee.personalDetail?.firstName, soleEmployee.personalDetail?.lastName]
                .filter(Boolean)
                .join(' '),
              location: soleEmployee.employment?.location?.name ?? null,
              role: soleEmployee.employment?.role?.name ?? null,
              jobTitle: soleEmployee.employment?.jobTitle?.name ?? null,
              grade: soleEmployee.employment?.grade?.name ?? null,
              accessAllZones: soleEmployee.employment?.accessAllZones ?? false,
              contractedHours: soleEmployee.employment?.contractedWeeklyHours ?? null,
              floorLocations: soleEmployee.employment?.floorLocations.map((f) => f.location.name) ?? [],
              baseLocations: soleEmployee.employment?.baseLocations.map((b) => b.location.name) ?? [],
              skills: soleEmployee.skills.map((s) => s.skillType?.name),
            }
          : null,
        employeesWithoutPatterns: empsNoPattern.map((e) => ({
          name: [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' '),
          location: e.employment?.location?.name ?? null,
          role: e.employment?.role?.name ?? null,
          accessAllZones: e.employment?.accessAllZones ?? false,
        })),
        employeesWithoutSkills: empsNoSkills.map((e) =>
          [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' '),
        ),
        samplePatternProfiles: patternProfiles.map((e) => ({
          name: [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' '),
          days: e.workingPatterns.map((p) => ({
            day: p.dayOfWeek,
            available: p.isAvailable,
            start: p.startTime,
            end: p.endTime,
            notes: p.notes,
          })),
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
