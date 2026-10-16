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
import { PensionAeEventDto, ProposeDeductionAdjustmentDto, ReviewDeductionAdjustmentDto } from './dto/payroll.dto';
import { PayrollLoanPensionService } from './payroll-loan-pension.service';

@ApiTags('UK Payroll — Loans & pensions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@Controller('payroll')
export class PayrollLoanPensionController {
  constructor(private readonly service: PayrollLoanPensionService) {}

  @Get('adjustments')
  @PayrollScope({ kind: 'organisation' })
  @Permissions('payroll.runs.read')
  @ApiOperation({ summary: 'List corrections of loan / pension amounts in closed runs' })
  listAdjustments(@Query('employeeId') employeeId?: string) {
    return this.service.listAdjustments(employeeId || undefined);
  }

  @Post('adjustments')
  @PayrollScope({ kind: 'organisation' })
  @Permissions('payroll.runs.manage')
  @ApiOperation({ summary: 'Propose a correction (refund / reversal) of a loan or pension amount in a closed run' })
  proposeAdjustment(@CurrentUser() user: RequestUser, @Body() dto: ProposeDeductionAdjustmentDto, @Req() req: Request) {
    return this.service.proposeAdjustment(user.id, dto, getRequestAuditMeta(req));
  }

  @Post('adjustments/:adjustmentId/review')
  @PayrollScope({ kind: 'organisation' })
  @Permissions('payroll.runs.close')
  @ApiOperation({ summary: 'Approve or reject a proposed correction (a different person from the proposer)' })
  reviewAdjustment(
    @CurrentUser() user: RequestUser,
    @Param('adjustmentId') adjustmentId: string,
    @Body() dto: ReviewDeductionAdjustmentDto,
    @Req() req: Request,
  ) {
    return this.service.reviewAdjustment(user.id, adjustmentId, dto, getRequestAuditMeta(req));
  }

  @Get('employees/:employeeId/pension-ae')
  @PayrollScope({ kind: 'employee', source: 'params', key: 'employeeId' })
  @Permissions('payroll.employees.read')
  @ApiOperation({ summary: 'Automatic enrolment duties of an employee' })
  getPensionAe(@Param('employeeId') employeeId: string) {
    return this.service.getPensionAe(employeeId);
  }

  @Post('employees/:employeeId/pension-ae/events')
  @PayrollScope({ kind: 'employee', source: 'params', key: 'employeeId' })
  @Permissions('payroll.employees.manage')
  @ApiOperation({ summary: 'Record an automatic enrolment event (postponement, notice, opt-in, opt-out, ...)' })
  recordPensionAeEvent(
    @CurrentUser() user: RequestUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: PensionAeEventDto,
    @Req() req: Request,
  ) {
    return this.service.recordPensionAeEvent(user.id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Get('runs/:runId/pension-contributions')
  @PayrollScope({ kind: 'organisation' })
  @Permissions('payroll.runs.read')
  @ApiOperation({ summary: 'Provider-independent pension contribution file and reconciliation for a run' })
  pensionContributions(@Param('runId') runId: string) {
    return this.service.pensionContributions(runId);
  }
}
