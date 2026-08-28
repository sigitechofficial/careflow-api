import {
  CarePathwayFormFieldType,
  CarePathwayFormType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type { CarePlanFieldSeed, CarePlanFormSeed } from './care-plan-forms.seed-data';
import {
  HOME_SUPPORT_PLAN_NAME,
  HOME_SUPPORT_PLAN_SEED,
} from './home-support-plan.seed-data';

export function buildCarePlanSchemaJson(seed: CarePlanFormSeed): Prisma.InputJsonValue {
  return {
    sections: seed.sections.map((s, si) => ({
      title: s.title,
      description: s.description ?? null,
      sortOrder: si,
      fields: s.fields.map((f, fi) => ({
        label: f.label,
        fieldKey: f.fieldKey ?? null,
        fieldType: f.fieldType,
        placeholder: f.placeholder ?? null,
        helpText: f.helpText ?? null,
        required: f.required ?? false,
        optionsJson: f.options?.length ? { options: f.options } : null,
        sortOrder: fi,
      })),
    })),
  };
}

function fieldCreateData(sectionId: string, f: CarePlanFieldSeed, sortOrder: number) {
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

/**
 * Non-destructive Home Support Plan schema alignment.
 * Upserts sections/fields by title + fieldKey; deactivates legacy fields (no hsp_* key).
 * Does NOT delete sections or fields — preserves UUIDs where keys match.
 */
export async function applyHomeSupportPlanSchema(
  prisma: PrismaClient,
  formVersionId: string,
  seed: CarePlanFormSeed = HOME_SUPPORT_PLAN_SEED,
): Promise<{ sections: number; fields: number; deactivated: number }> {
  const approvedFieldKeys = new Set(
    seed.sections.flatMap((s) => s.fields.map((f) => f.fieldKey).filter(Boolean) as string[]),
  );

  for (const sectionSeed of seed.sections) {
    for (const field of sectionSeed.fields) {
      if (!field.fieldKey) {
        throw new Error(`Home Support Plan field "${field.label}" is missing fieldKey`);
      }
      if (!field.fieldKey.startsWith('hsp_')) {
        throw new Error(`Home Support Plan fieldKey must start with hsp_: ${field.fieldKey}`);
      }
    }
  }

  const existingSections = await prisma.carePathwayFormSection.findMany({
    where: { formVersionId, deletedAt: null },
    include: {
      fields: { where: { deletedAt: null } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  const keptSectionIds = new Set<string>();

  for (let si = 0; si < seed.sections.length; si++) {
    const sectionSeed = seed.sections[si];
    let section = existingSections.find((s) => s.title === sectionSeed.title);

    if (!section) {
      section = await prisma.carePathwayFormSection.create({
        data: {
          formVersionId,
          title: sectionSeed.title,
          description: sectionSeed.description ?? null,
          sortOrder: si,
        },
        include: { fields: true },
      });
    } else {
      await prisma.carePathwayFormSection.update({
        where: { id: section.id },
        data: {
          title: sectionSeed.title,
          description: sectionSeed.description ?? null,
          sortOrder: si,
        },
      });
    }
    keptSectionIds.add(section.id);

    const versionFields = await prisma.carePathwayFormField.findMany({
      where: {
        section: { formVersionId, deletedAt: null },
        deletedAt: null,
      },
    });

    for (let fi = 0; fi < sectionSeed.fields.length; fi++) {
      const f = sectionSeed.fields[fi];
      const existing = versionFields.find((row) => row.fieldKey === f.fieldKey);

      if (existing) {
        await prisma.carePathwayFormField.update({
          where: { id: existing.id },
          data: fieldCreateData(section.id, f, fi),
        });
      } else {
        await prisma.carePathwayFormField.create({
          data: fieldCreateData(section.id, f, fi),
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
    deactivated,
  };
}

/** Align Home Support Plan on the current published form version (safe for existing DBs). */
export async function alignHomeSupportPlanTemplate(prisma: PrismaClient): Promise<{
  formId: string;
  versionId: string;
  stats: Awaited<ReturnType<typeof applyHomeSupportPlanSchema>>;
}> {
  const form = await prisma.carePathwayForm.findFirst({
    where: { name: HOME_SUPPORT_PLAN_NAME, formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
  });
  if (!form?.currentVersionId) {
    throw new Error(`Home Support Plan form or current version not found`);
  }

  await prisma.carePathwayForm.update({
    where: { id: form.id },
    data: { description: HOME_SUPPORT_PLAN_SEED.description },
  });

  const stats = await applyHomeSupportPlanSchema(prisma, form.currentVersionId, HOME_SUPPORT_PLAN_SEED);
  return { formId: form.id, versionId: form.currentVersionId, stats };
}
