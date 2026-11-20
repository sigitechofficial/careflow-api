import { Prisma, type PrismaClient } from '@prisma/client';
import { loadCqcFrameworks, statementsOf } from '../seed-lib/cqc-framework';
import {
  loadMockInspectionLibrary,
  templateHash,
} from '../seed-lib/mock-inspection-library';

export type MockInspectionLibrarySeedResult = {
  created: number;
  updated: number;
  unchanged: number;
  retired: number;
};

/**
 * Ready-made mock CQC inspections. Runs on every deploy and is idempotent: each template file is
 * upserted by code (skipped when its content hash is unchanged); a template no longer in the
 * library is retired, never deleted, because inspections may have been started from it.
 * Templates are checked against the active framework's statement codes.
 */
export async function seedMockInspectionLibrary(
  prisma: PrismaClient,
): Promise<MockInspectionLibrarySeedResult> {
  const active = loadCqcFrameworks().find((f) => f.status === 'ACTIVE');
  if (!active)
    throw new Error('Mock inspection library: no active CQC framework');
  const { library, templates } = loadMockInspectionLibrary(
    statementsOf(active).map((s) => s.code),
  );
  const result: MockInspectionLibrarySeedResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    retired: 0,
  };
  const sourceById = new Map(library.sources.map((s) => [s.id, s]));

  for (const t of templates) {
    const sources = t.sources.map((id) => sourceById.get(id)!);
    const contentHash = templateHash(t, sources);
    const existing = await prisma.cqcMockInspectionTemplate.findUnique({
      where: { code: t.code },
    });
    if (
      existing &&
      existing.contentHash === contentHash &&
      !existing.retiredAt
    ) {
      result.unchanged += 1;
      continue;
    }
    const data = {
      groupCode: t.group,
      groupName: t.groupName,
      title: t.title,
      summary: t.summary,
      whenToUse: t.whenToUse,
      estimatedMinutes: t.estimatedMinutes,
      displayOrder: t.displayOrder,
      statements: t.statements as unknown as Prisma.InputJsonValue,
      sources: sources as unknown as Prisma.InputJsonValue,
      researchedOn: new Date(`${t.researchedOn}T00:00:00.000Z`),
      contentHash,
      retiredAt: null,
    };
    if (existing) {
      await prisma.cqcMockInspectionTemplate.update({
        where: { id: existing.id },
        data,
      });
      result.updated += 1;
    } else {
      await prisma.cqcMockInspectionTemplate.create({
        data: { code: t.code, ...data },
      });
      result.created += 1;
    }
  }

  const retired = await prisma.cqcMockInspectionTemplate.updateMany({
    where: { code: { notIn: templates.map((t) => t.code) }, retiredAt: null },
    data: { retiredAt: new Date() },
  });
  result.retired = retired.count;
  return result;
}
