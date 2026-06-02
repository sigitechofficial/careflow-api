/** Normalized key for grouping duplicate medication rows (same display name). */
export function normalizeMedicationDedupeKey(name: string): string {
  return name.trim().toLowerCase();
}

export type MedicationDedupeCandidate = {
  id: string;
  medicationName: string;
  createdAt: Date;
  supplyDeliveries?: readonly unknown[];
  _count?: {
    events?: number;
    supplyDeliveries?: number;
  };
};

export type MedicationDuplicateGroup<T extends MedicationDedupeCandidate> = {
  key: string;
  canonical: T;
  /** All medication row ids in this group (includes canonical). */
  relatedIds: string[];
  members: T[];
};

/** Prefer row with MAR activity, then supply deliveries, then earliest seed (original). */
export function pickCanonicalMedication<T extends MedicationDedupeCandidate>(members: T[]): T {
  return [...members].sort((a, b) => {
    const eventsA = a._count?.events ?? 0;
    const eventsB = b._count?.events ?? 0;
    if (eventsB !== eventsA) return eventsB - eventsA;

    const deliveriesA = a._count?.supplyDeliveries ?? a.supplyDeliveries?.length ?? 0;
    const deliveriesB = b._count?.supplyDeliveries ?? b.supplyDeliveries?.length ?? 0;
    if (deliveriesB !== deliveriesA) return deliveriesB - deliveriesA;

    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

export function groupMedicationsByName<T extends MedicationDedupeCandidate>(
  medications: T[],
): MedicationDuplicateGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const med of medications) {
    const key = normalizeMedicationDedupeKey(med.medicationName);
    const list = byKey.get(key);
    if (list) list.push(med);
    else byKey.set(key, [med]);
  }

  const groups: MedicationDuplicateGroup<T>[] = [];
  for (const [key, members] of byKey) {
    const canonical = pickCanonicalMedication(members);
    groups.push({
      key,
      canonical,
      relatedIds: members.map((m) => m.id),
      members,
    });
  }

  return groups.sort((a, b) =>
    a.canonical.medicationName.localeCompare(b.canonical.medicationName),
  );
}

export function dedupeMedicationsByName<T extends MedicationDedupeCandidate>(
  medications: T[],
): T[] {
  return groupMedicationsByName(medications).map((g) => g.canonical);
}
