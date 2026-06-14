import type { MedicationPackComposeSummary } from './compose-context.types';

type PackRow = {
  id: string;
  name: string;
  packType: string | null;
  cycleNumber: number | null;
  pharmacyName: string | null;
  pharmacyPhone: string | null;
  gpName: string | null;
  gpSurgery: string | null;
};

function joinParts(parts: Array<string | null | undefined>, sep = ' · '): string | null {
  const line = parts.map((p) => p?.trim()).filter(Boolean).join(sep);
  return line || null;
}

export function buildMedicationPackComposeSummary(pack: PackRow): MedicationPackComposeSummary {
  const packTypeLabel = pack.packType?.replace(/_/g, ' ') ?? null;
  return {
    packId: pack.id,
    name: pack.name,
    packType: packTypeLabel,
    cycleNumber: pack.cycleNumber,
    pharmacyLine: joinParts([pack.pharmacyName, pack.pharmacyPhone]),
    gpLine: joinParts([pack.gpName, pack.gpSurgery]),
    storageLine: joinParts([
      packTypeLabel ? `${packTypeLabel} pack` : null,
      pack.cycleNumber != null ? `Cycle ${pack.cycleNumber}` : null,
      pack.name,
    ]),
  };
}
