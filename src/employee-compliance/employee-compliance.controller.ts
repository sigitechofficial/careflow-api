import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeComplianceService } from './employee-compliance.service';
import { CreateEmployeeComplianceDto } from './dto/create-employee-compliance.dto';
import { UpdateEmployeeComplianceDto } from './dto/update-employee-compliance.dto';

@ApiTags('Employee Compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/compliance')
export class EmployeeComplianceController {
  constructor(private readonly service: EmployeeComplianceService) {}

  @Get()
  @Permissions('employees.compliance.read')
  list(@CurrentUser() user: RequestUser, @Param('id') employeeId: string, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.list(employeeId, { actorUserId: user.id, ...m });
  }

  @Post()
  @Permissions('employees.compliance.update')
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Body() dto: CreateEmployeeComplianceDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Patch(':complianceId')
  @Permissions('employees.compliance.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('complianceId') complianceId: string,
    @Body() dto: UpdateEmployeeComplianceDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, employeeId, complianceId, dto, getRequestAuditMeta(req));
  }

  @Delete(':complianceId')
  @Permissions('employees.compliance.update')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('complianceId') complianceId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, employeeId, complianceId, getRequestAuditMeta(req));
  }
}
