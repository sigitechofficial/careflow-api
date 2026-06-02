import {
  MedicationAdministrationStatus,
  MedicationStatusCode,
} from '@prisma/client';
import { statusCodeToAdministrationStatus } from '../medication-charts/medication-chart-display.util';

export type StatusCodeResolution = {
  status: MedicationAdministrationStatus;
  statusCode: string;
  statusCodeId: string | null;
};

/** Resolve coarse enum + FK from a configured status code row or legacy fallback. */
export function resolveAdministrationFromStatusCode(
  code: string,
  row: Pick<MedicationStatusCode, 'id' | 'code' | 'administrationStatus'> | null,
): StatusCodeResolution {
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error('statusCode is required');
  }
  if (row) {
    return {
      status: row.administrationStatus,
      statusCode: row.code,
      statusCodeId: row.id,
    };
  }
  return {
    status: statusCodeToAdministrationStatus(trimmed),
    statusCode: trimmed,
    statusCodeId: null,
  };
}

/** Legacy path when only Prisma enum is supplied (no MAR code). */
export function resolveAdministrationFromEnumOnly(
  status: MedicationAdministrationStatus,
  defaultCode: string,
): StatusCodeResolution {
  return {
    status,
    statusCode: defaultCode,
    statusCodeId: null,
  };
}
