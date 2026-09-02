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

export type MedicationWitnessDtoFields = {
  witnessPresent?: boolean | null;
  witnessName?: string | null;
  witnessRelationCode?: string | null;
  witnessRelationDetail?: string | null;
  witnessNotes?: string | null;
};

export type MedicationWitnessColumns = {
  witnessPresent: boolean | null;
  witnessName: string | null;
  witnessRelationCode: string | null;
  witnessRelationDetail: string | null;
  witnessNotes: string | null;
};

export type MedicationWitnessEcho = {
  present: boolean;
  name: string | null;
  relationCode: string | null;
  relationLabel: string | null;
  relationDetail: string | null;
  notes: string | null;
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

const EMPTY_WITNESS: MedicationWitnessColumns = {
  witnessPresent: null,
  witnessName: null,
  witnessRelationCode: null,
  witnessRelationDetail: null,
  witnessNotes: null,
};

/** Persist columns from a carer/office write. Non-CD always clears. */
export function resolveMedicationWitnessColumns(
  isControlled: boolean,
  dto: MedicationWitnessDtoFields,
): MedicationWitnessColumns {
  if (!isControlled) return EMPTY_WITNESS;

  if (dto.witnessPresent !== true) {
    return {
      ...EMPTY_WITNESS,
      witnessPresent: dto.witnessPresent === false ? false : null,
    };
  }

  const name = trimOrNull(dto.witnessName);
  const relationCode = normalizeWitnessRelationCode(dto.witnessRelationCode);
  const relationDetail = trimOrNull(dto.witnessRelationDetail);
  const notes = trimOrNull(dto.witnessNotes);

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
  };
}

export function buildMedicationWitnessEcho(
  cols: Partial<MedicationWitnessColumns> | null | undefined,
): MedicationWitnessEcho | null {
  if (cols == null || cols.witnessPresent == null) return null;
  const code = normalizeWitnessRelationCode(cols.witnessRelationCode);
  return {
    present: cols.witnessPresent === true,
    name: trimOrNull(cols.witnessName),
    relationCode: code,
    relationLabel: code ? MEDICATION_WITNESS_RELATION_LABELS[code] : null,
    relationDetail: trimOrNull(cols.witnessRelationDetail),
    notes: trimOrNull(cols.witnessNotes),
  };
}

export function medicationWitnessTimelineDetail(
  echo: MedicationWitnessEcho | null,
): string | null {
  if (!echo) return null;
  if (!echo.present) return 'No witness';
  const relation = [echo.relationLabel, echo.relationDetail].filter(Boolean).join(' — ');
  const name = echo.name?.trim();
  if (!name) return 'Witness recorded';
  return relation ? `Witness: ${name} (${relation})` : `Witness: ${name}`;
}
