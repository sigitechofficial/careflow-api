import {
  EmployeeHoursApprovalStatus,
  EmployeeHoursApprovalType,
  Prisma,
} from '@prisma/client';

type RejectedPlanRequest = {
  employeeId: string | null;
  decidedAt: Date | null;
  requestPayload: Prisma.JsonValue;
};

/**
 * Rejected plan visits ("employeeId|slotId|YYYY-MM-DD") that a manager later approved for the
 * same carer on the rota (Hours approvals → rota visit). The later decision wins, so the carer
 * stays on those visits.
 */
export async function rotaApprovedAfterRejection(
  client: Prisma.TransactionClient,
  rejected: RejectedPlanRequest[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const employeeIds = [
    ...new Set(
      rejected.map((r) => r.employeeId).filter((id): id is string => !!id),
    ),
  ];
  if (!employeeIds.length) return out;
  const approvals = await client.employeeHoursApproval.findMany({
    where: {
      employeeId: { in: employeeIds },
      requestType: EmployeeHoursApprovalType.ROTA_VISIT_OVER_HOURS,
      status: EmployeeHoursApprovalStatus.APPROVED,
    },
    select: { employeeId: true, decidedAt: true, requestPayload: true },
  });
  const jobIdOf = (p: Prisma.JsonValue) =>
    (p as { scheduledJobId?: string } | null)?.scheduledJobId;
  const jobIds = [
    ...new Set(
      approvals
        .map((a) => jobIdOf(a.requestPayload))
        .filter((id): id is string => !!id),
    ),
  ];
  if (!jobIds.length) return out;
  const jobs = await client.scheduledJob.findMany({
    where: { id: { in: jobIds } },
    select: { id: true, metadata: true },
  });
  const slotDateOf = new Map<string, string>();
  for (const job of jobs) {
    const m = job.metadata as {
      visitPlanSlotId?: string;
      date?: string;
    } | null;
    if (m?.visitPlanSlotId && m.date)
      slotDateOf.set(job.id, `${m.visitPlanSlotId}|${m.date.slice(0, 10)}`);
  }
  // Latest rota approval per "employeeId|slotId|date".
  const approvedAt = new Map<string, number>();
  for (const a of approvals) {
    const slotDate = slotDateOf.get(jobIdOf(a.requestPayload) ?? '');
    if (!slotDate || !a.employeeId || !a.decidedAt) continue;
    const key = `${a.employeeId}|${slotDate}`;
    approvedAt.set(
      key,
      Math.max(approvedAt.get(key) ?? 0, a.decidedAt.getTime()),
    );
  }
  for (const r of rejected) {
    if (!r.employeeId) continue;
    const rejectedAt = r.decidedAt?.getTime() ?? 0;
    for (const slotDate of (r.requestPayload as { withheld?: string[] } | null)
      ?.withheld ?? []) {
      const key = `${r.employeeId}|${slotDate}`;
      if ((approvedAt.get(key) ?? 0) > rejectedAt) out.add(key);
    }
  }
  return out;
}
