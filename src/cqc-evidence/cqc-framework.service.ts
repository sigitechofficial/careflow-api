import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type FrameworkStatement = {
  id: string;
  code: string;
  title: string;
  summary: string;
  aliases: string[];
  verified: boolean;
  keyQuestionId: string;
  keyQuestionCode: string;
  keyQuestionTitle: string;
};

export type FrameworkKeyQuestion = {
  id: string;
  code: string;
  title: string;
  summary: string;
  statements: FrameworkStatement[];
};

export type FrameworkCategory = { code: string; title: string; description: string };

export type ActiveFramework = {
  id: string;
  version: number;
  code: string;
  title: string;
  note: string | null;
  checkedOn: string | null;
  sources: unknown;
  keyQuestions: FrameworkKeyQuestion[];
  statements: FrameworkStatement[];
  categories: FrameworkCategory[];
};

/**
 * The active CQC framework version (key questions → quality statements, evidence categories),
 * seeded from prisma/seed-data/cqc-framework. Screens and evidence always work against the active
 * version; links to older versions stay as history and are re-mapped by the seed.
 */
@Injectable()
export class CqcFrameworkService {
  constructor(private readonly prisma: PrismaService) {}

  async active(): Promise<ActiveFramework> {
    const v = await this.prisma.cqcFrameworkVersion.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { version: 'desc' },
      include: {
        keyQuestions: {
          orderBy: { displayOrder: 'asc' },
          include: { statements: { where: { retiredAt: null }, orderBy: { displayOrder: 'asc' } } },
        },
        categories: { where: { retiredAt: null }, orderBy: { displayOrder: 'asc' } },
      },
    });
    if (!v) throw new NotFoundException('The CQC framework has not been set up yet. Run the database seed.');
    const keyQuestions: FrameworkKeyQuestion[] = v.keyQuestions.map((k) => ({
      id: k.id,
      code: k.code,
      title: k.title,
      summary: k.summary,
      statements: k.statements.map((s) => ({
        id: s.id,
        code: s.code,
        title: s.title,
        summary: s.summary,
        aliases: s.aliases,
        verified: s.verified,
        keyQuestionId: k.id,
        keyQuestionCode: k.code,
        keyQuestionTitle: k.title,
      })),
    }));
    return {
      id: v.id,
      version: v.version,
      code: v.code,
      title: v.title,
      note: v.note,
      checkedOn: v.checkedOn ? v.checkedOn.toISOString().slice(0, 10) : null,
      sources: v.sources,
      keyQuestions,
      statements: keyQuestions.flatMap((k) => k.statements),
      categories: v.categories.map((c) => ({ code: c.code, title: c.title, description: c.description })),
    };
  }

  /** The framework for the screens: the active version plus a list of every version. */
  async describe() {
    const [framework, versions] = await Promise.all([
      this.active(),
      this.prisma.cqcFrameworkVersion.findMany({
        orderBy: { version: 'asc' },
        select: { version: true, code: true, title: true, status: true, effectiveFrom: true },
      }),
    ]);
    return {
      data: {
        ...framework,
        versions: versions.map((v) => ({
          version: v.version,
          code: v.code,
          title: v.title,
          status: v.status,
          effectiveFrom: v.effectiveFrom ? v.effectiveFrom.toISOString().slice(0, 10) : null,
        })),
      },
    };
  }

  /**
   * Statement ids as the active version's statements: ids already in it are kept; one from an
   * older version is replaced by the statements that take it over (mapsFrom, version by version).
   */
  async inActiveVersion(statementIds: string[], framework?: ActiveFramework): Promise<string[]> {
    const active = framework ?? (await this.active());
    const activeIds = new Set(active.statements.map((s) => s.id));
    const older = statementIds.filter((id) => !activeIds.has(id));
    if (!older.length) return [...new Set(statementIds)];
    const all = await this.prisma.cqcQualityStatement.findMany({
      select: { id: true, code: true, mapsFrom: true, frameworkVersion: { select: { version: true } } },
    });
    const byVersion = new Map<number, typeof all>();
    for (const s of all) {
      const list = byVersion.get(s.frameworkVersion.version) ?? [];
      list.push(s);
      byVersion.set(s.frameworkVersion.version, list);
    }
    const out = new Set(statementIds.filter((id) => activeIds.has(id)));
    for (const id of older) {
      const start = all.find((s) => s.id === id);
      if (!start) continue;
      let current = [start];
      for (let v = start.frameworkVersion.version; v < active.version; v += 1) {
        const codes = new Set(current.map((s) => s.code));
        current = (byVersion.get(v + 1) ?? []).filter((s) => s.mapsFrom.some((c) => codes.has(c)));
      }
      for (const s of current) if (activeIds.has(s.id)) out.add(s.id);
    }
    return [...out];
  }
}
