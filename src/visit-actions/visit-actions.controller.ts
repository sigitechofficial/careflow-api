import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { VisitActionsService } from './visit-actions.service';
import { CreateVisitActionDto } from './dto/create-visit-action.dto';
import { UpdateVisitActionDto } from './dto/update-visit-action.dto';

@ApiTags('Visit Actions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('visit-actions')
export class VisitActionsController {
  constructor(private readonly service: VisitActionsService) {}

  @Get()
  @Permissions('visit_actions.read')
  @ApiOperation({ summary: 'List visit actions' })
  @ApiQuery({ name: 'scheduledJobId', required: false })
  @ApiQuery({ name: 'scheduledVisitId', required: false })
  list(
    @Query('scheduledJobId') scheduledJobId?: string,
    @Query('scheduledVisitId') scheduledVisitId?: string,
  ) {
    return this.service.list(scheduledJobId, scheduledVisitId);
  }

  @Post()
  @Permissions('visit_actions.create')
  @ApiOperation({ summary: 'Create visit action' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateVisitActionDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('visit_actions.update')
  @ApiOperation({ summary: 'Update visit action' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateVisitActionDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('visit_actions.delete')
  @ApiOperation({ summary: 'Soft-delete visit action' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
