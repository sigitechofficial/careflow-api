import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ScheduledVisitsService } from './scheduled-visits.service';
import { ScheduledVisitQueryDto } from './dto/scheduled-visit-query.dto';
import { CreateScheduledVisitDto } from './dto/create-scheduled-visit.dto';
import { UpdateScheduledVisitDto } from './dto/update-scheduled-visit.dto';
import { UpdateScheduledVisitStatusDto } from './dto/update-scheduled-visit-status.dto';

@ApiTags('Scheduled Visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('scheduled-visits')
export class ScheduledVisitsController {
  constructor(private readonly service: ScheduledVisitsService) {}

  @Get()
  @Permissions('scheduled_visits.read')
  @ApiOperation({ summary: 'List scheduled visits' })
  list(@CurrentUser() user: RequestUser, @Query() query: ScheduledVisitQueryDto) {
    return this.service.list(query, user);
  }

  @Get(':id')
  @Permissions('scheduled_visits.read')
  @ApiOperation({ summary: 'Get scheduled visit by id' })
  getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getById(id, user);
  }

  @Post()
  @Permissions('scheduled_visits.create')
  @ApiOperation({ summary: 'Create scheduled visit' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateScheduledVisitDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('scheduled_visits.update')
  @ApiOperation({ summary: 'Update scheduled visit' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduledVisitDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/status')
  @Permissions('scheduled_visits.status.update')
  @ApiOperation({ summary: 'Update scheduled visit status' })
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduledVisitStatusDto,
    @Req() req: Request,
  ) {
    return this.service.updateStatus(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('scheduled_visits.delete')
  @ApiOperation({ summary: 'Soft-delete scheduled visit' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
