import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ECM_THRESHOLD_LOOKUP_DEFAULTS } from '../../prisma/seed-data/ecm-threshold-lookups.defaults';
import { seedEcmThresholdLookups } from '../../prisma/seeds/ecm-threshold-lookups.seed';
import type { EcmSettingsLayer } from './ecm-settings-resolver.util';
import { ECM_PLATFORM_DEFAULTS } from './ecm-timing.util';

export type EcmDashboardWindows = {
  dueNowWindowMinutes: number;
  startingSoonMinutes: number;
  earlyArrivalToleranceMinutes: number;
  lateArrivalToleranceMinutes: number;
  veryLateThresholdMinutes: number;
  missedVisitThresholdMinutes: number;
  geofenceRadiusMeters: number;
};

@Injectable()
export class EcmThresholdLookupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    await this.ensureSeeded();
    return this.prisma.ecmThresholdLookup.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async update(id: string, valueInt: number) {
    if (!Number.isFinite(valueInt) || valueInt < 0 || !Number.isInteger(valueInt)) {
      throw new BadRequestException('valueInt must be a non-negative integer');
    }
    const existing = await this.prisma.ecmThresholdLookup.findUnique({ where: { id } });
    if (!existing || !existing.isActive) {
      throw new NotFoundException('ECM threshold lookup not found');
    }

    // Keep very-late strictly above late when either is edited.
    if (existing.code === 'lateArrivalToleranceMinutes') {
      const veryLate = await this.prisma.ecmThresholdLookup.findFirst({
        where: { code: 'veryLateThresholdMinutes', isActive: true },
      });
      if (veryLate && veryLate.valueInt <= valueInt) {
        throw new BadRequestException(
          `Very late threshold (${veryLate.valueInt}) must be greater than late arrival tolerance (${valueInt})`,
        );
      }
    }
    if (existing.code === 'veryLateThresholdMinutes') {
      const late = await this.prisma.ecmThresholdLookup.findFirst({
        where: { code: 'lateArrivalToleranceMinutes', isActive: true },
      });
      if (late && valueInt <= late.valueInt) {
        throw new BadRequestException(
          `Very late threshold (${valueInt}) must be greater than late arrival tolerance (${late.valueInt})`,
        );
      }
    }

    return this.prisma.ecmThresholdLookup.update({
      where: { id },
      data: { valueInt },
    });
  }

  /** Platform layer for resolveEcmSettings — DB lookups with code defaults as fallback. */
  async toPlatformLayer(): Promise<EcmSettingsLayer> {
    const map = await this.valueMap();
    return {
      lateArrivalToleranceMinutes:
        map.get('lateArrivalToleranceMinutes') ?? ECM_PLATFORM_DEFAULTS.lateArrivalToleranceMinutes,
      veryLateThresholdMinutes:
        map.get('veryLateThresholdMinutes') ?? ECM_PLATFORM_DEFAULTS.veryLateThresholdMinutes,
      earlyArrivalToleranceMinutes:
        map.get('earlyArrivalToleranceMinutes') ??
        ECM_PLATFORM_DEFAULTS.earlyArrivalToleranceMinutes,
      shortVisitToleranceMinutes:
        map.get('shortVisitToleranceMinutes') ?? ECM_PLATFORM_DEFAULTS.shortVisitToleranceMinutes,
      shortVisitTolerancePercent:
        map.get('shortVisitTolerancePercent') ?? ECM_PLATFORM_DEFAULTS.shortVisitTolerancePercent,
      longVisitToleranceMinutes:
        map.get('longVisitToleranceMinutes') ?? ECM_PLATFORM_DEFAULTS.longVisitToleranceMinutes,
      excessiveOverrunMinutes:
        map.get('excessiveOverrunMinutes') ?? ECM_PLATFORM_DEFAULTS.excessiveOverrunMinutes,
      missedVisitThresholdMinutes:
        map.get('missedVisitThresholdMinutes') ?? ECM_PLATFORM_DEFAULTS.missedVisitThresholdMinutes,
      geofenceRadiusMeters:
        map.get('geofenceRadiusMeters') ?? ECM_PLATFORM_DEFAULTS.geofenceRadiusMeters,
      thresholdRuleVersion: `lookup-v1`,
    };
  }

  /** Thresholds shown on live-dashboard tile labels (and used for due/soon windows). */
  async getDashboardWindows(): Promise<EcmDashboardWindows> {
    const map = await this.valueMap();
    return {
      dueNowWindowMinutes: map.get('dueNowWindowMinutes') ?? 15,
      startingSoonMinutes: map.get('startingSoonMinutes') ?? 30,
      earlyArrivalToleranceMinutes:
        map.get('earlyArrivalToleranceMinutes') ??
        ECM_PLATFORM_DEFAULTS.earlyArrivalToleranceMinutes,
      lateArrivalToleranceMinutes:
        map.get('lateArrivalToleranceMinutes') ??
        ECM_PLATFORM_DEFAULTS.lateArrivalToleranceMinutes,
      veryLateThresholdMinutes:
        map.get('veryLateThresholdMinutes') ?? ECM_PLATFORM_DEFAULTS.veryLateThresholdMinutes,
      missedVisitThresholdMinutes:
        map.get('missedVisitThresholdMinutes') ??
        ECM_PLATFORM_DEFAULTS.missedVisitThresholdMinutes,
      geofenceRadiusMeters:
        map.get('geofenceRadiusMeters') ?? ECM_PLATFORM_DEFAULTS.geofenceRadiusMeters,
    };
  }

  private async valueMap(): Promise<Map<string, number>> {
    await this.ensureSeeded();
    const rows = await this.prisma.ecmThresholdLookup.findMany({
      where: { isActive: true },
      select: { code: true, valueInt: true },
    });
    return new Map(rows.map((r) => [r.code, r.valueInt]));
  }

  private async ensureSeeded() {
    const count = await this.prisma.ecmThresholdLookup.count();
    if (count >= ECM_THRESHOLD_LOOKUP_DEFAULTS.length) return;
    await seedEcmThresholdLookups(this.prisma);
  }
}
