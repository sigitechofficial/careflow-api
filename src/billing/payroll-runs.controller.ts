import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { PayrollRunsService } from './payroll-runs.service';
import {
  CreateBillingRunDto,
  CreateEmployeeSalaryDeductionDto,
  EmployeeEarningsQueryDto,
} from './dto/billing-runs.dto';

@ApiTags('Billing — Payroll runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/payroll-runs')
export class PayrollRunsController {
  constructor(private readonly service: PayrollRunsService) {}

  @Get('summary')
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'Payroll run draft summary for dashboard' })
  summary() {
    return this.service.getSummary();
  }

  @Get('employee-salaries')
  @AnyPermission('billing.payroll_runs.read', 'employees.read', 'employees.update')
  @ApiOperation({ summary: 'Organisation employee salary overview for a period' })
  employeeSalaries(@Query() query: EmployeeEarningsQueryDto) {
    return this.service.listEmployeeSalaries(query);
  }

  @Get('employee/:employeeId/earnings')
  @AnyPermission('billing.payroll_runs.read', 'employees.read', 'employees.update')
  @ApiOperation({ summary: 'Employee earnings / monthly salary summary' })
  employeeEarnings(
    @Param('employeeId') employeeId: string,
    @Query() query: EmployeeEarningsQueryDto,
  ) {
    return this.service.getEmployeeEarnings(employeeId, query);
  }

  @Get('employee/:employeeId/salary-deductions')
  @AnyPermission('billing.payroll_runs.read', 'employees.read', 'employees.update')
  @ApiOperation({ summary: 'List fines and penalties for an employee' })
  listDeductions(
    @Param('employeeId') employeeId: string,
    @Query('salaryMonth') salaryMonth?: string,
  ) {
    return this.service.listEmployeeSalaryDeductions(employeeId, salaryMonth);
  }

  @Post('employee/:employeeId/salary-deductions')
  @AnyPermission('billing.payroll_runs.manage', 'employees.update')
  @ApiOperation({ summary: 'Add a fine or penalty to an employee monthly salary' })
  createDeduction(
    @CurrentUser() user: RequestUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateEmployeeSalaryDeductionDto,
  ) {
    return this.service.createEmployeeSalaryDeduction(user.id, employeeId, dto);
  }

  @Delete('employee/:employeeId/salary-deductions/:deductionId')
  @AnyPermission('billing.payroll_runs.manage', 'employees.update')
  @ApiOperation({ summary: 'Remove a fine or penalty from employee salary' })
  deleteDeduction(
    @CurrentUser() user: RequestUser,
    @Param('employeeId') employeeId: string,
    @Param('deductionId') deductionId: string,
  ) {
    return this.service.deleteEmployeeSalaryDeduction(user.id, employeeId, deductionId);
  }

  @Get()
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'List payroll runs' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'Get payroll run with lines' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Create payroll run draft' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBillingRunDto) {
    return this.service.create(user.id, dto);
  }

  @Post(':id/calculate')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Calculate payroll lines from approved visits' })
  calculate(@Param('id') id: string) {
    return this.service.calculate(id);
  }

  @Post(':id/approve')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Approve payroll run for locking' })
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.approve(user.id, id);
  }

  @Post(':id/lock')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Lock payroll run and mark visits as pay-processed' })
  lock(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.lock(user.id, id);
  }

  @Get(':id/export')
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'Download payroll run CSV (locked or exported runs)' })
  @ApiProduces('text/csv')
  async downloadExport(@Param('id') id: string, @Res() res: Response) {
    const { csv, filename } = await this.service.getExportCsv(id);
    res
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  }

  @Post(':id/export')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Download payroll CSV and mark run as exported' })
  @ApiProduces('text/csv')
  async export(@Param('id') id: string, @Res() res: Response) {
    const { csv, filename } = await this.service.exportAndMark(id);
    res
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  }
}
