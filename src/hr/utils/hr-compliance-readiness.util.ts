import { HrDeploymentStatus } from '@prisma/client';
import type { ComplianceAllocationResult } from '../../employee-compliance/allocation-compliance.util';

/** Missing, expired or rejected mandatory compliance (or overdue training): not deployable. */
const RED_STATUSES = new Set(['MISSING', 'REQUIRED', 'EXPIRED', 'REJECTED', 'OVERDUE']);

const RANK: Record<HrDeploymentStatus, number> = { GREEN: 0, AMBER: 1, RED: 2 };

export type ComplianceReadiness = {
  /** From the mandatory compliance items (the same ones the rota checks). */
  level: HrDeploymentStatus;
  /** e.g. "DBS (EXPIRED)", worst first. */
  issues: string[];
};

/**
 * Compliance as a Green / Amber / Red level, whatever the rota's Warn / Block setting:
 * missing, expired or rejected = Red; expiring soon or waiting for review = Amber.
 */
export function complianceReadiness(result: ComplianceAllocationResult): ComplianceReadiness {
  const all = [...result.blockingIssues, ...result.warningIssues];
  const red = all.filter((i) => RED_STATUSES.has(i.status));
  const amber = all.filter((i) => !RED_STATUSES.has(i.status));
  return {
    level: red.length ? HrDeploymentStatus.RED : amber.length ? HrDeploymentStatus.AMBER : HrDeploymentStatus.GREEN,
    issues: [...red, ...amber].map((i) => i.label),
  };
}

/** The worse of what HR set and what compliance says. */
export function worstDeployment(a: HrDeploymentStatus, b: HrDeploymentStatus): HrDeploymentStatus {
  return RANK[a] >= RANK[b] ? a : b;
}
