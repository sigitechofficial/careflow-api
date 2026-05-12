import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ComplianceReportsService } from './compliance-reports.service';
import { EmployeeComplianceReportQueryDto } from './dto/employee-compliance-report-query.dto';

@ApiTags('Employee Compliance Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employee-compliance')
export class ComplianceReportsController {
  constructor(private readonly service: ComplianceReportsService) {}

  @Get('summary')
  @Permissions('employees.compliance.reports.read')
  @ApiOperation({ summary: 'Aggregate compliance counts' })
  summary(@CurrentUser() user: RequestUser, @Query() query: EmployeeComplianceReportQueryDto, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.summary(query, { actorUserId: user.id, ...m });
  }

  @Get('missing')
  @Permissions('employees.compliance.reports.read')
  missing(@CurrentUser() user: RequestUser, @Query() query: EmployeeComplianceReportQueryDto, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.missing(query, { actorUserId: user.id, ...m });
  }

  @Get('expired')
  @Permissions('employees.compliance.reports.read')
  expired(@CurrentUser() user: RequestUser, @Query() query: EmployeeComplianceReportQueryDto, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.expired(query, { actorUserId: user.id, ...m });
  }

  @Get('expiring')
  @Permissions('employees.compliance.reports.read')
  expiring(@CurrentUser() user: RequestUser, @Query() query: EmployeeComplianceReportQueryDto, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.expiring(query, { actorUserId: user.id, ...m });
  }

  @Get('pending-review')
  @Permissions('employees.compliance.reports.read')
  pendingReview(@CurrentUser() user: RequestUser, @Query() query: EmployeeComplianceReportQueryDto, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.pendingReview(query, { actorUserId: user.id, ...m });
  }

  @Get('report')
  @Permissions('employees.compliance.reports.read')
  report(@CurrentUser() user: RequestUser, @Query() query: EmployeeComplianceReportQueryDto, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.report(query, { actorUserId: user.id, ...m });
  }

  @Get('detail-report')
  @Permissions('employees.compliance.reports.read')
  detailReport(@CurrentUser() user: RequestUser, @Query() query: EmployeeComplianceReportQueryDto, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.detailReport(query, { actorUserId: user.id, ...m });
  }
}
