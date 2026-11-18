import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../common/decorators/permissions.decorator';
import {
  CurrentUser,
  type RequestUser,
} from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  CreateLearningContentItemDto,
  CreateLearningSectionDto,
  MoveLearningContentDto,
  ReorderLearningContentDto,
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
  createSection(
    @CurrentUser() user: RequestUser,
    @Param('versionId') versionId: string,
    @Body() dto: CreateLearningSectionDto,
    @Req() req: Request,
  ) {
    return this.service.createSection(versionId, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Patch('learning/sections/:sectionId')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Update section' })
  updateSection(
    @CurrentUser() user: RequestUser,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateLearningSectionDto,
    @Req() req: Request,
  ) {
    return this.service.updateSection(sectionId, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Delete('learning/sections/:sectionId')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Delete section' })
  deleteSection(
    @CurrentUser() user: RequestUser,
    @Param('sectionId') sectionId: string,
    @Req() req: Request,
  ) {
    return this.service.deleteSection(sectionId, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Post('learning/sections/:sectionId/content')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Create content item' })
  createContent(
    @CurrentUser() user: RequestUser,
    @Param('sectionId') sectionId: string,
    @Body() dto: CreateLearningContentItemDto,
    @Req() req: Request,
  ) {
    return this.service.createContentItem(sectionId, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Patch('learning/content/:contentId')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Update content item' })
  updateContent(
    @CurrentUser() user: RequestUser,
    @Param('contentId') contentId: string,
    @Body() dto: UpdateLearningContentItemDto,
    @Req() req: Request,
  ) {
    return this.service.updateContentItem(contentId, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Delete('learning/content/:contentId')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Delete content item' })
  deleteContent(
    @CurrentUser() user: RequestUser,
    @Param('contentId') contentId: string,
    @Req() req: Request,
  ) {
    return this.service.deleteContentItem(contentId, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Post('learning/course-versions/:versionId/reorder')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Reorder sections' })
  reorder(
    @CurrentUser() user: RequestUser,
    @Param('versionId') versionId: string,
    @Body() dto: ReorderLearningSectionsDto,
    @Req() req: Request,
  ) {
    return this.service.reorderSections(versionId, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Post('learning/sections/:sectionId/reorder-content')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Reorder the lessons of a DRAFT section' })
  reorderContent(
    @CurrentUser() user: RequestUser,
    @Param('sectionId') sectionId: string,
    @Body() dto: ReorderLearningContentDto,
    @Req() req: Request,
  ) {
    return this.service.reorderContent(sectionId, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }

  @Post('learning/content/:contentId/move')
  @Permissions('learning.courses.manage')
  @ApiOperation({
    summary: 'Move a lesson to another section of the same DRAFT version',
  })
  moveContent(
    @CurrentUser() user: RequestUser,
    @Param('contentId') contentId: string,
    @Body() dto: MoveLearningContentDto,
    @Req() req: Request,
  ) {
    return this.service.moveContent(contentId, dto, {
      userId: user.id,
      meta: getRequestAuditMeta(req),
    });
  }
}
