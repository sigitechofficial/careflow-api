import { Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import {
  type CarePlanReviewQueueStatusFilter,
  ServiceUserCarePlansService,
} from './service-user-care-plans.service';

@ApiTags('Service User Care Plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-user-care-plans')
export class ServiceUserCarePlansReviewController {
  constructor(private readonly service: ServiceUserCarePlansService) {}

  @Get('review-queue')
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'Monitor care plans — overdue, due soon, and up to date reviews' })
  reviewQueue(
    @Query('status') status?: string,
    @Query('serviceUserId') serviceUserId?: string,
    @Query('locationId') locationId?: string,
  ) {
    const allowed: CarePlanReviewQueueStatusFilter[] = ['all', 'overdue', 'due_soon', 'ok'];
    const normalised = allowed.includes(status as CarePlanReviewQueueStatusFilter)
      ? (status as CarePlanReviewQueueStatusFilter)
      : 'all';
    return this.service.reviewQueue({
      status: normalised,
      serviceUserId: serviceUserId?.trim() || undefined,
      locationId: locationId?.trim() || undefined,
    });
  }

  @Post('send-review-reminders')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Send in-app care plan review reminders (overdue / due soon)' })
  sendReviewReminders(
    @CurrentUser() user: RequestUser,
    @Query('dryRun') dryRun?: string,
  ) {
    return this.service.sendReviewReminders({
      triggeredByUserId: user.id,
      dryRun: dryRun === 'true',
    });
  }
}
