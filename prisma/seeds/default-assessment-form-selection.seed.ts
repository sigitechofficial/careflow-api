import { CarePathwayFormType, PrismaClient } from '@prisma/client';

/** Enable all active care pathway assessment forms in Form Selection when none are configured yet. */
export async function seedDefaultAssessmentFormSelections(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.defaultFormSelection.count({
    where: {
      formType: CarePathwayFormType.ASSESSMENT,
      deletedAt: null,
      isActive: true,
    },
  });
  if (existing > 0) return;

  const forms = await prisma.carePathwayForm.findMany({
    where: {
      formType: CarePathwayFormType.ASSESSMENT,
      deletedAt: null,
      isActive: true,
    },
    select: { id: true },
    orderBy: { name: 'asc' },
  });
  if (!forms.length) return;

  await prisma.defaultFormSelection.createMany({
    data: forms.map((form) => ({
      formId: form.id,
      formType: CarePathwayFormType.ASSESSMENT,
      isDefault: true,
      isActive: true,
    })),
  });
}
