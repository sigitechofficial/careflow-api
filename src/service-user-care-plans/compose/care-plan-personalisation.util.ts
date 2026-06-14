import { buildCarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';

export function buildPersonalisationFromServiceUser(row: {
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  serviceUserNumber?: string | null;
}) {
  return buildCarePlanPersonalisationContext({
    firstName: row.firstName,
    lastName: row.lastName,
    preferredName: row.preferredName,
    serviceUserNumber: row.serviceUserNumber ?? null,
  });
}
