import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { LearningCoursesService } from './learning-courses.service';
import {
  logLearningChange,
  withoutKey,
  type LearningActor,
} from './learning-audit.util';
import { checkedQuestionOptions } from './learning-quiz-rules.util';
import {
  CreateAssessmentQuestionDto,
  CreateLearningAssessmentDto,
  ReorderAssessmentQuestionsDto,
  UpdateAssessmentQuestionDto,
  UpdateLearningAssessmentDto,
} from './dto/learning.dto';

@Injectable()
export class LearningAssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: LearningCoursesService,
    private readonly audit: AuditLogsService,
  ) {}

  async createAssessment(
    versionId: string,
    dto: CreateLearningAssessmentDto,
    actor?: LearningActor,
  ) {
    await this.courses.assertDraftVersion(versionId);
    const sectionId = dto.sectionId ?? null;
    if (sectionId) {
      const section = await this.prisma.learningCourseSection.findFirst({
        where: { id: sectionId, courseVersionId: versionId },
        select: { id: true },
      });
      if (!section) {
        throw new BadRequestException(
          'That module is not in this course version',
        );
      }
    }
    // Added in order: last place among this module's quizzes (or among final assessments).
    const last = await this.prisma.learningAssessment.findFirst({
      where: { courseVersionId: versionId, sectionId },
      orderBy: { displayOrder: 'desc' },
      select: { displayOrder: true },
    });
    const row = await this.prisma.learningAssessment.create({
      data: {
        ...dto,
        courseVersionId: versionId,
        sectionId,
        displayOrder: last ? last.displayOrder + 1 : 0,
        // Final assessments are always required (agreed 13 Nov 2026).
        isRequired: sectionId ? (dto.isRequired ?? true) : true,
      },
    });
    await logLearningChange(this.audit, actor, {
      action: 'learning_quiz_created',
      recordType: 'LearningAssessment',
      recordId: row.id,
      newValues: row,
    });
    return row;
  }

  async updateAssessment(
    assessmentId: string,
    dto: UpdateLearningAssessmentDto,
    actor?: LearningActor,
  ) {
    const assessment = await this.prisma.learningAssessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');
    await this.courses.assertDraftVersion(assessment.courseVersionId);
    if (!assessment.sectionId && dto.isRequired === false) {
      throw new BadRequestException('A final assessment is always required');
    }
    const row = await this.prisma.learningAssessment.update({
      where: { id: assessmentId },
      data: dto,
    });
    await logLearningChange(this.audit, actor, {
      action: 'learning_quiz_updated',
      recordType: 'LearningAssessment',
      recordId: assessmentId,
      oldValues: assessment,
      newValues: row,
    });
    return row;
  }

  async deleteAssessment(assessmentId: string, actor?: LearningActor) {
    const assessment = await this.prisma.learningAssessment.findUnique({
      where: { id: assessmentId },
      include: { questions: { include: { options: true } } },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');
    await this.courses.assertDraftVersion(assessment.courseVersionId);
    await this.prisma.learningAssessment.delete({ where: { id: assessmentId } });
    await logLearningChange(this.audit, actor, {
      action: 'learning_quiz_deleted',
      recordType: 'LearningAssessment',
      recordId: assessmentId,
      oldValues: assessment,
    });
    return { id: assessmentId, deleted: true };
  }

  async createQuestion(
    assessmentId: string,
    dto: CreateAssessmentQuestionDto,
    actor?: LearningActor,
  ) {
    const assessment = await this.prisma.learningAssessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');
    await this.courses.assertDraftVersion(assessment.courseVersionId);

    const options = checkedQuestionOptions(
      dto.questionType,
      dto.questionText,
      dto.options,
    );
    // New questions go to the end unless an order is given.
    let displayOrder = dto.displayOrder;
    if (displayOrder === undefined) {
      const last = await this.prisma.learningAssessmentQuestion.findFirst({
        where: { assessmentId },
        orderBy: { displayOrder: 'desc' },
        select: { displayOrder: true },
      });
      displayOrder = last ? last.displayOrder + 1 : 0;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const question = await tx.learningAssessmentQuestion.create({
        data: {
          assessmentId,
          questionType: dto.questionType,
          questionText: dto.questionText.trim(),
          explanation: dto.explanation?.trim() || null,
          points: dto.points ?? 1,
          displayOrder,
          options: { create: options },
        },
      });
      return tx.learningAssessmentQuestion.findUnique({
        where: { id: question.id },
        include: { options: { orderBy: { displayOrder: 'asc' } } },
      });
    });
    if (created) {
      await logLearningChange(this.audit, actor, {
        action: 'learning_question_created',
        recordType: 'LearningAssessmentQuestion',
        recordId: created.id,
        newValues: created,
      });
    }
    return created;
  }

  async updateQuestion(
    questionId: string,
    dto: UpdateAssessmentQuestionDto,
    actor?: LearningActor,
  ) {
    const question = await this.prisma.learningAssessmentQuestion.findUnique({
      where: { id: questionId },
      include: {
        assessment: true,
        options: { orderBy: { displayOrder: 'asc' } },
      },
    });
    if (!question) throw new NotFoundException('Question not found');
    await this.courses.assertDraftVersion(question.assessment.courseVersionId);

    // Check the question as it will be after the change.
    const questionType = dto.questionType ?? question.questionType;
    const questionText = dto.questionText ?? question.questionText;
    const options = checkedQuestionOptions(
      questionType,
      questionText,
      dto.options ?? question.options,
    );
    const optionsChanged =
      dto.options !== undefined || dto.questionType !== undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.learningAssessmentQuestion.update({
        where: { id: questionId },
        data: {
          questionType,
          questionText: questionText.trim(),
          ...(dto.explanation !== undefined
            ? { explanation: dto.explanation?.trim() || null }
            : {}),
          points: dto.points,
          displayOrder: dto.displayOrder,
        },
      });

      if (optionsChanged) {
        await tx.learningAssessmentOption.deleteMany({ where: { questionId } });
        await tx.learningAssessmentOption.createMany({
          data: options.map((o) => ({ ...o, questionId })),
        });
      }

      return tx.learningAssessmentQuestion.findUnique({
        where: { id: updated.id },
        include: { options: { orderBy: { displayOrder: 'asc' } } },
      });
    });
    const before = withoutKey(question, 'assessment');
    await logLearningChange(this.audit, actor, {
      action: 'learning_question_updated',
      recordType: 'LearningAssessmentQuestion',
      recordId: questionId,
      oldValues: before,
      newValues: result,
    });
    return result;
  }

  async reorderQuestions(
    assessmentId: string,
    dto: ReorderAssessmentQuestionsDto,
    actor?: LearningActor,
  ) {
    const assessment = await this.prisma.learningAssessment.findUnique({
      where: { id: assessmentId },
      include: {
        questions: {
          select: { id: true, displayOrder: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');
    await this.courses.assertDraftVersion(assessment.courseVersionId);
    const current = assessment.questions.map((q) => q.id);
    const same =
      dto.questionIds.length === current.length &&
      new Set(dto.questionIds).size === current.length &&
      dto.questionIds.every((id) => current.includes(id));
    if (!same)
      throw new BadRequestException(
        'Send every question of this quiz exactly once',
      );
    await this.prisma.$transaction(
      dto.questionIds.map((id, index) =>
        this.prisma.learningAssessmentQuestion.update({
          where: { id },
          data: { displayOrder: index },
        }),
      ),
    );
    await logLearningChange(this.audit, actor, {
      action: 'learning_questions_reordered',
      recordType: 'LearningAssessment',
      recordId: assessmentId,
      oldValues: { questionIds: current },
      newValues: { questionIds: dto.questionIds },
    });
    return { id: assessmentId, questionIds: dto.questionIds };
  }

  async deleteQuestion(questionId: string, actor?: LearningActor) {
    const question = await this.prisma.learningAssessmentQuestion.findUnique({
      where: { id: questionId },
      include: { assessment: true, options: true },
    });
    if (!question) throw new NotFoundException('Question not found');
    await this.courses.assertDraftVersion(question.assessment.courseVersionId);
    await this.prisma.learningAssessmentQuestion.delete({ where: { id: questionId } });
    const before = withoutKey(question, 'assessment');
    await logLearningChange(this.audit, actor, {
      action: 'learning_question_deleted',
      recordType: 'LearningAssessmentQuestion',
      recordId: questionId,
      oldValues: before,
    });
    return { id: questionId, deleted: true };
  }
}
