import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatHmUtc } from '../common/utils/operational-day.util';
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
import { formatSleepObservationValue } from './observation-sleep.catalog';
import { formatAlignedCareValue } from './observation-align.catalog';
import { formatClinicalObservationValue } from './observation-clinical.catalog';

export type VisitObservationRecordedRow = {
  id: string;
  definitionId: string;
  type: string;
  title: string;
  label: string;
  typeCode: string;
  observationTypeCode: string;
  outcomeCode: 'recorded' | 'unable';
  value: string | number | null;
  secondaryValue: string | number | null;
  valueLabel: string | null;
  currentValue: string | number | null;
  unit: string | null;
  notes: string | null;
  unableReasonCode: string | null;
  unableReasonLabel: string | null;
  abnormal: boolean;
  critical: boolean;
  recordedAt: string;
  deviceRecordedAt: string | null;
  time: string;
  timeLabel: string;
  status: string | null;
  statusLabel: string | null;
  statusTone: 'success' | 'warning' | 'danger' | 'neutral';
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  /** Present when observation was saved with payload.bodyMapPins (skin / body map obs). */
  bodyMapPins?: EmployeeAppBodyMapPin[];
};

function readPayload(payload: Prisma.JsonValue | null): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

function unableReasonLabel(code: string | null): string | null {
  if (!code) return null;
  return EMPLOYEE_APP_UNABLE_REASONS.find((r) => r.code === code)?.label ?? code;
}

function rawValueFromRow(row: {
  numericValue: Prisma.Decimal | number | null;
  payload: Prisma.JsonValue | null;
}): string | number | null {
  const p = readPayload(row.payload);
  if (p.value != null && (typeof p.value === 'string' || typeof p.value === 'number')) {
    return p.value;
  }
  if (row.numericValue != null) return Number(row.numericValue);
  return null;
}

function secondaryValueFromPayload(payload: Prisma.JsonValue | null): string | number | null {
  const p = readPayload(payload);
  if (p.secondaryValue != null && (typeof p.secondaryValue === 'string' || typeof p.secondaryValue === 'number')) {
    return p.secondaryValue;
  }
  if (p.diastolic != null && (typeof p.diastolic === 'string' || typeof p.diastolic === 'number')) {
    return p.diastolic;
  }
  return null;
}

function asQualifierText(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const parts = v.map((x) => String(x).trim()).filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  const s = String(v).trim();
  return s || null;
}

/** Reading + qualifier fields for vitals / single-value-with-qualifier types. */
function formatVitalsQualifierValue(
  typeCode: string,
  p: Record<string, unknown>,
): string | null {
  const reading = asQualifierText(p.reading);
  const join = (base: string | null, quals: Array<string | null>): string | null => {
    if (!base) return null;
    const q = quals.filter((x): x is string => Boolean(x));
    return q.length ? `${base} · ${q.join(' · ')}` : base;
  };
  switch (typeCode) {
    case 'RESPIRATORY_RATE':
    case 'RESPIRATION': {
      const base = reading ? `${reading} breaths/min` : null;
      const spo2 = asQualifierText(p.spo2);
      const lpm = asQualifierText(p.oxygen_lpm);
      return join(base, [
        asQualifierText(p.breathless),
        spo2 ? `SpO2 ${spo2}%` : null,
        asQualifierText(p.oxygen),
        lpm ? `${lpm} L/min` : null,
      ]);
    }
    case 'OXYGEN_SATURATION':
      return join(reading ? `${reading}%` : null, [asQualifierText(p.context)]);
    case 'BLOOD_GLUCOSE':
    case 'BLOOD_SUGAR':
      return join(reading ? `${reading} mmol/L` : null, [asQualifierText(p.timing)]);
    case 'SOFT_SIGNS': {
      const signs = asQualifierText(p.signs);
      return signs ? `Signs: ${signs}` : null;
    }
    case 'URINE_OUTPUT':
      return join(reading ? `${reading} ml` : null, [
        asQualifierText(p.route),
        asQualifierText(p.appearance),
      ]);
    case 'WEIGHT':
      return join(reading ? `${reading} kg` : null, [asQualifierText(p.method)]);
    case 'PAIN_SCORE':
    case 'PAIN': {
      const score = asQualifierText(p.score);
      return join(score ? `${score}/10` : null, [asQualifierText(p.pattern)]);
    }
    case 'ORAL_MOUTH_CARE':
      return join(asQualifierText(p.status), [asQualifierText(p.actions)]);
    default:
      return null;
  }
}

export function formatVisitObservationValue(row: {
  numericValue: Prisma.Decimal | number | null;
  unit: string | null;
  payload: Prisma.JsonValue | null;
  observationType?: { code: string };
}): string | null {
  if (row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)) {
    const p = row.payload as Record<string, unknown>;
    const sleep = formatSleepObservationValue(p);
    if (sleep) return sleep;
    const typeCode = row.observationType?.code;
    if (typeCode) {
      // Blood pressure: prefer structured systolic/diastolic (+ pulse) over the
      // numericValue (which only holds systolic), so the full reading is shown.
      if (typeCode === 'BLOOD_PRESSURE' && p.systolic != null && p.diastolic != null) {
        const bpUnit = row.unit?.trim() || 'mmHg';
        const base = `${p.systolic}/${p.diastolic} ${bpUnit}`;
        return p.pulse != null ? `${base} · Pulse ${p.pulse}` : base;
      }
      // Vitals / qualifier forms: reading + its qualifier fields (context,
      // timing, route, method, pattern, etc.) so the admin sees the full record.
      const vitals = formatVitalsQualifierValue(typeCode, p);
      if (vitals) return vitals;
      const aligned = formatAlignedCareValue(typeCode, p);
      if (aligned) return aligned;
      const numeric =
        row.numericValue != null ? Number(row.numericValue) : null;
      const clinical = formatClinicalObservationValue(typeCode, p, numeric);
      if (clinical) return clinical;
    }
  }
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
  const p = readPayload(payload);
  if (p.outcome === 'unable') return 'Unable to record';
  if (Boolean(p.critical)) return 'Critical';
  if (Boolean(p.abnormal)) return 'Abnormal';
  if (code === 'BLOOD_SUGAR' && numericValue != null) {
    const v = Number(numericValue);
    if (v >= 4 && v <= 15) return 'Normal';
    if (v < 4) return 'Low';
    return 'High';
  }
  if (typeof p.interpretation === 'string') return p.interpretation;
  return null;
}

function statusToneFor(status: string | null, payload: Record<string, unknown>): VisitObservationRecordedRow['statusTone'] {
  if (Boolean(payload.critical) || status === 'Critical') return 'danger';
  if (Boolean(payload.abnormal) || status === 'Abnormal' || status === 'Unable to record') return 'warning';
  if (status) return 'success';
  return 'neutral';
}

function mapObservationRow(row: {
  id: string;
  notes: string | null;
  unit: string | null;
  recordedAt: Date;
  numericValue: Prisma.Decimal | number | null;
  payload: Prisma.JsonValue | null;
  observationType: { code: string; name: string; unitLabel: string | null };
}): VisitObservationRecordedRow {
  const typeCode = mobileTypeCode(row.observationType.code);
  const payload = readPayload(row.payload);
  const outcomeRaw = typeof payload.outcome === 'string' ? payload.outcome : 'recorded';
  const outcomeCode: 'recorded' | 'unable' = outcomeRaw === 'unable' ? 'unable' : 'recorded';
  const valueLabel = formatVisitObservationValue(row);
  const currentValue = rawValueFromRow(row);
  const secondaryValue = secondaryValueFromPayload(row.payload);
  const unableReasonCode =
    typeof payload.unableReasonCode === 'string' ? payload.unableReasonCode : null;
  const status = inferVisitObservationStatus(
    row.observationType.code,
    row.numericValue,
    row.payload,
  );
  const tone = statusToneFor(status, payload);
  const deviceRecordedAt =
    typeof payload.deviceRecordedAt === 'string'
      ? payload.deviceRecordedAt
      : row.recordedAt.toISOString();
  const recordedAtDate = new Date(deviceRecordedAt);
  const clock = Number.isNaN(recordedAtDate.getTime())
    ? formatHmUtc(row.recordedAt)
    : formatHmUtc(recordedAtDate);
  const bodyMapPins = extractBodyMapPinsFromPayload(row.payload) ?? undefined;
  const definitionId =
    (typeof payload.definitionId === 'string' && payload.definitionId.trim()) || typeCode;

  // Legacy: notes may have been mashed with "Unable: code"
  let notes = row.notes?.trim() || null;
  let legacyUnable: string | null = null;
  if (!unableReasonCode && notes) {
    const m = /^Unable:\s*(.+?)(?:\s*·\s*(.*))?$/i.exec(notes);
    if (m) {
      legacyUnable = m[1]?.trim() || null;
      notes = m[2]?.trim() || null;
    }
  }

  const resolvedUnable = unableReasonCode ?? legacyUnable;

  return {
    id: row.id,
    definitionId,
    type: row.observationType.name,
    title: row.observationType.name,
    label: row.observationType.name,
    typeCode,
    observationTypeCode: row.observationType.code,
    outcomeCode,
    value: currentValue,
    secondaryValue,
    valueLabel,
    currentValue,
    unit: row.unit ?? row.observationType.unitLabel ?? null,
    notes,
    unableReasonCode: resolvedUnable,
    unableReasonLabel: unableReasonLabel(resolvedUnable),
    abnormal: Boolean(payload.abnormal),
    critical: Boolean(payload.critical),
    recordedAt: row.recordedAt.toISOString(),
    deviceRecordedAt,
    time: clock,
    timeLabel: clock,
    status,
    statusLabel: status,
    statusTone: tone,
    tone,
    ...(bodyMapPins ? { bodyMapPins } : {}),
  };
}

function mergeRecordingIntoDefinition(
  definition: Record<string, unknown>,
  recording: VisitObservationRecordedRow,
): Record<string, unknown> {
  return {
    ...definition,
    done: true,
    outcomeCode: recording.outcomeCode,
    currentValue: recording.currentValue,
    value: recording.currentValue,
    secondaryValue: recording.secondaryValue,
    unit: recording.unit ?? definition.unit ?? null,
    notes: recording.notes,
    unableReasonCode: recording.unableReasonCode,
    unableReasonLabel: recording.unableReasonLabel,
    status: recording.status,
    statusLabel: recording.statusLabel,
    statusTone: recording.statusTone,
    timeLabel: recording.timeLabel,
    recordedAt: recording.recordedAt,
    deviceRecordedAt: recording.deviceRecordedAt,
    abnormal: recording.abnormal,
    critical: recording.critical,
    observationId: recording.id,
  };
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
        outcomeCode: null as string | null,
        currentValue: null as string | number | null,
        secondaryValue: null as string | number | null,
        notes: null as string | null,
        unableReasonCode: null as string | null,
        unableReasonLabel: null as string | null,
        timeLabel: null as string | null,
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
        outcomeCode: null,
        currentValue: null,
        secondaryValue: null,
        notes: null,
        unableReasonCode: null,
        unableReasonLabel: null,
        timeLabel: null,
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
      .map((row) => mapObservationRow(row));
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

    // Latest reading per typeCode wins for list prefill.
    const latestByType = new Map<string, VisitObservationRecordedRow>();
    for (const row of recorded) {
      if (!latestByType.has(row.typeCode)) latestByType.set(row.typeCode, row);
      if (!latestByType.has(row.definitionId)) latestByType.set(row.definitionId, row);
    }

    const mergeList = (items: Array<Record<string, unknown>>) =>
      items.map((item) => {
        const typeCode = String(item.typeCode ?? item.id ?? '');
        const recording = latestByType.get(typeCode);
        return recording ? mergeRecordingIntoDefinition(item, recording) : item;
      });

    const definitionsByTypeCode = { ...catalog.definitionsByTypeCode };
    for (const [key, definition] of Object.entries(definitionsByTypeCode)) {
      const typeCode = String(definition.typeCode ?? key);
      const recording = latestByType.get(typeCode) ?? latestByType.get(key);
      if (recording) {
        definitionsByTypeCode[key] = mergeRecordingIntoDefinition(definition, recording);
      }
    }

    return {
      ...catalog,
      definitionsByTypeCode,
      required: mergeList(catalog.required),
      optional: mergeList(catalog.optional),
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
