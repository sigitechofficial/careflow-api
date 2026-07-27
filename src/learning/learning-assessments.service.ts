import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LearningCoursesService } from './learning-courses.service';
import {
  CreateAssessmentQuestionDto,
  CreateLearningAssessmentDto,
  UpdateAssessmentQuestionDto,
  UpdateLearningAssessmentDto,
} from './dto/learning.dto';

@Injectable()
export class LearningAssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: LearningCoursesService,
  ) {}

  async createAssessment(versionId: string, dto: CreateLearningAssessmentDto) {
    await this.courses.assertDraftVersion(versionId);
    return this.prisma.learningAssessment.create({
      data: { courseVersionId: versionId, ...dto },
    });
  }

  async updateAssessment(assessmentId: string, dto: UpdateLearningAssessmentDto) {
    const assessment = await this.prisma.learningAssessment.findUnique({ where: { id: assessmentId } });
    if (!assessment) throw new NotFoundException('Assessment not found');
    await this.courses.assertDraftVersion(assessment.courseVersionId);
    return this.prisma.learningAssessment.update({ where: { id: assessmentId }, data: dto });
  }

  async deleteAssessment(assessmentId: string) {
    const assessment = await this.prisma.learningAssessment.findUnique({ where: { id: assessmentId } });
    if (!assessment) throw new NotFoundException('Assessment not found');
    await this.courses.assertDraftVersion(assessment.courseVersionId);
    await this.prisma.learningAssessment.delete({ where: { id: assessmentId } });
    return { id: assessmentId, deleted: true };
  }

  async createQuestion(assessmentId: string, dto: CreateAssessmentQuestionDto) {
    const assessment = await this.prisma.learningAssessment.findUnique({ where: { id: assessmentId } });
    if (!assessment) throw new NotFoundException('Assessment not found');
    await this.courses.assertDraftVersion(assessment.courseVersionId);

    return this.prisma.$transaction(async (tx) => {
      const question = await tx.learningAssessmentQuestion.create({
        data: {
          assessmentId,
          questionType: dto.questionType,
          questionText: dto.questionText,
          explanation: dto.explanation,
          points: dto.points ?? 1,
          displayOrder: dto.displayOrder ?? 0,
        },
      });

      if (dto.options?.length) {
        for (const option of dto.options) {
          await tx.learningAssessmentOption.create({
            data: {
              questionId: question.id,
              optionText: option.optionText,
              isCorrect: option.isCorrect ?? false,
              displayOrder: option.displayOrder ?? 0,
            },
          });
        }
      }

      return tx.learningAssessmentQuestion.findUnique({
        where: { id: question.id },
        include: { options: { orderBy: { displayOrder: 'asc' } } },
      });
    });
  }

  async updateQuestion(questionId: string, dto: UpdateAssessmentQuestionDto) {
    const question = await this.prisma.learningAssessmentQuestion.findUnique({
      where: { id: questionId },
      include: { assessment: true },
    });
    if (!question) throw new NotFoundException('Question not found');
    await this.courses.assertDraftVersion(question.assessment.courseVersionId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.learningAssessmentQuestion.update({
        where: { id: questionId },
        data: {
          questionType: dto.questionType,
          questionText: dto.questionText,
          explanation: dto.explanation,
          points: dto.points,
          displayOrder: dto.displayOrder,
        },
      });

      if (dto.options) {
        await tx.learningAssessmentOption.deleteMany({ where: { questionId } });
        for (const option of dto.options) {
          await tx.learningAssessmentOption.create({
            data: {
              questionId,
              optionText: option.optionText,
              isCorrect: option.isCorrect ?? false,
              displayOrder: option.displayOrder ?? 0,
            },
          });
        }
      }

      return tx.learningAssessmentQuestion.findUnique({
        where: { id: updated.id },
        include: { options: { orderBy: { displayOrder: 'asc' } } },
      });
    });
  }

  async deleteQuestion(questionId: string) {
    const question = await this.prisma.learningAssessmentQuestion.findUnique({
      where: { id: questionId },
      include: { assessment: true },
    });
    if (!question) throw new NotFoundException('Question not found');
    await this.courses.assertDraftVersion(question.assessment.courseVersionId);
    await this.prisma.learningAssessmentQuestion.delete({ where: { id: questionId } });
    return { id: questionId, deleted: true };
  }
}
