import { Body, Controller, Delete, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  CreateLearningContentItemDto,
  CreateLearningSectionDto,
  ReorderLearningSectionsDto,
  UpdateLearningContentItemDto,
  UpdateLearningSectionDto,
} from './dto/learning.dto';
import { LearningContentService } from './learning-content.service';

@ApiTags('Learning — Content')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class LearningContentController {
  constructor(private readonly service: LearningContentService) {}

  @Post('learning/course-versions/:versionId/sections')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Create section on DRAFT version' })
  createSection(@Param('versionId') versionId: string, @Body() dto: CreateLearningSectionDto) {
    return this.service.createSection(versionId, dto);
  }

  @Patch('learning/sections/:sectionId')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Update section' })
  updateSection(@Param('sectionId') sectionId: string, @Body() dto: UpdateLearningSectionDto) {
    return this.service.updateSection(sectionId, dto);
  }

  @Delete('learning/sections/:sectionId')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Delete section' })
  deleteSection(@Param('sectionId') sectionId: string) {
    return this.service.deleteSection(sectionId);
  }

  @Post('learning/sections/:sectionId/content')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Create content item' })
  createContent(@Param('sectionId') sectionId: string, @Body() dto: CreateLearningContentItemDto) {
    return this.service.createContentItem(sectionId, dto);
  }

  @Patch('learning/content/:contentId')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Update content item' })
  updateContent(@Param('contentId') contentId: string, @Body() dto: UpdateLearningContentItemDto) {
    return this.service.updateContentItem(contentId, dto);
  }

  @Delete('learning/content/:contentId')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Delete content item' })
  deleteContent(@Param('contentId') contentId: string) {
    return this.service.deleteContentItem(contentId);
  }

  @Post('learning/course-versions/:versionId/reorder')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Reorder sections' })
  reorder(@Param('versionId') versionId: string, @Body() dto: ReorderLearningSectionsDto) {
    return this.service.reorderSections(versionId, dto);
  }
}
