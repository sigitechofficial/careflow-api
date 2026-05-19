import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ScheduleReportsService } from './schedule-reports.service';
import { VisitDetailReportQueryDto } from './dto/visit-detail-report-query.dto';
import { DailyCarerAllocationReportQueryDto } from './dto/daily-carer-allocation-report-query.dto';
import { CallOffVisitReportQueryDto } from './dto/call-off-visit-report-query.dto';
import { ServiceUserVisitReportQueryDto } from './dto/service-user-visit-report-query.dto';
import { ServiceUserTimeAnalysisQueryDto } from './dto/service-user-time-analysis-query.dto';
import { ScheduleReportQueryDto } from './dto/schedule-report-query.dto';

@ApiTags('Schedule Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schedule-reports')
export class ScheduleReportsController {
  constructor(private readonly service: ScheduleReportsService) {}

  @Get('report-types')
  @Permissions('schedule_reports.read')
  @ApiOperation({ summary: 'List available schedule report types' })
  reportTypes() {
    return this.service.reportTypes();
  }

  @Get('visit-detail')
  @AnyPermission('schedule_reports.read', 'schedule_reports.export')
  @ApiOperation({ summary: 'Visit Detail Report (JSON)' })
  visitDetail(
    @CurrentUser() user: RequestUser,
    @Query() query: VisitDetailReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.visitDetail(user.id, query, getRequestAuditMeta(req), user.permissions);
  }

  @Get('daily-carer-allocation')
  @AnyPermission('schedule_reports.read', 'schedule_reports.export')
  @ApiOperation({ summary: 'Daily Carer Allocation Report (JSON)' })
  dailyCarerAllocation(
    @CurrentUser() user: RequestUser,
    @Query() query: DailyCarerAllocationReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.dailyCarerAllocation(user.id, query, getRequestAuditMeta(req), user.permissions);
  }

  @Get('call-off-visits')
  @AnyPermission('schedule_reports.read', 'schedule_reports.export')
  @ApiOperation({ summary: 'Call-off Visit Report (JSON)' })
  callOffVisits(
    @CurrentUser() user: RequestUser,
    @Query() query: CallOffVisitReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.callOffVisits(user.id, query, getRequestAuditMeta(req), user.permissions);
  }

  @Get('employee-capacity')
  @AnyPermission('schedule_reports.read', 'schedule_reports.export', 'employee_capacity.read')
  @ApiOperation({ summary: 'Employee Capacity Report (JSON)' })
  employeeCapacity(
    @CurrentUser() user: RequestUser,
    @Query() query: ScheduleReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.employeeCapacity(user.id, query, getRequestAuditMeta(req), user.permissions);
  }

  @Get('service-user-visits')
  @AnyPermission('schedule_reports.read', 'schedule_reports.export')
  @ApiOperation({ summary: 'Service User Visit Report (JSON)' })
  serviceUserVisits(
    @CurrentUser() user: RequestUser,
    @Query() query: ServiceUserVisitReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.serviceUserVisits(user.id, query, getRequestAuditMeta(req), user.permissions);
  }

  @Get('service-user-time-analysis')
  @AnyPermission('schedule_reports.read', 'schedule_reports.export')
  @ApiOperation({ summary: 'Service User Time Analysis (JSON)' })
  serviceUserTimeAnalysis(
    @CurrentUser() user: RequestUser,
    @Query() query: ServiceUserTimeAnalysisQueryDto,
    @Req() req: Request,
  ) {
    return this.service.serviceUserTimeAnalysis(user.id, query, getRequestAuditMeta(req), user.permissions);
  }

  @Get('scheduled-jobs-status')
  @AnyPermission('schedule_reports.read', 'schedule_reports.export')
  @ApiOperation({ summary: 'Scheduled Jobs Status Report (JSON)' })
  scheduledJobsStatus(
    @CurrentUser() user: RequestUser,
    @Query() query: ScheduleReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.scheduledJobsStatus(user.id, query, getRequestAuditMeta(req), user.permissions);
  }
}
