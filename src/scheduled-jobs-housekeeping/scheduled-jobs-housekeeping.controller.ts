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
import { ReinstateJobDto } from './dto/reinstate-job.dto';
import { SaveVisitJobTasksDto } from './dto/save-visit-job-tasks.dto';
import {
  VISIT_CANCELLATION_REASONS,
  VISIT_CHARGE_DECISION_OPTIONS,
} from './visit-cancellation-reason.util';

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
    return this.service.jobsNotStarted(user, query, getRequestAuditMeta(req));
  }

  @Get('jobs-needing-attention')
  @Permissions('scheduled_jobs_housekeeping.read')
  @ApiOperation({ summary: 'Jobs needing allocation or status attention' })
  jobsNeedingAttention(
    @CurrentUser() user: RequestUser,
    @Query() query: HousekeepingQueryDto,
    @Req() req: Request,
  ) {
    return this.service.jobsNeedingAttention(user, query, getRequestAuditMeta(req));
  }

  @Get('day-jobs')
  @Permissions('scheduled_jobs_housekeeping.read')
  @ApiOperation({ summary: 'All jobs for a selected day' })
  dayJobs(
    @CurrentUser() user: RequestUser,
    @Query() query: HousekeepingQueryDto,
    @Req() req: Request,
  ) {
    return this.service.dayJobs(user, query, getRequestAuditMeta(req));
  }

  @Get('jobs/:id/care-plan-delivery-tasks')
  @Permissions('scheduled_jobs_housekeeping.read')
  @ApiOperation({ summary: 'Care plan delivery tasks for completing a scheduled job visit' })
  carePlanDeliveryTasks(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
    @Query('formIds') formIds?: string,
  ) {
    const parsedFormIds = formIds
      ? formIds
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : undefined;
    return this.service.getCarePlanDeliveryTasks(
      user,
      id,
      parsedFormIds?.length ? { formIds: parsedFormIds } : undefined,
      getRequestAuditMeta(req),
    );
  }

  @Get('jobs/:id/visit-tasks')
  @Permissions('scheduled_jobs_housekeeping.read')
  @ApiOperation({ summary: 'Visit tasks assigned to this job for the linked medication round' })
  visitJobTasks(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.getVisitJobTasks(user, id, getRequestAuditMeta(req));
  }

  @Get('jobs/:id/visit-observations')
  @Permissions('scheduled_jobs_housekeeping.read')
  @ApiOperation({
    summary:
      'Visit observations catalog for admin workspace (same catalog as carer details /observations)',
  })
  visitJobObservations(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.service.getVisitObservations(user, id);
  }

  @Get('jobs/:id/timeline')
  @Permissions('scheduled_jobs_housekeeping.read')
  @ApiOperation({
    summary: 'Visit activity timeline (Log tab) — same events the carer app shows',
  })
  visitJobTimeline(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getVisitTimeline(user, id);
  }

  @Patch('jobs/:id/visit-tasks')
  @Permissions('scheduled_jobs_housekeeping.complete')
  @ApiOperation({ summary: 'Save visit task completion checkboxes for a scheduled job' })
  saveVisitJobTasks(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SaveVisitJobTasksDto,
    @Req() req: Request,
  ) {
    return this.service.saveVisitJobTasks(user, id, dto, getRequestAuditMeta(req));
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
    return this.service.completeJob(user, id, dto, getRequestAuditMeta(req));
  }

  @Get('cancellation-options')
  @Permissions('scheduled_jobs_housekeeping.read')
  @ApiOperation({ summary: 'Reason codes and charge options for visit cancellation' })
  cancellationOptions() {
    return {
      data: {
        reasons: VISIT_CANCELLATION_REASONS,
        chargeDecisions: VISIT_CHARGE_DECISION_OPTIONS,
      },
    };
  }

  @Patch('jobs/:id/cancel')
  @Permissions('scheduled_jobs_housekeeping.cancel')
  @ApiOperation({ summary: 'Cancel or call off a scheduled job with CQC-compliant record' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CancelJobDto,
    @Req() req: Request,
  ) {
    return this.service.cancelJob(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch('jobs/:id/reinstate')
  @Permissions('scheduled_jobs_housekeeping.cancel')
  @ApiOperation({ summary: 'Reinstate a cancelled or called-off job on the rota' })
  reinstate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReinstateJobDto,
    @Req() req: Request,
  ) {
    return this.service.reinstateJob(user, id, dto, getRequestAuditMeta(req));
  }
}
