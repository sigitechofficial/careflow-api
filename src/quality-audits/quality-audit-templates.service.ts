import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { OrgScope } from '../common/org-scope/org-scope.types';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { readSections, type AuditSection } from './quality-audit-scoring.util';
import type {
  CreateAuditAreaDto,
  ListAuditTemplatesQueryDto,
  SaveAuditTemplateDto,
} from './dto/quality-audits.dto';

const templateInclude = {
  area: { select: { code: true, name: true } },
  _count: { select: { schedules: { where: { stoppedAt: null } } } },
} satisfies Prisma.QualityAuditTemplateInclude;

type TemplateRow = Prisma.QualityAuditTemplateGetPayload<{
  include: typeof templateInclude;
}>;

/** "Care at night!" → "CARE_AT_NIGHT". */
export function areaCodeOf(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
      .slice(0, 40) || 'AREA'
  );
}

/** Sections from the form: trimmed, each standard with an id (kept when given, otherwise new and unique). */
export function normaliseSections(
  input: SaveAuditTemplateDto['sections'],
): AuditSection[] {
  const used = new Set<string>();
  const ids = input
    .flatMap((s) => s.standards.map((st) => st.id))
    .filter(Boolean);
  const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repeated)
    throw new BadRequestException(`Standard ${repeated} is listed twice`);
  return input.map((s) => ({
    title: s.title.trim(),
    standards: s.standards.map((st) => {
      let id = st.id;
      while (!id || used.has(id)) id = `s-${randomUUID().slice(0, 8)}`;
      used.add(id);
      return {
        id,
        text: st.text.trim(),
        ...(st.hint?.trim() ? { hint: st.hint.trim() } : {}),
      };
    }),
  }));
}

/**
 * Governance → Audits: audit areas and templates. Library templates come from the seed and cannot be
 * changed here; the organisation's own templates (isCustom, code OWN-NNNN) are made and edited here.
 * A custom template can be limited to some branches; branch-restricted users only see the custom
 * templates for their branches.
 */
@Injectable()
export class QualityAuditTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditLogsService,
  ) {}

  // ─── Areas ────────────────────────────────────────────────────────────────

  async areas() {
    const rows = await this.prisma.qualityAuditArea.findMany({
      where: { archivedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { templates: { where: { retiredAt: null } } } },
      },
    });
    return {
      data: rows.map((a) => ({
        code: a.code,
        name: a.name,
        description: a.description,
        isSystem: a.isSystem,
        templateCount: a._count.templates,
      })),
    };
  }

  async createArea(
    user: RequestUser,
    dto: CreateAuditAreaDto,
    meta?: RequestAuditMeta,
  ) {
    const name = dto.name.trim();
    const clash = await this.prisma.qualityAuditArea.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, archivedAt: null },
    });
    if (clash)
      throw new BadRequestException(
        `There is already an area called ${clash.name}`,
      );
    const base = areaCodeOf(name);
    let code = base;
    for (
      let n = 2;
      await this.prisma.qualityAuditArea.count({ where: { code } });
      n++
    )
      code = `${base}_${n}`;
    const last = await this.prisma.qualityAuditArea.aggregate({
      _max: { displayOrder: true },
    });
    const area = await this.prisma.qualityAuditArea.create({
      data: {
        code,
        name,
        description: dto.description?.trim() || null,
        displayOrder: (last._max.displayOrder ?? 0) + 10,
        createdById: user.id,
      },
    });
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_AREA_CREATED,
      area.id,
      meta,
      undefined,
      {
        code,
        name,
      },
    );
    return {
      message: 'Area added',
      data: {
        code: area.code,
        name: area.name,
        description: area.description,
        isSystem: false,
        templateCount: 0,
      },
    };
  }

  // ─── Templates ────────────────────────────────────────────────────────────

  /** Custom templates for other branches are hidden from branch-restricted users. */
  private visibleWhere(scope: OrgScope): Prisma.QualityAuditTemplateWhereInput {
    if (scope.locationIds === null) return {};
    return {
      OR: [
        { isCustom: false },
        { locationIds: { isEmpty: true } },
        { locationIds: { hasSome: scope.locationIds } },
      ],
    };
  }

  async templates(user: RequestUser, query: ListAuditTemplatesQueryDto = {}) {
    const scope = this.orgScope.fromRequestUser(user);
    const and: Prisma.QualityAuditTemplateWhereInput[] = [
      { retiredAt: null },
      this.visibleWhere(scope),
    ];
    if (query.areaCode) and.push({ area: { code: query.areaCode } });
    if (query.kind) and.push({ isCustom: query.kind === 'custom' });
    const rows = await this.prisma.qualityAuditTemplate.findMany({
      where: { AND: and },
      orderBy: [{ isCustom: 'asc' }, { displayOrder: 'asc' }, { title: 'asc' }],
      include: templateInclude,
    });
    return { data: rows.map((t) => this.summary(t)) };
  }

  async template(user: RequestUser, code: string) {
    const t = await this.requireTemplate(user, code);
    return {
      data: {
        ...this.summary(t),
        sections: readSections(t.sections),
        sources: t.isCustom ? [] : t.sources,
        researchedOn: t.isCustom
          ? null
          : t.researchedOn.toISOString().slice(0, 10),
      },
    };
  }

  /** A template the user may see and use (not retired). */
  async requireTemplate(user: RequestUser, code: string): Promise<TemplateRow> {
    const scope = this.orgScope.fromRequestUser(user);
    const t = await this.prisma.qualityAuditTemplate.findFirst({
      where: { AND: [{ code, retiredAt: null }, this.visibleWhere(scope)] },
      include: templateInclude,
    });
    if (!t) throw new NotFoundException('That audit template was not found');
    return t;
  }

  async createTemplate(
    user: RequestUser,
    dto: SaveAuditTemplateDto,
    meta?: RequestAuditMeta,
  ) {
    const data = await this.templateData(user, dto);
    const template = await this.withNextCode((code) =>
      this.prisma.qualityAuditTemplate.create({
        data: {
          code,
          isCustom: true,
          ...data,
          sources: [],
          researchedOn: new Date(new Date().toISOString().slice(0, 10)),
          contentHash: '',
          createdById: user.id,
        },
      }),
    );
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_TEMPLATE_CREATED,
      template.id,
      meta,
      undefined,
      {
        code: template.code,
        title: template.title,
      },
    );
    return {
      message: 'Template created',
      ...(await this.template(user, template.code)),
    };
  }

  async updateTemplate(
    user: RequestUser,
    code: string,
    dto: SaveAuditTemplateDto,
    meta?: RequestAuditMeta,
  ) {
    const existing = await this.requireTemplate(user, code);
    if (!existing.isCustom)
      throw new BadRequestException(
        'Library templates cannot be changed. Make your own copy instead.',
      );
    const data = await this.templateData(user, dto);
    const updated = await this.prisma.qualityAuditTemplate.update({
      where: { id: existing.id },
      data,
    });
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_TEMPLATE_UPDATED,
      existing.id,
      meta,
      auditSnapshot(existing),
      auditSnapshot(updated),
    );
    return { message: 'Template saved', ...(await this.template(user, code)) };
  }

  /** Retires one of the organisation's own templates; its audits are kept. */
  async retireTemplate(
    user: RequestUser,
    code: string,
    meta?: RequestAuditMeta,
  ) {
    const t = await this.requireTemplate(user, code);
    if (!t.isCustom)
      throw new BadRequestException('Library templates cannot be removed.');
    if (t._count.schedules)
      throw new BadRequestException(
        `Stop its ${t._count.schedules} schedule${t._count.schedules === 1 ? '' : 's'} first.`,
      );
    await this.prisma.qualityAuditTemplate.update({
      where: { id: t.id },
      data: { retiredAt: new Date() },
    });
    await this.log(
      user,
      AuditAction.QUALITY_AUDIT_TEMPLATE_RETIRED,
      t.id,
      meta,
    );
    return { message: 'Template removed' };
  }

  private async templateData(user: RequestUser, dto: SaveAuditTemplateDto) {
    const area = await this.prisma.qualityAuditArea.findFirst({
      where: { code: dto.areaCode, archivedAt: null },
    });
    if (!area) throw new BadRequestException('Choose an audit area');
    const scope = this.orgScope.fromRequestUser(user);
    const locationIds = [...new Set(dto.locationIds ?? [])];
    if (scope.locationIds !== null) {
      if (!locationIds.length)
        throw new BadRequestException(
          'Choose your branches: a template for every branch needs access to all branches.',
        );
      if (locationIds.some((id) => !scope.locationIds!.includes(id)))
        throw new BadRequestException('You can only choose your own branches.');
    }
    if (locationIds.length) {
      const found = await this.prisma.location.count({
        where: { id: { in: locationIds }, deletedAt: null },
      });
      if (found !== locationIds.length)
        throw new BadRequestException('Branch not found');
    }
    const sections = normaliseSections(dto.sections);
    const introduction = dto.introduction?.trim() || null;
    return {
      areaId: area.id,
      title: dto.title.trim(),
      summary: introduction ?? '',
      introduction,
      frequency: dto.frequency,
      earlyDays: dto.earlyDays ?? 2,
      lateDays: dto.lateDays ?? 2,
      auditedItemLabel: dto.auditedItemLabel?.trim() || null,
      keyQuestionCode: dto.keyQuestionCode ?? null,
      locationIds,
      sections: sections as unknown as Prisma.InputJsonValue,
    };
  }

  /** Creates with the next free OWN-NNNN code, retrying if another save took it first. */
  private async withNextCode<T>(
    create: (code: string) => Promise<T>,
  ): Promise<T> {
    const count = await this.prisma.qualityAuditTemplate.count({
      where: { isCustom: true },
    });
    for (let n = count + 1; n < count + 50; n++) {
      try {
        return await create(`OWN-${String(n).padStart(4, '0')}`);
      } catch (e) {
        if (
          !(
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002'
          )
        )
          throw e;
      }
    }
    throw new BadRequestException(
      'Could not save the template. Please try again.',
    );
  }

  private summary(t: TemplateRow) {
    const sections = readSections(t.sections);
    return {
      code: t.code,
      title: t.title,
      summary: t.summary,
      introduction: t.introduction,
      area: t.area,
      isCustom: t.isCustom,
      keyQuestionCode: t.keyQuestionCode,
      frequency: t.frequency,
      earlyDays: t.earlyDays,
      lateDays: t.lateDays,
      auditedItemLabel: t.auditedItemLabel,
      estimatedMinutes: t.estimatedMinutes,
      locationIds: t.locationIds,
      sectionCount: sections.length,
      standardCount: sections.reduce((n, s) => n + s.standards.length, 0),
      activeSchedules: t._count.schedules,
      cqcStatementCodes: t.cqcStatementCodes,
    };
  }

  private async log(
    user: RequestUser,
    action: AuditAction,
    recordId: string,
    meta?: RequestAuditMeta,
    oldValues?: unknown,
    newValues?: unknown,
  ) {
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.QUALITY_AUDITS,
      action,
      recordType: 'QualityAuditTemplate',
      recordId,
      ...(oldValues !== undefined ? { oldValues } : {}),
      ...(newValues !== undefined ? { newValues } : {}),
      ...meta,
    });
  }
}
