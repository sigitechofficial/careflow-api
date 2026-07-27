import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LearningCoursesService } from './learning-courses.service';
import {
  CreateLearningContentItemDto,
  CreateLearningSectionDto,
  ReorderLearningSectionsDto,
  UpdateLearningContentItemDto,
  UpdateLearningSectionDto,
} from './dto/learning.dto';

@Injectable()
export class LearningContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: LearningCoursesService,
  ) {}

  async createSection(versionId: string, dto: CreateLearningSectionDto) {
    await this.courses.assertDraftVersion(versionId);
    const row = await this.prisma.learningCourseSection.create({
      data: { courseVersionId: versionId, ...dto },
    });
    return row;
  }

  async updateSection(sectionId: string, dto: UpdateLearningSectionDto) {
    const section = await this.prisma.learningCourseSection.findUnique({ where: { id: sectionId } });
    if (!section) throw new NotFoundException('Section not found');
    await this.courses.assertDraftVersion(section.courseVersionId);
    return this.prisma.learningCourseSection.update({ where: { id: sectionId }, data: dto });
  }

  async deleteSection(sectionId: string) {
    const section = await this.prisma.learningCourseSection.findUnique({ where: { id: sectionId } });
    if (!section) throw new NotFoundException('Section not found');
    await this.courses.assertDraftVersion(section.courseVersionId);
    await this.prisma.learningCourseSection.delete({ where: { id: sectionId } });
    return { id: sectionId, deleted: true };
  }

  async createContentItem(sectionId: string, dto: CreateLearningContentItemDto) {
    const section = await this.prisma.learningCourseSection.findUnique({ where: { id: sectionId } });
    if (!section) throw new NotFoundException('Section not found');
    await this.courses.assertDraftVersion(section.courseVersionId);
    return this.prisma.learningContentItem.create({
      data: { courseSectionId: sectionId, ...dto },
    });
  }

  async updateContentItem(contentId: string, dto: UpdateLearningContentItemDto) {
    const item = await this.prisma.learningContentItem.findUnique({
      where: { id: contentId },
      include: { courseSection: true },
    });
    if (!item) throw new NotFoundException('Content item not found');
    await this.courses.assertDraftVersion(item.courseSection.courseVersionId);
    return this.prisma.learningContentItem.update({ where: { id: contentId }, data: dto });
  }

  async deleteContentItem(contentId: string) {
    const item = await this.prisma.learningContentItem.findUnique({
      where: { id: contentId },
      include: { courseSection: true },
    });
    if (!item) throw new NotFoundException('Content item not found');
    await this.courses.assertDraftVersion(item.courseSection.courseVersionId);
    await this.prisma.learningContentItem.delete({ where: { id: contentId } });
    return { id: contentId, deleted: true };
  }

  async reorderSections(versionId: string, dto: ReorderLearningSectionsDto) {
    await this.courses.assertDraftVersion(versionId);
    await this.prisma.$transaction(
      dto.sectionIds.map((sectionId, index) =>
        this.prisma.learningCourseSection.update({
          where: { id: sectionId, courseVersionId: versionId },
          data: { displayOrder: index },
        }),
      ),
    );
    return { versionId, sectionIds: dto.sectionIds };
  }
}
