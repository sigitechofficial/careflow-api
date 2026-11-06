import { Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { ServiceUserAssessmentsService } from './service-user-assessments.service';

@ApiTags('Service User Assessments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-user-assessments')
export class ServiceUserAssessmentsReviewController {
  constructor(private readonly service: ServiceUserAssessmentsService) {}

  @Get('review-schedules')
  @AnyPermission('service_users.assessments.read', 'service_users.read', 'settings.general.read')
  @ApiOperation({
    summary:
      'Assessment review schedules in force (built-in CQC/NICE intervals with the organisation overrides from Settings → Reviews & reminders)',
  })
  reviewSchedules() {
    return this.service.reviewSchedules();
  }

  @Get('review-queue')
  @AnyPermission('service_users.assessments.read', 'service_users.read')
  @ApiOperation({
    summary: 'Manager queue — assessments overdue or due soon (CQC schedule reminders)',
  })
  reviewQueue(
    @Query('serviceUserId') serviceUserId?: string,
    @Query('locationId') locationId?: string,
    @Query('overdueOnly') overdueOnly?: string,
    @Query('includeNotStarted') includeNotStarted?: string,
  ) {
    return this.service.reviewQueue({
      serviceUserId: serviceUserId?.trim() || undefined,
      locationId: locationId?.trim() || undefined,
      overdueOnly: overdueOnly === 'true',
      alertsOnly: includeNotStarted === 'true' ? false : true,
    });
  }

  @Post('send-review-reminders')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.assessments.read', 'service_users.update')
  @ApiOperation({
    summary: 'Send in-app assessment review reminders to key workers (overdue / due soon)',
  })
  sendReviewReminders(
    @CurrentUser() user: RequestUser,
    @Query('serviceUserId') serviceUserId?: string,
    @Query('dryRun') dryRun?: string,
    @Req() req?: Request,
  ) {
    return this.service.sendReviewReminders({
      triggeredByUserId: user.id,
      serviceUserId: serviceUserId?.trim() || undefined,
      dryRun: dryRun === 'true',
      meta: req ? getRequestAuditMeta(req) : undefined,
    });
  }
}
