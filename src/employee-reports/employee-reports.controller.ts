import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeReportsService } from './employee-reports.service';
import { EmployeeReportQueryDto } from './dto/employee-report-query.dto';

@ApiTags('Employee Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('employees.reports.read')
@Controller('employee-reports')
export class EmployeeReportsController {
  constructor(private readonly service: EmployeeReportsService) {}

  private audit(user: RequestUser, req: Request) {
    const m = getRequestAuditMeta(req);
    return { userId: user.id, ...m };
  }

  @Get('dashboard-summary')
  dashboardSummary(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.dashboardSummary(this.audit(user, req));
  }

  @Get('staff-summary')
  staffSummary(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.staffSummary(this.audit(user, req));
  }

  @Get('activity-summary')
  @ApiOperation({
    summary: 'Carer activity: visits, hours, late starts, tasks and notes',
  })
  activitySummary(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.activitySummary(user, query, this.audit(user, req));
  }

  @Get('staff-analysis')
  @ApiOperation({
    summary:
      'Overdue or due-soon reviews, skills, certifications and compliance per carer',
  })
  staffAnalysis(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.staffAnalysis(user, query, this.audit(user, req));
  }

  @Get('compliance')
  @ApiOperation({
    summary:
      'Skills, certifications and compliance documents expiring or expired',
  })
  compliance(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.compliance(user, query, this.audit(user, req));
  }

  @Get('compliance-detail')
  @ApiOperation({
    summary: 'Compliance status per carer (as on the Compliance board)',
  })
  complianceDetail(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.complianceDetail(user, query, this.audit(user, req));
  }

  @Get('roles')
  @ApiOperation({ summary: 'Role, job title and employment type per carer' })
  roles(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.roles(user, query, this.audit(user, req));
  }

  @Get('leaving')
  @ApiOperation({ summary: 'Carers who left in the date range' })
  leaving(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.leaving(user, query, this.audit(user, req));
  }

  @Get('details')
  @ApiOperation({ summary: 'Contact and employment details for every carer' })
  details(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.details(user, query, this.audit(user, req));
  }

  @Get('holidays')
  @ApiOperation({ summary: 'Holidays and absences in the date range' })
  holidays(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeeReportQueryDto,
    @Req() req: Request,
  ) {
    return this.service.holidays(user, query, this.audit(user, req));
  }
}
