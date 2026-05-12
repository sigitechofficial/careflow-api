/** Plain JSON clone for audit old/new payloads (drops functions, undefined, circular refs). */
export function auditSnapshot(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
