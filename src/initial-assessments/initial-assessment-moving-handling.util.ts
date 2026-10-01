import { Prisma } from '@prisma/client';

/** §12.5a "Uses hoist or sling?" — hidden in the admin; derived from the Moving & Handling worksheet. */
export const IA_USES_HOIST_FIELD_KEY = 'usesHoistOrSling';

/**
 * Whether the Moving & Handling worksheet (`metadata.movingHandlingOperations.tasks`) lists a hoist
 * for any task. Returns `undefined` when no task has been recorded yet, so callers don't overwrite
 * the answer before the worksheet is started.
 */
export function movingHandlingUsesHoist(metadata: Prisma.JsonValue | Record<string, unknown> | null | undefined): boolean | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const mh = (metadata as Record<string, unknown>).movingHandlingOperations;
  if (!mh || typeof mh !== 'object' || Array.isArray(mh)) return undefined;
  const tasks = (mh as Record<string, unknown>).tasks;
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) return undefined;

  let anyRecorded = false;
  for (const row of Object.values(tasks as Record<string, unknown>)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    anyRecorded = true;
    const methods = (row as Record<string, unknown>).methods;
    if (Array.isArray(methods) && methods.includes('hoist')) return true;
  }
  return anyRecorded ? false : undefined;
}

/** §12.5c "Transfer support required?" — hidden; derived from the M&H transfer tasks. */
export const IA_TRANSFER_SUPPORT_FIELD_KEY = 'transferSupportRequired';

const TRANSFER_TASK_IDS = ['gettingInOutOfBed', 'transfersBedToChair', 'moveUpBed', 'toileting'] as const;

/**
 * Whether the M&H worksheet shows any transfer done with supervision or assistance. `undefined`
 * until the transfer tasks are recorded (or the person is marked totally independent), so an
 * unfinished worksheet never silently writes "No".
 */
export function movingHandlingNeedsTransferSupport(
  metadata: Prisma.JsonValue | Record<string, unknown> | null | undefined,
): boolean | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const mh = (metadata as Record<string, unknown>).movingHandlingOperations;
  if (!mh || typeof mh !== 'object' || Array.isArray(mh)) return undefined;
  const rf = (mh as Record<string, unknown>).riskFilter as Record<string, unknown> | undefined;
  const tasks = ((mh as Record<string, unknown>).tasks ?? {}) as Record<string, unknown>;
  const capabilities = TRANSFER_TASK_IDS.map((id) => {
    const row = tasks[id];
    return row && typeof row === 'object' && !Array.isArray(row)
      ? ((row as Record<string, unknown>).capability as string | null | undefined)
      : undefined;
  });
  if (capabilities.some((c) => c === 'supervision' || c === 'assistance')) return true;
  if (rf?.totallyIndependentLowRisk === true) return false;
  if (capabilities.every((c) => c === 'independent')) return false;
  return undefined;
}
