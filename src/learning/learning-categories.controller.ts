import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  CreateLearningCategoryDto,
  LearningListQueryDto,
  UpdateLearningCategoryDto,
} from './dto/learning.dto';
import { LearningCategoriesService } from './learning-categories.service';

@ApiTags('Learning — Categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/categories')
export class LearningCategoriesController {
  constructor(private readonly service: LearningCategoriesService) {}

  @Get()
  @Permissions('learning.categories.read')
  @ApiOperation({ summary: 'List learning categories' })
  list(@Query() query: LearningListQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('learning.categories.read')
  @ApiOperation({ summary: 'Get learning category' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('learning.categories.manage')
  @ApiOperation({ summary: 'Create learning category' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateLearningCategoryDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('learning.categories.manage')
  @ApiOperation({ summary: 'Update learning category' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateLearningCategoryDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('learning.categories.manage')
  @ApiOperation({ summary: 'Soft-delete learning category' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.softDelete(id, user.id, getRequestAuditMeta(req));
  }
}
