import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';

/** Who made a course-authoring change (from the request). */
export type LearningActor = { userId: string; meta?: RequestAuditMeta };

/**
 * Write one LEARNING audit row for a course-authoring change (sections, lessons,
 * quizzes, questions). Skipped when no actor is given (e.g. internal callers).
 */
export async function logLearningChange(
  audit: AuditLogsService,
  actor: LearningActor | undefined,
  entry: {
    action: string;
    recordType: string;
    recordId: string;
    oldValues?: unknown;
    newValues?: unknown;
  },
): Promise<void> {
  if (!actor) return;
  await audit.logAudit({
    userId: actor.userId,
    module: AuditModule.LEARNING,
    action: entry.action,
    recordType: entry.recordType,
    recordId: entry.recordId,
    oldValues: entry.oldValues,
    newValues: entry.newValues,
    ipAddress: actor.meta?.ipAddress,
    userAgent: actor.meta?.userAgent,
  });
}

/** Copy of a record without one key (e.g. drop a joined parent before writing old values). */
export function withoutKey<T extends object, K extends keyof T>(
  obj: T,
  key: K,
): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => k !== key),
  ) as Omit<T, K>;
}
