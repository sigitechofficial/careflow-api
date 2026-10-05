import { BadRequestException } from '@nestjs/common';
import { IncidentPrivacyLevel, IncidentStatus } from '@prisma/client';
import { INCIDENT_PRIVACY_RANK } from './incident-workflow.util';

const SUPER_ADMIN_ROLE = 'Super Admin';

export type IncidentAccessUser = {
  roles?: string[];
  permissions?: string[];
};

/** Highest privacy tier this user may view (0 normal, 1 restricted, 2 highly conf). */
export function maxViewablePrivacyRank(user: IncidentAccessUser): number {
  if (user.roles?.includes(SUPER_ADMIN_ROLE)) return 2;
  const perms = user.permissions ?? [];
  if (perms.includes('incidents.view_highly_confidential')) return 2;
  if (perms.includes('incidents.view_confidential')) return 1;
  return 0;
}

export function allowedPrivacyLevels(
  user: IncidentAccessUser,
): IncidentPrivacyLevel[] {
  const rank = maxViewablePrivacyRank(user);
  return (Object.keys(INCIDENT_PRIVACY_RANK) as IncidentPrivacyLevel[]).filter(
    (level) => INCIDENT_PRIVACY_RANK[level] <= rank,
  );
}

export function canViewIncidentPrivacy(
  user: IncidentAccessUser,
  incident: { privacyLevel: IncidentPrivacyLevel },
): boolean {
  return (
    INCIDENT_PRIVACY_RANK[incident.privacyLevel] <= maxViewablePrivacyRank(user)
  );
}

/** Closed incidents are a finalised record: changes require reopening first. */
export function assertIncidentEditable(incident: { status: IncidentStatus }): void {
  if (incident.status === IncidentStatus.CLOSED) {
    throw new BadRequestException(
      'This incident is closed. Reopen it to make changes.',
    );
  }
}

export function hasIncidentPermission(
  user: IncidentAccessUser,
  permission: string,
): boolean {
  if (user.roles?.includes(SUPER_ADMIN_ROLE)) return true;
  return (user.permissions ?? []).includes(permission);
}
