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
import {
  applyHomeSupportPlanSchema,
  buildCarePlanSchemaJson,
} from './home-support-plan-schema.util';
import { HOME_SUPPORT_PLAN_NAME } from './home-support-plan.seed-data';
import { applyHomeCarePlanSchema } from './home-care-plan-schema.util';
import { applyAdvanceCarePlanSchema } from './advance-care-plan-schema.util';
import { ADVANCE_CARE_PLAN_NAME } from './advance-care-plan.seed-data';
import { applyCognitionBehaviourCarePlanSchema } from './cognition-behaviour-care-plan-schema.util';
import { COGNITION_BEHAVIOUR_CARE_PLAN_NAME } from './cognition-behaviour-care-plan.seed-data';
import { applyCultureReligionCarePlanSchema } from './culture-religion-care-plan-schema.util';
import { CULTURE_RELIGION_CARE_PLAN_NAME } from './culture-religion-care-plan.seed-data';
import { applyFallsCarePlanSchema } from './falls-care-plan-schema.util';
import { FALLS_CARE_PLAN_NAME } from './falls-care-plan.seed-data';
import { applyFinalDaysCarePlanSchema } from './final-days-care-plan-schema.util';
import { FINAL_DAYS_CARE_PLAN_NAME } from './final-days-care-plan.seed-data';
import { applyInfectionCarePlanSchema } from './infection-care-plan-schema.util';
import { INFECTION_CARE_PLAN_NAME } from './infection-care-plan.seed-data';
import { applyMedicationCarePlanSchema } from './medication-care-plan-schema.util';
import { MEDICATION_CARE_PLAN_NAME } from './medication-care-plan.seed-data';
import { applyMobilityCarePlanSchema } from './mobility-care-plan-schema.util';
import { MOBILITY_CARE_PLAN_NAME } from './mobility-care-plan.seed-data';
import { applyPainManagementCarePlanSchema } from './pain-management-care-plan-schema.util';
import { PAIN_MANAGEMENT_CARE_PLAN_NAME } from './pain-management-care-plan.seed-data';
import { applySkinIntegrityCarePlanSchema } from './skin-integrity-care-plan-schema.util';
import { SKIN_INTEGRITY_CARE_PLAN_NAME } from './skin-integrity-care-plan.seed-data';
import { applyPsychologicalCarePlanSchema } from './psychological-care-plan-schema.util';
import { PSYCHOLOGICAL_CARE_PLAN_NAME } from './psychological-care-plan.seed-data';
import { applyCommunicationCarePlanSchema } from './communication-care-plan-schema.util';
import { COMMUNICATION_CARE_PLAN_NAME } from './communication-care-plan.seed-data';
import { applyContinenceCarePlanSchema } from './continence-care-plan-schema.util';
import { CONTINENCE_CARE_PLAN_NAME } from './continence-care-plan.seed-data';
import { applyEatingAndDrinkingCarePlanSchema } from './eating-and-drinking-care-plan-schema.util';
import { EATING_AND_DRINKING_CARE_PLAN_NAME } from './eating-and-drinking-care-plan.seed-data';
import { applyPhysicalHealthCarePlanSchema } from './physical-health-care-plan-schema.util';
import { PHYSICAL_HEALTH_CARE_PLAN_NAME } from './physical-health-care-plan.seed-data';
import { applyPersonalSafetyCarePlanSchema } from './personal-safety-care-plan-schema.util';
import { PERSONAL_SAFETY_CARE_PLAN_NAME } from './personal-safety-care-plan.seed-data';
import { applyCarePlanReviewFormSchema } from './care-plan-review-form-schema.util';
import { CARE_PLAN_REVIEW_FORM_NAME } from './care-plan-review-form.seed-data';
import { applyDementiaCarePlanSchema } from './dementia-care-plan-schema.util';
import { DEMENTIA_CARE_PLAN_NAME } from './dementia-care-plan.seed-data';
import { applyHomeCareNeedsGoalsSupportSchema } from './home-care-needs-goals-support-schema.util';
import { HOME_CARE_NEEDS_GOALS_SUPPORT_NAME } from './home-care-needs-goals-support.seed-data';
import { applyPersonCentredCarePlanSchema } from './person-centred-care-plan-schema.util';
import { PERSON_CENTRED_CARE_PLAN_NAME } from './person-centred-care-plan.seed-data';
import { applyPressureUlcerCarePlanSchema } from './pressure-ulcer-care-plan-schema.util';
import { PRESSURE_ULCER_CARE_PLAN_NAME } from './pressure-ulcer-care-plan.seed-data';
import { applySleepingNightCarePlanSchema } from './sleeping-night-care-plan-schema.util';
import { SLEEPING_NIGHT_CARE_PLAN_NAME } from './sleeping-night-care-plan.seed-data';
import { applyWashingDressingCarePlanSchema } from './washing-dressing-care-plan-schema.util';
import { WASHING_DRESSING_CARE_PLAN_NAME } from './washing-dressing-care-plan.seed-data';
import { HOME_CARE_PLAN_NAME } from './home-care-plan.seed-data';
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
  return buildCarePlanSchemaJson(seed);
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
          fieldKey: f.fieldKey ?? null,
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
      if (planName === HOME_SUPPORT_PLAN_NAME) {
        await applyHomeSupportPlanSchema(prisma, version.id, seed);
      } else if (planName === HOME_CARE_PLAN_NAME) {
        await applyHomeCarePlanSchema(prisma, version.id, seed);
      } else if (planName === ADVANCE_CARE_PLAN_NAME) {
        await applyAdvanceCarePlanSchema(prisma, version.id, seed);
      } else if (planName === COGNITION_BEHAVIOUR_CARE_PLAN_NAME) {
        await applyCognitionBehaviourCarePlanSchema(prisma, version.id, seed);
      } else if (planName === CULTURE_RELIGION_CARE_PLAN_NAME) {
        await applyCultureReligionCarePlanSchema(prisma, version.id, seed);
      } else if (planName === FALLS_CARE_PLAN_NAME) {
        await applyFallsCarePlanSchema(prisma, version.id, seed);
      } else if (planName === FINAL_DAYS_CARE_PLAN_NAME) {
        await applyFinalDaysCarePlanSchema(prisma, version.id, seed);
      } else if (planName === INFECTION_CARE_PLAN_NAME) {
        await applyInfectionCarePlanSchema(prisma, version.id, seed);
      } else if (planName === MEDICATION_CARE_PLAN_NAME) {
        await applyMedicationCarePlanSchema(prisma, version.id, seed);
      } else if (planName === MOBILITY_CARE_PLAN_NAME) {
        await applyMobilityCarePlanSchema(prisma, version.id, seed);
      } else if (planName === PAIN_MANAGEMENT_CARE_PLAN_NAME) {
        await applyPainManagementCarePlanSchema(prisma, version.id, seed);
      } else if (planName === SKIN_INTEGRITY_CARE_PLAN_NAME) {
        await applySkinIntegrityCarePlanSchema(prisma, version.id, seed);
      } else if (planName === PSYCHOLOGICAL_CARE_PLAN_NAME) {
        await applyPsychologicalCarePlanSchema(prisma, version.id, seed);
      } else if (planName === COMMUNICATION_CARE_PLAN_NAME) {
        await applyCommunicationCarePlanSchema(prisma, version.id, seed);
      } else if (planName === CONTINENCE_CARE_PLAN_NAME) {
        await applyContinenceCarePlanSchema(prisma, version.id, seed);
      } else if (planName === EATING_AND_DRINKING_CARE_PLAN_NAME) {
        await applyEatingAndDrinkingCarePlanSchema(prisma, version.id, seed);
      } else if (planName === PHYSICAL_HEALTH_CARE_PLAN_NAME) {
        await applyPhysicalHealthCarePlanSchema(prisma, version.id, seed);
      } else if (planName === PERSONAL_SAFETY_CARE_PLAN_NAME) {
        await applyPersonalSafetyCarePlanSchema(prisma, version.id, seed);
      } else if (planName === CARE_PLAN_REVIEW_FORM_NAME) {
        await applyCarePlanReviewFormSchema(prisma, version.id, seed);
      } else if (planName === DEMENTIA_CARE_PLAN_NAME) {
        await applyDementiaCarePlanSchema(prisma, version.id, seed);
      } else if (planName === HOME_CARE_NEEDS_GOALS_SUPPORT_NAME) {
        await applyHomeCareNeedsGoalsSupportSchema(prisma, version.id, seed);
      } else if (planName === PERSON_CENTRED_CARE_PLAN_NAME) {
        await applyPersonCentredCarePlanSchema(prisma, version.id, seed);
      } else if (planName === PRESSURE_ULCER_CARE_PLAN_NAME) {
        await applyPressureUlcerCarePlanSchema(prisma, version.id, seed);
      } else if (planName === SLEEPING_NIGHT_CARE_PLAN_NAME) {
        await applySleepingNightCarePlanSchema(prisma, version.id, seed);
      } else if (planName === WASHING_DRESSING_CARE_PLAN_NAME) {
        await applyWashingDressingCarePlanSchema(prisma, version.id, seed);
      } else {
        await applyCarePlanSchema(prisma, version.id, seed);
      }
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

    if (planName === HOME_SUPPORT_PLAN_NAME) {
      await applyHomeSupportPlanSchema(prisma, versionId, seed);
    } else if (planName === HOME_CARE_PLAN_NAME) {
      await applyHomeCarePlanSchema(prisma, versionId, seed);
    } else if (planName === ADVANCE_CARE_PLAN_NAME) {
      await applyAdvanceCarePlanSchema(prisma, versionId, seed);
    } else if (planName === COGNITION_BEHAVIOUR_CARE_PLAN_NAME) {
      await applyCognitionBehaviourCarePlanSchema(prisma, versionId, seed);
    } else if (planName === CULTURE_RELIGION_CARE_PLAN_NAME) {
      await applyCultureReligionCarePlanSchema(prisma, versionId, seed);
    } else if (planName === FALLS_CARE_PLAN_NAME) {
      await applyFallsCarePlanSchema(prisma, versionId, seed);
    } else if (planName === FINAL_DAYS_CARE_PLAN_NAME) {
      await applyFinalDaysCarePlanSchema(prisma, versionId, seed);
    } else if (planName === INFECTION_CARE_PLAN_NAME) {
      await applyInfectionCarePlanSchema(prisma, versionId, seed);
    } else if (planName === MEDICATION_CARE_PLAN_NAME) {
      await applyMedicationCarePlanSchema(prisma, versionId, seed);
    } else if (planName === MOBILITY_CARE_PLAN_NAME) {
      await applyMobilityCarePlanSchema(prisma, versionId, seed);
    } else if (planName === PAIN_MANAGEMENT_CARE_PLAN_NAME) {
      await applyPainManagementCarePlanSchema(prisma, versionId, seed);
    } else if (planName === SKIN_INTEGRITY_CARE_PLAN_NAME) {
      await applySkinIntegrityCarePlanSchema(prisma, versionId, seed);
    } else if (planName === PSYCHOLOGICAL_CARE_PLAN_NAME) {
      await applyPsychologicalCarePlanSchema(prisma, versionId, seed);
    } else if (planName === COMMUNICATION_CARE_PLAN_NAME) {
      await applyCommunicationCarePlanSchema(prisma, versionId, seed);
    } else if (planName === CONTINENCE_CARE_PLAN_NAME) {
      await applyContinenceCarePlanSchema(prisma, versionId, seed);
    } else if (planName === EATING_AND_DRINKING_CARE_PLAN_NAME) {
      await applyEatingAndDrinkingCarePlanSchema(prisma, versionId, seed);
    } else if (planName === PHYSICAL_HEALTH_CARE_PLAN_NAME) {
      await applyPhysicalHealthCarePlanSchema(prisma, versionId, seed);
    } else if (planName === PERSONAL_SAFETY_CARE_PLAN_NAME) {
      await applyPersonalSafetyCarePlanSchema(prisma, versionId, seed);
    } else if (planName === CARE_PLAN_REVIEW_FORM_NAME) {
      await applyCarePlanReviewFormSchema(prisma, versionId, seed);
    } else if (planName === DEMENTIA_CARE_PLAN_NAME) {
      await applyDementiaCarePlanSchema(prisma, versionId, seed);
    } else if (planName === HOME_CARE_NEEDS_GOALS_SUPPORT_NAME) {
      await applyHomeCareNeedsGoalsSupportSchema(prisma, versionId, seed);
    } else if (planName === PERSON_CENTRED_CARE_PLAN_NAME) {
      await applyPersonCentredCarePlanSchema(prisma, versionId, seed);
    } else if (planName === PRESSURE_ULCER_CARE_PLAN_NAME) {
      await applyPressureUlcerCarePlanSchema(prisma, versionId, seed);
    } else if (planName === SLEEPING_NIGHT_CARE_PLAN_NAME) {
      await applySleepingNightCarePlanSchema(prisma, versionId, seed);
    } else if (planName === WASHING_DRESSING_CARE_PLAN_NAME) {
      await applyWashingDressingCarePlanSchema(prisma, versionId, seed);
    } else {
      await applyCarePlanSchema(prisma, versionId, seed);
    }
  }

  const refreshed = await refreshCarePathwayFormPictureUrls(prisma);
  if (refreshed > 0) {
    console.log(`[seed] Updated ${refreshed} care pathway form icon(s) to gallery PNGs.`);
  }
}
