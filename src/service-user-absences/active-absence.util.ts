/** Calendar day at UTC noon — matches absence `startDate` / `endDate` storage. */
export function calendarDayUtcNoon(reference = new Date()): Date {
  return new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate(), 12, 0, 0, 0),
  );
}

/** Prisma filter: absence spans the given calendar day (inclusive). */
export function activeServiceUserAbsenceWhere(today = calendarDayUtcNoon()) {
  return {
    deletedAt: null,
    startDate: { lte: today },
    OR: [{ endDate: null }, { endDate: { gte: today } }],
  };
}
