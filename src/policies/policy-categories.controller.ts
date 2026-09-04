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
  CreatePolicyCategoryDto,
  PolicyCategoryListQueryDto,
  UpdatePolicyCategoryDto,
} from './dto/policy.dto';
import { PolicyCategoriesService } from './policy-categories.service';

@ApiTags('Policy categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('policy-categories')
export class PolicyCategoriesController {
  constructor(private readonly service: PolicyCategoriesService) {}

  @Get()
  @Permissions('policies.read')
  @ApiOperation({ summary: 'List policy categories' })
  list(@Query() query: PolicyCategoryListQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('policies.read')
  @ApiOperation({ summary: 'Get a policy category' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('policies.categories.manage')
  @ApiOperation({ summary: 'Create a policy category' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePolicyCategoryDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('policies.categories.manage')
  @ApiOperation({ summary: 'Update a policy category' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePolicyCategoryDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('policies.categories.manage')
  @ApiOperation({ summary: 'Soft-delete a policy category' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.softDelete(id, user.id, getRequestAuditMeta(req));
  }
}
