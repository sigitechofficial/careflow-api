import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PayrollScope, PayrollScopeGuard } from '../common/guards/payroll-scope.guard';
import { Permissions, AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { VisitReconciliationsService } from './visit-reconciliations.service';
import {
  ApproveVisitReconciliationDto,
  BackfillVisitReconciliationsDto,
  BulkApproveVisitReconciliationsDto,
  DecideVisitOverrunDto,
  RecalculateVisitReconciliationsDto,
  ClearVisitReconciliationsDto,
  DismissPayEvaluationFailureDto,
  PayEvaluationFailuresQueryDto,
  RejectVisitReconciliationDto,
  SetVisitPayableAmountDto,
  SetVisitBillableAmountDto,
  UpdateVisitReconciliationDto,
  VisitReconciliationsQueryDto,
} from './dto/visit-reconciliations.dto';

@ApiTags('Billing — Visit reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@PayrollScope({ kind: 'organisation' })
@Controller('billing/visit-reconciliations')
export class VisitReconciliationsController {
  constructor(private readonly service: VisitReconciliationsService) {}

  @Get('summary')
  @PayrollScope({ kind: 'branchList' })
  @Permissions('billing.visit_reconciliations.read')
  @ApiOperation({ summary: 'Visit reconciliation summary for billing dashboard' })
  summary(@Query('locationId') locationId?: string) {
    return this.service.getSummary(locationId);
  }

  @Get('exception-queue')
  @Permissions('billing.visit_reconciliations.read')
  @ApiOperation({ summary: 'Recent unresolved finance exceptions' })
  exceptionQueue(@Query('limit') limit?: string) {
    const parsed = limit ? Math.min(Number(limit) || 10, 50) : 10;
    return this.service.getExceptionQueue(parsed);
  }

  @Get('evaluation-failures')
  @PayrollScope({ kind: 'branchList' })
  @Permissions('billing.visit_reconciliations.read')
  @ApiOperation({ summary: 'Pay calculations that failed and need attention (R-17)' })
  evaluationFailures(@Query() query: PayEvaluationFailuresQueryDto) {
    return this.service.listEvaluationFailures(query);
  }

  @Post('evaluation-failures/:failureId/retry')
  @PayrollScope({ kind: 'evaluationFailure', param: 'failureId' })
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Run a failed pay calculation again' })
  retryEvaluationFailure(
    @CurrentUser() user: RequestUser,
    @Param('failureId') failureId: string,
    @Req() req: Request,
  ) {
    return this.service.retryEvaluationFailure(user.id, failureId, getRequestAuditMeta(req));
  }

  @Post('evaluation-failures/:failureId/dismiss')
  @PayrollScope({ kind: 'evaluationFailure', param: 'failureId' })
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Close a failed pay calculation that is no longer needed, with a reason' })
  dismissEvaluationFailure(
    @CurrentUser() user: RequestUser,
    @Param('failureId') failureId: string,
    @Body() dto: DismissPayEvaluationFailureDto,
    @Req() req: Request,
  ) {
    return this.service.dismissEvaluationFailure(user.id, failureId, dto.reason, getRequestAuditMeta(req));
  }

  @Get()
  @PayrollScope({ kind: 'branchList' })
  @Permissions('billing.visit_reconciliations.read')
  @ApiOperation({ summary: 'List visit reconciliations' })
  list(@Query() query: VisitReconciliationsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @PayrollScope({ kind: 'reconciliation', param: 'id' })
  @Permissions('billing.visit_reconciliations.read')
  @ApiOperation({ summary: 'Get visit reconciliation by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post('backfill')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Create reconciliation records for existing completed visits' })
  backfill(@Body() dto: BackfillVisitReconciliationsDto) {
    return this.service.backfill(dto);
  }

  @Post('recalculate-amounts')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({
    summary:
      'Re-run pay/bill card resolution and amount calculation for unlocked reconciliations',
  })
  recalculateAmounts(
    @CurrentUser() user: RequestUser,
    @Body() dto: RecalculateVisitReconciliationsDto,
    @Req() req: Request,
  ) {
    return this.service.recalculateAmounts(dto, user.id, getRequestAuditMeta(req));
  }

  @Post('clear-all')
  @Permissions('billing.financial_reset')
  @ApiOperation({
    summary:
      'Test reset (disabled in production): delete visit reconciliations (optionally one service user) and dependent payroll/invoice lines',
  })
  clearAll(
    @CurrentUser() user: RequestUser,
    @Body() dto: ClearVisitReconciliationsDto,
    @Req() req: Request,
  ) {
    return this.service.clearAll(dto?.serviceUserId, user.id, getRequestAuditMeta(req));
  }

  @Post('bulk-approve')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Bulk approve visit reconciliations without blocking exceptions' })
  bulkApprove(@CurrentUser() user: RequestUser, @Body() dto: BulkApproveVisitReconciliationsDto) {
    return this.service.bulkApprove(user.id, dto);
  }

  @Post(':id/evaluate')
  @PayrollScope({ kind: 'reconciliation', param: 'id' })
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Re-run exception detection and card resolution' })
  evaluate(@Param('id') id: string) {
    return this.service.evaluate(id);
  }

  @Patch(':id')
  @PayrollScope({ kind: 'reconciliation', param: 'id' })
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Update approved payable/billable windows' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateVisitReconciliationDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, dto, user.id, getRequestAuditMeta(req));
  }

  @Post(':id/payable-amount')
  @PayrollScope({ kind: 'reconciliation', param: 'id' })
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({
    summary: 'Set visit payable amount (counts toward employee salary when accepted for pay)',
  })
  setPayableAmount(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetVisitPayableAmountDto,
    @Req() req: Request,
  ) {
    return this.service.setPayableAmount(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/billable-amount')
  @PayrollScope({ kind: 'reconciliation', param: 'id' })
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({
    summary: 'Set visit billable amount (client/funder charge when accepted for invoice)',
  })
  setBillableAmount(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetVisitBillableAmountDto,
  ) {
    return this.service.setBillableAmount(user.id, id, dto);
  }

  @Post(':id/approve')
  @PayrollScope({ kind: 'reconciliation', param: 'id' })
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Approve payable and/or billable time' })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ApproveVisitReconciliationDto,
    @Req() req: Request,
  ) {
    return this.service.approve(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/overrun/approve')
  @PayrollScope({ kind: 'reconciliation', param: 'id' })
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({
    summary: 'Acknowledge overrun as accepted (gross pay stays on planned duration)',
  })
  approveOverrun(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DecideVisitOverrunDto,
    @Req() req: Request,
  ) {
    return this.service.approveOverrun(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/overrun/reject')
  @PayrollScope({ kind: 'reconciliation', param: 'id' })
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({
    summary: 'Acknowledge overrun as rejected (gross pay stays on planned duration)',
  })
  rejectOverrun(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DecideVisitOverrunDto,
    @Req() req: Request,
  ) {
    return this.service.rejectOverrun(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/reject')
  @PayrollScope({ kind: 'reconciliation', param: 'id' })
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Reject payable and/or billable time' })
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: RejectVisitReconciliationDto,
    @Req() req: Request,
  ) {
    return this.service.reject(user.id, id, dto, getRequestAuditMeta(req));
  }
}
