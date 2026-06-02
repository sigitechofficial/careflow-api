import { Prisma } from '@prisma/client';
import { InitialAssessmentStatus as PrismaStatus } from '@prisma/client';

export type CareActivationEvaluation = {
  eligible: boolean;
  approvedForCareStart: boolean;
  careStartConditions: string | null;
  blockers: string[];
};

function metaObject(metadata: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata as Record<string, unknown>;
}

export function careActivationBlockedFromValidation(blocks: { message: string }[]): boolean {
  return blocks.some((b) => {
    const m = b.message.toLowerCase();
    return m.includes('no response procedure') || m.includes('cannot activate care');
  });
}

export function evaluateCareActivation(params: {
  status: PrismaStatus;
  metadata: Prisma.JsonValue | null | undefined;
}): CareActivationEvaluation {
  const meta = metaObject(params.metadata);
  const approvedForCareStart = meta.approvedForCareStart === true;
  const careStartConditions =
    typeof meta.careStartConditions === 'string' && meta.careStartConditions.trim()
      ? meta.careStartConditions.trim()
      : null;
  const blockers: string[] = [];

  if (params.status !== PrismaStatus.REVIEWED) {
    blockers.push('Assessment must be manager-reviewed before care package activation');
  }
  if (!approvedForCareStart) {
    blockers.push('Manager has not approved care start');
  }
  if (meta.careActivationBlocked === true) {
    blockers.push('Care activation blocked — no response procedure or other blocking rule');
  }
  if (meta.managerReviewRequired === true && params.status === PrismaStatus.SUBMITTED) {
    blockers.push('Manager review required before care can start');
  }

  const finance = meta.financeSupport;
  if (finance && typeof finance === 'object' && !Array.isArray(finance)) {
    const row = finance as Record<string, unknown>;
    if (row.required === true && row.consentRecorded !== true) {
      blockers.push('Finance support consent not recorded');
    }
    if (row.staffHandleCash === true && row.managerApprovalRequired !== true) {
      blockers.push('Cash handling requires manager approval');
    }
  }

  return {
    eligible: blockers.length === 0,
    approvedForCareStart,
    careStartConditions,
    blockers,
  };
}
