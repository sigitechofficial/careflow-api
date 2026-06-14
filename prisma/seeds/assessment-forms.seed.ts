import {
  CarePathwayFormFieldType,
  CarePathwayFormStatus,
  CarePathwayFormType,
  CarePathwayFormVersionStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type { CarePlanFormSeed } from './care-plan-forms.seed-data';
import { carePlanPictureSlug } from './care-plan-forms.seed';
import { resolveGalleryPictureUrl } from './care-pathway-gallery.seed';
import {
  MEDICATION_HOME_CARE_ASSESSMENT_FORM_NAME,
  MEDICATION_HOME_CARE_ASSESSMENT_SEED,
} from './medication-home-care-assessment.seed-data';

const ASSESSMENT_FORM_SEEDS: Record<string, CarePlanFormSeed> = {
  [MEDICATION_HOME_CARE_ASSESSMENT_FORM_NAME]: MEDICATION_HOME_CARE_ASSESSMENT_SEED,
};

function buildSchemaJson(seed: CarePlanFormSeed): Prisma.InputJsonValue {
  return {
    sections: seed.sections.map((s, si) => ({
      title: s.title,
      description: s.description ?? null,
      sortOrder: si,
      fields: s.fields.map((f, fi) => ({
        label: f.label,
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

async function applyFormSchema(
  prisma: PrismaClient,
  formVersionId: string,
  seed: CarePlanFormSeed,
): Promise<void> {
  await prisma.carePathwayFormSection.deleteMany({ where: { formVersionId } });

  for (let si = 0; si < seed.sections.length; si++) {
    const sectionSeed = seed.sections[si];
    const section = await prisma.carePathwayFormSection.create({
      data: {
        formVersionId,
        title: sectionSeed.title,
        description: sectionSeed.description ?? null,
        sortOrder: si,
      },
    });

    if (sectionSeed.fields.length) {
      await prisma.carePathwayFormField.createMany({
        data: sectionSeed.fields.map((f, fi) => ({
          sectionId: section.id,
          label: f.label,
          fieldType: f.fieldType as CarePathwayFormFieldType,
          placeholder: f.placeholder ?? null,
          helpText: f.helpText ?? null,
          required: f.required ?? false,
          optionsJson: f.options?.length ? { options: f.options } : undefined,
          sortOrder: fi,
        })),
      });
    }
  }

  await prisma.carePathwayFormVersion.update({
    where: { id: formVersionId },
    data: { schemaJson: buildSchemaJson(seed) },
  });
}

/** Create or refresh assessment form templates with full Form Builder schemas. */
export async function seedAssessmentForms(prisma: PrismaClient): Promise<void> {
  for (const [formName, seed] of Object.entries(ASSESSMENT_FORM_SEEDS)) {
    const slug = carePlanPictureSlug(formName);
    const pictureUrl = resolveGalleryPictureUrl(slug, formName);

    let form = await prisma.carePathwayForm.findFirst({
      where: { name: formName, formType: CarePathwayFormType.ASSESSMENT, deletedAt: null },
    });

    if (!form) {
      form = await prisma.carePathwayForm.create({
        data: {
          name: formName,
          formType: CarePathwayFormType.ASSESSMENT,
          description: seed.description,
          pictureUrl,
          status: CarePathwayFormStatus.PUBLISHED,
          versionLabel: '1',
          lastPublishedAt: new Date(),
        },
      });
      const version = await prisma.carePathwayFormVersion.create({
        data: {
          formId: form.id,
          versionNumber: 1,
          status: CarePathwayFormVersionStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      });
      await prisma.carePathwayForm.update({
        where: { id: form.id },
        data: { currentVersionId: version.id },
      });
      await applyFormSchema(prisma, version.id, seed);
      continue;
    }

    await prisma.carePathwayForm.update({
      where: { id: form.id },
      data: {
        description: seed.description,
        pictureUrl: form.pictureUrl ?? pictureUrl,
        status: CarePathwayFormStatus.PUBLISHED,
        lastPublishedAt: form.lastPublishedAt ?? new Date(),
      },
    });

    let versionId = form.currentVersionId;
    if (!versionId) {
      const version = await prisma.carePathwayFormVersion.create({
        data: {
          formId: form.id,
          versionNumber: 1,
          status: CarePathwayFormVersionStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      });
      versionId = version.id;
      await prisma.carePathwayForm.update({
        where: { id: form.id },
        data: { currentVersionId: versionId },
      });
    }

    await applyFormSchema(prisma, versionId, seed);
  }
}
