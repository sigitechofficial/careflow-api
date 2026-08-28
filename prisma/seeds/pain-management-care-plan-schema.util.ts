import {
  CarePathwayFormFieldType,
  CarePathwayFormType,
  PrismaClient,
} from '@prisma/client';
import type { CarePlanFieldSeed, CarePlanFormSeed } from './care-plan-forms.seed-data';
import {
  PAIN_MANAGEMENT_CARE_PLAN_LEGACY_LABEL_TO_KEY,
  PAIN_MANAGEMENT_CARE_PLAN_NAME,
  PAIN_MANAGEMENT_CARE_PLAN_SEED,
} from './pain-management-care-plan.seed-data';
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
 * Non-destructive Pain Management Care Plan schema alignment.
 *
 * Sections are matched by title (case-insensitively) and fields by `pain_management_` key,
 * so existing UUIDs survive. Fields that predate the Care 2020 merge carry no `fieldKey`;
 * they are adopted once by label so their UUIDs — and any draft or published values keyed
 * `sectionId:fieldId` — are preserved rather than orphaned.
 *
 * Never deletes sections or fields; unrecognised legacy fields are deactivated only.
 * The Pain Management suggestion engine matches fields by key and is unaffected.
 * All other care plans are untouched by this function.
 */
export async function applyPainManagementCarePlanSchema(
  prisma: PrismaClient,
  formVersionId: string,
  seed: CarePlanFormSeed = PAIN_MANAGEMENT_CARE_PLAN_SEED,
): Promise<{ sections: number; fields: number; adopted: number; deactivated: number }> {
  for (const sectionSeed of seed.sections) {
    for (const field of sectionSeed.fields) {
      if (!field.fieldKey) {
        throw new Error(`Pain Management Care Plan field "${field.label}" is missing fieldKey`);
      }
      if (!field.fieldKey.startsWith('pain_management_')) {
        throw new Error(
          `Pain Management Care Plan fieldKey must start with pain_management_: ${field.fieldKey}`,
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
    const mappedKey = PAIN_MANAGEMENT_CARE_PLAN_LEGACY_LABEL_TO_KEY[normalizeLabel(field.label)];
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

/** Align the Pain Management Care Plan on its current published version (safe for existing databases). */
export async function alignPainManagementCarePlanTemplate(prisma: PrismaClient): Promise<{
  formId: string;
  versionId: string;
  stats: Awaited<ReturnType<typeof applyPainManagementCarePlanSchema>>;
}> {
  const form = await prisma.carePathwayForm.findFirst({
    where: {
      name: PAIN_MANAGEMENT_CARE_PLAN_NAME,
      formType: CarePathwayFormType.CARE_PLAN,
      deletedAt: null,
    },
  });
  if (!form?.currentVersionId) {
    throw new Error('Pain Management Care Plan form or current version not found');
  }

  await prisma.carePathwayForm.update({
    where: { id: form.id },
    data: { description: PAIN_MANAGEMENT_CARE_PLAN_SEED.description },
  });

  const stats = await applyPainManagementCarePlanSchema(
    prisma,
    form.currentVersionId,
    PAIN_MANAGEMENT_CARE_PLAN_SEED,
  );
  return { formId: form.id, versionId: form.currentVersionId, stats };
}
