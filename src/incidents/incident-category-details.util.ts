/**
 * Category-specific answers captured when the office raises an incident
 * (`Incident.categoryDetails` JSONB). Shapes are keyed by the STABLE category key.
 *
 * Only the admin (office) create path enforces required answers — carer-app reports
 * must never be blocked by these fields.
 */

/** Pressure ulcer grades (NHS England terminology). Extend or relabel here — keys are stored. */
export const PRESSURE_ULCER_GRADES = [
  { key: 'CATEGORY_1', label: 'Category 1' },
  { key: 'CATEGORY_2', label: 'Category 2' },
  { key: 'CATEGORY_3', label: 'Category 3' },
  { key: 'CATEGORY_4', label: 'Category 4' },
  { key: 'UNSTAGEABLE', label: 'Unstageable' },
  { key: 'SDTI', label: 'Suspected Deep Tissue Injury (SDTI)' },
] as const;

/** Hospital outcome doesn't apply: a death is itself the outcome; a data breach harms no one physically. */
export const NO_HOSPITAL_OUTCOME_CATEGORIES = new Set(['DEATH', 'DATA_BREACH']);

export const WOUND_STATUSES = ['NEW', 'EXISTING', 'DETERIORATED'] as const;

export const ALLEGED_PERSON_KINDS = [
  'STAFF',
  'OTHER_PERSON',
  'UNKNOWN',
  'NOT_APPLICABLE',
] as const;

export type IncidentCategoryDetails = Record<string, unknown>;

type Result = { details: IncidentCategoryDetails | null; errors: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

class Reader {
  readonly errors: string[] = [];
  readonly out: IncidentCategoryDetails = {};

  constructor(
    private readonly raw: Record<string, unknown>,
    private readonly strict: boolean,
  ) {}

  text(
    key: string,
    label: string,
    opts: { required?: boolean; max?: number } = {},
  ) {
    const v = this.raw[key];
    if (v == null || (typeof v === 'string' && !v.trim())) {
      if (opts.required && this.strict)
        this.errors.push(`${label} is required`);
      return undefined;
    }
    if (typeof v !== 'string') {
      this.errors.push(`${label} must be text`);
      return undefined;
    }
    const t = v.trim();
    if (t.length > (opts.max ?? 2000)) {
      this.errors.push(`${label} is too long`);
      return undefined;
    }
    this.out[key] = t;
    return t;
  }

  bool(key: string, label: string, opts: { required?: boolean } = {}) {
    const v = this.raw[key];
    if (v == null) {
      if (opts.required && this.strict)
        this.errors.push(`${label} is required`);
      return undefined;
    }
    if (typeof v !== 'boolean') {
      this.errors.push(`${label} must be yes or no`);
      return undefined;
    }
    this.out[key] = v;
    return v;
  }

  oneOf<T extends string>(
    key: string,
    label: string,
    allowed: readonly T[],
    opts: { required?: boolean } = {},
  ): T | undefined {
    const v = this.raw[key];
    if (v == null || v === '') {
      if (opts.required && this.strict)
        this.errors.push(`${label} is required`);
      return undefined;
    }
    if (typeof v !== 'string' || !allowed.includes(v as T)) {
      this.errors.push(`${label} is not a valid option`);
      return undefined;
    }
    this.out[key] = v;
    return v as T;
  }

  pattern(key: string, label: string, re: RegExp) {
    const v = this.raw[key];
    if (v == null || v === '') return undefined;
    if (typeof v !== 'string' || !re.test(v)) {
      this.errors.push(`${label} is not valid`);
      return undefined;
    }
    this.out[key] = v;
    return v;
  }
}

/**
 * Validates and normalises `categoryDetails` for a category (unknown keys are dropped).
 * `strict` = office create path (required answers enforced); carer-app / non-strict only
 * type-checks whatever was supplied.
 */
export function normaliseIncidentCategoryDetails(
  categoryKey: string,
  subtypeKey: string | null | undefined,
  raw: unknown,
  options: { strict: boolean; today?: string },
): Result {
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) {
    return { details: null, errors: ['categoryDetails must be an object'] };
  }
  const r = new Reader((raw ?? {}) as Record<string, unknown>, options.strict);

  switch (categoryKey) {
    case 'MEDICATION':
      r.pattern('medicationId', 'Medication', UUID);
      r.text('medicationName', 'Medication name', { required: true, max: 200 });
      r.text('scheduledDose', 'Scheduled dose', { max: 200 });
      r.pattern('scheduledTime', 'Scheduled time', HM);
      r.text('actualDose', 'Actual dose', { max: 200 });
      r.bool('marEntryAffected', 'MAR entry affected', { required: true });
      break;

    case 'SAFEGUARDING': {
      const ap = ((raw ?? {}) as Record<string, unknown>).allegedPerson;
      if (ap == null) {
        if (options.strict)
          r.errors.push('Alleged person causing harm is required');
        break;
      }
      if (typeof ap !== 'object' || Array.isArray(ap)) {
        r.errors.push('Alleged person is not valid');
        break;
      }
      const inner = new Reader(ap as Record<string, unknown>, options.strict);
      const kind = inner.oneOf('kind', 'Alleged person', ALLEGED_PERSON_KINDS, {
        required: true,
      });
      if (kind === 'STAFF') {
        const id = inner.pattern('employeeId', 'Alleged staff member', UUID);
        if (!id && options.strict)
          inner.errors.push('Select the alleged staff member');
      }
      if (kind === 'OTHER_PERSON') {
        inner.text('name', 'Alleged person name', { required: true, max: 200 });
        inner.text('relationship', 'Relationship', { max: 100 });
      }
      r.errors.push(...inner.errors);
      if (Object.keys(inner.out).length) r.out.allegedPerson = inner.out;
      break;
    }

    case 'SKIN_WOUND': {
      r.oneOf('woundStatus', 'New / existing / deteriorated', WOUND_STATUSES, {
        required: true,
      });
      const grades = PRESSURE_ULCER_GRADES.map((g) => g.key);
      r.oneOf('pressureUlcerGrade', 'Pressure ulcer grade', grades, {
        required: subtypeKey === 'PRESSURE_ULCER',
      });
      break;
    }

    case 'CARE_DELIVERY':
      r.text('reason', 'Reason', { required: true });
      r.text('noMatchingVisitReason', 'Why no visit matches', { max: 1000 });
      break;

    case 'DEATH':
      r.text('confirmedByName', 'Who confirmed / notified the death', {
        required: true,
        max: 200,
      });
      r.text('confirmedByRole', 'Their role', { required: true, max: 100 });
      break;

    case 'INFECTION': {
      r.text('symptoms', 'Symptoms / details', { required: true });
      const day = r.pattern(
        'symptomsStartedOn',
        'Symptoms started on',
        ISO_DAY,
      );
      if (day && options.today && day > options.today) {
        r.errors.push('Symptoms started on cannot be in the future');
        delete r.out.symptomsStartedOn;
      }
      r.text('infectionControlAction', 'PPE / infection-control action', {
        required: true,
      });
      break;
    }

    case 'DATA_BREACH': {
      r.text('informationType', 'Type of information affected', {
        required: true,
        max: 500,
      });
      const n = ((raw ?? {}) as Record<string, unknown>).peopleAffected;
      if (n == null || n === '') {
        if (options.strict)
          r.errors.push('Number of people affected is required');
      } else if (
        typeof n !== 'number' ||
        !Number.isInteger(n) ||
        n < 0 ||
        n > 1_000_000
      ) {
        r.errors.push('Number of people affected must be a whole number');
      } else {
        r.out.peopleAffected = n;
      }
      r.bool('recoveredOrSecured', 'Recovered / secured', { required: true });
      break;
    }

    default:
      // No category-specific questions — ignore anything sent.
      return { details: null, errors: [] };
  }

  return {
    details: Object.keys(r.out).length ? r.out : null,
    errors: r.errors,
  };
}
