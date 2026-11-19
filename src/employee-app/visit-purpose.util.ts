import type { PrismaService } from '../prisma/prisma.service';

export type VisitPurpose = {
  /** What the visit is for, as written on the visit plan. */
  text: string;
  /** A regular visit on the plan, or an extra (one-off) visit added for specific dates. */
  source: 'regular' | 'extra';
};

/**
 * What a visit is for, read live from the visit plan so an edit on the plan shows on every visit:
 * - a regular visit: "What is this visit for?" on the plan's visit (VisitPlanSlot.notes);
 * - an extra visit: the reason given when it was added (VisitPlanSlotException.notes).
 * Null when nothing was written, or the visit is not from a plan.
 */
export async function visitPurposeForJob(prisma: PrismaService, jobId: string): Promise<VisitPurpose | null> {
  const job = await prisma.scheduledJob.findFirst({
    where: { id: jobId, deletedAt: null },
    select: {
      metadata: true,
      visits: {
        where: { deletedAt: null },
        orderBy: { scheduledStartDateTime: 'asc' },
        take: 1,
        select: { visitPlanSlot: { select: { notes: true } } },
      },
    },
  });
  if (!job) return null;
  const meta = job.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
    ? (job.metadata as Record<string, unknown>)
    : {};
  const exceptionId = typeof meta.visitPlanExceptionId === 'string' ? meta.visitPlanExceptionId : null;
  if (meta.visitPlanExtra === true && exceptionId) {
    const exception = await prisma.visitPlanSlotException.findFirst({
      where: { id: exceptionId },
      select: { notes: true },
    });
    const text = exception?.notes?.trim();
    return text ? { text, source: 'extra' } : null;
  }
  const text = job.visits[0]?.visitPlanSlot?.notes?.trim();
  return text ? { text, source: 'regular' } : null;
}
