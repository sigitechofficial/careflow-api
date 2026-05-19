import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobQueryDto } from './dto/scheduled-job-query.dto';
import { CreateScheduledJobDto } from './dto/create-scheduled-job.dto';
import { UpdateScheduledJobDto } from './dto/update-scheduled-job.dto';
import { UpdateScheduledJobStatusDto } from './dto/update-scheduled-job-status.dto';

@ApiTags('Scheduled Jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('scheduled-jobs')
export class ScheduledJobsController {
  constructor(private readonly service: ScheduledJobsService) {}

  @Get()
  @Permissions('scheduled_jobs.read')
  @ApiOperation({ summary: 'List scheduled jobs' })
  list(@Query() query: ScheduledJobQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('scheduled_jobs.read')
  @ApiOperation({ summary: 'Get scheduled job by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('scheduled_jobs.create')
  @ApiOperation({ summary: 'Create scheduled job' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateScheduledJobDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('scheduled_jobs.update')
  @ApiOperation({ summary: 'Update scheduled job' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduledJobDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/status')
  @Permissions('scheduled_jobs.status.update')
  @ApiOperation({ summary: 'Update scheduled job status' })
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduledJobStatusDto,
    @Req() req: Request,
  ) {
    return this.service.updateStatus(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('scheduled_jobs.delete')
  @ApiOperation({ summary: 'Soft-delete scheduled job' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
