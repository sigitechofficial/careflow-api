import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PayrollScope, PayrollScopeGuard } from '../common/guards/payroll-scope.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PayItemsService } from './pay-items.service';
import {
  CreatePayItemDto,
  PayItemQueryDto,
  PayItemSuggestionQueryDto,
  RecordVisitPayCorrectionDto,
  RejectPayItemDto,
  ReversePayItemDto,
} from './dto/pay-items.dto';

@ApiTags('Billing — Pay items')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@PayrollScope({ kind: 'organisation' })
@Controller('billing/pay-items')
export class PayItemsController {
  constructor(private readonly service: PayItemsService) {}

  @Get()
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'Non-visit pay items (bonus, adjustment, holiday, sick, on-call, live-in, training)' })
  list(@Query() query: PayItemQueryDto) {
    return this.service.list(query);
  }

  @Get('suggest-rate')
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'Default rate for a pay item (pay card rate or 52-week average for holiday pay)' })
  suggestRate(@Query() query: PayItemSuggestionQueryDto) {
    return this.service.suggestRate(query);
  }

  @Post()
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Enter a pay item (awaits approval)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePayItemDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Post('visit-corrections')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({
    summary:
      'Record a pay correction for a visit in a locked payroll run (difference is paid in the next run after a second approval)',
  })
  recordVisitCorrection(
    @CurrentUser() user: RequestUser,
    @Body() dto: RecordVisitPayCorrectionDto,
    @Req() req: Request,
  ) {
    return this.service.recordVisitCorrection(user.id, dto, getRequestAuditMeta(req));
  }

  @Get('visit-corrections/:visitReconciliationId')
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'Original pay line, corrections and reversals of one visit' })
  visitCorrectionHistory(@Param('visitReconciliationId') visitReconciliationId: string) {
    return this.service.visitCorrectionHistory(visitReconciliationId);
  }

  @Post(':id/reverse')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Reverse a pay item that has already been paid (once; needs a second approval)' })
  reverse(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReversePayItemDto,
    @Req() req: Request,
  ) {
    return this.service.reverse(user.id, id, dto.reason, getRequestAuditMeta(req));
  }

  @Post(':id/approve')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Approve a pay item (bonus / adjustment need a different approver)' })
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.approve(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/reject')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Reject a pay item' })
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: RejectPayItemDto,
    @Req() req: Request,
  ) {
    return this.service.reject(user.id, id, dto.reason, getRequestAuditMeta(req));
  }

  @Post(':id/cancel')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Cancel a pay item that has not been paid' })
  cancel(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.cancel(user.id, id, getRequestAuditMeta(req));
  }
}
