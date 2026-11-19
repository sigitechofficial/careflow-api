/**
 * Default job titles (tidy spelling and capitals; migration 20270119090000 renamed the old ones).
 * Seeded via `prisma db seed` (copied from app lookups so seed does not depend on `src/`).
 */
export const DEFAULT_JOB_TITLES: readonly string[] = [
  'Accounts',
  'Accounts Manager',
  'Administrative Assistant',
  'Administrator',
  'Allocator Coordinator',
  'Assistant Accountant',
  'Care Assistant',
  'Care Home Manager',
  'Care Support Worker',
  'Care Worker',
  'Carer',
  'Consultant',
  'Driver',
  'Field Quality Assurance Officer',
  'Field Support Worker',
  'Healthcare Assistant',
  'Human Resources',
  'Inspector',
  'Managing Director',
  'Medication Compliance',
  'Nurse',
  'Office Manager',
  'On-call Person',
  'Operations Manager',
  'Passenger Assistant',
  'Quality Assurance',
  'Senior Carer',
  'Spot Checker',
  'Supervisor',
  'Swift Locator',
  'System Monitoring Officer',
  'Volunteer',
];

/** Alias for seed files that prefer camelCase. */
export const defaultJobTitles = DEFAULT_JOB_TITLES;
