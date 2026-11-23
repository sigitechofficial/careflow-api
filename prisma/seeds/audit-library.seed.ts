import { Prisma, type PrismaClient } from '@prisma/client';
import { loadCqcFrameworks, statementsOf } from '../seed-lib/cqc-framework';
import { auditTemplateHash, loadAuditLibrary } from '../seed-lib/audit-library';

export type AuditLibrarySeedResult = {
  areas: number;
  created: number;
  updated: number;
  unchanged: number;
  retired: number;
};

/**
 * Ready-made audits. Runs on every deploy and is idempotent: the library's areas are upserted by code
 * (the organisation's own areas are left alone); each template file is upserted by code (skipped when
 * its content hash is unchanged); a library template no longer in the library is retired, never
 * deleted, because audits may have been carried out from it. The organisation's own templates are
 * never touched. The CQC statements each template names are checked against the active framework.
 */
export async function seedAuditLibrary(
  prisma: PrismaClient,
): Promise<AuditLibrarySeedResult> {
  const active = loadCqcFrameworks().find((f) => f.status === 'ACTIVE');
  const { library, templates } = loadAuditLibrary(
    active ? statementsOf(active).map((s) => s.code) : undefined,
  );
  const result: AuditLibrarySeedResult = {
    areas: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    retired: 0,
  };

  const areaIdByCode = new Map<string, string>();
  for (const a of library.areas) {
    const data = {
      name: a.name,
      description: a.description,
      displayOrder: a.displayOrder,
      isSystem: true,
      archivedAt: null,
    };
    const area = await prisma.qualityAuditArea.upsert({
      where: { code: a.code },
      create: { code: a.code, ...data },
      update: data,
    });
    areaIdByCode.set(a.code, area.id);
    result.areas += 1;
  }

  const sourceById = new Map(library.sources.map((s) => [s.id, s]));
  for (const t of templates) {
    const sources = t.sources.map((id) => sourceById.get(id)!);
    const contentHash = auditTemplateHash(t, sources);
    const areaId = areaIdByCode.get(t.area)!;
    const existing = await prisma.qualityAuditTemplate.findUnique({
      where: { code: t.code },
    });
    if (
      existing &&
      existing.contentHash === contentHash &&
      existing.areaId === areaId &&
      !existing.retiredAt
    ) {
      result.unchanged += 1;
      continue;
    }
    const data = {
      areaId,
      isCustom: false,
      keyQuestionCode: t.keyQuestion,
      title: t.title,
      summary: t.summary,
      introduction: t.introduction ?? null,
      frequency: t.frequency,
      earlyDays: t.earlyDays ?? 2,
      lateDays: t.lateDays ?? 2,
      auditedItemLabel: t.auditedItemLabel ?? null,
      estimatedMinutes: t.estimatedMinutes,
      displayOrder: t.displayOrder,
      sections: t.sections as unknown as Prisma.InputJsonValue,
      cqcStatementCodes: t.cqcStatements,
      sources: sources as unknown as Prisma.InputJsonValue,
      researchedOn: new Date(`${t.researchedOn}T00:00:00.000Z`),
      contentHash,
      retiredAt: null,
    };
    if (existing) {
      await prisma.qualityAuditTemplate.update({
        where: { id: existing.id },
        data,
      });
      result.updated += 1;
    } else {
      await prisma.qualityAuditTemplate.create({
        data: { code: t.code, ...data },
      });
      result.created += 1;
    }
  }

  const retired = await prisma.qualityAuditTemplate.updateMany({
    where: {
      isCustom: false,
      code: { notIn: templates.map((t) => t.code) },
      retiredAt: null,
    },
    data: { retiredAt: new Date() },
  });
  result.retired = retired.count;
  return result;
}
