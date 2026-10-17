import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PayrollScope, PayrollScopeGuard } from '../common/guards/payroll-scope.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeePayoutsService } from './employee-payouts.service';
import {
  CancelEmployeePayoutBatchDto,
  CreateEmployeePayoutBatchDto,
  EmployeePayoutsQueryDto,
  ReleaseHistoricReimbursementDto,
  SettleEmployeePayoutBatchDto,
} from './dto/employee-payouts.dto';

@ApiTags('Billing — Employee payouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@PayrollScope({ kind: 'organisation' })
@Controller('billing/employee-payouts')
export class EmployeePayoutsController {
  constructor(private readonly service: EmployeePayoutsService) {}

  @Get()
  @Permissions('billing.employee_payouts.read')
  @ApiOperation({ summary: 'List employee payout batches' })
  list(@Query() query: EmployeePayoutsQueryDto) {
    return this.service.list(query);
  }

  @Get('eligible-uk-runs')
  @Permissions('billing.employee_payouts.read')
  @ApiOperation({
    summary: 'List UK payroll runs eligible for payout (CLOSED, with net pay)',
  })
  listEligibleUkRuns() {
    return this.service.listPayoutEligibleUkRuns();
  }

  @Get('reimbursements')
  @Permissions('billing.employee_payouts.read')
  @ApiOperation({
    summary:
      'Mileage and expenses per UK run employee: recorded, payable through payouts, in batches, outstanding (TR-13)',
  })
  reimbursements(@Query('ukPayrollRunId') ukPayrollRunId?: string) {
    return this.service.reimbursementReconciliation(ukPayrollRunId);
  }

  @Post('reimbursements/:runEmployeeId/release')
  @Permissions('billing.employee_payouts.approve')
  @ApiOperation({
    summary:
      'Release the expenses of an earlier UK run for payment, after finance has checked they were not paid another way (D-20)',
  })
  releaseHistoricReimbursement(
    @CurrentUser() user: RequestUser,
    @Param('runEmployeeId') runEmployeeId: string,
    @Body() dto: ReleaseHistoricReimbursementDto,
    @Req() req: Request,
  ) {
    return this.service.releaseHistoricReimbursement(user.id, runEmployeeId, dto.reason, getRequestAuditMeta(req));
  }

  @Delete()
  @Permissions('billing.financial_reset')
  @ApiOperation({
    summary:
      'Delete payout batches that were never approved or paid (test reset; disabled in production). Optional periodKey limits scope.',
  })
  deleteAll(
    @CurrentUser() user: RequestUser,
    @Query() query: EmployeePayoutsQueryDto,
    @Req() req: Request,
  ) {
    return this.service.deleteAll(user.id, query.periodKey, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('billing.employee_payouts.read')
  @ApiOperation({ summary: 'Get payout batch with lines' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('billing.employee_payouts.manage')
  @ApiOperation({ summary: 'Create DRAFT payout batch from a closed UK payroll run' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateEmployeePayoutBatchDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/approve')
  @Permissions('billing.employee_payouts.approve')
  @ApiOperation({
    summary: 'Approve DRAFT payout batch (a different user from the one who created it)',
  })
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.approve(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/mark-paid')
  @Permissions('billing.employee_payouts.settle')
  @ApiOperation({
    summary:
      'Record bank settlement of an APPROVED payout batch (payment reference and date required)',
  })
  markPaid(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SettleEmployeePayoutBatchDto,
    @Req() req: Request,
  ) {
    return this.service.markPaid(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/cancel')
  @Permissions('billing.employee_payouts.manage')
  @ApiOperation({ summary: 'Cancel DRAFT or APPROVED payout batch' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CancelEmployeePayoutBatchDto,
    @Req() req: Request,
  ) {
    return this.service.cancel(user.id, id, dto?.reason, getRequestAuditMeta(req));
  }
}
