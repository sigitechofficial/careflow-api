import { formatUkDateLabelFromYmd } from '../common/utils/uk-date-label.util';
import { sanitizeComposeTextOrNull } from '../service-user-care-plans/compose/compose-html-sanitize.util';
import { DRAFT_NEXT_REVIEW_DATE_KEY } from '../service-user-care-plans/care-plan-review-schedule';

/** Form section + fields used to render a published care plan for a carer. */
export type CarePlanFormFieldForCarer = {
  id: string;
  sectionId: string;
  fieldKey?: string | null;
  label: string;
  fieldType: string;
  conditionalLogicJson?: unknown;
  sortOrder: number;
};

export type CarePlanFormSectionForCarer = {
  id: string;
  title: string;
  description?: string | null;
  sortOrder: number;
  fields: CarePlanFormFieldForCarer[];
};

export type CarerCarePlanField = {
  id: string;
  label: string;
  value: string;
  fieldType: string;
};

export type CarerCarePlanSection = {
  id: string;
  title: string;
  description: string | null;
  iconType: string;
  iconKey: string;
  fields: CarerCarePlanField[];
  lines: string[];
};

const OFFICE_ONLY_FIELD_TYPES = new Set(['SECTION_TEXT', 'SIGNATURE']);

type ConditionalOperator = 'equals' | 'not_equals' | 'is_true' | 'is_false' | 'includes';

type FieldConditionalRule = {
  sectionId: string;
  fieldId: string;
  operator: ConditionalOperator;
  value?: string;
};

function fieldValueKey(sectionId: string, fieldId: string) {
  return `${sectionId}:${fieldId}`;
}

function valuesRecord(valuesJson: unknown): Record<string, unknown> {
  if (!valuesJson || typeof valuesJson !== 'object' || Array.isArray(valuesJson)) return {};
  return valuesJson as Record<string, unknown>;
}

function parseShowWhen(raw: unknown): FieldConditionalRule[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const showWhen = (raw as { showWhen?: unknown }).showWhen;
  if (!Array.isArray(showWhen)) return [];
  return showWhen.filter((rule): rule is FieldConditionalRule => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
    const r = rule as FieldConditionalRule;
    return (
      typeof r.sectionId === 'string' &&
      typeof r.fieldId === 'string' &&
      typeof r.operator === 'string'
    );
  });
}

function parseMultiSelectParts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      /* fall through */
    }
  }
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeComparable(value: unknown): string {
  if (value === true || value === 'true') return 'true';
  if (value === false || value === 'false') return 'false';
  return String(value ?? '');
}

function lookupRawValue(
  values: Record<string, unknown>,
  field: Pick<CarePlanFormFieldForCarer, 'id' | 'sectionId' | 'fieldKey'>,
): unknown {
  const exactKey = fieldValueKey(field.sectionId, field.id);
  if (Object.prototype.hasOwnProperty.call(values, exactKey)) return values[exactKey];
  if (field.fieldKey && Object.prototype.hasOwnProperty.call(values, field.fieldKey)) {
    return values[field.fieldKey];
  }
  if (Object.prototype.hasOwnProperty.call(values, field.id)) return values[field.id];
  const suffix = `:${field.id}`;
  for (const [key, value] of Object.entries(values)) {
    if (key.endsWith(suffix)) return value;
  }
  return undefined;
}

function isInternalValueKey(key: string): boolean {
  return (
    key.startsWith('__meta.') ||
    key === DRAFT_NEXT_REVIEW_DATE_KEY ||
    key.includes('selectedAssessment')
  );
}

function evaluateRule(rule: FieldConditionalRule, values: Record<string, unknown>): boolean {
  const raw = lookupRawValue(values, {
    id: rule.fieldId,
    sectionId: rule.sectionId,
    fieldKey: null,
  });
  switch (rule.operator) {
    case 'is_true':
      return raw === true || raw === 'true' || raw === 'yes' || raw === 'Yes';
    case 'is_false':
      return raw === false || raw === 'false' || raw === 'no' || raw === 'No' || raw == null || raw === '';
    case 'equals':
      return normalizeComparable(raw) === (rule.value ?? '');
    case 'not_equals':
      return normalizeComparable(raw) !== (rule.value ?? '');
    case 'includes':
      return parseMultiSelectParts(raw).includes(rule.value ?? '');
    default:
      return true;
  }
}

function isFieldVisibleForCarer(
  field: CarePlanFormFieldForCarer,
  values: Record<string, unknown>,
): boolean {
  const rules = parseShowWhen(field.conditionalLogicJson);
  if (!rules.length) return true;
  return rules.every((rule) => evaluateRule(rule, values));
}

function looksLikeIsoDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(text);
}

function formatAttachmentLabel(fieldType: string, text: string): string | null {
  if (fieldType === 'PHOTO') return 'Photo attached';
  if (fieldType === 'FILE_UPLOAD') return 'File attached';
  return text;
}

/** Carer-readable answer. Empty / office-only markup returns null so the field is omitted. */
export function formatCarePlanValueForCarer(raw: unknown, fieldType?: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (raw === true || raw === 'true' || raw === 'yes' || raw === 'Yes') return 'Yes';
  if (raw === false || raw === 'false' || raw === 'no' || raw === 'No') return 'No';
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);

  if (Array.isArray(raw)) {
    if (fieldType && fieldType !== 'MULTI_SELECT') return null;
    const parts = parseMultiSelectParts(raw);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof raw === 'string' && raw.trim().startsWith('[') && fieldType === 'MULTI_SELECT') {
    const parts = parseMultiSelectParts(raw);
    return parts.length ? parts.join(', ') : null;
  }

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const url =
      (typeof obj.url === 'string' && obj.url.trim()) ||
      (typeof obj.uri === 'string' && obj.uri.trim()) ||
      (typeof obj.fileUrl === 'string' && obj.fileUrl.trim()) ||
      null;
    if (url) return formatAttachmentLabel(fieldType ?? 'FILE_UPLOAD', url);
    return null;
  }

  if (typeof raw !== 'string') return null;
  const text = sanitizeComposeTextOrNull(raw);
  if (!text) return null;

  const type = (fieldType ?? '').toUpperCase();
  if (type === 'DATE' || looksLikeIsoDate(text)) {
    return formatUkDateLabelFromYmd(text.slice(0, 10)) ?? text;
  }
  if (type === 'PHOTO' || type === 'FILE_UPLOAD') {
    return formatAttachmentLabel(type, text);
  }
  return text;
}

export function iconForCarePlanSection(title: string): string {
  const t = title.toLowerCase();
  if (/med|pill|insulin|emar/.test(t)) return 'pill';
  if (/hydrat|nutrition|eat|drink|fluid/.test(t)) return 'droplet';
  if (/skin|pressure|ulcer|wound/.test(t)) return 'activity';
  if (/memory|dement|cognit|psych|behav/.test(t)) return 'brain';
  if (/wash|dress|hygiene|personal care|continence/.test(t)) return 'person';
  if (/mobility|fall|moving|pain/.test(t)) return 'activity';
  if (/risk|safety/.test(t)) return 'warning';
  return 'person';
}

function toSection(partial: {
  id: string;
  title: string;
  description?: string | null;
  fields: CarerCarePlanField[];
}): CarerCarePlanSection {
  const icon = iconForCarePlanSection(partial.title);
  const description = partial.description?.trim() || null;
  return {
    id: partial.id,
    title: partial.title,
    description,
    iconType: icon,
    iconKey: icon,
    fields: partial.fields,
    lines: partial.fields.map((field) =>
      field.label ? `${field.label}: ${field.value}` : field.value,
    ),
  };
}

function mapFromFormSchema(
  sections: CarePlanFormSectionForCarer[],
  values: Record<string, unknown>,
): CarerCarePlanSection[] {
  const ordered = [...sections].sort((a, b) => a.sortOrder - b.sortOrder);
  const out: CarerCarePlanSection[] = [];

  for (const section of ordered) {
    const fields: CarerCarePlanField[] = [];
    const orderedFields = [...section.fields].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const field of orderedFields) {
      if (OFFICE_ONLY_FIELD_TYPES.has(field.fieldType)) continue;
      if (field.fieldKey === DRAFT_NEXT_REVIEW_DATE_KEY) continue;
      if (!isFieldVisibleForCarer(field, values)) continue;

      const raw = lookupRawValue(values, field);
      const value = formatCarePlanValueForCarer(raw, field.fieldType);
      const label = field.label.trim();
      if (!value || !label) continue;

      fields.push({
        id: field.id,
        label,
        value,
        fieldType: field.fieldType,
      });
    }
    if (!fields.length) continue;
    out.push(
      toSection({
        id: section.id,
        title: section.title.trim() || 'Care plan',
        description: section.description,
        fields,
      }),
    );
  }

  return out;
}

function mapFromLegacySectionsArray(
  sections: unknown[],
  fallbackTitle: string,
): CarerCarePlanSection[] {
  return sections
    .map((raw, idx) => {
      const section = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const title = String(section.title ?? section.label ?? fallbackTitle ?? `Section ${idx + 1}`);
      const fields: CarerCarePlanField[] = [];

      const push = (label: string, value: unknown, fieldType = 'TEXT') => {
        const formatted = formatCarePlanValueForCarer(value, fieldType);
        if (!formatted) return;
        fields.push({
          id: `${idx}-${fields.length}`,
          label: /^details?$/i.test(label) ? '' : label,
          value: formatted,
          fieldType,
        });
      };

      if (section.goal != null) push('Goal', section.goal);
      const prefs =
        typeof section.preferences === 'string'
          ? section.preferences
          : typeof section.howILikeMyCare === 'string'
            ? section.howILikeMyCare
            : null;
      if (prefs) push('How I like my care', prefs);
      if (Array.isArray(section.tasks)) {
        for (const task of section.tasks) push('Support', task);
      }
      if (Array.isArray(section.body)) {
        for (const line of section.body) push('', line);
      }
      if (Array.isArray(section.lines)) {
        for (const line of section.lines) push('', line);
      }
      if (Array.isArray(section.fields)) {
        for (const item of section.fields) {
          if (!item || typeof item !== 'object') continue;
          const field = item as Record<string, unknown>;
          push(String(field.label ?? ''), field.value, String(field.fieldType ?? 'TEXT'));
        }
      }

      return toSection({
        id: String(section.id ?? `section-${idx}`),
        title,
        description: typeof section.description === 'string' ? section.description : null,
        fields,
      });
    })
    .filter((section) => section.fields.length > 0);
}

function findFormField(
  sections: CarePlanFormSectionForCarer[],
  valueKey: string,
): { section: CarePlanFormSectionForCarer; field: CarePlanFormFieldForCarer } | null {
  const fieldId = valueKey.includes(':') ? valueKey.slice(valueKey.lastIndexOf(':') + 1) : valueKey;
  for (const section of sections) {
    for (const field of section.fields) {
      if (
        fieldValueKey(field.sectionId, field.id) === valueKey ||
        field.id === fieldId ||
        field.fieldKey === valueKey
      ) {
        return { section, field };
      }
    }
  }
  return null;
}

function mapFromFlatValues(
  values: Record<string, unknown>,
  fallbackTitle: string,
  formSections?: CarePlanFormSectionForCarer[] | null,
): CarerCarePlanSection[] {
  if (formSections?.length) {
    const bySection = new Map<string, { section: CarePlanFormSectionForCarer; fields: CarerCarePlanField[] }>();
    for (const [key, raw] of Object.entries(values)) {
      if (isInternalValueKey(key)) continue;
      const match = findFormField(formSections, key);
      if (!match) continue;
      if (OFFICE_ONLY_FIELD_TYPES.has(match.field.fieldType)) continue;
      if (!isFieldVisibleForCarer(match.field, values)) continue;
      const value = formatCarePlanValueForCarer(raw, match.field.fieldType);
      const label = match.field.label.trim();
      if (!value || !label) continue;
      const bucket = bySection.get(match.section.id) ?? { section: match.section, fields: [] };
      bucket.fields.push({
        id: match.field.id,
        label,
        value,
        fieldType: match.field.fieldType,
      });
      bySection.set(match.section.id, bucket);
    }
    const mapped = [...formSections]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .flatMap((section) => {
        const bucket = bySection.get(section.id);
        return bucket?.fields.length
          ? [
              toSection({
                id: section.id,
                title: section.title.trim() || fallbackTitle,
                description: section.description,
                fields: bucket.fields,
              }),
            ]
          : [];
      });
    if (mapped.length) return mapped;
  }

  const fields: CarerCarePlanField[] = [];
  for (const [key, raw] of Object.entries(values)) {
    if (isInternalValueKey(key)) continue;
    const value = formatCarePlanValueForCarer(raw);
    if (!value) continue;
    fields.push({
      id: key,
      label: '',
      value,
      fieldType: typeof raw === 'boolean' ? 'YES_NO' : 'TEXT',
    });
  }
  if (!fields.length) return [];
  return [
    toSection({
      id: 'overview',
      title: fallbackTitle || 'Care plan',
      fields,
    }),
  ];
}

/**
 * Published care-plan JSON → labelled sections a carer can read.
 * Prefers the live form schema (question labels + Yes/No + follow-ups). No field cap.
 */
export function mapPublishedCarePlanForCarer(opts: {
  valuesJson: unknown;
  formName: string;
  formSections?: CarePlanFormSectionForCarer[] | null;
}): CarerCarePlanSection[] {
  const formName = opts.formName?.trim() || 'Care plan';
  const values = valuesRecord(opts.valuesJson);

  if (opts.formSections && opts.formSections.length > 0) {
    const mapped = mapFromFormSchema(opts.formSections, values);
    if (mapped.length) return mapped;
  }

  if (Array.isArray(values.sections)) {
    const mapped = mapFromLegacySectionsArray(values.sections, formName);
    if (mapped.length) return mapped;
  }

  return mapFromFlatValues(values, formName, opts.formSections);
}
