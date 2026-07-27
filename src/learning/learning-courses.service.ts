import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LearningCourseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  CreateLearningCourseDto,
  CreateLearningCourseVersionDto,
  LearningCourseQueryDto,
  PublishLearningCourseDto,
  UpdateLearningCourseDto,
} from './dto/learning.dto';

@Injectable()
export class LearningCoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private mapCourse(row: Prisma.LearningCourseGetPayload<object>) {
    return {
      id: row.id,
      categoryId: row.categoryId,
      title: row.title,
      code: row.code,
      shortDescription: row.shortDescription,
      description: row.description,
      thumbnailFileId: row.thumbnailFileId,
      courseType: row.courseType,
      deliveryMethod: row.deliveryMethod,
      difficultyLevel: row.difficultyLevel,
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      cpdMinutes: row.cpdMinutes,
      isMandatory: row.isMandatory,
      requiresAssessment: row.requiresAssessment,
      requiresPracticalAssessment: row.requiresPracticalAssessment,
      requiresManagerApproval: row.requiresManagerApproval,
      requiresTrainingEvent: row.requiresTrainingEvent,
      passingScore: row.passingScore,
      maximumAttempts: row.maximumAttempts,
      certificateEnabled: row.certificateEnabled,
      certificateValidityDays: row.certificateValidityDays,
      refresherFrequencyDays: row.refresherFrequencyDays,
      effectiveFrom: row.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      reviewDate: row.reviewDate?.toISOString().slice(0, 10) ?? null,
      status: row.status,
      currentVersionId: row.currentVersionId,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapVersion(row: Prisma.LearningCourseVersionGetPayload<object>) {
    return {
      id: row.id,
      courseId: row.courseId,
      versionNumber: row.versionNumber,
      versionLabel: row.versionLabel,
      titleSnapshot: row.titleSnapshot,
      descriptionSnapshot: row.descriptionSnapshot,
      passingScore: row.passingScore,
      maximumAttempts: row.maximumAttempts,
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      cpdMinutes: row.cpdMinutes,
      certificateValidityDays: row.certificateValidityDays,
      refresherFrequencyDays: row.refresherFrequencyDays,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      publishedById: row.publishedById,
      changeSummary: row.changeSummary,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async assertDraftVersion(versionId: string) {
    const version = await this.prisma.learningCourseVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Course version not found');
    if (version.status !== LearningCourseStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT versions can be edited');
    }
    return version;
  }

  async list(query: LearningCourseQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { code: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.learningCourse.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningCourse.count({ where }),
    ]);

    return { data: rows.map((r) => this.mapCourse(r)), meta: buildPaginationMeta({ page, limit, total }) };
  }

  async getById(id: string) {
    const row = await this.prisma.learningCourse.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Course not found');
    return this.mapCourse(row);
  }

  async create(userId: string, dto: CreateLearningCourseDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.learningCourse.findFirst({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Course code already exists');

    const result = await this.prisma.$transaction(async (tx) => {
      const course = await tx.learningCourse.create({
        data: {
          ...dto,
          status: LearningCourseStatus.DRAFT,
          createdById: userId,
          updatedById: userId,
        },
      });

      const version = await tx.learningCourseVersion.create({
        data: {
          courseId: course.id,
          versionNumber: 1,
          versionLabel: 'v1',
          titleSnapshot: course.title,
          descriptionSnapshot: course.description,
          passingScore: course.passingScore,
          maximumAttempts: course.maximumAttempts,
          estimatedDurationMinutes: course.estimatedDurationMinutes,
          cpdMinutes: course.cpdMinutes,
          certificateValidityDays: course.certificateValidityDays,
          refresherFrequencyDays: course.refresherFrequencyDays,
          status: LearningCourseStatus.DRAFT,
        },
      });

      return { course, version };
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_course_created',
      recordType: 'LearningCourse',
      recordId: result.course.id,
      newValues: { course: this.mapCourse(result.course), version: this.mapVersion(result.version) },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { ...this.mapCourse(result.course), initialVersion: this.mapVersion(result.version) };
  }

  async update(id: string, userId: string, dto: UpdateLearningCourseDto, meta?: RequestAuditMeta) {
    const existing = await this.getById(id);
    if (dto.code && dto.code !== existing.code) {
      const clash = await this.prisma.learningCourse.findFirst({ where: { code: dto.code } });
      if (clash) throw new ConflictException('Course code already exists');
    }

    const row = await this.prisma.learningCourse.update({
      where: { id },
      data: { ...dto, updatedById: userId },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_course_updated',
      recordType: 'LearningCourse',
      recordId: id,
      oldValues: existing,
      newValues: this.mapCourse(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapCourse(row);
  }

  async publish(id: string, userId: string, dto: PublishLearningCourseDto, meta?: RequestAuditMeta) {
    const course = await this.prisma.learningCourse.findFirst({ where: { id, deletedAt: null } });
    if (!course) throw new NotFoundException('Course not found');

    const draftVersion = await this.prisma.learningCourseVersion.findFirst({
      where: { courseId: id, status: LearningCourseStatus.DRAFT },
      orderBy: { versionNumber: 'desc' },
    });
    if (!draftVersion) throw new BadRequestException('No DRAFT version available to publish');

    const result = await this.prisma.$transaction(async (tx) => {
      if (course.currentVersionId) {
        await tx.learningCourseVersion.updateMany({
          where: { courseId: id, status: LearningCourseStatus.PUBLISHED },
          data: { status: LearningCourseStatus.SUPERSEDED },
        });
      }

      const published = await tx.learningCourseVersion.update({
        where: { id: draftVersion.id },
        data: {
          status: LearningCourseStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedById: userId,
          changeSummary: dto.changeSummary ?? draftVersion.changeSummary,
          titleSnapshot: course.title,
          descriptionSnapshot: course.description,
          passingScore: course.passingScore,
          maximumAttempts: course.maximumAttempts,
          estimatedDurationMinutes: course.estimatedDurationMinutes,
          cpdMinutes: course.cpdMinutes,
          certificateValidityDays: course.certificateValidityDays,
          refresherFrequencyDays: course.refresherFrequencyDays,
        },
      });

      const updatedCourse = await tx.learningCourse.update({
        where: { id },
        data: {
          status: LearningCourseStatus.PUBLISHED,
          currentVersionId: published.id,
          updatedById: userId,
        },
      });

      return { course: updatedCourse, version: published };
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_course_published',
      recordType: 'LearningCourse',
      recordId: id,
      newValues: { course: this.mapCourse(result.course), version: this.mapVersion(result.version) },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { course: this.mapCourse(result.course), version: this.mapVersion(result.version) };
  }

  async createVersion(
    id: string,
    userId: string,
    dto: CreateLearningCourseVersionDto,
    meta?: RequestAuditMeta,
  ) {
    const course = await this.prisma.learningCourse.findFirst({ where: { id, deletedAt: null } });
    if (!course) throw new NotFoundException('Course not found');

    const latest = await this.prisma.learningCourseVersion.findFirst({
      where: { courseId: id },
      orderBy: { versionNumber: 'desc' },
    });
    if (!latest) throw new BadRequestException('Course has no versions');

    const existingDraft = await this.prisma.learningCourseVersion.findFirst({
      where: { courseId: id, status: LearningCourseStatus.DRAFT },
    });
    if (existingDraft) {
      throw new BadRequestException('A DRAFT version already exists');
    }

    const source = await this.prisma.learningCourseVersion.findUnique({
      where: { id: course.currentVersionId ?? latest.id },
      include: {
        sections: {
          orderBy: { displayOrder: 'asc' },
          include: {
            contentItems: { orderBy: { displayOrder: 'asc' } },
          },
        },
        assessments: {
          include: {
            questions: {
              orderBy: { displayOrder: 'asc' },
              include: { options: { orderBy: { displayOrder: 'asc' } } },
            },
          },
        },
      },
    });
    if (!source) throw new NotFoundException('Source version not found');

    const newVersion = await this.prisma.$transaction(async (tx) => {
      const version = await tx.learningCourseVersion.create({
        data: {
          courseId: id,
          versionNumber: latest.versionNumber + 1,
          versionLabel: dto.versionLabel ?? `v${latest.versionNumber + 1}`,
          titleSnapshot: course.title,
          descriptionSnapshot: course.description,
          passingScore: course.passingScore,
          maximumAttempts: course.maximumAttempts,
          estimatedDurationMinutes: course.estimatedDurationMinutes,
          cpdMinutes: course.cpdMinutes,
          certificateValidityDays: course.certificateValidityDays,
          refresherFrequencyDays: course.refresherFrequencyDays,
          changeSummary: dto.changeSummary,
          status: LearningCourseStatus.DRAFT,
        },
      });

      for (const section of source.sections) {
        const newSection = await tx.learningCourseSection.create({
          data: {
            courseVersionId: version.id,
            title: section.title,
            description: section.description,
            displayOrder: section.displayOrder,
            isRequired: section.isRequired,
            estimatedDurationMinutes: section.estimatedDurationMinutes,
          },
        });

        for (const item of section.contentItems) {
          await tx.learningContentItem.create({
            data: {
              courseSectionId: newSection.id,
              contentType: item.contentType,
              title: item.title,
              description: item.description,
              contentBody: item.contentBody,
              fileId: item.fileId,
              videoUrl: item.videoUrl,
              externalUrl: item.externalUrl,
              displayOrder: item.displayOrder,
              estimatedDurationMinutes: item.estimatedDurationMinutes,
              isRequired: item.isRequired,
              completionRule: item.completionRule,
              minimumTimeSpentSeconds: item.minimumTimeSpentSeconds,
            },
          });
        }
      }

      for (const assessment of source.assessments) {
        const newAssessment = await tx.learningAssessment.create({
          data: {
            courseVersionId: version.id,
            title: assessment.title,
            instructions: assessment.instructions,
            passingScore: assessment.passingScore,
            maximumAttempts: assessment.maximumAttempts,
            timeLimitMinutes: assessment.timeLimitMinutes,
            randomiseQuestions: assessment.randomiseQuestions,
            randomiseAnswers: assessment.randomiseAnswers,
            showCorrectAnswers: assessment.showCorrectAnswers,
            allowReview: assessment.allowReview,
            retakeDelayMinutes: assessment.retakeDelayMinutes,
            isRequired: assessment.isRequired,
          },
        });

        for (const question of assessment.questions) {
          const newQuestion = await tx.learningAssessmentQuestion.create({
            data: {
              assessmentId: newAssessment.id,
              questionType: question.questionType,
              questionText: question.questionText,
              explanation: question.explanation,
              points: question.points,
              displayOrder: question.displayOrder,
              isRequired: question.isRequired,
            },
          });

          for (const option of question.options) {
            await tx.learningAssessmentOption.create({
              data: {
                questionId: newQuestion.id,
                optionText: option.optionText,
                isCorrect: option.isCorrect,
                displayOrder: option.displayOrder,
              },
            });
          }
        }
      }

      return version;
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_course_version_created',
      recordType: 'LearningCourseVersion',
      recordId: newVersion.id,
      newValues: this.mapVersion(newVersion),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapVersion(newVersion);
  }

  async unpublish(id: string, userId: string, meta?: RequestAuditMeta) {
    const course = await this.prisma.learningCourse.findFirst({ where: { id, deletedAt: null } });
    if (!course) throw new NotFoundException('Course not found');
    if (course.status !== LearningCourseStatus.PUBLISHED) {
      throw new BadRequestException('Only PUBLISHED courses can be unpublished to Draft');
    }

    const existingDraft = await this.prisma.learningCourseVersion.findFirst({
      where: { courseId: id, status: LearningCourseStatus.DRAFT },
      orderBy: { versionNumber: 'desc' },
    });

    const publishedVersion = await this.prisma.learningCourseVersion.findFirst({
      where: {
        courseId: id,
        status: LearningCourseStatus.PUBLISHED,
        ...(course.currentVersionId ? { id: course.currentVersionId } : {}),
      },
      orderBy: { versionNumber: 'desc' },
    });

    if (!existingDraft && !publishedVersion) {
      throw new BadRequestException('No published version available to unpublish');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (existingDraft) {
        await tx.learningCourseVersion.updateMany({
          where: { courseId: id, status: LearningCourseStatus.PUBLISHED },
          data: { status: LearningCourseStatus.SUPERSEDED },
        });

        const updatedCourse = await tx.learningCourse.update({
          where: { id },
          data: {
            status: LearningCourseStatus.DRAFT,
            currentVersionId: existingDraft.id,
            updatedById: userId,
          },
        });

        return { course: updatedCourse, version: existingDraft };
      }

      const draftVersion = await tx.learningCourseVersion.update({
        where: { id: publishedVersion!.id },
        data: {
          status: LearningCourseStatus.DRAFT,
          publishedAt: null,
          publishedById: null,
        },
      });

      const updatedCourse = await tx.learningCourse.update({
        where: { id },
        data: {
          status: LearningCourseStatus.DRAFT,
          currentVersionId: draftVersion.id,
          updatedById: userId,
        },
      });

      return { course: updatedCourse, version: draftVersion };
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_course_unpublished',
      recordType: 'LearningCourse',
      recordId: id,
      oldValues: this.mapCourse(course),
      newValues: {
        course: this.mapCourse(result.course),
        version: this.mapVersion(result.version),
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { course: this.mapCourse(result.course), version: this.mapVersion(result.version) };
  }

  async archive(id: string, userId: string, meta?: RequestAuditMeta) {
    const existing = await this.getById(id);
    const row = await this.prisma.learningCourse.update({
      where: { id },
      data: {
        status: LearningCourseStatus.ARCHIVED,
        archivedAt: new Date(),
        updatedById: userId,
      },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_course_archived',
      recordType: 'LearningCourse',
      recordId: id,
      oldValues: existing,
      newValues: this.mapCourse(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapCourse(row);
  }

  async listVersions(courseId: string) {
    await this.getById(courseId);
    const rows = await this.prisma.learningCourseVersion.findMany({
      where: { courseId },
      orderBy: { versionNumber: 'desc' },
    });
    return rows.map((r) => this.mapVersion(r));
  }

  async getVersion(courseId: string, versionId: string) {
    await this.getById(courseId);
    const row = await this.prisma.learningCourseVersion.findFirst({
      where: { id: versionId, courseId },
      include: {
        sections: {
          orderBy: { displayOrder: 'asc' },
          include: { contentItems: { orderBy: { displayOrder: 'asc' } } },
        },
        assessments: {
          include: {
            questions: {
              orderBy: { displayOrder: 'asc' },
              include: { options: { orderBy: { displayOrder: 'asc' } } },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Version not found');

    return {
      ...this.mapVersion(row),
      sections: row.sections.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        displayOrder: s.displayOrder,
        isRequired: s.isRequired,
        estimatedDurationMinutes: s.estimatedDurationMinutes,
        contentItems: s.contentItems.map((c) => ({
          id: c.id,
          contentType: c.contentType,
          title: c.title,
          description: c.description,
          contentBody: c.contentBody,
          fileId: c.fileId,
          videoUrl: c.videoUrl,
          externalUrl: c.externalUrl,
          displayOrder: c.displayOrder,
          isRequired: c.isRequired,
          completionRule: c.completionRule,
          minimumTimeSpentSeconds: c.minimumTimeSpentSeconds,
        })),
      })),
      assessments: row.assessments.map((a) => ({
        id: a.id,
        title: a.title,
        instructions: a.instructions,
        passingScore: a.passingScore,
        maximumAttempts: a.maximumAttempts,
        timeLimitMinutes: a.timeLimitMinutes,
        isRequired: a.isRequired,
        questions: a.questions.map((q) => ({
          id: q.id,
          questionType: q.questionType,
          questionText: q.questionText,
          explanation: q.explanation,
          points: q.points,
          displayOrder: q.displayOrder,
          options: q.options.map((o) => ({
            id: o.id,
            optionText: o.optionText,
            isCorrect: o.isCorrect,
            displayOrder: o.displayOrder,
          })),
        })),
      })),
    };
  }
}
