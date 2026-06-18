import {
  ENTERPRISE_EMPLOYEE_VISA_TYPES,
  LEGACY_VISA_TYPE_ID_MAP,
  mergeEnterpriseImmigrationStatuses,
} from '../seed-data/employee-visa-catalog';
import {
  parseEmployeeVisaTypes,
  serializeEmployeeVisaTypes,
} from '../seed-data/employee-visa-types.util';

const DEFAULT_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';

/** One-off or seed helper: ensure all enterprise immigration statuses exist with hour caps. */
export async function ensureEnterpriseImmigrationStatusLookups(prisma: {
  organisationGeneralSettings: {
    findFirst: (args: unknown) => Promise<{ id: string; employeeVisaTypes: unknown } | null>;
    update: (args: unknown) => Promise<unknown>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  employeeEmployment: { updateMany: (args: unknown) => Promise<{ count: number }> };
}) {
  const settings = await prisma.organisationGeneralSettings.findFirst({
    where: { id: DEFAULT_SETTINGS_ID },
  });

  const merged = mergeEnterpriseImmigrationStatuses(
    settings ? parseEmployeeVisaTypes(settings.employeeVisaTypes) : [...ENTERPRISE_EMPLOYEE_VISA_TYPES],
  );

  if (settings) {
    await prisma.organisationGeneralSettings.update({
      where: { id: settings.id },
      data: { employeeVisaTypes: serializeEmployeeVisaTypes(merged) },
    });
  } else {
    await prisma.organisationGeneralSettings.upsert({
      where: { id: DEFAULT_SETTINGS_ID },
      update: { employeeVisaTypes: serializeEmployeeVisaTypes(merged) },
      create: {
        id: DEFAULT_SETTINGS_ID,
        employeeVisaTypes: serializeEmployeeVisaTypes(merged),
      },
    });
  }

  let remapped = 0;
  for (const [legacyId, nextId] of Object.entries(LEGACY_VISA_TYPE_ID_MAP)) {
    const result = await prisma.employeeEmployment.updateMany({
      where: { visaTypeId: legacyId, deletedAt: null },
      data: { visaTypeId: nextId },
    });
    remapped += result.count;
  }

  return { statusCount: merged.length, remappedEmploymentIds: remapped };
}
