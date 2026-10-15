import { BadRequestException } from '@nestjs/common';

export const MEDICATION_WITNESS_RELATIONS = ['CO_CARER', 'RELATIVE', 'OTHER'] as const;
export type MedicationWitnessRelationCode = (typeof MEDICATION_WITNESS_RELATIONS)[number];

export const MEDICATION_WITNESS_RELATION_LABELS: Record<
  MedicationWitnessRelationCode,
  string
> = {
  CO_CARER: 'Co-carer',
  RELATIVE: 'Relative',
  OTHER: 'Other',
};

/** Why a controlled drug was given with no witness present. */
export const MEDICATION_WITNESS_ABSENT_REASONS = [
  'SINGLE_CARER_VISIT',
  'NO_ONE_ELSE_PRESENT',
  'OTHER',
] as const;

export type MedicationWitnessAbsentReasonCode =
  (typeof MEDICATION_WITNESS_ABSENT_REASONS)[number];

export const MEDICATION_WITNESS_ABSENT_REASON_LABELS: Record<
  MedicationWitnessAbsentReasonCode,
  string
> = {
  SINGLE_CARER_VISIT: 'Single-carer visit',
  NO_ONE_ELSE_PRESENT: 'No one else present',
  OTHER: 'Other',
};

export type MedicationWitnessDtoFields = {
  witnessPresent?: boolean | null;
  witnessName?: string | null;
  witnessRelationCode?: string | null;
  witnessRelationDetail?: string | null;
  witnessNotes?: string | null;
  witnessEmployeeId?: string | null;
  witnessAbsentReasonCode?: string | null;
};

export type MedicationWitnessColumns = {
  witnessPresent: boolean | null;
  witnessName: string | null;
  witnessRelationCode: string | null;
  witnessRelationDetail: string | null;
  witnessNotes: string | null;
  witnessEmployeeId: string | null;
  witnessAbsentReasonCode: string | null;
};

export type MedicationWitnessEcho = {
  present: boolean;
  name: string | null;
  relationCode: string | null;
  relationLabel: string | null;
  relationDetail: string | null;
  notes: string | null;
  /** Staff record of a co-carer witness; null for a relative or other person. */
  employeeId: string | null;
  absentReasonCode: string | null;
  absentReasonLabel: string | null;
};

/** Another carer allocated to the same visit, who may witness a controlled drug. */
export type MedicationWitnessCoCarer = { employeeId: string; name: string };

/**
 * Carer-app rules for a controlled drug. A dose that is given must say whether a
 * witness was present: a co-carer witness is picked from the visit's other carers,
 * and "no witness" needs a reason.
 */
export type MedicationWitnessVisitRules = {
  given: boolean;
  coCarers: MedicationWitnessCoCarer[];
};

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeWitnessRelationCode(
  raw: string | null | undefined,
): MedicationWitnessRelationCode | null {
  const upper = raw?.trim().toUpperCase();
  if (!upper) return null;
  return (MEDICATION_WITNESS_RELATIONS as readonly string[]).includes(upper)
    ? (upper as MedicationWitnessRelationCode)
    : null;
}

export function normalizeWitnessAbsentReasonCode(
  raw: string | null | undefined,
): MedicationWitnessAbsentReasonCode | null {
  const upper = raw?.trim().toUpperCase();
  if (!upper) return null;
  return (MEDICATION_WITNESS_ABSENT_REASONS as readonly string[]).includes(upper)
    ? (upper as MedicationWitnessAbsentReasonCode)
    : null;
}

const EMPTY_WITNESS: MedicationWitnessColumns = {
  witnessPresent: null,
  witnessName: null,
  witnessRelationCode: null,
  witnessRelationDetail: null,
  witnessNotes: null,
  witnessEmployeeId: null,
  witnessAbsentReasonCode: null,
};

/**
 * Persist columns from a carer/office write. Non-CD always clears.
 * Pass `visitRules` for a carer-app write; an office record has no visit to check.
 */
export function resolveMedicationWitnessColumns(
  isControlled: boolean,
  dto: MedicationWitnessDtoFields,
  visitRules?: MedicationWitnessVisitRules,
): MedicationWitnessColumns {
  if (!isControlled) return EMPTY_WITNESS;

  const mustAnswer = visitRules?.given === true;
  if (mustAnswer && typeof dto.witnessPresent !== 'boolean') {
    throw new BadRequestException(
      'witnessPresent is required when a controlled drug is given',
    );
  }

  if (dto.witnessPresent !== true) {
    const absentReason = normalizeWitnessAbsentReasonCode(dto.witnessAbsentReasonCode);
    const absentNotes = trimOrNull(dto.witnessNotes);
    if (mustAnswer && !absentReason) {
      throw new BadRequestException(
        'witnessAbsentReasonCode is required when no witness is present',
      );
    }
    if (mustAnswer && absentReason === 'OTHER' && !absentNotes) {
      throw new BadRequestException('witnessNotes is required when the reason is Other');
    }
    const absent = dto.witnessPresent === false;
    return {
      ...EMPTY_WITNESS,
      witnessPresent: absent ? false : null,
      witnessAbsentReasonCode: absent ? absentReason : null,
      witnessNotes: absent && absentReason ? absentNotes : null,
    };
  }

  const relationCode = normalizeWitnessRelationCode(dto.witnessRelationCode);
  const relationDetail = trimOrNull(dto.witnessRelationDetail);
  const notes = trimOrNull(dto.witnessNotes);

  // A co-carer witness is a real carer on this visit, not a typed name.
  let coCarer: MedicationWitnessCoCarer | null = null;
  if (visitRules && relationCode === 'CO_CARER') {
    const witnessEmployeeId = dto.witnessEmployeeId?.trim();
    coCarer = visitRules.coCarers.find((c) => c.employeeId === witnessEmployeeId) ?? null;
    if (!coCarer) {
      throw new BadRequestException(
        visitRules.coCarers.length
          ? 'Choose the co-carer witness from the carers on this visit'
          : 'No other carer is on this visit — choose Relative or Other for the witness',
      );
    }
  }

  const name = coCarer?.name ?? trimOrNull(dto.witnessName);
  if (!name) {
    throw new BadRequestException('witnessName is required when a witness is present');
  }
  if (!relationCode) {
    throw new BadRequestException(
      'witnessRelationCode must be CO_CARER, RELATIVE, or OTHER',
    );
  }
  if (relationCode === 'RELATIVE' && !relationDetail) {
    throw new BadRequestException(
      'witnessRelationDetail is required for a relative witness',
    );
  }

  return {
    witnessPresent: true,
    witnessName: name,
    witnessRelationCode: relationCode,
    witnessRelationDetail: relationDetail,
    witnessNotes: notes,
    witnessEmployeeId: coCarer?.employeeId ?? null,
    witnessAbsentReasonCode: null,
  };
}

export function buildMedicationWitnessEcho(
  cols: Partial<MedicationWitnessColumns> | null | undefined,
): MedicationWitnessEcho | null {
  if (cols == null || cols.witnessPresent == null) return null;
  const code = normalizeWitnessRelationCode(cols.witnessRelationCode);
  const absentReason = normalizeWitnessAbsentReasonCode(cols.witnessAbsentReasonCode);
  return {
    present: cols.witnessPresent === true,
    name: trimOrNull(cols.witnessName),
    relationCode: code,
    relationLabel: code ? MEDICATION_WITNESS_RELATION_LABELS[code] : null,
    relationDetail: trimOrNull(cols.witnessRelationDetail),
    notes: trimOrNull(cols.witnessNotes),
    employeeId: cols.witnessEmployeeId ?? null,
    absentReasonCode: absentReason,
    absentReasonLabel: absentReason
      ? MEDICATION_WITNESS_ABSENT_REASON_LABELS[absentReason]
      : null,
  };
}

export function medicationWitnessTimelineDetail(
  echo: MedicationWitnessEcho | null,
): string | null {
  if (!echo) return null;
  if (!echo.present) {
    return echo.absentReasonLabel ? `No witness — ${echo.absentReasonLabel}` : 'No witness';
  }
  const relation = [echo.relationLabel, echo.relationDetail].filter(Boolean).join(' — ');
  const name = echo.name?.trim();
  if (!name) return 'Witness recorded';
  return relation ? `Witness: ${name} (${relation})` : `Witness: ${name}`;
}
