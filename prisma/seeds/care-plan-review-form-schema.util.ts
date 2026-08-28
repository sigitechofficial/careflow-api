import {
  CarePathwayFormFieldType,
  CarePathwayFormType,
  PrismaClient,
} from '@prisma/client';
import type { CarePlanFieldSeed, CarePlanFormSeed } from './care-plan-forms.seed-data';
import {
  CARE_PLAN_REVIEW_FORM_LEGACY_LABEL_TO_KEY,
  CARE_PLAN_REVIEW_FORM_NAME,
  CARE_PLAN_REVIEW_FORM_SEED,
} from './care-plan-review-form.seed-data';
import { buildCarePlanSchemaJson } from './home-support-plan-schema.util';

function fieldWriteData(sectionId: string, f: CarePlanFieldSeed, sortOrder: number) {
  return {
    sectionId,
    fieldKey: f.fieldKey!,
    label: f.label,
    fieldType: f.fieldType as CarePathwayFormFieldType,
    placeholder: f.placeholder ?? null,
    helpText: f.helpText ?? null,
    required: f.required ?? false,
    optionsJson: f.options?.length ? { options: f.options } : undefined,
    sortOrder,
    isActive: true,
  };
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Non-destructive Care Plan review form Care Plan schema alignment.
 *
 * Sections are matched by title (case-insensitively) and fields by `care_plan_review_` key, so
 * existing UUIDs survive. Fields that predate the Care 2020 merge carry no `fieldKey`; they
 * are adopted once by label so their UUIDs — and the real draft/published values keyed
 * `sectionId:fieldId` — are preserved rather than orphaned.
 *
 * Never deletes sections or fields; unrecognised legacy fields are deactivated only. The
 * existing Care Plan review form AUTO-PREFILL engine matches fields by label and is unaffected. All
 * other care plans are untouched by this function.
 */
export async function applyCarePlanReviewFormSchema(
  prisma: PrismaClient,
  formVersionId: string,
  seed: CarePlanFormSeed = CARE_PLAN_REVIEW_FORM_SEED,
): Promise<{ sections: number; fields: number; adopted: number; deactivated: number }> {
  for (const sectionSeed of seed.sections) {
    for (const field of sectionSeed.fields) {
      if (!field.fieldKey) {
        throw new Error(`Care Plan review form field "${field.label}" is missing fieldKey`);
      }
      if (!field.fieldKey.startsWith('care_plan_review_')) {
        throw new Error(
          `Care Plan review form fieldKey must start with care_plan_review_: ${field.fieldKey}`,
        );
      }
    }
  }

  const approvedFieldKeys = new Set(
    seed.sections.flatMap((s) => s.fields.map((f) => f.fieldKey as string)),
  );

  // Adopt pre-merge fields: stamp the business key onto the existing row so the
  // key-based match below finds it and reuses its UUID.
  const keylessFields = await prisma.carePathwayFormField.findMany({
    where: {
      section: { formVersionId, deletedAt: null },
      deletedAt: null,
      fieldKey: null,
    },
  });

  let adopted = 0;
  for (const field of keylessFields) {
    const mappedKey = CARE_PLAN_REVIEW_FORM_LEGACY_LABEL_TO_KEY[normalizeLabel(field.label)];
    if (!mappedKey) continue;

    const alreadyTaken = await prisma.carePathwayFormField.findFirst({
      where: {
        section: { formVersionId, deletedAt: null },
        deletedAt: null,
        fieldKey: mappedKey,
      },
    });
    if (alreadyTaken) continue;

    await prisma.carePathwayFormField.update({
      where: { id: field.id },
      data: { fieldKey: mappedKey },
    });
    adopted += 1;
  }

  const existingSections = await prisma.carePathwayFormSection.findMany({
    where: { formVersionId, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
  });

  const keptSectionIds = new Set<string>();

  for (let si = 0; si < seed.sections.length; si += 1) {
    const sectionSeed = seed.sections[si];
    const existingSection = existingSections.find(
      (s) => normalizeLabel(s.title) === normalizeLabel(sectionSeed.title),
    );

    const section = existingSection
      ? await prisma.carePathwayFormSection.update({
          where: { id: existingSection.id },
          data: {
            title: sectionSeed.title,
            description: sectionSeed.description ?? null,
            sortOrder: si,
          },
        })
      : await prisma.carePathwayFormSection.create({
          data: {
            formVersionId,
            title: sectionSeed.title,
            description: sectionSeed.description ?? null,
            sortOrder: si,
          },
        });

    keptSectionIds.add(section.id);

    const versionFields = await prisma.carePathwayFormField.findMany({
      where: { section: { formVersionId, deletedAt: null }, deletedAt: null },
    });

    for (let fi = 0; fi < sectionSeed.fields.length; fi += 1) {
      const f = sectionSeed.fields[fi];
      const existing = versionFields.find((row) => row.fieldKey === f.fieldKey);

      if (existing) {
        await prisma.carePathwayFormField.update({
          where: { id: existing.id },
          data: fieldWriteData(section.id, f, fi),
        });
      } else {
        await prisma.carePathwayFormField.create({
          data: fieldWriteData(section.id, f, fi),
        });
      }
    }
  }

  const legacyFields = await prisma.carePathwayFormField.findMany({
    where: {
      section: { formVersionId, deletedAt: null },
      deletedAt: null,
      isActive: true,
      OR: [{ fieldKey: null }, { fieldKey: { notIn: [...approvedFieldKeys] } }],
    },
  });

  let deactivated = 0;
  for (const field of legacyFields) {
    await prisma.carePathwayFormField.update({
      where: { id: field.id },
      data: { isActive: false },
    });
    deactivated += 1;
  }

  for (const section of existingSections) {
    if (!keptSectionIds.has(section.id)) {
      await prisma.carePathwayFormSection.update({
        where: { id: section.id },
        data: { deletedAt: new Date() },
      });
    }
  }

  await prisma.carePathwayFormVersion.update({
    where: { id: formVersionId },
    data: { schemaJson: buildCarePlanSchemaJson(seed) },
  });

  return {
    sections: seed.sections.length,
    fields: approvedFieldKeys.size,
    adopted,
    deactivated,
  };
}

/** Align the Care Plan review form Care Plan on its current published version (safe for existing databases). */
export async function alignCarePlanReviewFormTemplate(prisma: PrismaClient): Promise<{
  formId: string;
  versionId: string;
  stats: Awaited<ReturnType<typeof applyCarePlanReviewFormSchema>>;
}> {
  const form = await prisma.carePathwayForm.findFirst({
    where: {
      name: CARE_PLAN_REVIEW_FORM_NAME,
      formType: CarePathwayFormType.CARE_PLAN,
      deletedAt: null,
    },
  });
  if (!form?.currentVersionId) {
    throw new Error('Care Plan review form or current version not found');
  }

  await prisma.carePathwayForm.update({
    where: { id: form.id },
    data: { description: CARE_PLAN_REVIEW_FORM_SEED.description },
  });

  const stats = await applyCarePlanReviewFormSchema(
    prisma,
    form.currentVersionId,
    CARE_PLAN_REVIEW_FORM_SEED,
  );
  return { formId: form.id, versionId: form.currentVersionId, stats };
}
