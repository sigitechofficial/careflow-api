import type { PrismaService } from '../prisma/prisma.service';
import type { MarExportContext } from './medication-mar-export-shared.util';
import {
  formatReportMonthLabel,
  formatUkDate,
  formatUkDateTime,
  normalizeMarExportMonthStats,
  periodBounds,
} from './medication-mar-export-shared.util';

type ChartForExport = {
  month: string;
  lastDay: number;
  periodStart?: string;
  periodEnd?: string;
  periodLabel?: string;
  medicationCount?: number;
  scheduleRowCount?: number;
  monthStats?: Parameters<typeof normalizeMarExportMonthStats>[0];
};

export async function loadMarExportContext(
  prisma: PrismaService,
  exporterUserId: string,
  serviceUserId: string,
  month: string,
  chart: ChartForExport,
): Promise<MarExportContext> {
  const [su, exporter, company] = await Promise.all([
    prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        dateOfBirth: true,
        nhsNumber: true,
        location: { select: { name: true } },
        medicationAllergies: {
          where: { deletedAt: null, isActive: true },
          select: { allergyName: true },
          orderBy: { allergyName: 'asc' },
        },
      },
    }),
    prisma.user.findFirst({
      where: { id: exporterUserId, deletedAt: null },
      select: { firstName: true, lastName: true, email: true },
    }),
    prisma.companyProfile.findFirst({
      select: { displayName: true, companyName: true },
    }),
  ]);

  const legal = [su?.firstName, su?.lastName].filter(Boolean).join(' ').trim();
  const serviceUserLabel =
    su?.preferredName?.trim() && legal
      ? `${legal} (${su.preferredName.trim()})`
      : legal || su?.preferredName?.trim() || 'Service user';

  const exporterName = exporter
    ? [exporter.firstName, exporter.lastName].filter(Boolean).join(' ').trim() ||
      exporter.email
    : null;

  const allergies =
    su?.medicationAllergies
      ?.map(a => a.allergyName.trim())
      .filter(Boolean) ?? [];

  const bounds = periodBounds(month, chart.lastDay);
  const periodStart = chart.periodStart ?? bounds.start;
  const periodEnd = chart.periodEnd ?? bounds.end;

  return {
    organisationName: company?.displayName ?? company?.companyName ?? null,
    serviceUserId,
    serviceUserLabel,
    preferredName: su?.preferredName?.trim() ?? null,
    dateOfBirth: formatUkDate(su?.dateOfBirth?.toISOString() ?? null),
    nhsNumber: su?.nhsNumber?.trim() ?? null,
    locationName: su?.location?.name ?? null,
    allergySummary: allergies.length > 0 ? allergies.join('; ') : null,
    reportMonth: month,
    reportMonthLabel: chart.periodLabel ?? formatReportMonthLabel(month),
    periodStart,
    periodEnd,
    generatedAt: formatUkDateTime(),
    generatedBy: exporterName,
    medicationCount: chart.medicationCount ?? 0,
    administrationRowCount: chart.scheduleRowCount ?? 0,
    monthStats: normalizeMarExportMonthStats(chart.monthStats),
  };
}
