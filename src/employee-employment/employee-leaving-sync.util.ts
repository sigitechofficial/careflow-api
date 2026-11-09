import type { Prisma } from '@prisma/client';

type EmploymentLeaving = {
  endDate: Date | null;
  leavingReasonId: string | null;
  leavingNotes: string | null;
};

/**
 * Leaving is entered once, on the employee's Employment record (end date and reason). The leaving record is
 * kept in step from it, so surveys and reports that read leaving records (the "Notice given" survey trigger,
 * the leavers list) see the same thing. The record is created when an end date is first entered — that is
 * the day notice was given — updated if the date or reason changes, and removed if the end date is cleared.
 */
export async function syncLeavingRecordFromEmployment(
  tx: Prisma.TransactionClient,
  employeeId: string,
  userId: string,
  employment: EmploymentLeaving,
): Promise<void> {
  const live = await tx.employeeLeavingRecord.findMany({
    where: { employeeId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, leavingDate: true, leavingReasonId: true, notes: true },
  });
  const now = new Date();
  if (!employment.endDate) {
    if (live.length) {
      await tx.employeeLeavingRecord.updateMany({
        where: { id: { in: live.map((r) => r.id) } },
        data: { deletedAt: now, deletedById: userId, isActive: false },
      });
    }
    return;
  }
  const notes = employment.leavingNotes?.trim() || null;
  const [current, ...older] = live;
  if (!current) {
    await tx.employeeLeavingRecord.create({
      data: {
        employeeId,
        leavingDate: employment.endDate,
        leavingReasonId: employment.leavingReasonId,
        notes,
        createdById: userId,
        updatedById: userId,
      },
    });
    return;
  }
  if (
    current.leavingDate.getTime() !== employment.endDate.getTime() ||
    current.leavingReasonId !== employment.leavingReasonId ||
    (current.notes ?? null) !== notes
  ) {
    await tx.employeeLeavingRecord.update({
      where: { id: current.id },
      data: { leavingDate: employment.endDate, leavingReasonId: employment.leavingReasonId, notes, updatedById: userId },
    });
  }
  if (older.length) {
    await tx.employeeLeavingRecord.updateMany({
      where: { id: { in: older.map((r) => r.id) } },
      data: { deletedAt: now, deletedById: userId, isActive: false },
    });
  }
}
