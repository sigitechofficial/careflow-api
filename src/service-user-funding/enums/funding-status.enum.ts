/** Mirrors `FundingStatus` in Prisma (`service_users` schema) — use for Swagger / validation. */
export enum FundingStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  ENDED = 'ENDED',
  REJECTED = 'REJECTED',
  UNKNOWN = 'UNKNOWN',
}
