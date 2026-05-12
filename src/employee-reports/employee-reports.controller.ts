import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeReportsService } from './employee-reports.service';

@ApiTags('Employee Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employee-reports')
export class EmployeeReportsController {
  constructor(private readonly service: EmployeeReportsService) {}

  private audit(user: RequestUser, req: Request) {
    const m = getRequestAuditMeta(req);
    return { userId: user.id, ...m };
  }

  @Get('dashboard-summary')
  @Permissions('employees.reports.read')
  dashboardSummary(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.dashboardSummary(this.audit(user, req));
  }

  @Get('staff-summary')
  @Permissions('employees.reports.read')
  staffSummary(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.staffSummary(this.audit(user, req));
  }

  @Get('staff-analysis')
  @Permissions('employees.reports.read')
  staffAnalysis(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.staffAnalysis(this.audit(user, req));
  }

  @Get('compliance')
  @Permissions('employees.reports.read')
  compliance(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.compliance(this.audit(user, req));
  }

  @Get('compliance-detail')
  @Permissions('employees.reports.read')
  complianceDetail(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.complianceDetail(this.audit(user, req));
  }

  @Get('leaving')
  @Permissions('employees.reports.read')
  leaving(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.leaving(this.audit(user, req));
  }

  @Get('details')
  @Permissions('employees.reports.read')
  details(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.details(this.audit(user, req));
  }

  @Get('holidays')
  @Permissions('employees.reports.read')
  holidays(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.holidays(this.audit(user, req));
  }
}
