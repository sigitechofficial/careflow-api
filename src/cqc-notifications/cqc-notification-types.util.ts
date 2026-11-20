import { CqcNotificationStatus, CqcNotificationType } from '@prisma/client';

/**
 * CQC statutory notifications: what each type asks for, the internal deadline and the status rules.
 * Field lists are CareFlow's checklist of what the CQC form needs (Care Quality Commission
 * (Registration) Regulations 2009, regs 16 and 18), not a copy of CQC's form, which CQC changes often.
 */

/** Internal target: CQC's legal standard is "without delay"; CareFlow aims for 24 hours from awareness. */
export const CQC_NOTIFICATION_TARGET_HOURS = 24;

export type CqcFieldKind =
  | 'text'
  | 'longText'
  | 'datetime'
  | 'boolean'
  | 'select'
  /** A name: picked from staff in the form, or typed for someone outside the service. Stored as text. */
  | 'staff';

export type CqcFieldOption = { value: string; label: string };

export type CqcDetailField = {
  key: string;
  label: string;
  kind: CqcFieldKind;
  /** Needed before the notification can be marked ready. */
  required: boolean;
  options?: CqcFieldOption[];
  help?: string;
};

export type CqcNotificationTypeSpec = {
  type: CqcNotificationType;
  label: string;
  /** CQC form / regulation, e.g. "SN16 · Regulation 16". */
  regulation: string;
  whenToNotify: string;
  fields: CqcDetailField[];
};

const opts = (...pairs: Array<[string, string]>): CqcFieldOption[] =>
  pairs.map(([value, label]) => ({ value, label }));

export const CQC_NOTIFICATION_TYPES: CqcNotificationTypeSpec[] = [
  {
    type: CqcNotificationType.DEATH,
    label: 'Death of a person using the service',
    regulation: 'SN16 · Regulation 16',
    whenToNotify:
      'A person died while receiving care, or the death may have resulted from the care provided. Notify without delay, including expected deaths.',
    fields: [
      {
        key: 'placeOfDeath',
        label: 'Place of death',
        kind: 'select',
        required: true,
        options: opts(
          ['HOME', 'Own home'],
          ['HOSPITAL', 'Hospital'],
          ['HOSPICE', 'Hospice'],
          ['CARE_HOME', 'Care home'],
          ['OTHER', 'Other'],
        ),
      },
      {
        key: 'expectedness',
        label: 'Was the death expected?',
        kind: 'select',
        required: true,
        options: opts(
          ['EXPECTED', 'Expected'],
          ['UNEXPECTED', 'Unexpected'],
          ['NOT_KNOWN', 'Not known'],
        ),
      },
      {
        key: 'causeIfKnown',
        label: 'Cause of death, if known',
        kind: 'text',
        required: false,
      },
      {
        key: 'coronerInvolved',
        label: 'Coroner informed or involved',
        kind: 'boolean',
        required: false,
      },
    ],
  },
  {
    type: CqcNotificationType.SERIOUS_INJURY,
    label: 'Serious injury',
    regulation: 'SN18 · Regulation 18(2)(a)–(b)',
    whenToNotify:
      'A health care professional thinks the injury caused lasting harm, prolonged pain or psychological harm (28 days or more), changed the body’s structure or shortened life expectancy, or needs treatment to prevent death or such harm.',
    fields: [
      {
        key: 'injuryDescription',
        label: 'Injury and body part',
        kind: 'longText',
        required: true,
      },
      {
        key: 'seriousnessCriterion',
        label: 'Why it is a serious injury',
        kind: 'select',
        required: true,
        options: opts(
          [
            'IMPAIRMENT',
            'Impairment of sensory, motor or intellectual function that is not likely to be temporary',
          ],
          ['BODY_STRUCTURE', 'Changes to the structure of the body'],
          [
            'PROLONGED_PAIN',
            'Prolonged pain or prolonged psychological harm (28 days or more)',
          ],
          ['LIFE_EXPECTANCY', 'Shortened life expectancy'],
          [
            'TREATMENT_TO_PREVENT',
            'Needs treatment to prevent death or one of the above',
          ],
        ),
      },
      {
        key: 'assessedBy',
        label: 'Health care professional who assessed it',
        kind: 'staff',
        required: true,
        help: 'Choose the staff member who assessed it, or type the name and role of someone outside the service, e.g. "Dr Patel, GP" or "A&E doctor". CQC needs the opinion of a registered health care professional (such as a doctor or nurse).',
      },
      {
        key: 'treatment',
        label: 'Treatment received',
        kind: 'select',
        required: false,
        options: opts(
          ['HOSPITAL_ADMISSION', 'Admitted to hospital'],
          ['A_AND_E', 'Treated in A&E'],
          ['GP_OR_COMMUNITY', 'GP or community nurse'],
          ['OTHER', 'Other'],
        ),
      },
    ],
  },
  {
    type: CqcNotificationType.ABUSE_ALLEGATION,
    label: 'Abuse or allegation of abuse',
    regulation: 'SN18 · Regulation 18(2)(e)',
    whenToNotify:
      'Any abuse or allegation of abuse of a person using the service, including allegations made by others, ones that seem unlikely, and ones later withdrawn.',
    fields: [
      {
        key: 'abuseType',
        label: 'Type of abuse',
        kind: 'select',
        required: true,
        options: opts(
          ['PHYSICAL', 'Physical'],
          ['SEXUAL', 'Sexual'],
          ['PSYCHOLOGICAL', 'Psychological or emotional'],
          [
            'FINANCIAL',
            'Financial or material (theft, misuse of money or property)',
          ],
          ['NEGLECT', 'Neglect or acts of omission'],
          ['DISCRIMINATORY', 'Discriminatory'],
          ['ORGANISATIONAL', 'Organisational'],
          ['OTHER', 'Other'],
        ),
      },
      {
        key: 'allegedPerpetrator',
        label: 'Alleged to have been carried out by',
        kind: 'select',
        required: true,
        options: opts(
          ['STAFF', 'Member of staff'],
          ['FAMILY_OR_FRIEND', 'Family member or friend'],
          ['OTHER_SERVICE_USER', 'Another person using the service'],
          ['OTHER', 'Someone else'],
          ['NOT_KNOWN', 'Not known'],
        ),
      },
      {
        key: 'safeguardingReference',
        label: 'Local authority safeguarding reference',
        kind: 'text',
        required: false,
      },
    ],
  },
  {
    type: CqcNotificationType.POLICE_INCIDENT,
    label: 'Incident reported to or investigated by the police',
    regulation: 'SN18 · Regulation 18(2)(f)',
    whenToNotify: 'Any incident reported to, or investigated by, the police.',
    fields: [
      {
        key: 'policeForce',
        label: 'Police force',
        kind: 'text',
        required: true,
      },
      {
        key: 'policeReference',
        label: 'Police reference (crime or incident number)',
        kind: 'text',
        required: false,
      },
      {
        key: 'reasonForPolice',
        label: 'Why the police are involved',
        kind: 'longText',
        required: true,
      },
    ],
  },
  {
    type: CqcNotificationType.SERVICE_DISRUPTION,
    label: 'Event that stops the service running safely',
    regulation: 'SN18 · Regulation 18(2)(g)',
    whenToNotify:
      'An event that stops, or is likely to threaten, the service running safely and properly, e.g. too few suitable staff, utilities or safety systems failing for more than 24 hours, or damage to premises.',
    fields: [
      {
        key: 'eventKind',
        label: 'Kind of event',
        kind: 'select',
        required: true,
        options: opts(
          [
            'STAFFING',
            'Not enough suitably qualified, skilled and experienced staff',
          ],
          [
            'UTILITIES',
            'Electricity, gas, water or sewerage out for more than 24 hours',
          ],
          ['PREMISES_DAMAGE', 'Physical damage to premises'],
          [
            'SAFETY_SYSTEMS',
            'Fire alarm or other safety device failed for more than 24 hours',
          ],
          ['IT_SYSTEMS', 'IT, phone or cyber incident'],
          ['OTHER', 'Other'],
        ),
      },
      {
        key: 'endedAt',
        label: 'When it ended (if it has)',
        kind: 'datetime',
        required: false,
      },
      {
        key: 'peopleAffected',
        label: 'People and visits affected',
        kind: 'longText',
        required: true,
      },
    ],
  },
];

/** Who else was told, as stored in CqcNotification.othersInformed. */
export const CQC_OTHERS_INFORMED: CqcFieldOption[] = opts(
  ['LOCAL_AUTHORITY_SAFEGUARDING', 'Local authority safeguarding'],
  ['POLICE', 'Police'],
  ['FAMILY_OR_REPRESENTATIVE', 'Family or representative'],
  ['GP', 'GP'],
  ['CORONER', 'Coroner'],
  ['COMMISSIONER', 'Commissioner'],
  ['HSE', 'Health and Safety Executive'],
  ['OTHER', 'Other'],
);

export function typeSpec(type: CqcNotificationType): CqcNotificationTypeSpec {
  const spec = CQC_NOTIFICATION_TYPES.find((t) => t.type === type);
  if (!spec) throw new Error(`Unknown CQC notification type ${type}`);
  return spec;
}

export type DetailsResult =
  | { ok: true; details: Record<string, string | boolean | null> }
  | { ok: false; error: string };

/**
 * Checks type-specific answers: only known keys, values of the right kind, select values from the list.
 * Empty strings become null. Does not check required fields (see readinessProblems).
 */
export function cleanDetails(
  type: CqcNotificationType,
  input: unknown,
): DetailsResult {
  if (input === null || input === undefined) return { ok: true, details: {} };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, error: 'details must be an object' };
  const spec = typeSpec(type);
  const out: Record<string, string | boolean | null> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const field = spec.fields.find((f) => f.key === key);
    if (!field)
      return { ok: false, error: `Unknown detail "${key}" for ${spec.label}` };
    if (raw === null || raw === undefined || raw === '') {
      out[key] = null;
      continue;
    }
    if (field.kind === 'boolean') {
      if (typeof raw !== 'boolean')
        return { ok: false, error: `${field.label} must be yes or no` };
      out[key] = raw;
      continue;
    }
    if (typeof raw !== 'string')
      return { ok: false, error: `${field.label} must be text` };
    const value = raw.trim();
    if (value.length > 4000)
      return { ok: false, error: `${field.label} is too long` };
    if (
      field.kind === 'select' &&
      !field.options?.some((o) => o.value === value)
    )
      return { ok: false, error: `${field.label}: choose one of the options` };
    if (field.kind === 'datetime' && Number.isNaN(new Date(value).getTime()))
      return { ok: false, error: `${field.label} is not a valid date` };
    out[key] = value || null;
  }
  return { ok: true, details: out };
}

export type ReadinessInput = {
  type: CqcNotificationType;
  eventOccurredAt: Date | null;
  summary: string | null;
  actionsTaken: string | null;
  details: unknown;
};

/** What is missing before a notification can be marked ready (empty = ready). */
export function readinessProblems(n: ReadinessInput): string[] {
  const problems: string[] = [];
  if (!n.eventOccurredAt) problems.push('When it happened');
  if (!n.summary?.trim()) problems.push('What happened');
  if (!n.actionsTaken?.trim()) problems.push('Action taken');
  const details =
    n.details && typeof n.details === 'object' && !Array.isArray(n.details)
      ? (n.details as Record<string, unknown>)
      : {};
  for (const f of typeSpec(n.type).fields) {
    if (!f.required) continue;
    const v = details[f.key];
    if (v === undefined || v === null || v === '') problems.push(f.label);
  }
  return problems;
}

export function dueAtFrom(becameAwareAt: Date): Date {
  return new Date(
    becameAwareAt.getTime() + CQC_NOTIFICATION_TARGET_HOURS * 3600_000,
  );
}

export function formatCqcNotificationReference(
  year: number,
  value: number,
): string {
  return `CQCN-${year}-${String(value).padStart(6, '0')}`;
}

/** Still being prepared: can be edited, counts towards due/overdue. */
export const OPEN_CQC_NOTIFICATION_STATUSES: CqcNotificationStatus[] = [
  CqcNotificationStatus.DRAFT,
  CqcNotificationStatus.READY,
];

export function isOverdue(
  n: { status: CqcNotificationStatus; dueAt: Date },
  now: Date,
): boolean {
  return (
    OPEN_CQC_NOTIFICATION_STATUSES.includes(n.status) &&
    n.dueAt.getTime() < now.getTime()
  );
}

/** Submitted (or acknowledged) after the internal target. */
export function submittedLate(n: {
  submittedAt: Date | null;
  dueAt: Date;
}): boolean {
  return Boolean(n.submittedAt && n.submittedAt.getTime() > n.dueAt.getTime());
}
