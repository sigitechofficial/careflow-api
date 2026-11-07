import type { PrismaClient } from '@prisma/client';
import {
  frameworkHash,
  loadCqcFrameworks,
  planFrameworkRemap,
  versionKey,
  type CqcFramework,
} from '../seed-lib/cqc-framework';

export type CqcFrameworkSeedResult = {
  versionsCreated: number;
  versionsUpdated: number;
  versionsUnchanged: number;
  activeVersion: number | null;
  /** Evidence links added to the active version's statements (framework change re-mapping). */
  linksRemapped: number;
  /** Evidence moved to the active version's evidence category code. */
  categoriesRemapped: number;
};

const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

/**
 * The CQC framework (Quality & compliance → CQC evidence). Runs on every deploy and is idempotent.
 * Each version file becomes a CqcFrameworkVersion with its key questions, quality statements and
 * evidence categories (upserted by code; one that leaves the file is marked retired, never deleted,
 * because evidence may link to it). Then evidence linked to an older version is linked to the
 * statements of the active version that take it over (mapsFrom), keeping its old links as history.
 */
export async function seedCqcFramework(
  prisma: PrismaClient,
  frameworks: CqcFramework[] = loadCqcFrameworks(),
): Promise<CqcFrameworkSeedResult> {
  const result: CqcFrameworkSeedResult = {
    versionsCreated: 0,
    versionsUpdated: 0,
    versionsUnchanged: 0,
    activeVersion: frameworks.find((f) => f.status === 'ACTIVE')?.version ?? null,
    linksRemapped: 0,
    categoriesRemapped: 0,
  };

  for (const f of frameworks) {
    const contentHash = frameworkHash(f);
    const existing = await prisma.cqcFrameworkVersion.findUnique({ where: { version: f.version } });
    if (existing && existing.contentHash === contentHash && existing.status === f.status) {
      result.versionsUnchanged += 1;
      continue;
    }
    const details = {
      code: f.code,
      title: f.title,
      status: f.status,
      effectiveFrom: day(f.effectiveFrom),
      checkedOn: day(f.checkedOn),
      note: f.note,
      sources: f.sources,
      contentHash,
    };
    const version = existing
      ? await prisma.cqcFrameworkVersion.update({ where: { id: existing.id }, data: details })
      : await prisma.cqcFrameworkVersion.create({ data: { version: f.version, ...details } });
    if (existing) result.versionsUpdated += 1;
    else result.versionsCreated += 1;

    const now = new Date();
    const statementCodes: string[] = [];
    for (const [kqIndex, kq] of f.keyQuestions.entries()) {
      const keyQuestion = await prisma.cqcKeyQuestion.upsert({
        where: { frameworkVersionId_code: { frameworkVersionId: version.id, code: kq.code } },
        update: { title: kq.title, summary: kq.summary, displayOrder: (kqIndex + 1) * 10 },
        create: {
          frameworkVersionId: version.id,
          code: kq.code,
          title: kq.title,
          summary: kq.summary,
          displayOrder: (kqIndex + 1) * 10,
        },
      });
      for (const [sIndex, s] of kq.statements.entries()) {
        statementCodes.push(s.code);
        const data = {
          keyQuestionId: keyQuestion.id,
          title: s.title,
          summary: s.summary,
          aliases: s.aliases,
          mapsFrom: s.mapsFrom ?? [],
          verified: s.verification.status === 'verified',
          displayOrder: (kqIndex + 1) * 100 + sIndex,
          retiredAt: null,
        };
        await prisma.cqcQualityStatement.upsert({
          where: { frameworkVersionId_code: { frameworkVersionId: version.id, code: s.code } },
          update: data,
          create: { frameworkVersionId: version.id, code: s.code, ...data },
        });
      }
    }
    await prisma.cqcQualityStatement.updateMany({
      where: { frameworkVersionId: version.id, code: { notIn: statementCodes }, retiredAt: null },
      data: { retiredAt: now },
    });

    for (const [cIndex, c] of f.evidenceCategories.entries()) {
      const data = {
        title: c.title,
        description: c.description,
        mapsFrom: c.mapsFrom ?? [],
        displayOrder: (cIndex + 1) * 10,
        retiredAt: null,
      };
      await prisma.cqcEvidenceCategory.upsert({
        where: { frameworkVersionId_code: { frameworkVersionId: version.id, code: c.code } },
        update: data,
        create: { frameworkVersionId: version.id, code: c.code, ...data },
      });
    }
    await prisma.cqcEvidenceCategory.updateMany({
      where: {
        frameworkVersionId: version.id,
        code: { notIn: f.evidenceCategories.map((c) => c.code) },
        retiredAt: null,
      },
      data: { retiredAt: now },
    });
  }

  // Versions no longer on disk stop being active (kept for the evidence that links to them).
  await prisma.cqcFrameworkVersion.updateMany({
    where: { version: { notIn: frameworks.map((f) => f.version) }, status: 'ACTIVE' },
    data: { status: 'RETIRED' },
  });

  const remap = await remapEvidenceToActiveVersion(prisma, frameworks);
  result.linksRemapped = remap.links;
  result.categoriesRemapped = remap.categories;
  return result;
}

/**
 * Framework change: link current evidence on an older version's statements to the active
 * version's successors, and move its evidence category code on. Idempotent (existing links skipped).
 */
export async function remapEvidenceToActiveVersion(
  prisma: PrismaClient,
  frameworks: CqcFramework[],
): Promise<{ links: number; categories: number }> {
  const plan = planFrameworkRemap(frameworks);
  const active = frameworks.find((f) => f.status === 'ACTIVE');
  if (!active || (!plan.statements.size && !plan.categories.size)) return { links: 0, categories: 0 };

  const versions = await prisma.cqcFrameworkVersion.findMany({ select: { id: true, version: true } });
  const activeRow = versions.find((v) => v.version === active.version);
  if (!activeRow) return { links: 0, categories: 0 };
  const versionById = new Map(versions.map((v) => [v.id, v.version]));
  const activeStatements = await prisma.cqcQualityStatement.findMany({
    where: { frameworkVersionId: activeRow.id },
    select: { id: true, code: true },
  });
  const activeIdByCode = new Map(activeStatements.map((s) => [s.code, s.id]));

  const oldLinks = await prisma.cqcEvidenceStatement.findMany({
    where: { statement: { frameworkVersionId: { not: activeRow.id } }, evidence: { status: { not: 'ARCHIVED' } } },
    select: { evidenceId: true, statement: { select: { code: true, frameworkVersionId: true } } },
  });
  const data: Array<{ evidenceId: string; statementId: string }> = [];
  for (const link of oldLinks) {
    const version = versionById.get(link.statement.frameworkVersionId);
    if (version === undefined) continue;
    for (const code of plan.statements.get(versionKey(version, link.statement.code)) ?? []) {
      const statementId = activeIdByCode.get(code);
      if (statementId) data.push({ evidenceId: link.evidenceId, statementId });
    }
  }
  const links = data.length
    ? (await prisma.cqcEvidenceStatement.createMany({ data, skipDuplicates: true })).count
    : 0;

  // Evidence categories: codes are stored on the evidence; an older version's code moves on.
  let categories = 0;
  const activeCategoryCodes = new Set(active.evidenceCategories.map((c) => c.code));
  for (const older of frameworks.filter((f) => f.version < active.version)) {
    for (const c of older.evidenceCategories) {
      const next = plan.categories.get(versionKey(older.version, c.code));
      if (!next || next === c.code || activeCategoryCodes.has(c.code)) continue;
      categories += (
        await prisma.cqcEvidence.updateMany({ where: { categoryCode: c.code }, data: { categoryCode: next } })
      ).count;
    }
  }
  return { links, categories };
}
