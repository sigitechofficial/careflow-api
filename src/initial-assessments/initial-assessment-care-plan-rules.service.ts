import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CarePathwayFormType, Prisma, ServiceUserMedicalConditionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CarePlanRecommendation, CarePlanTriggerItem } from './initial-assessment-care-plan.util';
import {
  ruleConditionsFromJson,
  submissionAnswersForRules,
  type AdlRowForRules,
} from './initial-assessment-care-plan-rules.util';
import { computeCarePlanRecommendations } from './initial-assessment-care-plan-recommendations.util';
import {
  isCarePlanTriggerPositive,
  visibleQuestionIdsForSubmission,
} from './initial-assessment-care-plan-triggers.util';
import {
  diagnoseCarePlanRules,
  validateRuleConditionsAgainstTemplate,
} from './initial-assessment-care-plan-rules.validation';
import { isSecureQuestionMetadata } from './initial-assessment-secure-field.util';
import type { CarePlanRecommendationRuleRow, CarePlanRuleCondition } from './initial-assessment-care-plan-rules.types';
import type {
  CreateCarePlanRecommendationRuleDto,
  UpdateCarePlanRecommendationRuleDto,
} from './dto/care-plan-recommendation-rule.dto';
import { IA_CARE_PLAN_STARTER_RULES } from '../../prisma/seeds/initial-assessment-care-plan-rules.seed';
import { readCarePlanDecisions } from './initial-assessment-care-plan-decisions.util';
import {
  planRecommendationPersistence,
  recommendationFromStoredRow,
} from './initial-assessment-care-plan-recommendation-store.util';

type PrismaDb = PrismaService | Prisma.TransactionClient;

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

/** Care plan forms a recommendation may target: not deleted and active (same as form selection). */
const AVAILABLE_CARE_PLAN_FORM_WHERE = {
  formType: CarePathwayFormType.CARE_PLAN,
  deletedAt: null,
  isActive: true,
} satisfies Prisma.CarePathwayFormWhereInput;

const evaluationQuestionSelect = {
  id: true,
  questionText: true,
  questionType: true,
  carePlanTrigger: true,
  metadata: true,
  section: { select: { sectionNumber: true, title: true, carePlanArea: true } },
} satisfies Prisma.InitialAssessmentQuestionSelect;

function adlRowsFromMetadata(metadata: Prisma.JsonValue): AdlRowForRules[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const adl = (metadata as Record<string, unknown>).adl;
  if (!adl || typeof adl !== 'object' || Array.isArray(adl)) return [];
  const rows = (adl as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.score !== 'number' || r.score < 0 || r.score > 4) return [];
    return [{ id: r.id, activity: typeof r.activity === 'string' ? r.activity : r.id, score: r.score }];
  });
}

@Injectable()
export class InitialAssessmentCarePlanRulesService {
  private readonly logger = new Logger(InitialAssessmentCarePlanRulesService.name);
  private readonly reportedInvalidRules = new Set<string>();

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

  private async resolveTemplateId(templateId?: string): Promise<string> {
    const template = templateId
      ? await this.prisma.initialAssessmentTemplate.findFirst({
          where: { id: templateId, deletedAt: null },
        })
      : await this.prisma.initialAssessmentTemplate.findFirst({
          where: { isDefault: true, deletedAt: null },
        });
    if (!template) throw new NotFoundException('Initial assessment template not found');
    return template.id;
  }

  private async loadTemplateQuestionsForRules(templateId: string) {
    return this.prisma.initialAssessmentQuestion.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        section: { templateId, deletedAt: null },
      },
      select: {
        id: true,
        questionText: true,
        questionType: true,
        options: true,
        metadata: true,
        carePlanTrigger: true,
        section: { select: { sectionNumber: true, title: true, carePlanArea: true } },
      },
    });
  }

  async listAssessmentFieldKeys(templateId?: string) {
    const resolvedTemplateId = await this.resolveTemplateId(templateId);

    const questions = await this.prisma.initialAssessmentQuestion.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        section: { templateId: resolvedTemplateId, deletedAt: null },
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
    await this.validateConditions(dto.conditions);

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

    if (dto.conditions) await this.validateConditions(dto.conditions);

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

  /** Read-only health report: invalid targets, unresolvable conditions, warnings and drift from the starter rules. */
  async diagnostics(templateId?: string) {
    const resolvedTemplateId = await this.resolveTemplateId(templateId);
    const [rules, questions] = await Promise.all([
      this.prisma.initialAssessmentCarePlanRecommendationRule.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.loadTemplateQuestionsForRules(resolvedTemplateId),
    ]);
    const forms = await this.prisma.carePathwayForm.findMany({
      where: {
        OR: [
          { id: { in: rules.map((r) => r.carePathwayFormId) } },
          { formType: CarePathwayFormType.CARE_PLAN, deletedAt: null },
        ],
      },
      select: { id: true, name: true, isActive: true, status: true, formType: true, deletedAt: true },
    });
    const report = diagnoseCarePlanRules({
      rules: rules.map((r) => mapRuleRow(r)),
      forms,
      questions,
      starterRules: IA_CARE_PLAN_STARTER_RULES,
    });
    return { data: { templateId: resolvedTemplateId, ...report } };
  }

  /**
   * Care plan recommendations for a submission (rules, legacy area triggers, medical conditions).
   * Answers to questions hidden by an assessment gate are ignored; rules whose target form is
   * deleted or inactive never produce a recommendation.
   */
  async resolveRecommendations(
    submissionId: string,
    db: PrismaDb = this.prisma,
  ): Promise<CarePlanRecommendation[]> {
    const ctx = await this.loadEvaluationContext(submissionId, db);
    if (!ctx) return [];

    const [rules, catalogue] = await Promise.all([this.loadActiveRules(db), this.availableCatalogue(db)]);

    let medicalConditions: Array<{ code: string; name: string }> | null = null;
    if (ctx.serviceUserId) {
      const activeConditions = await db.serviceUserMedicalCondition.findMany({
        where: {
          serviceUserId: ctx.serviceUserId,
          deletedAt: null,
          status: ServiceUserMedicalConditionStatus.ACTIVE,
          isActive: true,
        },
        select: {
          condition: { select: { code: true, name: true } },
        },
      });
      medicalConditions = activeConditions
        .map((row) => ({
          code: row.condition?.code ?? '',
          name: row.condition?.name ?? '',
        }))
        .filter((c) => c.code);
    }

    return computeCarePlanRecommendations({
      rules,
      answers: ctx.answers,
      catalogue,
      medicalConditions,
      visibleQuestionIds: ctx.visibleQuestionIds,
      adlRows: ctx.adlRows,
    });
  }

  /**
   * Recommendations stored when the assessment was submitted; assessments submitted before they were
   * stored (no rows) fall back to live calculation.
   */
  async loadRecommendations(submissionId: string, db: PrismaDb = this.prisma): Promise<CarePlanRecommendation[]> {
    const stored = await db.initialAssessmentCarePlanRecommendation.findMany({
      where: { submissionId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (stored.length === 0) return this.resolveRecommendations(submissionId, db);
    return stored.map(recommendationFromStoredRow);
  }

  /**
   * Stores the calculated recommendations for a submitted assessment, inside the submit transaction.
   * Safe to repeat: existing rows are never duplicated and decided rows are never changed. Decisions
   * already recorded in `metadata.carePlanDecisions` (e.g. a reopened assessment) carry over.
   */
  async persistRecommendations(
    tx: Prisma.TransactionClient,
    input: { submissionId: string; serviceUserId: string; metadata: Prisma.JsonValue },
  ): Promise<{ created: number; refreshed: number }> {
    const [recommendations, existing] = await Promise.all([
      this.resolveRecommendations(input.submissionId, tx),
      tx.initialAssessmentCarePlanRecommendation.findMany({ where: { submissionId: input.submissionId } }),
    ]);
    const plan = planRecommendationPersistence({
      recommendations,
      existing,
      decisions: readCarePlanDecisions(input.metadata),
    });
    if (plan.create.length > 0) {
      await tx.initialAssessmentCarePlanRecommendation.createMany({
        data: plan.create.map((row) => ({
          ...row,
          submissionId: input.submissionId,
          serviceUserId: input.serviceUserId,
        })),
        skipDuplicates: true,
      });
    }
    for (const { id, ...data } of plan.refresh) {
      await tx.initialAssessmentCarePlanRecommendation.updateMany({
        where: { id, status: 'PENDING' },
        data,
      });
    }
    return { created: plan.create.length, refreshed: plan.refresh.length };
  }

  /**
   * Answers to `carePlanTrigger` questions that count as positive (Yes, or substantive text on a
   * free-text question) and are still shown on the assessment.
   */
  async loadCarePlanTriggerItems(submissionId: string): Promise<CarePlanTriggerItem[]> {
    const submission = await this.prisma.initialAssessmentSubmission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: { templateId: true },
    });
    if (!submission) return [];
    const [questions, answers] = await Promise.all([
      this.loadVisibilityQuestions(submission.templateId),
      this.prisma.initialAssessmentAnswer.findMany({
        where: { submissionId },
        include: {
          question: {
            select: {
              ...evaluationQuestionSelect,
              section: { select: { id: true, sectionNumber: true, title: true, carePlanArea: true } },
            },
          },
        },
      }),
    ]);
    const visible = visibleQuestionIdsForSubmission(questions, answers);

    return answers
      .filter(
        (a) =>
          a.question.carePlanTrigger &&
          visible.has(a.questionId) &&
          isCarePlanTriggerPositive({ ...a, questionType: a.question.questionType }),
      )
      .map((a) => {
        const meta = a.question.metadata;
        const specRef =
          meta && typeof meta === 'object' && !Array.isArray(meta) && typeof (meta as { specRef?: unknown }).specRef === 'string'
            ? (meta as { specRef: string }).specRef
            : undefined;
        return {
          answerId: a.id,
          questionId: a.questionId,
          questionText: a.question.questionText,
          notes: a.notes,
          textValue: isSecureQuestionMetadata(a.question.metadata) ? null : a.textValue,
          section: a.question.section,
          carePlanArea: a.question.section.carePlanArea,
          specRef,
        };
      });
  }

  private async loadVisibilityQuestions(templateId: string, db: PrismaDb = this.prisma) {
    return db.initialAssessmentQuestion.findMany({
      where: { isActive: true, deletedAt: null, section: { templateId, deletedAt: null } },
      select: { id: true, questionText: true, metadata: true, section: { select: { sectionNumber: true } } },
    });
  }

  private async loadEvaluationContext(submissionId: string, db: PrismaDb) {
    const submission = await db.initialAssessmentSubmission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: { serviceUserId: true, templateId: true, metadata: true },
    });
    if (!submission) return null;

    const [questions, answers] = await Promise.all([
      this.loadVisibilityQuestions(submission.templateId, db),
      db.initialAssessmentAnswer.findMany({
        where: { submissionId },
        include: { question: { select: evaluationQuestionSelect } },
      }),
    ]);

    return {
      serviceUserId: submission.serviceUserId,
      answers: submissionAnswersForRules(answers),
      visibleQuestionIds: visibleQuestionIdsForSubmission(questions, answers),
      adlRows: adlRowsFromMetadata(submission.metadata),
    };
  }

  private availableCatalogue(db: PrismaDb) {
    return db.carePathwayForm.findMany({
      where: AVAILABLE_CARE_PLAN_FORM_WHERE,
      select: { id: true, name: true },
    });
  }

  /** Active rules whose target form is available; others are reported once and skipped. */
  private async loadActiveRules(db: PrismaDb): Promise<CarePlanRecommendationRuleRow[]> {
    const rules = await db.initialAssessmentCarePlanRecommendationRule.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (rules.length === 0) return [];

    const forms = await db.carePathwayForm.findMany({
      where: { id: { in: rules.map((r) => r.carePathwayFormId) }, ...AVAILABLE_CARE_PLAN_FORM_WHERE },
      select: { id: true, name: true },
    });
    const formMap = new Map(forms.map((f) => [f.id, f.name]));

    const valid = rules.filter((r) => formMap.has(r.carePathwayFormId));
    for (const r of rules) {
      if (formMap.has(r.carePathwayFormId) || this.reportedInvalidRules.has(r.id)) continue;
      this.reportedInvalidRules.add(r.id);
      this.logger.warn(
        `IA care plan rule ${r.id} targets care plan form ${r.carePathwayFormId}, which is deleted, inactive or missing — rule skipped. See the rules diagnostics report.`,
      );
    }

    return valid.map((r) => mapRuleRow({ ...r, formName: formMap.get(r.carePathwayFormId) }));
  }

  private async assertCarePlanForm(formId: string) {
    const form = await this.prisma.carePathwayForm.findFirst({
      where: { id: formId, ...AVAILABLE_CARE_PLAN_FORM_WHERE },
    });
    if (!form) throw new BadRequestException('Care plan form not found or not active');
  }

  private async validateConditions(conditions: CarePlanRuleCondition[]) {
    const templateId = await this.resolveTemplateId();
    const questions = await this.loadTemplateQuestionsForRules(templateId);
    const { errors } = validateRuleConditionsAgainstTemplate(conditions, questions);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(' '));
    }
  }
}
