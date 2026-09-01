export const LOOKUP_MANAGEABLE_RESOURCES = [
  'job-titles',
  'skill-types',
  'work-areas',
  'grades',
  'contract-types',
  'certification-types',
  'non-core-activity-reasons',
  'leaving-reasons',
  'visit-status-reasons',
  'review-types',
  'locations',
  'zones',
  'travel-payment-types',
] as const;

export type LookupManageableResource = (typeof LOOKUP_MANAGEABLE_RESOURCES)[number];

export function parseLookupManageableResource(resource: string): LookupManageableResource {
  if ((LOOKUP_MANAGEABLE_RESOURCES as readonly string[]).includes(resource)) {
    return resource as LookupManageableResource;
  }
  throw new Error(`Unknown lookup resource: ${resource}`);
}
