import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PayrollScope, PayrollScopeGuard } from '../common/guards/payroll-scope.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreateLeaveTermsDto, RecordLeaveEntryDto } from './dto/leave.dto';
import { LeaveService } from './leave.service';

@ApiTags('UK Payroll — Holiday entitlement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@Controller('payroll')
export class LeaveController {
  constructor(private readonly service: LeaveService) {}

  @Get('employees/:employeeId/leave')
  @PayrollScope({ kind: 'employee', source: 'params', key: 'employeeId' })
  @Permissions('payroll.employees.read')
  @ApiOperation({ summary: 'Holiday entitlement, balance and holiday pay rate on a day (or for a leaver)' })
  summary(
    @Param('employeeId') employeeId: string,
    @Query('asOf') asOf?: string,
    @Query('leavingDate') leavingDate?: string,
  ) {
    return this.service.summary(employeeId, asOf, leavingDate);
  }

  @Get('employees/:employeeId/leave-terms')
  @PayrollScope({ kind: 'employee', source: 'params', key: 'employeeId' })
  @Permissions('payroll.employees.read')
  @ApiOperation({ summary: 'Leave terms of an employee, current and earlier' })
  listTerms(@Param('employeeId') employeeId: string) {
    return this.service.listTerms(employeeId);
  }

  @Post('employees/:employeeId/leave-terms')
  @PayrollScope({ kind: 'employee', source: 'params', key: 'employeeId' })
  @Permissions('payroll.employees.manage')
  @ApiOperation({ summary: 'Enter leave terms (apply once a second person approves them)' })
  createTerms(
    @CurrentUser() user: RequestUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateLeaveTermsDto,
    @Req() req: Request,
  ) {
    return this.service.createTerms(user.id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Post('leave-terms/:termsId/approve')
  @PayrollScope({ kind: 'organisation' })
  @Permissions('payroll.pay_agreements.approve')
  @ApiOperation({ summary: 'Second person puts leave terms into effect' })
  approveTerms(@CurrentUser() user: RequestUser, @Param('termsId') termsId: string, @Req() req: Request) {
    return this.service.approveTerms(user.id, termsId, getRequestAuditMeta(req));
  }

  @Post('employees/:employeeId/leave-entries')
  @PayrollScope({ kind: 'employee', source: 'params', key: 'employeeId' })
  @Permissions('payroll.employees.manage')
  @ApiOperation({ summary: 'Record leave taken, an adjustment, a carry-over or a payment on leaving' })
  recordEntry(
    @CurrentUser() user: RequestUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: RecordLeaveEntryDto,
    @Req() req: Request,
  ) {
    return this.service.recordEntry(user.id, employeeId, dto, getRequestAuditMeta(req));
  }
}
