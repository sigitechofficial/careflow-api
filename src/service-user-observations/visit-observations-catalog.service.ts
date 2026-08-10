import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMPLOYEE_APP_UNABLE_REASONS,
  OBS_TYPE_CODE_ALIASES,
  VITAL_RANGE_TO_OBS_CODE,
  buildCatalogSections,
  buildObsBounds,
  buildObsFormForType,
  mobileTypeCode,
} from '../employee-app/employee-app-observations.catalog';
import {
  extractBodyMapPinsFromPayload,
  observationPayloadMatchesJob,
  type EmployeeAppBodyMapPin,
} from '../employee-app/employee-app-body-map-pins.util';

export type VisitObservationRecordedRow = {
  id: string;
  definitionId: string;
  type: string;
  title: string;
  typeCode: string;
  observationTypeCode: string;
  value: string | null;
  valueLabel: string | null;
  unit: string | null;
  recordedAt: string;
  time: string;
  timeLabel: string;
  status: string | null;
  statusLabel: string | null;
  statusTone: 'success';
  tone: 'success';
  /** Present when observation was saved with payload.bodyMapPins (skin / body map obs). */
  bodyMapPins?: EmployeeAppBodyMapPin[];
};

function formatHmUtc(d: Date) {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatVisitObservationValue(row: {
  numericValue: Prisma.Decimal | number | null;
  unit: string | null;
  payload: Prisma.JsonValue | null;
}): string | null {
  if (row.numericValue != null) {
    const unit = row.unit?.trim();
    const num = Number(row.numericValue);
    return unit ? `${num} ${unit}` : String(num);
  }
  if (row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)) {
    const p = row.payload as Record<string, unknown>;
    if (p.systolic != null && p.diastolic != null) {
      return `${p.systolic}/${p.diastolic}`;
    }
    if (typeof p.amountMl === 'number') return `${p.amountMl} ml`;
    if (typeof p.fluidInMl === 'number' || typeof p.fluidOutMl === 'number') {
      const parts = [
        p.fluidInMl != null ? `In ${p.fluidInMl} ml` : null,
        p.fluidOutMl != null ? `Out ${p.fluidOutMl} ml` : null,
      ].filter(Boolean);
      if (parts.length) return parts.join(' · ');
    }
    if (typeof p.position === 'string') return String(p.position);
    if (typeof p.value === 'string' || typeof p.value === 'number') return String(p.value);
  }
  return null;
}

export function inferVisitObservationStatus(
  code: string,
  numericValue: Prisma.Decimal | number | null,
  payload: Prisma.JsonValue | null,
): string | null {
  if (code === 'BLOOD_SUGAR' && numericValue != null) {
    const v = Number(numericValue);
    if (v >= 4 && v <= 15) return 'Normal';
    if (v < 4) return 'Low';
    return 'High';
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    if (typeof p.interpretation === 'string') return p.interpretation;
  }
  return null;
}

/**
 * Shared Obs catalog + recorded-this-visit payload used by carer details API
 * and admin visit workspace Observations tab.
 */
@Injectable()
export class VisitObservationsCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async buildCatalogPayload(serviceUserId: string) {
    const [types, vitalRanges, wellbeingDimensions, previousByType] = await Promise.all([
      this.prisma.observationType.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.vitalAcceptedRangeCatalog.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.wellbeingDimension.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: { levelLabels: { orderBy: { level: 'asc' } } },
      }),
      this.loadLatestObservationsByType(serviceUserId),
    ]);

    type VitalRangeEntry = {
      min: number | null;
      max: number | null;
      unit: string;
      diastolic?: { min: number; max: number; unit: string };
    };
    const rangeByObsCode = new Map<string, VitalRangeEntry>();
    for (const row of vitalRanges) {
      const obsCode = VITAL_RANGE_TO_OBS_CODE[row.fieldKey];
      if (!obsCode) continue;
      if (row.fieldKey === 'bpDiastolic') {
        const existing = rangeByObsCode.get(obsCode) ?? {
          min: null,
          max: null,
          unit: row.unit,
        };
        existing.diastolic = { min: row.min, max: row.max, unit: row.unit };
        rangeByObsCode.set(obsCode, existing);
        continue;
      }
      const existing = rangeByObsCode.get(obsCode);
      rangeByObsCode.set(obsCode, {
        min: row.min,
        max: row.max,
        unit: row.unit,
        diastolic: existing?.diastolic,
      });
    }

    const wellbeingForForm = wellbeingDimensions.map((d) => ({
      code: d.code,
      name: d.name,
      levels: d.levelLabels.map((l) => ({ level: l.level, label: l.label })),
    }));

    const definitionsByTypeCode: Record<string, Record<string, unknown>> = {};
    const optional: Array<Record<string, unknown>> = [];

    for (const type of types) {
      const code = type.code.toUpperCase();
      const typeCode = mobileTypeCode(code);
      const range = rangeByObsCode.get(code);
      const unit = range?.unit ?? type.unitLabel ?? null;
      const bounds = buildObsBounds({
        unit,
        minAccepted: range?.min ?? null,
        maxAccepted: range?.max ?? null,
        secondary:
          code === 'BLOOD_PRESSURE' && range?.diastolic
            ? {
                key: 'diastolic',
                label: 'Diastolic',
                unit: range.diastolic.unit,
                minAccepted: range.diastolic.min,
                maxAccepted: range.diastolic.max,
                ...(() => {
                  const b = buildObsBounds({
                    unit: range.diastolic.unit,
                    minAccepted: range.diastolic.min,
                    maxAccepted: range.diastolic.max,
                  });
                  return {
                    warningMin: b.warningMin,
                    warningMax: b.warningMax,
                    criticalMin: b.criticalMin,
                    criticalMax: b.criticalMax,
                    normalRangeLabel: b.normalRangeLabel,
                  };
                })(),
              }
            : null,
      });

      const form = buildObsFormForType({
        code,
        name: type.name,
        unitLabel: type.unitLabel,
        valueKind: type.valueKind,
        bounds,
        wellbeingDimensions: code === 'WELLBEING' ? wellbeingForForm : undefined,
      });

      const previous = previousByType.get(code);
      const definition = {
        id: typeCode,
        definitionId: typeCode,
        typeCode,
        observationTypeCode: code,
        observationTypeId: type.id,
        label: type.name,
        description: form.subtitle,
        category: type.usesNews2 ? 'vitals' : 'clinical',
        isRequired: false,
        unit: bounds.unit,
        inputType: form.fields[0]?.inputType ?? 'number',
        normalRangeLabel: bounds.normalRangeLabel,
        minAccepted: bounds.minAccepted,
        maxAccepted: bounds.maxAccepted,
        warningMin: bounds.warningMin,
        warningMax: bounds.warningMax,
        criticalMin: bounds.criticalMin,
        criticalMax: bounds.criticalMax,
        instructions: form.subtitle,
        previousValue: previous?.valueLabel ?? null,
        previousRecordedAt: previous?.recordedAt ?? null,
        allowsUnableToRecord: true,
        allowsMultipleReadings: true,
        requiresNotesWhenAbnormal: form.requiresNotesWhenAbnormal,
        requiresNotesWhenCritical: form.requiresNotesWhenCritical,
        isOutstanding: false,
        isDue: false,
        isOverdue: false,
        done: false,
        bounds,
        form,
        valueKind: type.valueKind,
        usesNews2: type.usesNews2,
      };

      definitionsByTypeCode[typeCode] = definition;
      definitionsByTypeCode[code.toLowerCase()] = definition;
      if (OBS_TYPE_CODE_ALIASES[code]) {
        definitionsByTypeCode[OBS_TYPE_CODE_ALIASES[code]] = definition;
      }

      optional.push({
        id: typeCode,
        typeCode,
        observationTypeCode: code,
        label: type.name,
        description: form.subtitle,
        category: definition.category,
        isRequired: false,
        unit: bounds.unit,
        normalRangeLabel: bounds.normalRangeLabel,
        minAccepted: bounds.minAccepted,
        maxAccepted: bounds.maxAccepted,
        warningMin: bounds.warningMin,
        warningMax: bounds.warningMax,
        criticalMin: bounds.criticalMin,
        criticalMax: bounds.criticalMax,
        allowsUnableToRecord: true,
        allowsMultipleReadings: true,
        done: false,
      });
    }

    const suggestedCodes = [
      'BLOOD_SUGAR',
      'FLUID_MONITOR',
      'REPOSITIONING',
      'WELLBEING',
      'INFECTION',
      'BLOOD_PRESSURE',
      'PULSE',
      'OXYGEN_SATURATION',
      'TEMPERATURE',
    ];
    const suggested = suggestedCodes
      .map((code) => types.find((t) => t.code.toUpperCase() === code))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => ({
        id: mobileTypeCode(t.code),
        typeCode: mobileTypeCode(t.code),
        label: t.name,
        observationTypeCode: t.code,
      }));

    const catalogSections = buildCatalogSections(
      types.map((t) => ({
        code: t.code,
        name: t.name,
        unitLabel: t.unitLabel,
      })),
    );

    return {
      unableReasons: EMPLOYEE_APP_UNABLE_REASONS,
      catalog: {
        title: 'Record observation',
        anotherTitle: 'Record another observation',
        searchPlaceholder: 'Search observations',
        sections: catalogSections,
      },
      definitionsByTypeCode,
      required: [] as typeof optional,
      optional,
      suggested,
      emergencyProtocol: {
        id: 'medical_emergency',
        title: 'Medical emergency — launch protocol',
        description: 'Collapse, choking or acute deterioration.',
        tone: 'danger' as const,
      },
    };
  }

  async loadVisitObservations(
    serviceUserId: string,
    since: Date,
    scheduledJobId?: string,
  ): Promise<VisitObservationRecordedRow[]> {
    const rows = await this.prisma.serviceUserObservation.findMany({
      where: {
        serviceUserId,
        deletedAt: null,
        recordedAt: { gte: since },
      },
      orderBy: { recordedAt: 'desc' },
      include: { observationType: true },
      take: 20,
    });

    return rows
      .filter(
        (row) =>
          !scheduledJobId || observationPayloadMatchesJob(row.payload, scheduledJobId),
      )
      .map((row) => {
      const typeCode = mobileTypeCode(row.observationType.code);
      const valueLabel = formatVisitObservationValue(row);
      const status = inferVisitObservationStatus(
        row.observationType.code,
        row.numericValue,
        row.payload,
      );
      const bodyMapPins = extractBodyMapPinsFromPayload(row.payload) ?? undefined;
      return {
        id: row.id,
        definitionId: typeCode,
        type: row.observationType.name,
        title: row.observationType.name,
        typeCode,
        observationTypeCode: row.observationType.code,
        value: valueLabel,
        valueLabel,
        unit: row.unit ?? row.observationType.unitLabel ?? null,
        recordedAt: row.recordedAt.toISOString(),
        time: formatHmUtc(row.recordedAt),
        timeLabel: formatHmUtc(row.recordedAt),
        status,
        statusLabel: status,
        statusTone: 'success' as const,
        tone: 'success' as const,
        ...(bodyMapPins ? { bodyMapPins } : {}),
      };
    });
  }

  async buildVisitObservationsPayload(input: {
    serviceUserId: string;
    since: Date;
    scheduledJobId?: string;
  }) {
    const [catalog, recorded] = await Promise.all([
      this.buildCatalogPayload(input.serviceUserId),
      this.loadVisitObservations(input.serviceUserId, input.since, input.scheduledJobId),
    ]);
    return {
      ...catalog,
      recordedThisVisit: recorded,
      recordedCount: recorded.length,
    };
  }

  private async loadLatestObservationsByType(serviceUserId: string) {
    const rows = await this.prisma.serviceUserObservation.findMany({
      where: { serviceUserId, deletedAt: null },
      orderBy: { recordedAt: 'desc' },
      include: { observationType: true },
      take: 80,
    });
    const map = new Map<string, { valueLabel: string | null; recordedAt: string }>();
    for (const row of rows) {
      const code = row.observationType.code.toUpperCase();
      if (map.has(code)) continue;
      map.set(code, {
        valueLabel: formatVisitObservationValue(row),
        recordedAt: row.recordedAt.toISOString(),
      });
    }
    return map;
  }
}
