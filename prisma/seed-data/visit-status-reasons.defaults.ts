/**
 * Default Visit Status Reasons for office Record visit.
 * Shared by prisma/seed.ts and prisma/scripts/seed-visit-status-reasons.ts.
 */
export const DEFAULT_VISIT_STATUS_REASONS = [
  // Completed / attended
  'Visit completed as planned',
  'Care delivered',
  'Carer attended — tasks done',
  'All scheduled tasks completed',
  'Medication administered as planned',
  'Partial care delivered',
  'Care delivered with follow-up needed',
  'Visit completed early',
  'Visit completed with overrun',
  'Double-up visit completed',
  'Shadow / training visit completed',

  // Started / in progress
  'Visit started — carer on site',
  'Visit in progress',

  // Missed / did not take place (office narrative; structured missed codes remain separate)
  'Carer did not attend',
  'No cover available',
  'Service user not home',
  'Service user refused visit',
  'Could not gain access',
  'Hospital or temporary absence',
  'Family cancelled too late',
  'Rostering / scheduling error',

  // Cancelled / called off
  'Cancelled by office',
  'Cancelled by service user',
  'Cancelled by family',
  'Cancelled — weather or travel disruption',
  'Cancelled — staff sickness',
  'Duplicate visit removed',

  // Called off / needs attention
  'Called off on arrival',
  'Unsafe to continue visit',
  'Escalated for manager review',
  'Needs reallocation',

  // Catch-all
  'Other',
] as const;
