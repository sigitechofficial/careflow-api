import { formatHm } from '../../medication-charts/medication-chart-rounds.util';

export type VisitMedicationRound = {
  code: string;
  name: string;
  dueTime: string;
};

export function resolveVisitMedicationRoundFromDb(
  round: { code: string; name: string; time: string } | null,
): VisitMedicationRound | null {
  if (!round) return null;
  return {
    code: round.code,
    name: round.name,
    dueTime: formatHm(round.time) ?? round.time,
  };
}

export function normalizePackDueTime(value: string | null | undefined): string {
  return formatHm(value) ?? (value?.trim() ?? '');
}

export function medMatchesCompartmentDueTime(
  schedules: Array<{ dueTime: string | null }> | undefined,
  compartmentDueTime: string,
): boolean {
  const target = normalizePackDueTime(compartmentDueTime);
  return (schedules ?? []).some((s) => normalizePackDueTime(s.dueTime) === target);
}

function labelMatchesRound(label: string, round: VisitMedicationRound): boolean {
  const normalized = label.trim().toLowerCase();
  return (
    normalized === round.name.toLowerCase() ||
    normalized === round.code.toLowerCase() ||
    normalized.includes(round.name.toLowerCase())
  );
}

export function compartmentMatchesVisitRound(
  compartment: { label: string; dueTime: string },
  round: VisitMedicationRound,
): boolean {
  const compTime = normalizePackDueTime(compartment.dueTime);
  const roundTime = normalizePackDueTime(round.dueTime);
  if (roundTime && compTime && compTime === roundTime) return true;
  return labelMatchesRound(compartment.label, round);
}

export function filterCompartmentsForVisitRound<T extends { label: string; dueTime: string }>(
  compartments: T[],
  round: VisitMedicationRound | null,
): T[] {
  if (!round) return compartments;
  return compartments.filter((c) => compartmentMatchesVisitRound(c, round));
}

/** Chart "How assisted" for the carer. Hide empty / N/A. */
export function plannedHowAssistedLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'not applicable') return null;
  return trimmed;
}
