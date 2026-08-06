import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  CreateEmployeePayAgreementDto,
  UpdateEmployeePayAgreementDto,
  UpsertEmployeePayrollProfileDto,
} from './dto/payroll.dto';
import { PayrollEmployeesService } from './payroll-employees.service';

@ApiTags('UK Payroll — Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('payroll')
export class PayrollEmployeesController {
  constructor(private readonly service: PayrollEmployeesService) {}

  @Get('employees')
  @Permissions('payroll.employees.read')
  @ApiOperation({ summary: 'List employees with payroll setup status' })
  list() {
    return this.service.listEmployeeSetup();
  }

  @Get('employees/:employeeId/ytd')
  @Permissions('payroll.employees.read')
  @ApiOperation({
    summary: 'Get employee year-to-date pay / tax / NI for a tax year (defaults to current)',
  })
  getYtd(
    @Param('employeeId') employeeId: string,
    @Query('taxYearId') taxYearId?: string,
  ) {
    return this.service.getEmployeeYtd(employeeId, taxYearId || undefined);
  }

  @Get('employees/:employeeId/profile')
  @Permissions('payroll.employees.read')
  @ApiOperation({ summary: 'Get employee payroll profile' })
  getProfile(@Param('employeeId') employeeId: string) {
    return this.service.getProfile(employeeId);
  }

  @Put('employees/:employeeId/profile')
  @Permissions('payroll.employees.manage')
  @ApiOperation({ summary: 'Create or update employee payroll profile (configuration only)' })
  upsertProfile(
    @CurrentUser() user: RequestUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: UpsertEmployeePayrollProfileDto,
    @Req() req: Request,
  ) {
    return this.service.upsertProfile(user.id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Get('employees/:employeeId/pay-agreements')
  @Permissions('payroll.employees.read')
  @ApiOperation({ summary: 'List effective-dated pay agreements' })
  listAgreements(@Param('employeeId') employeeId: string) {
    return this.service.listAgreements(employeeId);
  }

  @Post('employees/:employeeId/pay-agreements')
  @Permissions('payroll.employees.manage')
  @ApiOperation({ summary: 'Create an effective-dated pay agreement' })
  createAgreement(
    @CurrentUser() user: RequestUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateEmployeePayAgreementDto,
    @Req() req: Request,
  ) {
    return this.service.createAgreement(user.id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Patch('pay-agreements/:agreementId')
  @Permissions('payroll.employees.manage')
  @ApiOperation({ summary: 'Update a pay agreement' })
  updateAgreement(
    @CurrentUser() user: RequestUser,
    @Param('agreementId') agreementId: string,
    @Body() dto: UpdateEmployeePayAgreementDto,
    @Req() req: Request,
  ) {
    return this.service.updateAgreement(user.id, agreementId, dto, getRequestAuditMeta(req));
  }
}
