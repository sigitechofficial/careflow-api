import { Prisma } from '@prisma/client';
import { resolveVisitTaskCompletionInput } from '../visit-tasks/visit-task-completion-input.util';

export function buildTaskCatalogueFlagsJson(
  name: string,
  existing?: Record<string, unknown> | null,
): Prisma.InputJsonValue {
  const flags: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  flags.completionInput = resolveVisitTaskCompletionInput({ name, flagsJson: flags });
  return flags as Prisma.InputJsonValue;
}
