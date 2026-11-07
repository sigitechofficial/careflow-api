import {
  CarePathwayFormFieldType,
  CarePathwayFormStatus,
  CarePathwayFormType,
  CarePathwayFormVersionStatus,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import { DEFAULT_SUPERVISION_FORMS, type SupervisionFormDef } from '../seed-data/supervision-forms';

function schemaJson(def: SupervisionFormDef): Prisma.InputJsonValue {
  return {
    sections: def.sections.map((s, si) => ({
      title: s.title,
      description: s.description ?? null,
      sortOrder: si,
      fields: s.fields.map((f, fi) => ({
        label: f.label,
        fieldKey: f.key,
        fieldType: f.type,
        placeholder: null,
        helpText: f.help ?? null,
        required: f.required ?? false,
        optionsJson: f.options?.length ? { options: f.options } : null,
        sortOrder: fi,
      })),
    })),
  };
}

/**
 * Default supervision / spot check / appraisal forms as published Care Pathway staff forms. Runs on
 * every deploy and only creates a form that has never existed (a form an admin renamed or deleted
 * is not brought back). A new form is set on its review types only when that type has no form yet,
 * so choices made in Settings → Supervision are never overwritten.
 */
export async function seedSupervisionForms(
  prisma: PrismaClient,
): Promise<{ formsCreated: number; reviewTypesLinked: number }> {
  let formsCreated = 0;
  let reviewTypesLinked = 0;
  for (const def of DEFAULT_SUPERVISION_FORMS) {
    const existing = await prisma.carePathwayForm.findFirst({
      where: { name: def.name, formType: CarePathwayFormType.STAFF_FORM },
      select: { id: true },
    });
    if (existing) continue;

    const now = new Date();
    const formId = await prisma.$transaction(async (tx) => {
      const form = await tx.carePathwayForm.create({
        data: {
          name: def.name,
          description: def.description,
          formType: CarePathwayFormType.STAFF_FORM,
          status: CarePathwayFormStatus.PUBLISHED,
          versionLabel: '1',
          lastPublishedAt: now,
        },
      });
      const version = await tx.carePathwayFormVersion.create({
        data: {
          formId: form.id,
          versionNumber: 1,
          status: CarePathwayFormVersionStatus.PUBLISHED,
          publishedAt: now,
          schemaJson: schemaJson(def),
        },
      });
      for (const [si, section] of def.sections.entries()) {
        const row = await tx.carePathwayFormSection.create({
          data: { formVersionId: version.id, title: section.title, description: section.description ?? null, sortOrder: si },
        });
        await tx.carePathwayFormField.createMany({
          data: section.fields.map((f, fi) => ({
            sectionId: row.id,
            fieldKey: f.key,
            label: f.label,
            fieldType: f.type as CarePathwayFormFieldType,
            helpText: f.help ?? null,
            required: f.required ?? false,
            optionsJson: f.options?.length ? { options: f.options } : undefined,
            sortOrder: fi,
          })),
        });
      }
      await tx.carePathwayForm.update({ where: { id: form.id }, data: { currentVersionId: version.id } });
      await tx.carePathwayFormPublishLog.create({
        data: { formId: form.id, formVersionId: version.id, publishedAt: now, notes: 'Default form (seed)' },
      });
      return form.id;
    });
    formsCreated += 1;

    const linked = await prisma.reviewType.updateMany({
      where: { code: { in: def.reviewTypeCodes }, deletedAt: null, supervisionFormId: null },
      data: { supervisionFormId: formId },
    });
    reviewTypesLinked += linked.count;
  }
  return { formsCreated, reviewTypesLinked };
}
