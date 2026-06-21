import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ScheduleRunsService } from './schedule-runs.service';
import { ScheduleRunQueryDto } from './dto/schedule-run-query.dto';
import { CreateScheduleRunDto } from './dto/create-schedule-run.dto';
import { UpdateScheduleRunDto } from './dto/update-schedule-run.dto';
import { RunVisitIdsDto } from './dto/run-visit-ids.dto';
import { SyncScheduleRunCarerDto } from './dto/sync-schedule-run-carer.dto';

@ApiTags('Schedule Runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schedule-runs')
export class ScheduleRunsController {
  constructor(private readonly service: ScheduleRunsService) {}

  @Get()
  @Permissions('schedule_runs.read')
  @ApiOperation({ summary: 'List schedule runs' })
  list(@Query() query: ScheduleRunQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('schedule_runs.read')
  @ApiOperation({ summary: 'Get schedule run by id' })
  getById(@Param('id') id: string, @Query('includeJobs') includeJobs?: string) {
    return this.service.getById(id, includeJobs === 'true');
  }

  @Post()
  @Permissions('schedule_runs.create')
  @ApiOperation({ summary: 'Create schedule run' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateScheduleRunDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('schedule_runs.update')
  @ApiOperation({ summary: 'Update schedule run' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleRunDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('schedule_runs.delete')
  @ApiOperation({ summary: 'Soft-delete schedule run' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/jobs')
  @Permissions('schedule_runs.update')
  @ApiOperation({ summary: 'Add visits to a run' })
  addJobs(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: RunVisitIdsDto,
    @Req() req: Request,
  ) {
    return this.service.addJobs(user.id, id, dto.visitIds, getRequestAuditMeta(req));
  }

  @Patch(':id/jobs/reorder')
  @Permissions('schedule_runs.update')
  @ApiOperation({ summary: 'Reorder visits in a run' })
  reorderJobs(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: RunVisitIdsDto,
    @Req() req: Request,
  ) {
    return this.service.reorderJobs(user.id, id, dto.visitIds, getRequestAuditMeta(req));
  }

  @Delete(':id/jobs/:jobId')
  @Permissions('schedule_runs.update')
  @ApiOperation({ summary: 'Remove a visit from a run' })
  removeJob(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
    @Req() req: Request,
  ) {
    return this.service.removeJob(user.id, id, jobId, getRequestAuditMeta(req));
  }

  @Post(':id/cancel')
  @Permissions('schedule_runs.update')
  @ApiOperation({ summary: 'Cancel a run and detach its visits' })
  cancel(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.cancel(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/sync-carer')
  @Permissions('schedule_runs.update')
  @ApiOperation({ summary: 'Allocate the run carer to all visits in the run' })
  syncCarer(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SyncScheduleRunCarerDto,
    @Req() req: Request,
  ) {
    return this.service.syncCarer(user.id, id, dto, getRequestAuditMeta(req));
  }
}
