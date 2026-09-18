import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
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
  RejectVisitReconciliationDto,
  SetVisitPayableAmountDto,
  SetVisitBillableAmountDto,
  UpdateVisitReconciliationDto,
  VisitReconciliationsQueryDto,
} from './dto/visit-reconciliations.dto';

@ApiTags('Billing — Visit reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/visit-reconciliations')
export class VisitReconciliationsController {
  constructor(private readonly service: VisitReconciliationsService) {}

  @Get('summary')
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

  @Get()
  @Permissions('billing.visit_reconciliations.read')
  @ApiOperation({ summary: 'List visit reconciliations' })
  list(@Query() query: VisitReconciliationsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
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
  recalculateAmounts(@Body() dto: RecalculateVisitReconciliationsDto) {
    return this.service.recalculateAmounts(dto);
  }

  @Post('clear-all')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({
    summary:
      'Delete visit reconciliations (optionally scoped to one service user) and dependent payroll/invoice lines',
  })
  clearAll(@Body() dto: ClearVisitReconciliationsDto) {
    return this.service.clearAll(dto?.serviceUserId);
  }

  @Post('bulk-approve')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Bulk approve visit reconciliations without blocking exceptions' })
  bulkApprove(@CurrentUser() user: RequestUser, @Body() dto: BulkApproveVisitReconciliationsDto) {
    return this.service.bulkApprove(user.id, dto);
  }

  @Post(':id/evaluate')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Re-run exception detection and card resolution' })
  evaluate(@Param('id') id: string) {
    return this.service.evaluate(id);
  }

  @Patch(':id')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Update approved payable/billable windows' })
  update(@Param('id') id: string, @Body() dto: UpdateVisitReconciliationDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/payable-amount')
  @AnyPermission('billing.visit_reconciliations.manage', 'employees.update')
  @ApiOperation({
    summary: 'Set visit payable amount (counts toward employee salary when accepted for pay)',
  })
  setPayableAmount(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetVisitPayableAmountDto,
  ) {
    return this.service.setPayableAmount(user.id, id, dto);
  }

  @Post(':id/billable-amount')
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
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Approve payable and/or billable time' })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ApproveVisitReconciliationDto,
  ) {
    return this.service.approve(user.id, id, dto);
  }

  @Post(':id/overrun/approve')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({
    summary: 'Acknowledge overrun as accepted (gross pay stays on planned duration)',
  })
  approveOverrun(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DecideVisitOverrunDto,
  ) {
    return this.service.approveOverrun(user.id, id, dto);
  }

  @Post(':id/overrun/reject')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({
    summary: 'Acknowledge overrun as rejected (gross pay stays on planned duration)',
  })
  rejectOverrun(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DecideVisitOverrunDto,
  ) {
    return this.service.rejectOverrun(user.id, id, dto);
  }

  @Post(':id/reject')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Reject payable and/or billable time' })
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: RejectVisitReconciliationDto,
  ) {
    return this.service.reject(user.id, id, dto);
  }
}
