import {
  CarePathwayFormStatus,
  CarePathwayFormType,
  CarePathwayFormVersionStatus,
  PathwayActionType,
  PrismaClient,
} from '@prisma/client';
import { CARE_PLAN_FORM_SEEDS } from './care-plan-forms.seed-data';
import { carePlanPictureSlug, seedCarePlanForms } from './care-plan-forms.seed';
import { resolveGalleryPictureUrl, seedCarePictureGallery } from './care-pathway-gallery.seed';
import { seedDefaultAssessmentFormSelections } from './default-assessment-form-selection.seed';

type ChecklistSeed = { name: string; icon?: string; items: string[] };

const CHECKLIST_SEEDS: ChecklistSeed[] = [
  {
    name: 'Continence',
    icon: 'continence',
    items: [
      'Dry',
      'Unsoiled',
      'Incontinent + (urine)',
      'Incontinent ++ (urine)',
      'Incontinent +++ (urine)',
      'Incontinent + (faeces)',
      'Incontinent ++ (faeces)',
      'Incontinent +++ (faeces)',
      'Pads changed',
      'Underwear changed',
      'Client refuse continent care',
    ],
  },
  {
    name: 'Final Days',
    icon: 'final-days',
    items: [
      'Check breathing comfortably',
      'Food/drink given',
      'Supported with continence',
      'Checked for pain',
      'Checked for anxiety/delirium/agitation',
      'Checked for nausea/vomiting',
      'Supported with mobility',
      'Checked for comfort',
      'Checked personal care',
      'Mouth care given',
      'Communicated with family',
      'Checked pressure areas',
      'Checked for diabetes symptoms',
    ],
  },
  {
    name: 'Home First Checklist',
    icon: 'home-first',
    items: [
      'Walks independently',
      'Walk with Zimmer Frame',
      'Walk with Walking Stick',
      'Bed Bound',
      'Shower/strip wash/bed bath',
      'Dressing support',
      'Food/drink support',
      'Medication support',
    ],
  },
  {
    name: 'Maintenance Checks',
    icon: 'maintenance',
    items: ['Bulb check', 'Wear and tear check', 'Odd jobs - inside', 'Odd jobs - outside', 'Equipment check'],
  },
  { name: 'Meal', icon: 'meal', items: ['What was eaten'] },
  {
    name: 'Mouth Care',
    icon: 'mouth-care',
    items: [
      'Mouth care given',
      'Mouth check',
      'Natural teeth cleaned',
      'Dentures cleaned',
      'Dry mouth care',
    ],
  },
  {
    name: 'Night Duties',
    icon: 'night-duties',
    items: ['Laundry', 'Dining room clean', 'Lounge clean', 'General clean', 'Medication check'],
  },
  {
    name: 'Nutrition',
    icon: 'nutrition',
    items: [
      'Food choice given',
      'Snack offered',
      'Drink offered',
      'Prompted to eat',
      'Prompted to drink',
    ],
  },
  {
    name: 'Pain Management',
    icon: 'pain',
    items: ['No pain', 'Mild pain', 'Moderate pain', 'Severe pain', 'Appears to be in pain'],
  },
  {
    name: 'Personal Care',
    icon: 'personal-care',
    items: ['Personal care given', 'Bath', 'Shower', 'Shave', 'Hair wash', 'Dressed', 'Declined'],
  },
  {
    name: 'Pressure Ulcer prevention',
    icon: 'pressure',
    items: ['Mattress', 'Protection', 'Cushion in place', 'Skin inspection', 'Nutrition/hydration offer'],
  },
  {
    name: 'Psychological',
    icon: 'psychological',
    items: ['Well-Being check', 'Mood check', 'Room check', 'Isolation check'],
  },
  {
    name: 'Skin Integrity',
    icon: 'skin',
    items: ['Skin check', 'Check for redness', 'Check for rash', 'Check creams applied'],
  },
  {
    name: 'Sleeping and Night',
    icon: 'sleep',
    items: ['Comfortable', 'Room temperature', 'Call bell in easy reach', 'Drink', 'Snack'],
  },
  {
    name: 'Social Activities',
    icon: 'social',
    items: ['Bingo', 'Cookery', 'Art and Craft', 'Exercise', 'Quiz', 'Music', 'Visitors', 'Declined', 'Other'],
  },
];

const ACTION_SEEDS = [
  { actionName: 'out reach', actionIcon: 'outreach', actionType: PathwayActionType.CHECKLIST },
  { actionName: 'laundry and cleaning', actionIcon: 'laundry', actionType: PathwayActionType.CHECKLIST },
  { actionName: 'Welfare Check', actionIcon: 'welfare', actionType: PathwayActionType.OBSERVATION },
  { actionName: 'Medication Visit', actionIcon: 'medication', actionType: PathwayActionType.CHECKLIST },
  { actionName: 'Domestic Visit', actionIcon: 'domestic', actionType: PathwayActionType.CHECKLIST },
  { actionName: 'Tea Visit', actionIcon: 'tea', actionType: PathwayActionType.CHECKLIST },
  { actionName: 'Bed Visit', actionIcon: 'bed', actionType: PathwayActionType.CHECKLIST },
  { actionName: 'Lunch Visit', actionIcon: 'lunch', actionType: PathwayActionType.CHECKLIST },
  { actionName: 'AM Visit', actionIcon: 'am', actionType: PathwayActionType.CHECKLIST },
];

const SAMPLE_FORMS: { name: string; formType: CarePathwayFormType }[] = [
  { name: 'ACCIDENT Event form', formType: CarePathwayFormType.SERVICE_FORM },
  { name: 'Assessing For Medication in home care', formType: CarePathwayFormType.ASSESSMENT },
  { name: 'Bed Rail Assessment', formType: CarePathwayFormType.ASSESSMENT },
  { name: 'Capability Assessment', formType: CarePathwayFormType.ASSESSMENT },
  { name: 'Carer Communication form', formType: CarePathwayFormType.STAFF_FORM },
  { name: 'Change of carer', formType: CarePathwayFormType.SERVICE_FORM },
  { name: 'Charity Hoover', formType: CarePathwayFormType.SERVICE_FORM },
  { name: 'Choking Risk Assessment', formType: CarePathwayFormType.ASSESSMENT },
  { name: 'Commendation/Complaint Record', formType: CarePathwayFormType.SERVICE_FORM },
  { name: 'COMPLIMENT event form', formType: CarePathwayFormType.STAFF_FORM },
  { name: 'COVID-19 Best Interest Checklist', formType: CarePathwayFormType.ASSESSMENT },
  { name: 'Customer Feedback Form', formType: CarePathwayFormType.SERVICE_FORM },
];

function slugCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export async function seedCarePathway(prisma: PrismaClient): Promise<void> {
  const textCategories = ['Personal Care', 'Nutrition', 'Mobility', 'Social & Wellbeing'];
  for (let i = 0; i < textCategories.length; i++) {
    const name = textCategories[i];
    const existing = await prisma.carePlanTextCategory.findFirst({
      where: { name, deletedAt: null },
    });
    if (!existing) {
      await prisma.carePlanTextCategory.create({
        data: { name, sortOrder: i, isActive: true },
      });
    }
  }

  await prisma.carePlanTextPersonalisationToken.upsert({
    where: { token: '@' },
    update: { isActive: true },
    create: {
      token: '@',
      description: 'Service user name placeholder',
      replacementSource: 'serviceUserName',
      isActive: true,
    },
  });

  for (const cl of CHECKLIST_SEEDS) {
    const existing = await prisma.pathwayChecklist.findFirst({
      where: { name: cl.name, deletedAt: null },
    });
    const checklist =
      existing ??
      (await prisma.pathwayChecklist.create({
        data: {
          name: cl.name,
          icon: cl.icon ?? null,
          observationEnabled: false,
          recordPhoto: false,
        },
      }));

    for (let i = 0; i < cl.items.length; i++) {
      const itemText = cl.items[i];
      const hasItem = await prisma.pathwayChecklistItem.findFirst({
        where: { checklistId: checklist.id, itemText, deletedAt: null },
      });
      if (!hasItem) {
        await prisma.pathwayChecklistItem.create({
          data: { checklistId: checklist.id, itemText, sortOrder: i },
        });
      }
    }
  }

  for (const a of ACTION_SEEDS) {
    const existing = await prisma.pathwayAction.findFirst({
      where: { actionName: a.actionName, deletedAt: null },
    });
    if (!existing) {
      await prisma.pathwayAction.create({
        data: {
          actionName: a.actionName,
          actionIcon: a.actionIcon,
          actionType: a.actionType,
          carersCount: 1,
        },
      });
    }
  }

  await seedCarePictureGallery(prisma);

  for (const f of SAMPLE_FORMS) {
    const existing = await prisma.carePathwayForm.findFirst({
      where: { name: f.name, deletedAt: null },
    });
    if (existing) continue;

    const pictureSlug =
      f.formType === CarePathwayFormType.CARE_PLAN ? carePlanPictureSlug(f.name) : slugCode(f.name);
    const pictureUrl =
      f.formType === CarePathwayFormType.CARE_PLAN
        ? resolveGalleryPictureUrl(pictureSlug, f.name)
        : null;

    const form = await prisma.carePathwayForm.create({
      data: {
        name: f.name,
        formType: f.formType,
        pictureUrl,
        status:
          f.name === 'Charity Hoover'
            ? CarePathwayFormStatus.ACTIVE
            : CarePathwayFormStatus.PUBLISHED,
        versionLabel: '1',
        lastPublishedAt: f.name === 'Charity Hoover' ? null : new Date(),
      },
    });
    const version = await prisma.carePathwayFormVersion.create({
      data: {
        formId: form.id,
        versionNumber: 1,
        status: CarePathwayFormVersionStatus.PUBLISHED,
        publishedAt: f.name === 'Charity Hoover' ? null : new Date(),
      },
    });
    await prisma.carePathwayFormSection.create({
      data: {
        formVersionId: version.id,
        title: 'Section 1',
        sortOrder: 0,
      },
    });
    if (f.name !== 'Charity Hoover') {
      await prisma.carePathwayForm.update({
        where: { id: form.id },
        data: { currentVersionId: version.id },
      });
    }
  }

  await seedCarePlanForms(prisma);
  await seedDefaultAssessmentFormSelections(prisma);

  // Remove legacy empty care plans not in the catalogue (e.g. duplicate partial seeds)
  const catalogueNames = Object.keys(CARE_PLAN_FORM_SEEDS);
  await prisma.carePathwayForm.updateMany({
    where: {
      formType: CarePathwayFormType.CARE_PLAN,
      deletedAt: null,
      name: { notIn: catalogueNames },
    },
    data: { deletedAt: new Date(), isActive: false },
  });
}
