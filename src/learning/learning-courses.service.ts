import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LearningCourseStatus,
  LearningCourseType,
  LearningDeliveryMethod,
  Prisma,
} from '@prisma/client';
import {
  courseTypeDeliveryError,
  nextCourseCode,
} from './learning-course-rules.util';
import { signedLearningFileUrl } from './learning-file.util';
import { checkPublishable } from './learning-publish-check.util';
import { quizIsRequired } from './learning-quiz-progress.util';
import { sanitizeOptionalRichTextHtml } from '../common/utils/rich-text-html.util';
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
  WithdrawLearningCourseDto,
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
      requiresAssessment: row.requiresAssessment,
      requiresPracticalAssessment: row.requiresPracticalAssessment,
      requiresManagerApproval: row.requiresManagerApproval,
      certificateEnabled: row.certificateEnabled,
      learningObjectives: row.learningObjectives,
      competencyId: row.competencyId,
      competencyChecklistSnapshot: row.competencyChecklistSnapshot,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      publishedById: row.publishedById,
      changeSummary: row.changeSummary,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async assertActiveCategory(categoryId: string) {
    const category = await this.prisma.learningCategory.findFirst({
      where: { id: categoryId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('Choose an active category');
  }

  /** Suggested unique code for a new course in a category, e.g. SAFEGUARDING-003. */
  async suggestCode(categoryId: string) {
    const category = await this.prisma.learningCategory.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { code: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    const prefix = category.code.trim().toUpperCase();
    const rows = await this.prisma.learningCourse.findMany({
      where: { code: { startsWith: `${prefix}-`, mode: 'insensitive' } },
      select: { code: true },
    });
    return {
      code: nextCourseCode(
        prefix,
        rows.map((r) => r.code),
      ),
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

    // The list shows which version is live and, when one is being edited, the draft's number.
    const currentIds = rows
      .map((r) => r.currentVersionId)
      .filter((v): v is string => !!v);
    const versions = rows.length
      ? await this.prisma.learningCourseVersion.findMany({
          where: {
            OR: [
              {
                courseId: { in: rows.map((r) => r.id) },
                status: LearningCourseStatus.DRAFT,
              },
              {
                id: { in: currentIds },
                status: LearningCourseStatus.PUBLISHED,
              },
            ],
          },
          select: {
            id: true,
            courseId: true,
            versionNumber: true,
            status: true,
          },
        })
      : [];
    const draftOf = new Map(
      versions
        .filter((v) => v.status === LearningCourseStatus.DRAFT)
        .map((v) => [v.courseId, v.versionNumber]),
    );
    const liveOf = new Map(
      versions
        .filter((v) => v.status === LearningCourseStatus.PUBLISHED)
        .map((v) => [v.id, v.versionNumber]),
    );

    return {
      data: rows.map((r) => ({
        ...this.mapCourse(r),
        draftVersionNumber: draftOf.get(r.id) ?? null,
        publishedVersionNumber: r.currentVersionId
          ? (liveOf.get(r.currentVersionId) ?? null)
          : null,
      })),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  /** Course count per status tab, with the same search and category filter as the list. */
  async statusCounts(query: LearningCourseQueryDto) {
    const where = {
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              {
                title: { contains: query.search, mode: 'insensitive' as const },
              },
              {
                code: { contains: query.search, mode: 'insensitive' as const },
              },
            ],
          }
        : {}),
    };
    const grouped = await this.prisma.learningCourse.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const count = (status: LearningCourseStatus) =>
      grouped.find((g) => g.status === status)?._count._all ?? 0;
    return {
      PUBLISHED: count(LearningCourseStatus.PUBLISHED),
      DRAFT: count(LearningCourseStatus.DRAFT),
      WITHDRAWN: count(LearningCourseStatus.WITHDRAWN),
      ARCHIVED: count(LearningCourseStatus.ARCHIVED),
    };
  }

  async getById(id: string) {
    const row = await this.prisma.learningCourse.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('Course not found');
    return this.mapCourse(row);
  }

  async create(userId: string, dto: CreateLearningCourseDto, meta?: RequestAuditMeta) {
    const { learningObjectives, ...courseData } = dto;
    if (courseData.description !== undefined) {
      courseData.description =
        sanitizeOptionalRichTextHtml(courseData.description ?? null) ??
        undefined;
    }
    const existing = await this.prisma.learningCourse.findFirst({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Course code already exists');
    await this.assertActiveCategory(dto.categoryId);
    const courseType = dto.courseType ?? LearningCourseType.COURSE;
    const deliveryMethod = dto.deliveryMethod ?? LearningDeliveryMethod.ONLINE;
    const pairError = courseTypeDeliveryError(courseType, deliveryMethod);
    if (pairError) throw new BadRequestException(pairError);

    const result = await this.prisma.$transaction(async (tx) => {
      const course = await tx.learningCourse.create({
        data: {
          ...courseData,
          courseType,
          deliveryMethod,
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
          ...versionRulesFromCourse(course),
          learningObjectives: learningObjectives?.trim() || null,
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
    const { learningObjectives, competencyId, ...courseData } = dto;
    const existing = await this.getById(id);
    const draftRules = draftRulesFromUpdate(dto);
    // A published version is read-only: changes go into a draft version first.
    const draft = await this.prisma.learningCourseVersion.findFirst({
      where: { courseId: id, status: LearningCourseStatus.DRAFT },
      orderBy: { versionNumber: 'desc' },
    });
    if (!draft)
      throw new BadRequestException(
        'This course is published. Create a new version to make changes.',
      );
    if (courseData.description !== undefined) {
      courseData.description =
        sanitizeOptionalRichTextHtml(courseData.description ?? null) ??
        undefined;
    }
    if (dto.code && dto.code !== existing.code) {
      const clash = await this.prisma.learningCourse.findFirst({ where: { code: dto.code } });
      if (clash) throw new ConflictException('Course code already exists');
    }
    if (dto.categoryId && dto.categoryId !== existing.categoryId) {
      await this.assertActiveCategory(dto.categoryId);
    }
    const rulesError = completionRulesError({
      certificateEnabled: dto.certificateEnabled ?? existing.certificateEnabled,
      refresherFrequencyDays:
        dto.refresherFrequencyDays !== undefined
          ? dto.refresherFrequencyDays
          : existing.refresherFrequencyDays,
    });
    if (rulesError) throw new BadRequestException(rulesError);
    if (competencyId && competencyId !== draft.competencyId) {
      const competency = await this.prisma.learningCompetency.findFirst({
        where: { id: competencyId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!competency)
        throw new BadRequestException('Choose an active competency');
    }
    // Only check type + delivery when one of them changes (old courses keep legacy types).
    const typeChanged =
      dto.courseType !== undefined && dto.courseType !== existing.courseType;
    const methodChanged =
      dto.deliveryMethod !== undefined &&
      dto.deliveryMethod !== existing.deliveryMethod;
    if (typeChanged || methodChanged) {
      const pairError = courseTypeDeliveryError(
        dto.courseType ?? existing.courseType,
        dto.deliveryMethod ?? existing.deliveryMethod,
      );
      if (pairError) throw new BadRequestException(pairError);
    }

    const row = await this.prisma.learningCourse.update({
      where: { id },
      data: { ...courseData, updatedById: userId },
    });

    // Learning objectives, the practical competency and the completion rules belong to the
    // editable draft version (publish freezes them; carers keep the rules of their version).
    if (
      learningObjectives !== undefined ||
      competencyId !== undefined ||
      Object.keys(draftRules).length
    ) {
      await this.prisma.learningCourseVersion.update({
        where: { id: draft.id },
        data: {
          ...(draftRules as Prisma.LearningCourseVersionUncheckedUpdateInput),
          ...(learningObjectives !== undefined
            ? { learningObjectives: learningObjectives.trim() || null }
            : {}),
          ...(competencyId !== undefined ? { competencyId } : {}),
        },
      });
    }

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_course_updated',
      recordType: 'LearningCourse',
      recordId: id,
      oldValues: {
        ...existing,
        draftVersion: {
          learningObjectives: draft.learningObjectives,
          competencyId: draft.competencyId,
          ...pickDraftRules(draft, Object.keys(draftRules)),
        },
      },
      newValues: {
        ...this.mapCourse(row),
        draftVersion: {
          learningObjectives:
            learningObjectives !== undefined
              ? learningObjectives.trim() || null
              : draft.learningObjectives,
          competencyId:
            competencyId !== undefined ? competencyId : draft.competencyId,
          ...draftRules,
        },
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapCourse(row);
  }

  /** Builds the publish check for the course's DRAFT version (same check publish runs). */
  private async runPublishCheck(
    courseId: string,
    changeSummary?: string | null,
  ) {
    const course = await this.prisma.learningCourse.findFirst({
      where: { id: courseId, deletedAt: null },
      include: { category: { select: { isActive: true, deletedAt: true } } },
    });
    if (!course) throw new NotFoundException('Course not found');
    const draft = await this.prisma.learningCourseVersion.findFirst({
      where: { courseId, status: LearningCourseStatus.DRAFT },
      orderBy: { versionNumber: 'desc' },
      include: {
        sections: {
          orderBy: { displayOrder: 'asc' },
          include: {
            contentItems: {
              orderBy: { displayOrder: 'asc' },
              include: {
                file: { select: { mimeType: true, deletedAt: true } },
              },
            },
          },
        },
        assessments: {
          orderBy: { displayOrder: 'asc' },
          include: {
            questions: {
              orderBy: { displayOrder: 'asc' },
              include: { options: true },
            },
          },
        },
      },
    });
    if (!draft)
      throw new BadRequestException('No DRAFT version available to publish');
    const competency = draft.competencyId
      ? await this.prisma.learningCompetency.findFirst({
          where: { id: draft.competencyId, deletedAt: null },
          select: { isActive: true, assessmentCriteria: true },
        })
      : null;
    const criteria = Array.isArray(competency?.assessmentCriteria)
      ? competency.assessmentCriteria
      : [];
    const result = checkPublishable({
      course: {
        title: course.title,
        categoryId: course.categoryId,
        categoryActive:
          !!course.category &&
          course.category.isActive &&
          !course.category.deletedAt,
        courseType: course.courseType,
        deliveryMethod: course.deliveryMethod,
        status: course.status,
        estimatedDurationMinutes: course.estimatedDurationMinutes,
      },
      version: {
        versionNumber: draft.versionNumber,
        requiresAssessment: draft.requiresAssessment,
        requiresPracticalAssessment: draft.requiresPracticalAssessment,
        certificateEnabled: draft.certificateEnabled,
        refresherFrequencyDays: draft.refresherFrequencyDays,
        learningObjectives: draft.learningObjectives,
      },
      hasCompetencyLink: !!draft.competencyId,
      competency: competency
        ? { active: competency.isActive, criteriaCount: criteria.length }
        : null,
      sections: draft.sections.map((sec) => ({
        title: sec.title,
        lessons: sec.contentItems.map((c) => ({
          title: c.title,
          contentType: c.contentType,
          contentBody: c.contentBody,
          videoUrl: c.videoUrl,
          externalUrl: c.externalUrl,
          file: c.file
            ? { mimeType: c.file.mimeType, deleted: !!c.file.deletedAt }
            : null,
          isRequired: c.isRequired,
        })),
      })),
      quizzes: draft.assessments.map((a) => ({
        title: a.title,
        sectionId: a.sectionId,
        questions: a.questions.map((q) => ({
          questionType: q.questionType,
          questionText: q.questionText,
          options: q.options.map((o) => ({
            optionText: o.optionText,
            isCorrect: o.isCorrect,
          })),
        })),
      })),
      changeSummary,
    });
    return { course, draft, result };
  }

  /** What would stop (blockers) or should be looked at (warnings) before publishing the draft. */
  async publishCheck(courseId: string) {
    const { draft, result } = await this.runPublishCheck(courseId);
    return {
      versionId: draft.id,
      versionNumber: draft.versionNumber,
      changeSummaryRequired: draft.versionNumber > 1,
      ...result,
    };
  }

  async publish(
    id: string,
    userId: string,
    dto: PublishLearningCourseDto,
    meta?: RequestAuditMeta,
  ) {
    const changeSummary = dto.changeSummary?.trim() ?? '';
    // The same checks as the Review step, run again here so the API never publishes a broken draft.
    const {
      course,
      draft: draftVersion,
      result: check,
    } = await this.runPublishCheck(id, changeSummary);
    if (!check.canPublish) {
      throw new BadRequestException({
        message: check.blockers.map((b) => b.message).join('. '),
        blockers: check.blockers,
      });
    }

    // Freeze the practical checklist so later edits to the competency never change this version.
    const competency = draftVersion.competencyId
      ? await this.prisma.learningCompetency.findUnique({
          where: { id: draftVersion.competencyId },
          select: { assessmentCriteria: true },
        })
      : null;

    const wasWithdrawn = course.status === LearningCourseStatus.WITHDRAWN;
    const stayWithdrawn = wasWithdrawn && dto.reactivate !== true;

    const result = await this.prisma.$transaction(async (tx) => {
      // Claim the draft first: a second publish running at the same time finds no DRAFT and stops,
      // and the whole transaction rolls back (no half-published state).
      const claimed = await tx.learningCourseVersion.updateMany({
        where: { id: draftVersion.id, status: LearningCourseStatus.DRAFT },
        data: { status: LearningCourseStatus.PUBLISHED },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          'This version was just published by someone else',
        );

      await tx.learningCourseVersion.updateMany({
        where: {
          courseId: id,
          status: LearningCourseStatus.PUBLISHED,
          id: { not: draftVersion.id },
        },
        data: { status: LearningCourseStatus.SUPERSEDED },
      });

      const published = await tx.learningCourseVersion.update({
        where: { id: draftVersion.id },
        data: {
          status: LearningCourseStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedById: userId,
          changeSummary: changeSummary || draftVersion.changeSummary,
          titleSnapshot: course.title,
          descriptionSnapshot: course.description,
          passingScore: course.passingScore,
          maximumAttempts: course.maximumAttempts,
          estimatedDurationMinutes: course.estimatedDurationMinutes,
          cpdMinutes: course.cpdMinutes,
          certificateValidityDays: course.certificateValidityDays,
          refresherFrequencyDays: course.refresherFrequencyDays,
          ...versionRulesFromCourse(course),
          // The quiz step is needed when the version has a required quiz (module or final).
          requiresAssessment: draftVersion.assessments.some(quizIsRequired),
          competencyChecklistSnapshot:
            (competency?.assessmentCriteria as
              | Prisma.InputJsonValue
              | null
              | undefined) ?? Prisma.DbNull,
        },
      });

      const updatedCourse = await tx.learningCourse.update({
        where: { id },
        data: {
          // A withdrawn course stays withdrawn unless the admin chose "Publish and re-activate".
          status: stayWithdrawn
            ? LearningCourseStatus.WITHDRAWN
            : LearningCourseStatus.PUBLISHED,
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
    if (wasWithdrawn && !stayWithdrawn) {
      await this.audit.logAudit({
        userId,
        module: AuditModule.LEARNING,
        action: 'learning_course_reactivated',
        recordType: 'LearningCourse',
        recordId: id,
        oldValues: { status: LearningCourseStatus.WITHDRAWN },
        newValues: {
          status: LearningCourseStatus.PUBLISHED,
          withVersion: result.version.versionNumber,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    }

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
          orderBy: { displayOrder: 'asc' },
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
          ...versionRulesFromCourse(course),
          learningObjectives: source.learningObjectives,
          competencyId: source.competencyId,
          changeSummary: dto.changeSummary,
          status: LearningCourseStatus.DRAFT,
        },
      });

      // Old module id -> copied module id, so module quizzes land in the right module.
      const sectionMap = new Map<string, string>();
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
        sectionMap.set(section.id, newSection.id);

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
            sectionId: assessment.sectionId
              ? (sectionMap.get(assessment.sectionId) ?? null)
              : null,
            displayOrder: assessment.displayOrder,
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

  /**
   * Withdraw from NEW assignments. Carers already on the course keep going and can complete;
   * the published version stays locked (never turned back into a draft).
   */
  async withdraw(
    id: string,
    userId: string,
    dto: WithdrawLearningCourseDto,
    meta?: RequestAuditMeta,
  ) {
    const course = await this.prisma.learningCourse.findFirst({
      where: { id, deletedAt: null },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.status !== LearningCourseStatus.PUBLISHED) {
      throw new BadRequestException('Only a published course can be withdrawn');
    }
    const row = await this.prisma.learningCourse.update({
      where: { id },
      data: { status: LearningCourseStatus.WITHDRAWN, updatedById: userId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_course_withdrawn',
      recordType: 'LearningCourse',
      recordId: id,
      oldValues: this.mapCourse(course),
      newValues: { ...this.mapCourse(row), withdrawReason: dto.reason.trim() },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return this.mapCourse(row);
  }

  /** Make a withdrawn course available for new assignments again (same published version). */
  async reactivate(id: string, userId: string, meta?: RequestAuditMeta) {
    const course = await this.prisma.learningCourse.findFirst({
      where: { id, deletedAt: null },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.status !== LearningCourseStatus.WITHDRAWN) {
      throw new BadRequestException(
        'Only a withdrawn course can be re-activated',
      );
    }
    const published = course.currentVersionId
      ? await this.prisma.learningCourseVersion.findFirst({
          where: {
            id: course.currentVersionId,
            status: LearningCourseStatus.PUBLISHED,
          },
        })
      : null;
    if (!published)
      throw new BadRequestException('This course has no published version');
    const row = await this.prisma.learningCourse.update({
      where: { id },
      data: { status: LearningCourseStatus.PUBLISHED, updatedById: userId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_course_reactivated',
      recordType: 'LearningCourse',
      recordId: id,
      oldValues: this.mapCourse(course),
      newValues: this.mapCourse(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return this.mapCourse(row);
  }

  /**
   * Bring an archived course back (agreed 13 Nov 2026): it becomes Published again when it has a
   * published version, otherwise it goes back to Draft (it was never published).
   */
  async unarchive(id: string, userId: string, meta?: RequestAuditMeta) {
    const course = await this.getById(id);
    if (course.status !== LearningCourseStatus.ARCHIVED) {
      throw new BadRequestException(
        'Only an archived course can be brought back',
      );
    }
    const published = course.currentVersionId
      ? await this.prisma.learningCourseVersion.findFirst({
          where: {
            id: course.currentVersionId,
            status: LearningCourseStatus.PUBLISHED,
          },
          select: { id: true },
        })
      : null;
    const row = await this.prisma.learningCourse.update({
      where: { id },
      data: {
        status: published
          ? LearningCourseStatus.PUBLISHED
          : LearningCourseStatus.DRAFT,
        archivedAt: null,
        updatedById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_course_unarchived',
      recordType: 'LearningCourse',
      recordId: id,
      oldValues: course,
      newValues: this.mapCourse(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return this.mapCourse(row);
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
      include: {
        _count: { select: { sections: true, assessments: true } },
        sections: { select: { _count: { select: { contentItems: true } } } },
      },
    });
    // For the version history panel: who published it and how many carers were assigned it.
    const publisherIds = [
      ...new Set(
        rows.map((r) => r.publishedById).filter((v): v is string => !!v),
      ),
    ];
    const [publishers, assigned] = await Promise.all([
      publisherIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: publisherIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : Promise.resolve([]),
      this.prisma.learningAssignment.groupBy({
        by: ['courseVersionId'],
        where: { courseId },
        _count: { _all: true },
      }),
    ]);
    const nameOf = new Map(
      publishers.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      ]),
    );
    const assignedOf = new Map(
      assigned.map((a) => [a.courseVersionId, a._count._all]),
    );
    return rows.map((r) => ({
      ...this.mapVersion(r),
      publishedByName: r.publishedById
        ? (nameOf.get(r.publishedById) ?? null)
        : null,
      sectionCount: r._count.sections,
      lessonCount: r.sections.reduce(
        (n, sec) => n + sec._count.contentItems,
        0,
      ),
      quizCount: r._count.assessments,
      assignmentCount: assignedOf.get(r.id) ?? 0,
    }));
  }

  async getVersion(courseId: string, versionId: string) {
    await this.getById(courseId);
    const row = await this.prisma.learningCourseVersion.findFirst({
      where: { id: versionId, courseId },
      include: {
        sections: {
          orderBy: { displayOrder: 'asc' },
          include: {
            contentItems: {
              orderBy: { displayOrder: 'asc' },
              include: { file: true },
            },
          },
        },
        assessments: {
          orderBy: { displayOrder: 'asc' },
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
          estimatedDurationMinutes: c.estimatedDurationMinutes,
          // Signed, short-lived link: the file is not public.
          file:
            c.file && !c.file.deletedAt
              ? {
                  id: c.file.id,
                  originalName: c.file.originalName,
                  mimeType: c.file.mimeType,
                  fileSize: c.file.fileSize,
                  url: signedLearningFileUrl(c.file.id),
                }
              : null,
        })),
      })),
      assessments: row.assessments.map((a) => ({
        id: a.id,
        title: a.title,
        instructions: a.instructions,
        passingScore: a.passingScore,
        maximumAttempts: a.maximumAttempts,
        retakeDelayMinutes: a.retakeDelayMinutes,
        sectionId: a.sectionId,
        displayOrder: a.displayOrder,
        timeLimitMinutes: a.timeLimitMinutes,
        isRequired: quizIsRequired(a),
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

/** Course fields that are also completion / certificate rules of the draft version. */
const DRAFT_RULE_KEYS = [
  'requiresAssessment',
  'requiresPracticalAssessment',
  'requiresManagerApproval',
  'certificateEnabled',
  'certificateValidityDays',
  'cpdMinutes',
  'refresherFrequencyDays',
  'passingScore',
  'maximumAttempts',
  'estimatedDurationMinutes',
] as const;

type DraftRuleKey = (typeof DRAFT_RULE_KEYS)[number];

/** The rule fields present in a course update, to copy onto the draft version. */
type DraftRules = Partial<Record<DraftRuleKey, number | boolean | null>>;

export function draftRulesFromUpdate(
  dto: Partial<Record<DraftRuleKey, number | boolean | null | undefined>>,
): DraftRules {
  const out: DraftRules = {};
  for (const key of DRAFT_RULE_KEYS) {
    const value = dto[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function pickDraftRules(draft: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, draft[k]]));
}

/** A refresher is assigned when the certificate expires, so it needs a certificate. */
export function completionRulesError(rules: {
  certificateEnabled: boolean;
  refresherFrequencyDays: number | null | undefined;
}): string | null {
  if (rules.refresherFrequencyDays && !rules.certificateEnabled) {
    return 'Turn on the certificate to assign a refresher when it expires';
  }
  return null;
}

/**
 * Completion / certificate rules a version carries. Snapshotted from the course when a
 * version is created or published, so learners on that version keep these rules even if
 * the course settings change later.
 */
export function versionRulesFromCourse(course: {
  requiresAssessment: boolean;
  requiresPracticalAssessment: boolean;
  requiresManagerApproval: boolean;
  certificateEnabled: boolean;
}) {
  return {
    requiresAssessment: course.requiresAssessment,
    requiresPracticalAssessment: course.requiresPracticalAssessment,
    requiresManagerApproval: course.requiresManagerApproval,
    certificateEnabled: course.certificateEnabled,
  };
}
