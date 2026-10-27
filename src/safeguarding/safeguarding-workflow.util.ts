import { SafeguardingStatus } from '@prisma/client';

export const SAFEGUARDING_ACTIONS = [
  'SCREEN',
  'START_INVESTIGATION',
  'REFER',
  'CLOSE',
  'REOPEN',
] as const;

export type SafeguardingAction = (typeof SAFEGUARDING_ACTIONS)[number];

const S = SafeguardingStatus;

/** Allowed source statuses for each action, and the resulting status. */
const TRANSITIONS: Record<SafeguardingAction, { from: SafeguardingStatus[]; to: SafeguardingStatus }> = {
  SCREEN: { from: [S.RAISED], to: S.SCREENING },
  START_INVESTIGATION: { from: [S.RAISED, S.SCREENING], to: S.INVESTIGATING },
  REFER: { from: [S.SCREENING, S.INVESTIGATING], to: S.REFERRED },
  CLOSE: { from: [S.RAISED, S.SCREENING, S.INVESTIGATING, S.REFERRED], to: S.CLOSED },
  REOPEN: { from: [S.CLOSED], to: S.INVESTIGATING },
};

/**
 * Returns the next status for an action from the current status, or null when
 * the action is not allowed. The service throws BadRequest on null.
 */
export function nextSafeguardingStatus(
  current: SafeguardingStatus,
  action: SafeguardingAction,
): SafeguardingStatus | null {
  const rule = TRANSITIONS[action];
  if (!rule) return null;
  return rule.from.includes(current) ? rule.to : null;
}

/** Human label for the timeline entry of a transition. */
export function safeguardingActionLabel(action: SafeguardingAction): string {
  switch (action) {
    case 'SCREEN':
      return 'Screened';
    case 'START_INVESTIGATION':
      return 'Investigation started';
    case 'REFER':
      return 'Referred to Local Authority';
    case 'CLOSE':
      return 'Closed';
    case 'REOPEN':
      return 'Reopened';
    default:
      return action;
  }
}
