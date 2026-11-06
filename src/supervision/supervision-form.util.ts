import type { Prisma } from '@prisma/client';
import { richTextHasContent } from './supervision-session.util';

/**
 * Sessions are recorded on a Care Pathway staff form. The session keeps a snapshot of the form
 * (sections and fields with their ids) so later edits in Care Pathway never change a record, and
 * answers are keyed `sectionId:fieldId` exactly as the admin CarePathwayFormRenderer keys them.
 */
export type SupervisionFormField = {
  id: string;
  fieldKey: string | null;
  label: string;
  fieldType: string;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  optionsJson: unknown;
  validationJson: Record<string, unknown> | null;
  conditionalLogicJson: Record<string, unknown> | null;
  sortOrder: number;
};

export type SupervisionFormSection = {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  fields: SupervisionFormField[];
};

export type SupervisionFormSnapshot = {
  formId: string;
  name: string;
  description: string | null;
  formType: string;
  formVersionId: string | null;
  /** Care Pathway "last published" when the snapshot was taken (used to refresh unstarted sessions). */
  publishedAt: string | null;
  sections: SupervisionFormSection[];
};

export type SupervisionAnswers = Record<string, string | boolean>;

/** Field types that only show text and take no answer. */
const DISPLAY_ONLY_TYPES = new Set(['SECTION_TEXT']);
/** Field types whose answer is HTML from the rich-text editor. */
const RICH_TEXT_TYPES = new Set(['TEXTAREA', 'RICH_TEXT', 'SUMMERNOTE']);
/** Keeps signature / photo data URLs from turning a session into a multi-megabyte row. */
export const MAX_ANSWER_LENGTH = 1_500_000;

export function answerKey(sectionId: string, fieldId: string): string {
  return `${sectionId}:${fieldId}`;
}

/** Care Pathway form row (as read with its current version) → session snapshot. */
export function snapshotFromForm(form: {
  id: string;
  name: string;
  description: string | null;
  formType: string;
  currentVersionId: string | null;
  lastPublishedAt: Date | null;
  currentVersion: {
    sections: Array<{
      id: string;
      title: string;
      description: string | null;
      sortOrder: number;
      fields: Array<{
        id: string;
        fieldKey: string | null;
        label: string;
        fieldType: string;
        placeholder: string | null;
        helpText: string | null;
        required: boolean;
        optionsJson: Prisma.JsonValue;
        validationJson: Prisma.JsonValue;
        conditionalLogicJson: Prisma.JsonValue;
        sortOrder: number;
      }>;
    }>;
  } | null;
}): SupervisionFormSnapshot {
  const asObject = (v: Prisma.JsonValue) =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  return {
    formId: form.id,
    name: form.name,
    description: form.description,
    formType: form.formType,
    formVersionId: form.currentVersionId,
    publishedAt: form.lastPublishedAt?.toISOString() ?? null,
    sections: (form.currentVersion?.sections ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      sortOrder: s.sortOrder,
      fields: s.fields.map((f) => ({
        id: f.id,
        fieldKey: f.fieldKey,
        label: f.label,
        fieldType: f.fieldType,
        placeholder: f.placeholder,
        helpText: f.helpText,
        required: f.required,
        optionsJson: f.optionsJson ?? null,
        validationJson: asObject(f.validationJson),
        conditionalLogicJson: asObject(f.conditionalLogicJson),
        sortOrder: f.sortOrder,
      })),
    })),
  };
}

export function parseSnapshot(value: Prisma.JsonValue | null | undefined): SupervisionFormSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snap = value as unknown as SupervisionFormSnapshot;
  return Array.isArray(snap.sections) ? snap : null;
}

export function parseAnswers(value: Prisma.JsonValue | null | undefined): SupervisionAnswers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: SupervisionAnswers = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

// ─── Conditional logic (same rules as the admin form-builder-conditional-logic util) ─────────

type ConditionalRule = { sectionId: string; fieldId: string; operator: string; value?: string };

function conditionalRules(raw: unknown): ConditionalRule[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const showWhen = (raw as { showWhen?: unknown }).showWhen;
  if (!Array.isArray(showWhen)) return [];
  return showWhen.filter(
    (r): r is ConditionalRule =>
      Boolean(r) &&
      typeof r === 'object' &&
      typeof (r as ConditionalRule).sectionId === 'string' &&
      typeof (r as ConditionalRule).fieldId === 'string' &&
      typeof (r as ConditionalRule).operator === 'string',
  );
}

/** Same storage as the admin form-builder-field-options util: "a|b", or a JSON array from older saves. */
function multiSelectValues(raw: string | boolean | undefined): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // fall through to the "|" list
    }
  }
  return raw.split('|').map((v) => v.trim()).filter(Boolean);
}

function comparable(raw: string | boolean | undefined): string {
  if (raw === true || raw === 'true') return 'true';
  if (raw === false || raw === 'false') return 'false';
  return String(raw ?? '');
}

function ruleHolds(rule: ConditionalRule, answers: SupervisionAnswers): boolean {
  const raw = answers[answerKey(rule.sectionId, rule.fieldId)];
  switch (rule.operator) {
    case 'is_true':
      return raw === true || raw === 'true';
    case 'is_false':
      return raw === false || raw === 'false' || raw === undefined || raw === '';
    case 'equals':
      return comparable(raw) === (rule.value ?? '');
    case 'not_equals':
      return comparable(raw) !== (rule.value ?? '');
    case 'includes':
      return multiSelectValues(raw).includes(rule.value ?? '');
    default:
      return true;
  }
}

export function isFieldVisible(field: SupervisionFormField, answers: SupervisionAnswers): boolean {
  return conditionalRules(field.conditionalLogicJson).every((rule) => ruleHolds(rule, answers));
}

// ─── Answers ─────────────────────────────────────────────────────────────────────────────────

/** Whether a field has an answer. A Yes/No "No" counts; a required tick box must be ticked. */
export function hasAnswer(field: SupervisionFormField, value: string | boolean | undefined): boolean {
  if (value === undefined) return false;
  if (field.fieldType === 'CHECKBOX') return value === true || value === 'true';
  if (typeof value === 'boolean') return true;
  if (RICH_TEXT_TYPES.has(field.fieldType)) return richTextHasContent(value);
  if (field.fieldType === 'MULTI_SELECT') return multiSelectValues(value).length > 0;
  return value.trim().length > 0;
}

/** Visible questions of the form, in order (display-only text left out). */
export function answerableFields(snapshot: SupervisionFormSnapshot, answers: SupervisionAnswers) {
  const out: Array<{ key: string; section: SupervisionFormSection; field: SupervisionFormField }> = [];
  for (const section of [...snapshot.sections].sort((a, b) => a.sortOrder - b.sortOrder)) {
    for (const field of [...section.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (DISPLAY_ONLY_TYPES.has(field.fieldType) || !isFieldVisible(field, answers)) continue;
      out.push({ key: answerKey(section.id, field.id), section, field });
    }
  }
  return out;
}

export type MissingField = { key: string; section: string; label: string };

/** Required visible questions with no answer yet (blocks the supervisor signature when the setting is on). */
export function missingRequiredFields(
  snapshot: SupervisionFormSnapshot | null,
  answers: SupervisionAnswers,
): MissingField[] {
  if (!snapshot) return [];
  return answerableFields(snapshot, answers)
    .filter(({ key, field }) => field.required && !hasAnswer(field, answers[key]))
    .map(({ key, section, field }) => ({ key, section: section.title, label: field.label }));
}

export function formProgress(snapshot: SupervisionFormSnapshot | null, answers: SupervisionAnswers) {
  if (!snapshot) return { answered: 0, total: 0, required: 0, requiredAnswered: 0 };
  const fields = answerableFields(snapshot, answers);
  const answered = fields.filter(({ key, field }) => hasAnswer(field, answers[key]));
  return {
    answered: answered.length,
    total: fields.length,
    required: fields.filter(({ field }) => field.required).length,
    requiredAnswered: answered.filter(({ field }) => field.required).length,
  };
}

/**
 * Merges a patch of answers into the saved ones. Only keys from the snapshot are accepted; an
 * empty value clears the answer. Returns the unknown keys so the caller can reject the request.
 */
export function mergeAnswers(
  snapshot: SupervisionFormSnapshot,
  saved: SupervisionAnswers,
  patch: Record<string, unknown>,
): { answers: SupervisionAnswers; unknownKeys: string[]; invalidKeys: string[] } {
  const fields = new Map<string, SupervisionFormField>();
  for (const s of snapshot.sections) {
    for (const f of s.fields) {
      if (!DISPLAY_ONLY_TYPES.has(f.fieldType)) fields.set(answerKey(s.id, f.id), f);
    }
  }
  const answers: SupervisionAnswers = { ...saved };
  const unknownKeys: string[] = [];
  const invalidKeys: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const field = fields.get(key);
    if (!field) {
      unknownKeys.push(key);
      continue;
    }
    if (value === null || value === '') {
      delete answers[key];
      continue;
    }
    if (typeof value === 'boolean') {
      answers[key] = value;
      continue;
    }
    if (typeof value !== 'string' || value.length > MAX_ANSWER_LENGTH) {
      invalidKeys.push(key);
      continue;
    }
    if (RICH_TEXT_TYPES.has(field.fieldType) && !richTextHasContent(value)) {
      delete answers[key];
      continue;
    }
    answers[key] = RICH_TEXT_TYPES.has(field.fieldType) ? value.trim() : value;
  }
  return { answers, unknownKeys, invalidKeys };
}
