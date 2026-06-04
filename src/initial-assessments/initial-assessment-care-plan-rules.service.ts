import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CarePathwayFormType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CarePlanRecommendation } from './initial-assessment-care-plan.util';
import { enrichCarePlanRecommendationsWithForms } from './initial-assessment-care-plan-area-map.util';
import { buildCarePlanRecommendations } from './initial-assessment-care-plan.util';
import {
  buildRecommendationsFromRules,
  mergeCarePlanRecommendations,
  ruleConditionsFromJson,
  submissionAnswersForRules,
} from './initial-assessment-care-plan-rules.util';
import type { CarePlanRecommendationRuleRow } from './initial-assessment-care-plan-rules.types';
import type {
  CreateCarePlanRecommendationRuleDto,
  UpdateCarePlanRecommendationRuleDto,
} from './dto/care-plan-recommendation-rule.dto';
import type { CarePlanTriggerItem } from './initial-assessment-care-plan.util';

function mapRuleRow(row: {
  id: string;
  carePathwayFormId: string;
  label: string | null;
  matchMode: 'ANY' | 'ALL';
  conditions: Prisma.JsonValue;
  suppressLegacyArea: string | null;
  sortOrder: number;
  isActive: boolean;
  formName?: string;
}): CarePlanRecommendationRuleRow {
  return {
    id: row.id,
    carePathwayFormId: row.carePathwayFormId,
    label: row.label,
    matchMode: row.matchMode,
    conditions: ruleConditionsFromJson(row.conditions),
    suppressLegacyArea: row.suppressLegacyArea,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    formName: row.formName,
  };
}

@Injectable()
export class InitialAssessmentCarePlanRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async listCarePlanForms() {
    const rows = await this.prisma.carePathwayForm.findMany({
      where: {
        deletedAt: null,
        formType: CarePathwayFormType.CARE_PLAN,
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        isActive: true,
      },
    });
    return { data: rows };
  }

  async listRules() {
    const rules = await this.prisma.initialAssessmentCarePlanRecommendationRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const formIds = [...new Set(rules.map((r) => r.carePathwayFormId))];
    const forms = formIds.length
      ? await this.prisma.carePathwayForm.findMany({
          where: { id: { in: formIds }, deletedAt: null },
          select: { id: true, name: true, formType: true, status: true },
        })
      : [];
    const formMap = new Map(forms.map((f) => [f.id, f]));

    return {
      data: rules.map((r) => ({
        ...r,
        conditions: ruleConditionsFromJson(r.conditions),
        form: formMap.get(r.carePathwayFormId) ?? null,
      })),
    };
  }

  async listAssessmentFieldKeys(templateId?: string) {
    const template = templateId
      ? await this.prisma.initialAssessmentTemplate.findFirst({
          where: { id: templateId, deletedAt: null },
        })
      : await this.prisma.initialAssessmentTemplate.findFirst({
          where: { isDefault: true, deletedAt: null },
        });
    if (!template) throw new NotFoundException('Initial assessment template not found');

    const questions = await this.prisma.initialAssessmentQuestion.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        section: { templateId: template.id, deletedAt: null },
      },
      select: {
        id: true,
        questionText: true,
        questionType: true,
        carePlanTrigger: true,
        metadata: true,
        section: { select: { sectionNumber: true, title: true, carePlanArea: true } },
      },
      orderBy: [{ section: { sectionNumber: 'asc' } }, { sortOrder: 'asc' }],
    });

    const rows = questions.map((q) => {
      const meta =
        q.metadata && typeof q.metadata === 'object' && !Array.isArray(q.metadata)
          ? (q.metadata as Record<string, unknown>)
          : {};
      return {
        questionId: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        carePlanTrigger: q.carePlanTrigger,
        fieldKey: typeof meta.fieldKey === 'string' ? meta.fieldKey : null,
        specRef: typeof meta.specRef === 'string' ? meta.specRef : null,
        sectionNumber: q.section.sectionNumber,
        sectionTitle: q.section.title,
        carePlanArea: q.section.carePlanArea,
      };
    });

    return { data: rows };
  }

  async createRule(dto: CreateCarePlanRecommendationRuleDto) {
    await this.assertCarePlanForm(dto.carePathwayFormId);
    this.validateConditions(dto.conditions);

    const existing = await this.prisma.initialAssessmentCarePlanRecommendationRule.findFirst({
      where: { carePathwayFormId: dto.carePathwayFormId, deletedAt: null },
    });
    if (existing) {
      throw new BadRequestException('A rule already exists for this care plan. Edit the existing rule instead.');
    }

    const row = await this.prisma.initialAssessmentCarePlanRecommendationRule.create({
      data: {
        carePathwayFormId: dto.carePathwayFormId,
        label: dto.label?.trim() || null,
        matchMode: dto.matchMode ?? 'ANY',
        conditions: dto.conditions as unknown as Prisma.InputJsonValue,
        suppressLegacyArea: dto.suppressLegacyArea?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    return { data: { ...row, conditions: ruleConditionsFromJson(row.conditions) } };
  }

  async updateRule(id: string, dto: UpdateCarePlanRecommendationRuleDto) {
    const existing = await this.prisma.initialAssessmentCarePlanRecommendationRule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Rule not found');

    if (dto.carePathwayFormId && dto.carePathwayFormId !== existing.carePathwayFormId) {
      await this.assertCarePlanForm(dto.carePathwayFormId);
      const conflict = await this.prisma.initialAssessmentCarePlanRecommendationRule.findFirst({
        where: { carePathwayFormId: dto.carePathwayFormId, deletedAt: null, id: { not: id } },
      });
      if (conflict) throw new BadRequestException('Another rule already uses this care plan');
    }

    if (dto.conditions) this.validateConditions(dto.conditions);

    const row = await this.prisma.initialAssessmentCarePlanRecommendationRule.update({
      where: { id },
      data: {
        ...(dto.carePathwayFormId !== undefined ? { carePathwayFormId: dto.carePathwayFormId } : {}),
        ...(dto.label !== undefined ? { label: dto.label?.trim() || null } : {}),
        ...(dto.matchMode !== undefined ? { matchMode: dto.matchMode } : {}),
        ...(dto.conditions !== undefined
          ? { conditions: dto.conditions as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.suppressLegacyArea !== undefined
          ? { suppressLegacyArea: dto.suppressLegacyArea?.trim() || null }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return { data: { ...row, conditions: ruleConditionsFromJson(row.conditions) } };
  }

  async deleteRule(id: string) {
    const existing = await this.prisma.initialAssessmentCarePlanRecommendationRule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Rule not found');
    await this.prisma.initialAssessmentCarePlanRecommendationRule.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Rule deleted' };
  }

  async resolveRecommendations(
    submissionId: string,
    legacyTriggerItems: CarePlanTriggerItem[],
  ): Promise<CarePlanRecommendation[]> {
    const rules = await this.loadActiveRules();
    if (rules.length === 0) {
      return buildCarePlanRecommendations(legacyTriggerItems);
    }

    const answers = await this.prisma.initialAssessmentAnswer.findMany({
      where: { submissionId },
      include: {
        question: {
          select: {
            questionText: true,
            metadata: true,
            section: {
              select: { sectionNumber: true, title: true, carePlanArea: true },
            },
          },
        },
      },
    });

    const answerRows = submissionAnswersForRules(answers);
    const ruleBased = buildRecommendationsFromRules(rules, answerRows);
    const legacy = buildCarePlanRecommendations(legacyTriggerItems);
    const suppressAreas = rules
      .filter((r) => r.suppressLegacyArea)
      .map((r) => r.suppressLegacyArea as string);

    const merged = mergeCarePlanRecommendations(ruleBased, legacy, suppressAreas);
    const catalogue = await this.prisma.carePathwayForm.findMany({
      where: { formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
      select: { id: true, name: true },
    });
    enrichCarePlanRecommendationsWithForms(merged, catalogue);
    return merged;
  }

  private async loadActiveRules(): Promise<CarePlanRecommendationRuleRow[]> {
    const rules = await this.prisma.initialAssessmentCarePlanRecommendationRule.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (rules.length === 0) return [];

    const forms = await this.prisma.carePathwayForm.findMany({
      where: { id: { in: rules.map((r) => r.carePathwayFormId) }, deletedAt: null },
      select: { id: true, name: true },
    });
    const formMap = new Map(forms.map((f) => [f.id, f.name]));

    return rules.map((r) =>
      mapRuleRow({ ...r, formName: formMap.get(r.carePathwayFormId) }),
    );
  }

  private async assertCarePlanForm(formId: string) {
    const form = await this.prisma.carePathwayForm.findFirst({
      where: { id: formId, deletedAt: null, formType: CarePathwayFormType.CARE_PLAN },
    });
    if (!form) throw new BadRequestException('Care plan form not found');
  }

  private validateConditions(
    conditions: Array<{
      fieldKey?: string;
      specRef?: string;
      questionTextContains?: string;
      when: string;
    }>,
  ) {
    for (const c of conditions) {
      if (!c.fieldKey && !c.specRef && !c.questionTextContains) {
        throw new BadRequestException(
          'Each condition needs fieldKey, specRef, or questionTextContains',
        );
      }
    }
  }
}
