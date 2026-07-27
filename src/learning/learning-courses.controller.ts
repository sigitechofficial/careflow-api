import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  CreateLearningCourseDto,
  CreateLearningCourseVersionDto,
  LearningCourseQueryDto,
  PublishLearningCourseDto,
  UpdateLearningCourseDto,
} from './dto/learning.dto';
import { LearningCoursesService } from './learning-courses.service';

@ApiTags('Learning — Courses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/courses')
export class LearningCoursesController {
  constructor(private readonly service: LearningCoursesService) {}

  @Get()
  @Permissions('learning.courses.read')
  @ApiOperation({ summary: 'List learning courses' })
  list(@Query() query: LearningCourseQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('learning.courses.read')
  @ApiOperation({ summary: 'Get learning course' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Create learning course with version 1 DRAFT' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateLearningCourseDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Update learning course metadata' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateLearningCourseDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/publish')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Publish current DRAFT version' })
  publish(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: PublishLearningCourseDto,
    @Req() req: Request,
  ) {
    return this.service.publish(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/create-version')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Clone published version into new DRAFT' })
  createVersion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateLearningCourseVersionDto,
    @Req() req: Request,
  ) {
    return this.service.createVersion(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/unpublish')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Unpublish course back to Draft (stops new assignments until republished)' })
  unpublish(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.unpublish(id, user.id, getRequestAuditMeta(req));
  }

  @Post(':id/archive')
  @Permissions('learning.courses.manage')
  @ApiOperation({ summary: 'Archive learning course' })
  archive(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.archive(id, user.id, getRequestAuditMeta(req));
  }

  @Get(':id/versions')
  @Permissions('learning.courses.read')
  @ApiOperation({ summary: 'List course versions' })
  listVersions(@Param('id') id: string) {
    return this.service.listVersions(id);
  }

  @Get(':id/versions/:versionId')
  @Permissions('learning.courses.read')
  @ApiOperation({ summary: 'Get course version detail' })
  getVersion(@Param('id') id: string, @Param('versionId') versionId: string) {
    return this.service.getVersion(id, versionId);
  }
}
