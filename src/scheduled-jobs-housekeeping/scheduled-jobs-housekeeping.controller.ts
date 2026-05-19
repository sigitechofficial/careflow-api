import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ScheduledJobsHousekeepingService } from './scheduled-jobs-housekeeping.service';
import { HousekeepingQueryDto } from './dto/housekeeping-query.dto';
import { CompleteJobDto } from './dto/complete-job.dto';
import { CancelJobDto } from './dto/cancel-job.dto';

@ApiTags('Scheduled Jobs Housekeeping')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('scheduled-jobs-housekeeping')
export class ScheduledJobsHousekeepingController {
  constructor(private readonly service: ScheduledJobsHousekeepingService) {}

  @Get('jobs-not-started')
  @Permissions('scheduled_jobs_housekeeping.read')
  @ApiOperation({ summary: 'Jobs past start time that have not started' })
  jobsNotStarted(
    @CurrentUser() user: RequestUser,
    @Query() query: HousekeepingQueryDto,
    @Req() req: Request,
  ) {
    return this.service.jobsNotStarted(user.id, query, getRequestAuditMeta(req));
  }

  @Get('jobs-needing-attention')
  @Permissions('scheduled_jobs_housekeeping.read')
  @ApiOperation({ summary: 'Jobs needing allocation or status attention' })
  jobsNeedingAttention(
    @CurrentUser() user: RequestUser,
    @Query() query: HousekeepingQueryDto,
    @Req() req: Request,
  ) {
    return this.service.jobsNeedingAttention(user.id, query, getRequestAuditMeta(req));
  }

  @Get('day-jobs')
  @Permissions('scheduled_jobs_housekeeping.read')
  @ApiOperation({ summary: 'All jobs for a selected day' })
  dayJobs(
    @CurrentUser() user: RequestUser,
    @Query() query: HousekeepingQueryDto,
    @Req() req: Request,
  ) {
    return this.service.dayJobs(user.id, query, getRequestAuditMeta(req));
  }

  @Patch('jobs/:id/complete')
  @Permissions('scheduled_jobs_housekeeping.complete')
  @ApiOperation({ summary: 'Mark scheduled job and visits as completed' })
  complete(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CompleteJobDto,
    @Req() req: Request,
  ) {
    return this.service.completeJob(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Patch('jobs/:id/cancel')
  @Permissions('scheduled_jobs_housekeeping.cancel')
  @ApiOperation({ summary: 'Cancel scheduled job, visits, and active allocations' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CancelJobDto,
    @Req() req: Request,
  ) {
    return this.service.cancelJob(user.id, id, dto, getRequestAuditMeta(req));
  }
}
