import { BadRequestException } from '@nestjs/common';
import type { CarePathwayFormFieldType } from '@prisma/client';
import { randomUUID } from 'crypto';
import type {
  ConditionalOperator,
  SaveCareFormFieldDto,
  SaveCareFormSchemaDto,
} from './dto/save-care-form-schema.dto';

/**
 * ID-safe planning for `FormBuilderService.saveSchema`.
 *
 * Saved answers (care plan instances, supervision drafts, the admin renderer) are keyed
 * `${sectionId}:${fieldId}` and show-when rules point at `sectionId`/`fieldId`, so a save
 * must never re-mint ids for rows that still exist. This module turns the builder payload
 * into an explicit plan — which rows to create, update, or soft-retire — the same way the
 * care-plan seed appliers do (sections: `deletedAt`; fields: `isActive: false`, row kept).
 *
 * It is pure (no Prisma) so the rules can be unit tested; all client errors surface as
 * `BadRequestException` before anything is written.
 */

export type ExistingSectionRow = {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
};

export type ExistingFieldRow = {
  id: string;
  sectionId: string;
  fieldKey: string | null;
  label: string;
  fieldType: CarePathwayFormFieldType;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  optionsJson: unknown;
  validationJson: unknown;
  conditionalLogicJson: unknown;
  sortOrder: number;
};

export type StoredConditionalRule = {
  sectionId: string;
  fieldId: string;
  operator: ConditionalOperator;
  value?: string;
};

export type StoredConditionalLogic = { showWhen: StoredConditionalRule[] };

export type PlannedSectionData = {
  title: string;
  description: string | null;
  sortOrder: number;
};

export type PlannedFieldData = {
  sectionId: string;
  fieldKey: string | null;
  label: string;
  fieldType: CarePathwayFormFieldType;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  optionsJson: unknown;
  validationJson: Record<string, unknown> | null;
  conditionalLogicJson: StoredConditionalLogic | null;
  sortOrder: number;
};

export type PlannedSection = {
  id: string;
  isNew: boolean;
  /** False when an existing row already matches — no write needed. */
  changed: boolean;
  data: PlannedSectionData;
};

export type PlannedField = {
  id: string;
  isNew: boolean;
  changed: boolean;
  data: PlannedFieldData;
};

export type SchemaSavePlan = {
  sections: PlannedSection[];
  fields: PlannedField[];
  retiredSectionIds: string[];
  retiredFieldIds: string[];
};

export function normalizeFieldKey(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** JSON.stringify with sorted object keys — jsonb does not preserve key order. */
function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

function sameRow<T extends Record<string, unknown>>(
  next: T,
  existing: Record<string, unknown>,
) {
  return Object.keys(next).every(
    (key) => stableJson(next[key]) === stableJson(existing[key]),
  );
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Reads rules already stored on a row (seed appliers write the same shape). */
function storedRules(raw: unknown): StoredConditionalRule[] {
  const showWhen = asPlainObject(raw)?.showWhen;
  if (!Array.isArray(showWhen)) return [];
  return showWhen.filter((rule): rule is StoredConditionalRule => {
    const r = asPlainObject(rule);
    return (
      !!r &&
      typeof r.sectionId === 'string' &&
      typeof r.fieldId === 'string' &&
      typeof r.operator === 'string'
    );
  });
}

function describeField(
  field: Pick<SaveCareFormFieldDto, 'label'>,
  sectionTitle: string,
) {
  return `"${field.label.trim() || 'Untitled field'}" in section "${sectionTitle.trim()}"`;
}

const STALE_EDITOR_HINT =
  'Reload the form to pick up the latest version, then try again.';

export function planSchemaSave(
  existing: { sections: ExistingSectionRow[]; fields: ExistingFieldRow[] },
  dto: SaveCareFormSchemaDto,
  newId: () => string = randomUUID,
): SchemaSavePlan {
  const existingSections = new Map(existing.sections.map((s) => [s.id, s]));
  const existingFields = new Map(existing.fields.map((f) => [f.id, f]));

  // ── Pass 1: give every payload row its real id and index how rules can name it.
  const sectionIds = new Set<string>();
  /** Field ref (existing id or new-row clientId) → resolved ids. Refs are unique per save. */
  const ruleTargets = new Map<string, { sectionId: string; fieldId: string }>();

  const resolvedSections = dto.sections.map((section) => {
    if (section.id) {
      if (!existingSections.has(section.id)) {
        throw new BadRequestException(
          `Section "${section.title.trim()}" no longer exists on this form. ${STALE_EDITOR_HINT}`,
        );
      }
      if (sectionIds.has(section.id)) {
        throw new BadRequestException(
          `Section "${section.title.trim()}" appears twice in the form.`,
        );
      }
      sectionIds.add(section.id);
    }
    const id = section.id ?? newId();

    const fields = section.fields.map((field) => {
      if (field.id && field.clientId) {
        throw new BadRequestException(
          `Field ${describeField(field, section.title)} sends both id and clientId; send id for existing fields and clientId for new ones.`,
        );
      }
      if (field.id && !existingFields.has(field.id)) {
        throw new BadRequestException(
          `Field ${describeField(field, section.title)} no longer exists on this form. ${STALE_EDITOR_HINT}`,
        );
      }
      if (field.clientId && existingFields.has(field.clientId)) {
        // A clientId that spells an existing row's id would make rules ambiguous.
        throw new BadRequestException(
          `Field ${describeField(field, section.title)} has a clientId that matches an existing field id; send it as id instead.`,
        );
      }
      const fieldId = field.id ?? newId();
      const ref = field.id ?? field.clientId;
      if (ref) {
        if (ruleTargets.has(ref)) {
          throw new BadRequestException(
            `Field ${describeField(field, section.title)} appears twice in the form.`,
          );
        }
        ruleTargets.set(ref, { sectionId: id, fieldId });
      }
      return { dto: field, id: fieldId };
    });

    return { dto: section, id, fields };
  });

  // ── Pass 2: build row data, resolving show-when rules against the saved form.
  const resolveLogic = (
    raw: {
      showWhen: {
        sectionId: string;
        fieldId: string;
        operator: string;
        value?: string;
      }[];
    },
    owner: { id: string; label: string; sectionTitle: string },
  ): StoredConditionalLogic | null => {
    if (!raw.showWhen.length) return null;
    const showWhen = raw.showWhen.map((rule) => {
      // Resolve by field: its section is taken from where the field lives after this save,
      // so the rule always matches the `${sectionId}:${fieldId}` answer key.
      const target = ruleTargets.get(rule.fieldId);
      if (!target) {
        throw new BadRequestException(
          `Field ${describeField({ label: owner.label }, owner.sectionTitle)} has a "show when" condition on a field that is not on this form (it may have been removed). Update or remove the condition and save again.`,
        );
      }
      if (target.fieldId === owner.id) {
        throw new BadRequestException(
          `Field ${describeField({ label: owner.label }, owner.sectionTitle)} cannot have a "show when" condition on itself.`,
        );
      }
      const stored: StoredConditionalRule = {
        sectionId: target.sectionId,
        fieldId: target.fieldId,
        operator: rule.operator as ConditionalOperator,
      };
      if (rule.value !== undefined) stored.value = rule.value;
      return stored;
    });
    return { showWhen };
  };

  const sections: PlannedSection[] = [];
  const fields: PlannedField[] = [];

  for (const section of resolvedSections) {
    const data: PlannedSectionData = {
      title: section.dto.title.trim(),
      description: section.dto.description?.trim() || null,
      sortOrder: section.dto.sortOrder,
    };
    const before = existingSections.get(section.id);
    sections.push({
      id: section.id,
      isNew: !before,
      changed: !before || !sameRow(data, before),
      data,
    });

    for (const field of section.fields) {
      const dto = field.dto;
      const prior = existingFields.get(field.id);
      const owner = {
        id: field.id,
        label: dto.label,
        sectionTitle: section.dto.title,
      };

      // conditionalLogicJson / validationJson: omitted = keep what is stored (seed
      // appliers write these too), null = clear. Kept rules are re-checked so a save
      // can never leave a rule pointing at a removed field.
      let conditionalLogicJson: StoredConditionalLogic | null;
      if (dto.conditionalLogicJson === undefined) {
        const kept = prior ? storedRules(prior.conditionalLogicJson) : [];
        conditionalLogicJson = kept.length
          ? resolveLogic({ showWhen: kept }, owner)
          : null;
      } else if (dto.conditionalLogicJson === null) {
        conditionalLogicJson = null;
      } else {
        conditionalLogicJson = resolveLogic(dto.conditionalLogicJson, owner);
      }

      const validationJson =
        dto.validationJson === undefined
          ? asPlainObject(prior?.validationJson)
          : dto.validationJson === null
            ? null
            : { ...dto.validationJson };

      const data: PlannedFieldData = {
        sectionId: section.id,
        fieldKey: normalizeFieldKey(dto.fieldKey),
        label: dto.label.trim(),
        fieldType: dto.fieldType,
        placeholder: dto.placeholder?.trim() || null,
        helpText: dto.helpText?.trim() || null,
        required: dto.required ?? false,
        optionsJson: dto.optionsJson ?? null,
        validationJson,
        conditionalLogicJson,
        sortOrder: dto.sortOrder,
      };
      fields.push({
        id: field.id,
        isNew: !prior,
        changed: !prior || !sameRow(data, prior),
        data,
      });
    }
  }

  const keptSectionIds = new Set(sections.map((s) => s.id));
  const keptFieldIds = new Set(fields.map((f) => f.id));

  return {
    sections,
    fields,
    retiredSectionIds: existing.sections
      .filter((s) => !keptSectionIds.has(s.id))
      .map((s) => s.id),
    retiredFieldIds: existing.fields
      .filter((f) => !keptFieldIds.has(f.id))
      .map((f) => f.id),
  };
}

/** Version `schemaJson` snapshot — now carries ids so it can be matched back to rows. */
export function buildSchemaJsonFromPlan(plan: SchemaSavePlan) {
  return {
    sections: plan.sections.map((section) => ({
      id: section.id,
      ...section.data,
      fields: plan.fields
        .filter((field) => field.data.sectionId === section.id)
        .map((field) => ({ id: field.id, ...field.data })),
    })),
  };
}
