import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Survey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { surveyVisibleInScope } from './survey-scope.util';
import { assertSurveyLogic } from './survey-question-config.util';
import { SECTION_INTRO_MAX, SECTION_TITLE_MAX, sectionIntrosOf, sectionRuns, storedIntros } from './survey-sections.util';

type Row = {
  id: string;
  surveyId: string;
  key: string | null;
  questionText: string;
  questionType: Prisma.SurveyQuestionGetPayload<object>['questionType'];
  options: Prisma.JsonValue;
  config: Prisma.JsonValue;
  otherOption: Prisma.JsonValue;
  showIf: Prisma.JsonValue;
  sortOrder: number;
  createdAt: Date;
  sectionTitle: string | null;
};

/**
 * The section manager: rename a section, give it an introduction, move it up or down as a block,
 * remove it (its questions stay, without a heading) and put a split section back together. Each
 * section is the `sectionTitle` its questions share, so ready-made surveys, the question bank,
 * Preview, the link page, the portal, the carer app, Results and the CSV keep working. Renaming and
 * the introduction are allowed once people have answered (they change no answer); moving follows
 * the same rule as moving one question ("Show only if" rules decide). Every change is audited.
 */
@Injectable()
export class SurveySectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  private async requireEditable(actor: RequestUser, id: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({ where: { id, deletedAt: null, isCatalogue: false } });
    const scope = this.orgScope.fromRequestUser(actor);
    if (!survey || !surveyVisibleInScope(scope, survey)) throw new NotFoundException('Survey not found');
    // A company-wide template (no branches) is changed only by someone with every branch.
    if (scope.locationIds !== null && survey.isTemplate && survey.locationIds.length === 0) {
      throw new ForbiddenException(
        'This is a shared company template, so only someone with access to all branches can change it. Use the template to start your own survey.',
      );
    }
    return survey;
  }

  private async ordered(surveyId: string): Promise<Row[]> {
    const rows = await this.prisma.surveyQuestion.findMany({
      where: { surveyId, deletedAt: null },
      select: {
        id: true,
        surveyId: true,
        key: true,
        questionText: true,
        questionType: true,
        options: true,
        config: true,
        otherOption: true,
        showIf: true,
        sortOrder: true,
        createdAt: true,
        sectionTitle: true,
      },
    });
    return [...rows].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
  }

  private requireSection(rows: Row[], title: string): string {
    const t = title?.trim();
    if (!t || !rows.some((q) => q.sectionTitle?.trim() === t)) throw new NotFoundException('Section not found');
    return t;
  }

  private async saveOrder(next: Row[], why: string, also?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    try {
      assertSurveyLogic(next);
    } catch (e) {
      throw new BadRequestException(`${why} ${e instanceof Error ? e.message : ''}`.trim());
    }
    const changes = next.map((q, i) => ({ id: q.id, from: q.sortOrder, to: i })).filter((c) => c.from !== c.to);
    if (!changes.length && !also) return;
    const surveyId = next[0]?.surveyId;
    await this.prisma.$transaction(async (tx) => {
      // Two people changing the order at once: the second works from an order that no longer
      // exists, and saving it could put a question before the one its "Show only if" depends on.
      // Lock the survey and check nothing moved since this order was read.
      if (surveyId) {
        await tx.$executeRaw`SELECT 1 FROM "surveys"."Survey" WHERE "id" = ${surveyId}::uuid FOR UPDATE`;
        const now = await tx.surveyQuestion.findMany({ where: { surveyId, deletedAt: null }, select: { id: true, sortOrder: true } });
        const read = new Map(next.map((q) => [q.id, q.sortOrder]));
        if (now.length !== read.size || now.some((q) => read.get(q.id) !== q.sortOrder)) {
          throw new ConflictException('Someone else changed the order of this survey just now. Reload the page and try again.');
        }
      }
      if (also) await also(tx);
      for (const c of changes) await tx.surveyQuestion.update({ where: { id: c.id }, data: { sortOrder: c.to } });
    });
  }

  private async log(actor: RequestUser, survey: Survey, description: string, values: Record<string, unknown>, meta?: RequestAuditMeta) {
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_SECTION_UPDATED,
      recordType: 'Survey',
      recordId: survey.id,
      description: `${description} on survey "${survey.title}"`,
      newValues: values,
      ...meta,
    });
  }

  /** Store introductions (keeping ready-made ones that were not changed out of the stored map). */
  private async saveIntros(surveyId: string, intros: Record<string, string>) {
    // Raw SQL: an introduction is wording for people answering, not a change to the questions or
    // figures, so the survey's updatedAt (which dates CQC evidence) is left alone.
    const json = Object.keys(intros).length ? JSON.stringify(intros) : null;
    await this.prisma.$executeRaw`UPDATE "surveys"."Survey" SET "sectionIntros" = ${json}::jsonb WHERE "id" = ${surveyId}::uuid`;
  }

  /** Rename a section (every question in it) and keep its introduction. */
  async rename(actor: RequestUser, surveyId: string, from: string, to: string, meta?: RequestAuditMeta) {
    const survey = await this.requireEditable(actor, surveyId);
    const rows = await this.ordered(surveyId);
    const title = this.requireSection(rows, from);
    const next = to?.trim();
    if (!next) throw new BadRequestException('Give the section a name, or use Remove section.');
    if (next.length > SECTION_TITLE_MAX) throw new BadRequestException(`A section name can be at most ${SECTION_TITLE_MAX} characters.`);
    if (next === title) return { message: 'Section unchanged', data: { title } };
    if (rows.some((q) => q.sectionTitle?.trim() === next)) {
      throw new BadRequestException(`There is already a section called "${next}". Choose another name, or move the questions into it.`);
    }
    await this.prisma.surveyQuestion.updateMany({
      where: { surveyId, deletedAt: null, sectionTitle: title },
      data: { sectionTitle: next },
    });
    // The introduction goes with it (a ready-made one too, now stored on the survey).
    const intros = sectionIntrosOf(survey);
    const stored = storedIntros(survey.sectionIntros);
    if (intros[title] !== undefined || stored[title] !== undefined) {
      const text = intros[title] ?? '';
      delete stored[title];
      stored[next] = text;
      // A ready-made introduction must not come back under the old name.
      if (sectionIntrosOf({ libraryMeta: survey.libraryMeta })[title]) stored[title] = '';
      await this.saveIntros(surveyId, stored);
    }
    await this.log(actor, survey, `Section "${title}" renamed to "${next}"`, { from: title, to: next }, meta);
    return { message: 'Section renamed', data: { title: next } };
  }

  /** Set or clear a section's introduction (one or two sentences shown under its heading). */
  async setIntroduction(actor: RequestUser, surveyId: string, title: string, introduction: string | null, meta?: RequestAuditMeta) {
    const survey = await this.requireEditable(actor, surveyId);
    const rows = await this.ordered(surveyId);
    const t = this.requireSection(rows, title);
    const text = introduction?.trim() ?? '';
    if (text.length > SECTION_INTRO_MAX) {
      throw new BadRequestException(`An introduction can be at most ${SECTION_INTRO_MAX} characters: one or two short sentences.`);
    }
    const stored = storedIntros(survey.sectionIntros);
    // Cleared: '' keeps a ready-made introduction from coming back; nothing to keep otherwise.
    if (text) stored[t] = text;
    else if (sectionIntrosOf({ libraryMeta: survey.libraryMeta })[t]) stored[t] = '';
    else delete stored[t];
    await this.saveIntros(surveyId, stored);
    await this.log(actor, survey, text ? `Introduction set for section "${t}"` : `Introduction removed from section "${t}"`, { section: t, introduction: text || null }, meta);
    return { message: text ? 'Introduction saved' : 'Introduction removed', data: { title: t, introduction: text || null } };
  }

  /** Move a section up or down past the next section (or the questions with no section) as a block. */
  async move(actor: RequestUser, surveyId: string, title: string, direction: 'up' | 'down', meta?: RequestAuditMeta) {
    const survey = await this.requireEditable(actor, surveyId);
    const rows = await this.ordered(surveyId);
    const t = this.requireSection(rows, title);
    const runs = sectionRuns(rows);
    const at = runs.map((r, i) => (r.title === t ? i : -1)).filter((i) => i >= 0);
    if (at.length > 1) {
      throw new BadRequestException(`"${t}" is in more than one place. Use "Put them together" first, then move it.`);
    }
    const i = at[0]!;
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= runs.length) {
      throw new BadRequestException(direction === 'up' ? 'This section is already first.' : 'This section is already last.');
    }
    const swapped = [...runs];
    [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
    const other = runs[j]!.title ? `"${runs[j]!.title}"` : 'the questions with no section';
    await this.saveOrder(
      swapped.flatMap((r) => r.questions),
      `"${t}" cannot move ${direction} past ${other}:`,
    );
    await this.log(actor, survey, `Section "${t}" moved ${direction}`, { section: t, moved: direction }, meta);
    return { message: 'Section moved', data: { title: t } };
  }

  /** Remove a section: its questions stay where they are, without a heading. */
  async remove(actor: RequestUser, surveyId: string, title: string, meta?: RequestAuditMeta) {
    const survey = await this.requireEditable(actor, surveyId);
    const rows = await this.ordered(surveyId);
    const t = this.requireSection(rows, title);
    const count = rows.filter((q) => q.sectionTitle?.trim() === t).length;
    await this.prisma.surveyQuestion.updateMany({ where: { surveyId, deletedAt: null, sectionTitle: t }, data: { sectionTitle: null } });
    const stored = storedIntros(survey.sectionIntros);
    if (stored[t] !== undefined || sectionIntrosOf(survey)[t] !== undefined) {
      if (sectionIntrosOf({ libraryMeta: survey.libraryMeta })[t]) stored[t] = '';
      else delete stored[t];
      await this.saveIntros(surveyId, stored);
    }
    await this.log(actor, survey, `Section "${t}" removed (its ${count} questions kept)`, { section: t, questions: count }, meta);
    return { message: 'Section removed; its questions are kept', data: { title: t, questions: count } };
  }

  /**
   * Move one question into a section (or out of every section, title null): its heading changes and
   * it goes to the end of that section (the end of the survey for "no section" or a new section).
   * Allowed once people have answered (a heading changes no answer); "Show only if" rules decide.
   */
  async place(actor: RequestUser, surveyId: string, questionId: string, title: string | null, meta?: RequestAuditMeta) {
    const survey = await this.requireEditable(actor, surveyId);
    const rows = await this.ordered(surveyId);
    const moving = rows.find((q) => q.id === questionId);
    if (!moving) throw new NotFoundException('Question not found');
    const target = title?.trim() || null;
    if (target && target.length > SECTION_TITLE_MAX) throw new BadRequestException(`A section name can be at most ${SECTION_TITLE_MAX} characters.`);
    const rest = rows.filter((q) => q.id !== questionId);
    const lastIn = target ? rest.map((q) => q.sectionTitle?.trim() ?? '').lastIndexOf(target) : -1;
    const at = lastIn >= 0 ? lastIn + 1 : rest.length;
    const next = [...rest.slice(0, at), { ...moving, sectionTitle: target }, ...rest.slice(at)];
    // The heading and the new order together (one transaction).
    await this.saveOrder(next, `This question cannot move to ${target ? `"${target}"` : 'the end'}:`, (tx) =>
      tx.surveyQuestion.update({ where: { id: questionId }, data: { sectionTitle: target } }),
    );
    await this.log(
      actor,
      survey,
      target ? `A question moved into section "${target}"` : 'A question moved out of its section',
      { questionId, from: moving.sectionTitle ?? null, to: target },
      meta,
    );
    return { message: target ? `Moved to "${target}"` : 'Moved out of its section', data: { questionId, title: target } };
  }

  /** A section split across the survey: bring its questions together where it first appears. */
  async gather(actor: RequestUser, surveyId: string, title: string, meta?: RequestAuditMeta) {
    const survey = await this.requireEditable(actor, surveyId);
    const rows = await this.ordered(surveyId);
    const t = this.requireSection(rows, title);
    const inSection = rows.filter((q) => q.sectionTitle?.trim() === t);
    const first = rows.findIndex((q) => q.sectionTitle?.trim() === t);
    const rest = rows.filter((q) => q.sectionTitle?.trim() !== t);
    const before = rows.slice(0, first).filter((q) => q.sectionTitle?.trim() !== t).length;
    const next = [...rest.slice(0, before), ...inSection, ...rest.slice(before)];
    await this.saveOrder(next, `The questions of "${t}" cannot be put together:`);
    await this.log(actor, survey, `Section "${t}" put back together`, { section: t }, meta);
    return { message: 'Section put together', data: { title: t } };
  }
}
