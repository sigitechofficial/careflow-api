import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreatePolicyTagDto, PolicyTagListQueryDto, UpdatePolicyTagDto } from './dto/policy.dto';
import { PolicyTagsService } from './policy-tags.service';

@ApiTags('Policy tags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('policy-tags')
export class PolicyTagsController {
  constructor(private readonly service: PolicyTagsService) {}

  @Get()
  @Permissions('policies.read')
  @ApiOperation({ summary: 'List policy tags' })
  list(@Query() query: PolicyTagListQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('policies.read')
  @ApiOperation({ summary: 'Get a policy tag' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('policies.categories.manage')
  @ApiOperation({ summary: 'Create a policy tag' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePolicyTagDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('policies.categories.manage')
  @ApiOperation({ summary: 'Update a policy tag' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePolicyTagDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, user.id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('policies.categories.manage')
  @ApiOperation({ summary: 'Soft-delete a policy tag' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.softDelete(id, user.id, getRequestAuditMeta(req));
  }
}
