import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LearningCompletionRule, LearningContentType } from '@prisma/client';
import { sanitizeRichTextHtml } from '../common/utils/rich-text-html.util';
import {
  fileFitsContentType,
  isHttpUrl,
  isHttpsUrl,
} from './learning-file.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { LearningCoursesService } from './learning-courses.service';
import {
  logLearningChange,
  withoutKey,
  type LearningActor,
} from './learning-audit.util';
import {
  CreateLearningContentItemDto,
  CreateLearningSectionDto,
  MoveLearningContentDto,
  ReorderLearningContentDto,
  ReorderLearningSectionsDto,
  UpdateLearningContentItemDto,
  UpdateLearningSectionDto,
} from './dto/learning.dto';

@Injectable()
export class LearningContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: LearningCoursesService,
    private readonly audit: AuditLogsService,
  ) {}

  async createSection(
    versionId: string,
    dto: CreateLearningSectionDto,
    actor?: LearningActor,
  ) {
    await this.courses.assertDraftVersion(versionId);
    // New sections go to the end unless an order is given.
    let displayOrder = dto.displayOrder;
    if (displayOrder === undefined) {
      const last = await this.prisma.learningCourseSection.findFirst({
        where: { courseVersionId: versionId },
        orderBy: { displayOrder: 'desc' },
        select: { displayOrder: true },
      });
      displayOrder = last ? last.displayOrder + 1 : 0;
    }
    const row = await this.prisma.learningCourseSection.create({
      // A module is always required; whether its lessons count is set per lesson.
      data: {
        courseVersionId: versionId,
        ...dto,
        displayOrder,
        isRequired: true,
      },
    });
    await logLearningChange(this.audit, actor, {
      action: 'learning_section_created',
      recordType: 'LearningCourseSection',
      recordId: row.id,
      newValues: row,
    });
    return row;
  }

  async updateSection(
    sectionId: string,
    dto: UpdateLearningSectionDto,
    actor?: LearningActor,
  ) {
    const section = await this.prisma.learningCourseSection.findUnique({
      where: { id: sectionId },
    });
    if (!section) throw new NotFoundException('Section not found');
    await this.courses.assertDraftVersion(section.courseVersionId);
    const { isRequired: _ignored, ...changes } = dto;
    void _ignored;
    const row = await this.prisma.learningCourseSection.update({
      where: { id: sectionId },
      data: changes,
    });
    await logLearningChange(this.audit, actor, {
      action: 'learning_section_updated',
      recordType: 'LearningCourseSection',
      recordId: sectionId,
      oldValues: section,
      newValues: row,
    });
    return row;
  }

  async deleteSection(sectionId: string, actor?: LearningActor) {
    const section = await this.prisma.learningCourseSection.findUnique({
      where: { id: sectionId },
      include: { contentItems: true },
    });
    if (!section) throw new NotFoundException('Section not found');
    await this.courses.assertDraftVersion(section.courseVersionId);
    await this.prisma.learningCourseSection.delete({ where: { id: sectionId } });
    await logLearningChange(this.audit, actor, {
      action: 'learning_section_deleted',
      recordType: 'LearningCourseSection',
      recordId: sectionId,
      oldValues: section,
    });
    return { id: sectionId, deleted: true };
  }

  async createContentItem(
    sectionId: string,
    dto: CreateLearningContentItemDto,
    actor?: LearningActor,
  ) {
    const section = await this.prisma.learningCourseSection.findUnique({
      where: { id: sectionId },
    });
    if (!section) throw new NotFoundException('Section not found');
    await this.courses.assertDraftVersion(section.courseVersionId);
    const lesson = await this.checkedLesson({
      contentType: dto.contentType,
      contentBody: dto.contentBody ?? null,
      fileId: dto.fileId ?? null,
      videoUrl: dto.videoUrl ?? null,
      externalUrl: dto.externalUrl ?? null,
    });
    const last = await this.prisma.learningContentItem.findFirst({
      where: { courseSectionId: sectionId },
      orderBy: { displayOrder: 'desc' },
      select: { displayOrder: true },
    });
    const row = await this.prisma.learningContentItem.create({
      data: {
        courseSectionId: sectionId,
        ...dto,
        ...lesson,
        title: dto.title.trim(),
        displayOrder: dto.displayOrder ?? (last ? last.displayOrder + 1 : 0),
        // Agreed default: the carer presses "Mark as complete".
        completionRule:
          dto.completionRule ?? LearningCompletionRule.ACKNOWLEDGE,
      },
    });
    await logLearningChange(this.audit, actor, {
      action: 'learning_lesson_created',
      recordType: 'LearningContentItem',
      recordId: row.id,
      newValues: row,
    });
    return row;
  }

  async updateContentItem(
    contentId: string,
    dto: UpdateLearningContentItemDto,
    actor?: LearningActor,
  ) {
    const item = await this.prisma.learningContentItem.findUnique({
      where: { id: contentId },
      include: { courseSection: true },
    });
    if (!item) throw new NotFoundException('Content item not found');
    await this.courses.assertDraftVersion(item.courseSection.courseVersionId);
    const lesson = await this.checkedLesson({
      contentType: dto.contentType ?? item.contentType,
      contentBody:
        dto.contentBody !== undefined ? dto.contentBody : item.contentBody,
      fileId: dto.fileId !== undefined ? dto.fileId : item.fileId,
      videoUrl: dto.videoUrl !== undefined ? dto.videoUrl : item.videoUrl,
      externalUrl:
        dto.externalUrl !== undefined ? dto.externalUrl : item.externalUrl,
    });
    const row = await this.prisma.learningContentItem.update({
      where: { id: contentId },
      data: {
        ...dto,
        ...lesson,
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      },
    });
    const before = withoutKey(item, 'courseSection');
    await logLearningChange(this.audit, actor, {
      action: 'learning_lesson_updated',
      recordType: 'LearningContentItem',
      recordId: contentId,
      oldValues: before,
      newValues: row,
    });
    return row;
  }

  async deleteContentItem(contentId: string, actor?: LearningActor) {
    const item = await this.prisma.learningContentItem.findUnique({
      where: { id: contentId },
      include: { courseSection: true },
    });
    if (!item) throw new NotFoundException('Content item not found');
    await this.courses.assertDraftVersion(item.courseSection.courseVersionId);
    await this.prisma.learningContentItem.delete({ where: { id: contentId } });
    const before = withoutKey(item, 'courseSection');
    await logLearningChange(this.audit, actor, {
      action: 'learning_lesson_deleted',
      recordType: 'LearningContentItem',
      recordId: contentId,
      oldValues: before,
    });
    return { id: contentId, deleted: true };
  }

  async reorderSections(
    versionId: string,
    dto: ReorderLearningSectionsDto,
    actor?: LearningActor,
  ) {
    await this.courses.assertDraftVersion(versionId);
    const before = await this.prisma.learningCourseSection.findMany({
      where: { courseVersionId: versionId },
      orderBy: { displayOrder: 'asc' },
      select: { id: true },
    });
    await this.prisma.$transaction(
      dto.sectionIds.map((sectionId, index) =>
        this.prisma.learningCourseSection.update({
          where: { id: sectionId, courseVersionId: versionId },
          data: { displayOrder: index },
        }),
      ),
    );
    await logLearningChange(this.audit, actor, {
      action: 'learning_sections_reordered',
      recordType: 'LearningCourseVersion',
      recordId: versionId,
      oldValues: { sectionIds: before.map((r) => r.id) },
      newValues: { sectionIds: dto.sectionIds },
    });
    return { versionId, sectionIds: dto.sectionIds };
  }

  /** Reorder the lessons of one draft section. Must list every lesson of that section. */
  async reorderContent(
    sectionId: string,
    dto: ReorderLearningContentDto,
    actor?: LearningActor,
  ) {
    const section = await this.prisma.learningCourseSection.findUnique({
      where: { id: sectionId },
      include: {
        contentItems: {
          orderBy: { displayOrder: 'asc' },
          select: { id: true },
        },
      },
    });
    if (!section) throw new NotFoundException('Section not found');
    await this.courses.assertDraftVersion(section.courseVersionId);
    const current = section.contentItems.map((c) => c.id);
    const same =
      current.length === dto.contentIds.length &&
      [...current].sort().join() === [...dto.contentIds].sort().join();
    if (!same)
      throw new BadRequestException(
        'Send every lesson of this section exactly once',
      );
    await this.prisma.$transaction(
      dto.contentIds.map((id, index) =>
        this.prisma.learningContentItem.update({
          where: { id },
          data: { displayOrder: index },
        }),
      ),
    );
    await logLearningChange(this.audit, actor, {
      action: 'learning_lessons_reordered',
      recordType: 'LearningCourseSection',
      recordId: sectionId,
      oldValues: { contentIds: current },
      newValues: { contentIds: dto.contentIds },
    });
    return { sectionId, contentIds: dto.contentIds };
  }

  /** Move a lesson to another section of the same draft version (it goes to the end). */
  async moveContent(
    contentId: string,
    dto: MoveLearningContentDto,
    actor?: LearningActor,
  ) {
    const item = await this.prisma.learningContentItem.findUnique({
      where: { id: contentId },
      include: { courseSection: true },
    });
    if (!item) throw new NotFoundException('Content item not found');
    const target = await this.prisma.learningCourseSection.findUnique({
      where: { id: dto.sectionId },
    });
    if (!target) throw new NotFoundException('Section not found');
    if (target.courseVersionId !== item.courseSection.courseVersionId) {
      throw new BadRequestException(
        'A lesson can only move within the same course version',
      );
    }
    await this.courses.assertDraftVersion(target.courseVersionId);
    const last = await this.prisma.learningContentItem.findFirst({
      where: { courseSectionId: target.id },
      orderBy: { displayOrder: 'desc' },
      select: { displayOrder: true },
    });
    const row = await this.prisma.learningContentItem.update({
      where: { id: contentId },
      data: {
        courseSectionId: target.id,
        displayOrder: last ? last.displayOrder + 1 : 0,
      },
    });
    await logLearningChange(this.audit, actor, {
      action: 'learning_lesson_moved',
      recordType: 'LearningContentItem',
      recordId: contentId,
      oldValues: { sectionId: item.courseSectionId },
      newValues: { sectionId: target.id },
    });
    return row;
  }

  /**
   * Check a lesson's material for its type and keep only the field that type uses:
   * Text = rich text (sanitised), Image / PDF / Document = an uploaded file that fits,
   * Video = an https link, External link = an http(s) link.
   */
  private async checkedLesson(input: {
    contentType: LearningContentType;
    contentBody: string | null;
    fileId: string | null;
    videoUrl: string | null;
    externalUrl: string | null;
  }) {
    const cleared = {
      contentBody: null,
      fileId: null,
      videoUrl: null,
      externalUrl: null,
    } as {
      contentBody: string | null;
      fileId: string | null;
      videoUrl: string | null;
      externalUrl: string | null;
    };
    switch (input.contentType) {
      case LearningContentType.TEXT:
        return {
          ...cleared,
          contentBody: input.contentBody
            ? sanitizeRichTextHtml(input.contentBody)
            : null,
        };
      case LearningContentType.VIDEO: {
        const url = input.videoUrl?.trim() ?? '';
        if (!isHttpsUrl(url))
          throw new BadRequestException(
            'Add the video as an https link (e.g. YouTube, Vimeo or SharePoint)',
          );
        return { ...cleared, videoUrl: url };
      }
      case LearningContentType.EXTERNAL_LINK: {
        const url = input.externalUrl?.trim() ?? '';
        if (!isHttpUrl(url))
          throw new BadRequestException('Add a valid web link');
        return { ...cleared, externalUrl: url };
      }
      case LearningContentType.IMAGE:
      case LearningContentType.PDF:
      case LearningContentType.DOCUMENT: {
        if (!input.fileId)
          throw new BadRequestException('Upload a file for this lesson');
        const file = await this.prisma.learningFile.findFirst({
          where: { id: input.fileId, deletedAt: null },
          select: { mimeType: true },
        });
        if (!file)
          throw new BadRequestException('The uploaded file was not found');
        if (!fileFitsContentType(file.mimeType, input.contentType)) {
          throw new BadRequestException(
            'The uploaded file does not fit this lesson type',
          );
        }
        return { ...cleared, fileId: input.fileId };
      }
      default:
        throw new BadRequestException(
          'Lessons can be text, image, PDF, document, video link or web link',
        );
    }
  }
}
