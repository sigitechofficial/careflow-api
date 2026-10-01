/**
 * Targeted, idempotent patch: Medication care plan → "Medication support level" SELECT options.
 *
 * Adds 'Assisted by carer' and 'Provided by others (family / nurse)' so every IA §9.2 level
 * maps 1:1 (see mapMedicationSupportLevelToCarePlan). Touches ONLY the
 * `medication_support_level` field of the Medication CARE_PLAN form:
 *   - CarePathwayFormField.optionsJson (every non-deleted version of that form)
 *   - the matching field entry inside CarePathwayFormVersion.schemaJson
 * Nothing else is written: no other fields, sections, forms, instances, drafts or
 * published care plan values. Any option already present that is not in the canonical list
 * is kept (appended) so no saved answer becomes invalid.
 *
 * Safe to re-run (no-op once applied). Dry run by default:
 *   npx ts-node --transpile-only prisma/scripts/patch-medication-support-level-options.ts
 *   npx ts-node --transpile-only prisma/scripts/patch-medication-support-level-options.ts --apply
 */
import { CarePathwayFormType, Prisma, PrismaClient } from '@prisma/client';
import {
  MEDICATION_CARE_PLAN_NAME,
  MEDICATION_SUPPORT_LEVEL_OPTIONS,
} from '../seeds/medication-care-plan.seed-data';

const FIELD_KEY = 'medication_support_level';
const APPLY = process.argv.includes('--apply');

const prisma = new PrismaClient();

function readOptions(optionsJson: unknown): string[] {
  if (!optionsJson || typeof optionsJson !== 'object' || Array.isArray(optionsJson)) return [];
  const options = (optionsJson as { options?: unknown }).options;
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string') : [];
}

/** Canonical order first, then any extra existing options (never drop a saved value). */
function mergedOptions(existing: string[]): string[] {
  const extras = existing.filter((o) => !MEDICATION_SUPPORT_LEVEL_OPTIONS.includes(o));
  return [...MEDICATION_SUPPORT_LEVEL_OPTIONS, ...extras];
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Returns a patched copy of schemaJson, or null when nothing needs to change. */
function patchSchemaJson(schemaJson: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!schemaJson || typeof schemaJson !== 'object' || Array.isArray(schemaJson)) return null;
  const clone = JSON.parse(JSON.stringify(schemaJson)) as {
    sections?: Array<{ fields?: Array<Record<string, unknown>> }>;
  };
  let changed = false;
  for (const section of clone.sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.fieldKey !== FIELD_KEY) continue;
      const current = readOptions(field.optionsJson);
      const next = mergedOptions(current);
      if (!sameList(current, next)) {
        field.optionsJson = { ...((field.optionsJson as object) ?? {}), options: next };
        changed = true;
      }
    }
  }
  return changed ? (clone as Prisma.JsonValue) : null;
}

async function main() {
  console.log(`[patch-medication-support-level-options] mode=${APPLY ? 'APPLY' : 'DRY RUN'}`);
  const forms = await prisma.carePathwayForm.findMany({
    where: { name: MEDICATION_CARE_PLAN_NAME, formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
    select: { id: true, name: true, currentVersionId: true },
  });
  if (forms.length === 0) {
    console.log('No Medication care plan form found — nothing to do.');
    return;
  }

  let fieldUpdates = 0;
  let schemaUpdates = 0;

  for (const form of forms) {
    const versions = await prisma.carePathwayFormVersion.findMany({
      where: { formId: form.id },
      select: { id: true, versionNumber: true, schemaJson: true },
      orderBy: { versionNumber: 'asc' },
    });

    for (const version of versions) {
      const fields = await prisma.carePathwayFormField.findMany({
        where: {
          fieldKey: FIELD_KEY,
          deletedAt: null,
          section: { formVersionId: version.id, deletedAt: null },
        },
        select: { id: true, optionsJson: true },
      });

      for (const field of fields) {
        const current = readOptions(field.optionsJson);
        const next = mergedOptions(current);
        if (sameList(current, next)) {
          console.log(`  form=${form.id} v${version.versionNumber} field=${field.id}: already up to date`);
          continue;
        }
        console.log(
          `  form=${form.id} v${version.versionNumber} field=${field.id}: ${JSON.stringify(current)} -> ${JSON.stringify(next)}`,
        );
        if (APPLY) {
          const base =
            field.optionsJson && typeof field.optionsJson === 'object' && !Array.isArray(field.optionsJson)
              ? (field.optionsJson as Prisma.JsonObject)
              : {};
          await prisma.carePathwayFormField.update({
            where: { id: field.id },
            data: { optionsJson: { ...base, options: next } },
          });
        }
        fieldUpdates += 1;
      }

      const patchedSchema = patchSchemaJson(version.schemaJson);
      if (patchedSchema) {
        console.log(`  form=${form.id} v${version.versionNumber}: schemaJson ${FIELD_KEY} options updated`);
        if (APPLY) {
          await prisma.carePathwayFormVersion.update({
            where: { id: version.id },
            data: { schemaJson: patchedSchema as Prisma.InputJsonValue },
          });
        }
        schemaUpdates += 1;
      } else {
        console.log(`  form=${form.id} v${version.versionNumber}: schemaJson already up to date (or field absent)`);
      }
    }
  }

  console.log(
    `[patch-medication-support-level-options] ${APPLY ? 'updated' : 'would update'} fields=${fieldUpdates} schemaJson=${schemaUpdates}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
