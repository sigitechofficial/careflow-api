import { CarePathwayFormType, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

type FormRow = {
  id: string;
  name: string;
  description: string | null;
  formType: CarePathwayFormType;
  status: string;
  lastPublishedAt: Date | null;
  pictureUrl: string | null;
  versionLabel: string;
  isActive: boolean;
};

export function mapCarePathwayAssessmentFormSummary(row: FormRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    formType: row.formType,
    status: row.status,
    lastPublishedAt: row.lastPublishedAt?.toISOString() ?? null,
    pictureUrl: row.pictureUrl,
    versionLabel: row.versionLabel,
    isActive: row.isActive,
  };
}

type CatalogueClient = PrismaService | Prisma.TransactionClient;

/** Org Form Selection when configured; otherwise all active care pathway assessment forms. */
export async function listCarePathwayAssessmentCatalogForms(client: CatalogueClient) {
  const selections = await client.defaultFormSelection.findMany({
    where: { deletedAt: null, isActive: true, formType: CarePathwayFormType.ASSESSMENT },
    include: { form: true },
    orderBy: [{ form: { name: 'asc' } }],
  });

  const selectedForms = selections
    .filter((row) => row.form && row.form.deletedAt == null && row.form.isActive)
    .map((row) => mapCarePathwayAssessmentFormSummary(row.form as FormRow));

  if (selectedForms.length > 0) {
    return { forms: selectedForms, source: 'form_selection' as const };
  }

  const allForms = await client.carePathwayForm.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      formType: CarePathwayFormType.ASSESSMENT,
    },
    orderBy: { name: 'asc' },
  });

  return {
    forms: allForms.map(mapCarePathwayAssessmentFormSummary),
    source: 'all_published' as const,
  };
}
