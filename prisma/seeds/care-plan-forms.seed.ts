import {
  CarePathwayFormFieldType,
  CarePathwayFormStatus,
  CarePathwayFormType,
  CarePathwayFormVersionStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import {
  CARE_PLAN_FORM_SEEDS,
  type CarePlanFormSeed,
} from './care-plan-forms.seed-data';
import { writeStandardIconFile } from './care-pathway-icon-svg.util';
import { resolveGalleryPictureUrl } from './care-pathway-gallery.seed';

const CUSTOM_FORM_ICON_PREFIX = '/uploads/care-pathway/forms/';

/** Point all care pathway forms at gallery PNGs (skips custom uploaded form icons). */
export async function refreshCarePathwayFormPictureUrls(prisma: PrismaClient): Promise<number> {
  const forms = await prisma.carePathwayForm.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, formType: true, pictureUrl: true },
  });

  let updated = 0;
  for (const form of forms) {
    if (form.pictureUrl?.startsWith(CUSTOM_FORM_ICON_PREFIX)) continue;

    const slug = carePlanPictureSlug(form.name);
    const pictureUrl = resolveGalleryPictureUrl(slug, form.name);
    if (pictureUrl !== form.pictureUrl) {
      await prisma.carePathwayForm.update({
        where: { id: form.id },
        data: { pictureUrl },
      });
      updated += 1;
    }
  }
  return updated;
}

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

export function carePlanPictureSlug(name: string): string {
  const key = name.toLowerCase();
  if (key.includes('accident') || key.includes('choking') || key.includes('risk assess')) return 'danger';
  if (key.includes('bed rail') || key.includes('bed ')) return 'bed';
  if (key.includes('charity') || key.includes('hoover') || key.includes('clean')) return 'cleaning';
  if (key.includes('change of carer') || key.includes('carer comm')) return 'carer';
  if (key.includes('communication')) return 'communication';
  if (key.includes('capability')) return 'people';
  if (key.includes('continence')) return 'continence';
  if (key.includes('culture') || key.includes('religion') || key.includes('spirituality')) return 'religion';
  if (
    key.includes('dementia') ||
    key.includes('home care') ||
    key.includes('home support') ||
    key.includes('person centred')
  ) {
    return 'care-at-home';
  }
  if (key.includes('eating') || key.includes('drinking')) return 'drinks';
  if (key.includes('falls') || key.includes('mobility')) return 'mobility';
  if (key.includes('final days')) return 'palliative';
  if (key.includes('infection')) return 'infection';
  if (key.includes('medication')) return 'medication';
  if (key.includes('pain')) return 'pain';
  if (key.includes('pressure')) return 'pressure-ulcer';
  if (key.includes('psycholog') || key.includes('cognition') || key.includes('behaviour')) return 'psychology';
  if (key.includes('skin')) return 'health';
  if (key.includes('sleep') || key.includes('night')) return 'bed';
  if (key.includes('social') || key.includes('activities')) return 'activities';
  if (key.includes('washing') || key.includes('dressing')) return 'personal-washing';
  if (key.includes('safety') || key.includes('family')) return 'family-care';
  if (key.includes('physical')) return 'health';
  if (key.includes('communication')) return 'carer';
  if (key.includes('advance') || key.includes('review') || key.includes('risk')) return 'care-plan';
  return 'care-plan';
}

async function applyCarePlanSchema(
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

/** Create or refresh all care plan templates with descriptions and field schemas. */
export async function seedCarePlanForms(prisma: PrismaClient): Promise<void> {
  const planNames = Object.keys(CARE_PLAN_FORM_SEEDS);

  for (const planName of planNames) {
    writeStandardIconFile(carePlanPictureSlug(planName), planName);
  }

  for (const planName of planNames) {
    const seed = CARE_PLAN_FORM_SEEDS[planName];
    const slug = carePlanPictureSlug(planName);
    const pictureUrl = resolveGalleryPictureUrl(slug, planName);

    let form = await prisma.carePathwayForm.findFirst({
      where: { name: planName, formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
    });

    if (!form) {
      form = await prisma.carePathwayForm.create({
        data: {
          name: planName,
          formType: CarePathwayFormType.CARE_PLAN,
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
      await applyCarePlanSchema(prisma, version.id, seed);
      continue;
    }

    await prisma.carePathwayForm.update({
      where: { id: form.id },
      data: {
        description: seed.description,
        pictureUrl,
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

    await applyCarePlanSchema(prisma, versionId, seed);
  }

  const refreshed = await refreshCarePathwayFormPictureUrls(prisma);
  if (refreshed > 0) {
    console.log(`[seed] Updated ${refreshed} care pathway form icon(s) to gallery PNGs.`);
  }
}
