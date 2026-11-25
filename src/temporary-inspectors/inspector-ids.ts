/**
 * Temporary inspector ids seen by JwtAuthGuard in this process. An inspector is not an office user, so audit rows
 * written "as" one link no user and name the inspector in their metadata instead (AuditLogsService). Inspector ids
 * are their own UUIDs and never an office user's id.
 */
const inspectorIds = new Set<string>();

export function rememberInspectorId(id: string): void {
  inspectorIds.add(id);
}

export function isInspectorId(id: string | null | undefined): boolean {
  return Boolean(id) && inspectorIds.has(id!);
}
