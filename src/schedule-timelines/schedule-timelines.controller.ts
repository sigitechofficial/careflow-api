import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ScheduleTimelinesService } from './schedule-timelines.service';
import { JobsDayTimelineQueryDto } from './dto/jobs-day-timeline-query.dto';
import { EmployeeTimelineQueryDto } from './dto/employee-timeline-query.dto';
import { ServiceUserTimelineQueryDto } from './dto/service-user-timeline-query.dto';
import { EmployeeCapacityQueryDto } from './dto/employee-capacity-query.dto';

@ApiTags('Schedule Timelines')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schedule-timelines')
export class ScheduleTimelinesController {
  constructor(private readonly service: ScheduleTimelinesService) {}

  @Get('jobs/day-runs')
  @Permissions('schedule_timelines.read')
  @ApiOperation({ summary: 'Jobs / Day / Runs view' })
  jobsDayRuns(
    @CurrentUser() user: RequestUser,
    @Query() query: JobsDayTimelineQueryDto,
    @Req() req: Request,
  ) {
    return this.service.jobsDayRuns(user.id, query, getRequestAuditMeta(req));
  }

  @Get('jobs/day-timeline')
  @Permissions('schedule_timelines.read')
  @ApiOperation({ summary: 'Jobs / Day / Timeline view' })
  jobsDayTimeline(
    @CurrentUser() user: RequestUser,
    @Query() query: JobsDayTimelineQueryDto,
    @Req() req: Request,
  ) {
    return this.service.jobsDayTimeline(user.id, query, getRequestAuditMeta(req));
  }

  @Get('employees/day-runs')
  @Permissions('schedule_timelines.read')
  @ApiOperation({ summary: 'Employee / Day / Runs view' })
  employeesDayRuns(
    @CurrentUser() user: RequestUser,
    @Query() query: JobsDayTimelineQueryDto,
    @Req() req: Request,
  ) {
    return this.service.employeesDayRuns(user.id, query, getRequestAuditMeta(req));
  }

  @Get('job-carer/day-starts')
  @Permissions('schedule_timelines.read')
  @ApiOperation({ summary: 'Job / Carer / Day starts' })
  jobCarerDayStarts(
    @CurrentUser() user: RequestUser,
    @Query() query: JobsDayTimelineQueryDto,
    @Req() req: Request,
  ) {
    return this.service.jobCarerDayStarts(user.id, query, getRequestAuditMeta(req));
  }

  @Get('employees/day')
  @Permissions('schedule_timelines.read')
  @ApiOperation({ summary: 'Employee / Day / Timeline' })
  employeesDay(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeTimelineQueryDto,
    @Req() req: Request,
  ) {
    return this.service.employeesDay(user.id, query, getRequestAuditMeta(req));
  }

  @Get('employees/week')
  @Permissions('schedule_timelines.read')
  @ApiOperation({ summary: 'Employee / Week / Timeline' })
  employeesWeek(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeTimelineQueryDto,
    @Req() req: Request,
  ) {
    return this.service.employeesWeek(user.id, query, getRequestAuditMeta(req));
  }

  @Get('employees/month')
  @Permissions('schedule_timelines.read')
  @ApiOperation({ summary: 'Employee / Month / Timeline (single month)' })
  employeesMonth(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeTimelineQueryDto,
    @Req() req: Request,
  ) {
    return this.service.employeesMonth(user.id, query, getRequestAuditMeta(req));
  }

  @Get('service-users/day')
  @Permissions('schedule_timelines.read')
  @ApiOperation({ summary: 'Service User / Day / Timeline' })
  serviceUsersDay(
    @CurrentUser() user: RequestUser,
    @Query() query: ServiceUserTimelineQueryDto,
    @Req() req: Request,
  ) {
    return this.service.serviceUsersDay(user.id, query, getRequestAuditMeta(req));
  }

  @Get('service-users/week')
  @Permissions('schedule_timelines.read')
  @ApiOperation({ summary: 'Service User / Week / Timeline' })
  serviceUsersWeek(
    @CurrentUser() user: RequestUser,
    @Query() query: ServiceUserTimelineQueryDto,
    @Req() req: Request,
  ) {
    return this.service.serviceUsersWeek(user.id, query, getRequestAuditMeta(req));
  }

  @Get('employee-capacity')
  @AnyPermission('schedule_timelines.read', 'employee_capacity.read')
  @ApiOperation({ summary: 'Employee capacity report (max 31-day range)' })
  employeeCapacity(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeCapacityQueryDto,
    @Req() req: Request,
  ) {
    return this.service.employeeCapacity(user.id, query, getRequestAuditMeta(req));
  }
}
