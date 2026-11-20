import { CqcNotificationType } from '@prisma/client';

/**
 * Which ready-made library policies back up each kind of CQC notification. References are the library
 * file references (POL-…); the catalogue copies in the database carry them with a "LIB-" prefix, and
 * an organisation's adopted copy points at its catalogue copy. A suggestion only — staff choose.
 */

/** Relevant to every notification: how we notify, how we handle incidents, and being open. */
const ALL_TYPES = ['POL-GOV-009', 'POL-GOV-007', 'POL-GOV-008'];

const BY_TYPE: Record<CqcNotificationType, string[]> = {
  DEATH: ['POL-CD-011', 'POL-CD-012', 'POL-SG-013'],
  SERIOUS_INJURY: [
    'POL-CD-009',
    'POL-HS-005',
    'POL-HS-006',
    'POL-CD-008',
    'POL-HS-007',
    'POL-HS-008',
  ],
  ABUSE_ALLEGATION: ['POL-SG-001', 'POL-SG-002', 'POL-SG-007', 'POL-HR-018'],
  POLICE_INCIDENT: [
    'POL-SG-002',
    'POL-SG-007',
    'POL-HS-004',
    'POL-SG-013',
    'POL-MED-010',
  ],
  SERVICE_DISRUPTION: [
    'POL-GOV-020',
    'POL-CD-013',
    'POL-HS-014',
    'POL-GOV-018',
    'POL-IPC-003',
  ],
};

/** Answers that point to a more specific policy, listed first. */
const BY_ANSWER: Array<{
  type: CqcNotificationType;
  key: string;
  value: string;
  refs: string[];
}> = [
  {
    type: CqcNotificationType.ABUSE_ALLEGATION,
    key: 'abuseType',
    value: 'FINANCIAL',
    refs: ['POL-CD-017', 'POL-SG-008'],
  },
  {
    type: CqcNotificationType.ABUSE_ALLEGATION,
    key: 'abuseType',
    value: 'SEXUAL',
    refs: ['POL-SG-010'],
  },
  {
    type: CqcNotificationType.ABUSE_ALLEGATION,
    key: 'abuseType',
    value: 'NEGLECT',
    refs: ['POL-SG-012', 'POL-CD-013'],
  },
  {
    type: CqcNotificationType.ABUSE_ALLEGATION,
    key: 'abuseType',
    value: 'DISCRIMINATORY',
    refs: ['POL-CD-005'],
  },
  {
    type: CqcNotificationType.ABUSE_ALLEGATION,
    key: 'allegedPerpetrator',
    value: 'STAFF',
    refs: ['POL-SG-007', 'POL-HR-020'],
  },
  {
    type: CqcNotificationType.SERVICE_DISRUPTION,
    key: 'eventKind',
    value: 'STAFFING',
    refs: ['POL-CD-013', 'POL-GOV-020'],
  },
  {
    type: CqcNotificationType.SERVICE_DISRUPTION,
    key: 'eventKind',
    value: 'IT_SYSTEMS',
    refs: ['POL-GOV-018', 'POL-GOV-015'],
  },
];

/** Library references to suggest, most specific first, without repeats. */
export function suggestedPolicyRefs(
  type: CqcNotificationType,
  details: unknown,
): string[] {
  const answers =
    details && typeof details === 'object' && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : {};
  const specific = BY_ANSWER.filter(
    (b) => b.type === type && answers[b.key] === b.value,
  ).flatMap((b) => b.refs);
  return [...new Set([...specific, ...BY_TYPE[type], ...ALL_TYPES])];
}

/** The catalogue copy's reference for a library reference. */
export const catalogueReference = (ref: string) => `LIB-${ref}`;

export const versionLabel = (major: number, minor: number) =>
  `v${major}.${minor}`;

/** One line for the CQC form, e.g. "Our relevant policies: Safeguarding Adults Policy (POL-SG-001, v2.0)." */
export function policiesForCqcForm(
  policies: Array<{ title: string; reference: string; version: string | null }>,
): string {
  if (!policies.length) return '';
  return `Our relevant policies: ${policies
    .map(
      (p) =>
        `${p.title} (${[p.reference, p.version].filter(Boolean).join(', ')})`,
    )
    .join('; ')}.`;
}
