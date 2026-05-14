/**
 * Canonical job title labels for lookups (legacy casing / typos preserved).
 * Seeded via `prisma db seed` (copied from app lookups so seed does not depend on `src/`).
 */
export const DEFAULT_JOB_TITLES: readonly string[] = [
  'ADMINISTRATIVE ASSISTANT',
  'Accounts',
  'Accounts Manager',
  'Administrator',
  'Allocator Coordinator',
  'Assistant Accountant',
  'CARE WORKER',
  'Care Assitance',
  'Care Home Manager',
  'Carer',
  'Consultant',
  'Drivers',
  'Feild Support Worker',
  'Field Quality Assurance Officer',
  'HEALTH CARE ASSISTANT',
  'Human Resource',
  'Inspector',
  'Managing Director',
  'Nurse',
  'Office Manager',
  'On-call person',
  'Operation Manager',
  'Passenger Assitance',
  'Quality Assurance',
  'SWIFT LOCATOR',
  'Supervisor',
  'System Monitoring officer',
  'Volunteer',
  'care support worker',
  'medication compliance',
  'senior carer',
  'spot checker',
];

/** Alias for seed files that prefer camelCase. */
export const defaultJobTitles = DEFAULT_JOB_TITLES;
