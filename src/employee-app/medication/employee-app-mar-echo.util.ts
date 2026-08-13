import { formatHmUtc } from '../../common/utils/operational-day.util';
import { MedicationAdministrationStatus } from '@prisma/client';

export type MarAdminEventEchoSource = {
  id: string;
  status: MedicationAdministrationStatus | string;
  statusCode?: string | null;
  reason?: string | null;
  notes?: string | null;
  supportLevel?: string | null;
  timeGiven?: string | null;
  outcomeLabel?: string | null;
  actualDateTime?: Date | string | null;
  prnReason?: string | null;
  prnOutcome?: string | null;
  isPrn?: boolean;
};

export type MarAdminEchoFields = {
  administrationEventId: string;
  done: true;
  isRecorded: true;
  resolved: true;
  outcomeCode: string;
  outcomeLabel: string | null;
  supportLevel: string | null;
  notes: string | null;
  reasonCode: string | null;
  timeGiven: string | null;
  administeredAt: string | null;
  deviceRecordedAt: string | null;
  prnIndication: string | null;
  prnEffectiveness: string | null;
  savedAtLabel: string | null;
};

const OUTCOME_LABELS: Record<string, string> = {
  G: 'Given',
  F: 'Given (family)',
  I: 'Given (self)',
  S: 'Given (self)',
  T: 'Given',
  R: 'Refused',
  N: 'Not given',
  C: 'Cancelled',
  H: 'Held',
  PCI: 'Held (PCI)',
  GIVEN: 'Given',
  REFUSED: 'Refused',
  NOT_GIVEN: 'Not given',
  CANCELLED: 'Cancelled',
  HELD: 'Held',
};

/** Prefer UI letter codes (G/R/…) when stored; fall back from Prisma status enum. */
export function echoMarOutcomeCode(
  statusCode: string | null | undefined,
  status: MedicationAdministrationStatus | string,
): string {
  const code = statusCode?.trim();
  if (code) return code;
  switch (status) {
    case MedicationAdministrationStatus.GIVEN:
    case 'GIVEN':
      return 'G';
    case MedicationAdministrationStatus.REFUSED:
    case 'REFUSED':
      return 'R';
    case MedicationAdministrationStatus.CANCELLED:
    case 'CANCELLED':
      return 'C';
    case MedicationAdministrationStatus.HELD:
    case 'HELD':
      return 'H';
    case MedicationAdministrationStatus.NOT_GIVEN:
    case 'NOT_GIVEN':
      return 'N';
    default:
      return String(status);
  }
}

export function echoMarOutcomeLabel(
  outcomeLabel: string | null | undefined,
  outcomeCode: string,
): string | null {
  const trimmed = outcomeLabel?.trim();
  if (trimmed) return trimmed;
  return OUTCOME_LABELS[outcomeCode.toUpperCase()] ?? OUTCOME_LABELS[outcomeCode] ?? null;
}

function formatHmFromDate(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return formatHmUtc(d);
}

function isoFromDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Legacy writes mashed `outcomeLabel · Support: X · notes` into `notes`.
 * Parse when dedicated columns are empty so completed visits still prefill.
 */
export function parseLegacyMarNotes(notes: string | null | undefined): {
  outcomeLabel: string | null;
  supportLevel: string | null;
  notes: string | null;
} {
  if (!notes?.trim()) {
    return { outcomeLabel: null, supportLevel: null, notes: null };
  }
  const parts = notes.split(' · ').map((p) => p.trim()).filter(Boolean);
  let outcomeLabel: string | null = null;
  let supportLevel: string | null = null;
  const rest: string[] = [];

  for (const part of parts) {
    const supportMatch = /^Support:\s*(.+)$/i.exec(part);
    if (supportMatch) {
      supportLevel = supportMatch[1]?.trim() || null;
      continue;
    }
    const upper = part.toUpperCase();
    if (
      !outcomeLabel &&
      (OUTCOME_LABELS[upper] ||
        Object.values(OUTCOME_LABELS).some((l) => l.toLowerCase() === part.toLowerCase()))
    ) {
      outcomeLabel = part;
      continue;
    }
    rest.push(part);
  }

  return {
    outcomeLabel,
    supportLevel,
    notes: rest.length > 0 ? rest.join(' · ') : null,
  };
}

export function buildMarAdminEchoFields(
  evt: MarAdminEventEchoSource,
  _timeZone?: string,
): MarAdminEchoFields {
  const legacy = parseLegacyMarNotes(evt.notes);
  const outcomeCode = echoMarOutcomeCode(evt.statusCode, evt.status);
  const supportLevel = evt.supportLevel?.trim() || legacy.supportLevel;
  const outcomeLabel = echoMarOutcomeLabel(
    evt.outcomeLabel?.trim() || legacy.outcomeLabel,
    outcomeCode,
  );
  /** Prefer dedicated notes column when supportLevel/outcomeLabel columns are set. */
  const hasStructured =
    Boolean(evt.supportLevel?.trim()) ||
    Boolean(evt.outcomeLabel?.trim()) ||
    Boolean(evt.timeGiven?.trim());
  const notes = hasStructured
    ? evt.notes?.trim() || null
    : (legacy.notes ?? evt.notes?.trim() ?? null);
  const administeredAt = isoFromDate(evt.actualDateTime);
  const timeGiven =
    evt.timeGiven?.trim() ||
    formatHmFromDate(evt.actualDateTime);

  return {
    administrationEventId: evt.id,
    done: true,
    isRecorded: true,
    resolved: true,
    outcomeCode,
    outcomeLabel,
    supportLevel,
    notes,
    reasonCode: evt.reason?.trim() || null,
    timeGiven,
    administeredAt,
    deviceRecordedAt: administeredAt,
    prnIndication: evt.isPrn ? evt.prnReason?.trim() || null : evt.prnReason?.trim() || null,
    prnEffectiveness: evt.isPrn ? evt.prnOutcome?.trim() || null : evt.prnOutcome?.trim() || null,
    savedAtLabel: timeGiven ? `Saved ${timeGiven}` : null,
  };
}

export function emptyMarAdminEchoFields(): {
  administrationEventId: null;
  done: false;
  isRecorded: false;
  resolved: false;
  outcomeCode: null;
  outcomeLabel: null;
  supportLevel: null;
  notes: null;
  reasonCode: null;
  timeGiven: null;
  administeredAt: null;
  deviceRecordedAt: null;
  prnIndication: null;
  prnEffectiveness: null;
  savedAtLabel: null;
} {
  return {
    administrationEventId: null,
    done: false,
    isRecorded: false,
    resolved: false,
    outcomeCode: null,
    outcomeLabel: null,
    supportLevel: null,
    notes: null,
    reasonCode: null,
    timeGiven: null,
    administeredAt: null,
    deviceRecordedAt: null,
    prnIndication: null,
    prnEffectiveness: null,
    savedAtLabel: null,
  };
}
