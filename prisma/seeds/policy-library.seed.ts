import { PolicyDocumentType, PolicyStatus, type Prisma, type PrismaClient } from '@prisma/client';
import {
  catalogueReference,
  keyPointsWordCount,
  loadPolicyLibrary,
  policyWordCount,
  renderPolicyHtml,
  type LibraryFile,
} from '../seed-lib/policy-library';

/**
 * The policy library as catalogue documents (isCatalogue = true): complete policies an organisation
 * adopts as its own drafts from Policies → Ready-made policies. Runs on every deploy. Categories
 * are added when missing (names an admin changed are kept). Catalogue documents belong to CareFlow,
 * so their content is refreshed and ones no longer in the library are retired; nothing an
 * organisation adopted or wrote is touched, and catalogue documents never appear in the policy
 * library or on pages (both filter isCatalogue).
 */
export async function seedPolicyLibrary(
  prisma: PrismaClient,
  files: LibraryFile[] = loadPolicyLibrary(),
): Promise<{ categoriesCreated: number; created: number; updated: number; retired: number }> {
  let categoriesCreated = 0;
  let created = 0;
  let updated = 0;
  const titleByRef = new Map(files.flatMap((f) => f.documents.map((d) => [d.reference, d.title] as const)));
  const catalogueRefs = files.flatMap((f) => f.documents.map((d) => catalogueReference(d.reference)));

  for (const [order, file] of files.entries()) {
    let category = await prisma.policyCategory.findFirst({ where: { code: file.category.code, deletedAt: null } });
    if (!category) {
      category = await prisma.policyCategory.create({
        data: { name: file.category.name, code: file.category.code, displayOrder: 100 + order * 10 },
      });
      categoriesCreated += 1;
    }

    for (const p of file.documents) {
      const reference = catalogueReference(p.reference);
      const contentHtml = renderPolicyHtml(p, (r) => titleByRef.get(r));
      const contentJson = {
        type: 'library',
        version: 2,
        researchedOn: file.category.researchedOn,
        categoryCode: file.category.code,
        wordCount: policyWordCount(p),
        keyPointsWordCount: keyPointsWordCount(p),
        policy: p,
      } as unknown as Prisma.InputJsonValue;
      const changeSummary =
        p.revision > 1
          ? `CareFlow policy library revision ${p.revision}: ${p.revisionNote}`
          : `CareFlow policy library (researched ${file.category.researchedOn})`;

      const existing = await prisma.policyDocument.findFirst({
        where: { reference },
        select: { id: true, isCatalogue: true, currentVersionId: true },
      });
      if (existing && !existing.isCatalogue) continue; // never overwrite an organisation's own document

      if (!existing) {
        await prisma.$transaction(async (tx) => {
          const doc = await tx.policyDocument.create({
            data: {
              reference,
              title: p.title,
              description: p.summary,
              documentType: p.documentType as PolicyDocumentType,
              primaryCategoryId: category!.id,
              status: PolicyStatus.APPROVED,
              isCatalogue: true,
            },
          });
          const version = await tx.policyVersion.create({
            data: {
              documentId: doc.id,
              versionMajor: 1,
              versionMinor: 0,
              status: PolicyStatus.APPROVED,
              titleSnapshot: p.title,
              contentJson,
              contentHtml,
              acknowledgementRequired: p.acknowledgementRequired,
              changeSummary,
            },
          });
          await tx.policyDocument.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
        });
        created += 1;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.policyDocument.update({
          where: { id: existing.id },
          data: {
            title: p.title,
            description: p.summary,
            documentType: p.documentType as PolicyDocumentType,
            primaryCategoryId: category!.id,
            isActive: true,
            deletedAt: null,
          },
        });
        if (existing.currentVersionId) {
          await tx.policyVersion.update({
            where: { id: existing.currentVersionId },
            data: { titleSnapshot: p.title, contentJson, contentHtml, acknowledgementRequired: p.acknowledgementRequired, changeSummary },
          });
        }
      });
      updated += 1;
    }
  }

  const retired = await prisma.policyDocument.updateMany({
    where: { isCatalogue: true, deletedAt: null, reference: { notIn: catalogueRefs } },
    data: { isActive: false, deletedAt: new Date() },
  });
  return { categoriesCreated, created, updated, retired: retired.count };
}
