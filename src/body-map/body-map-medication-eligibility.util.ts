import type { MedicationRoute, MedicationType } from '@prisma/client';

const BODY_MAP_SITE_TYPE_CODES = new Set([
  'CREAM',
  'OINTMENT',
  'LOTION',
  'PATCH',
  'INJECTION',
  'SPRAY',
]);

const BODY_MAP_SITE_ROUTE_CODES = new Set(['TOPICAL', 'TRANSDERMAL', 'ROUTE_INJECTION']);

export type MedicationLookupShape = {
  requiresBodyMapSite?: boolean;
  code?: string | null;
} | null | undefined;

export function medicationRequiresBodyMapSite(input: {
  medicationType?: MedicationLookupShape;
  route?: MedicationLookupShape;
}): boolean {
  const type = input.medicationType;
  const route = input.route;
  if (type?.requiresBodyMapSite || route?.requiresBodyMapSite) return true;
  if (type?.code && BODY_MAP_SITE_TYPE_CODES.has(type.code)) return true;
  if (route?.code && BODY_MAP_SITE_ROUTE_CODES.has(route.code)) return true;
  return false;
}

export function medicationRequiresBodyMapSiteFromMed(med: {
  medicationType: Pick<MedicationType, 'code' | 'requiresBodyMapSite'> | null;
  route: Pick<MedicationRoute, 'code' | 'requiresBodyMapSite'> | null;
}): boolean {
  return medicationRequiresBodyMapSite({
    medicationType: med.medicationType,
    route: med.route,
  });
}
