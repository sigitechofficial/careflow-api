import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PayrollScope, PayrollScopeGuard } from '../common/guards/payroll-scope.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { DecideTravelIntervalDto, RecordTravelIntervalDto, RejectTravelIntervalDto } from './dto/travel-intervals.dto';
import { TravelIntervalsService } from './travel-intervals.service';

@ApiTags('Billing — Travel time')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@PayrollScope({ kind: 'organisation' })
@Controller('billing/travel-intervals')
export class TravelIntervalsController {
  constructor(private readonly service: TravelIntervalsService) {}

  @Get('visit/:visitReconciliationId')
  @PayrollScope({ kind: 'reconciliation', param: 'visitReconciliationId' })
  @Permissions('billing.visit_reconciliations.read')
  @ApiOperation({ summary: 'Travel time of a visit: approved intervals, or the estimate the pay run uses without them' })
  listForVisit(@Param('visitReconciliationId') visitReconciliationId: string) {
    return this.service.listForVisit(visitReconciliationId);
  }

  @Post()
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Record what a stretch of time before a visit was (awaits a second person)' })
  record(@CurrentUser() user: RequestUser, @Body() dto: RecordTravelIntervalDto, @Req() req: Request) {
    return this.service.record(user.id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/approve')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Approve an interval: it then replaces the estimate for that visit' })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DecideTravelIntervalDto,
    @Req() req: Request,
  ) {
    return this.service.approve(user.id, id, dto.note, getRequestAuditMeta(req));
  }

  @Post(':id/reject')
  @Permissions('billing.visit_reconciliations.manage')
  @ApiOperation({ summary: 'Reject an interval' })
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: RejectTravelIntervalDto,
    @Req() req: Request,
  ) {
    return this.service.reject(user.id, id, dto.note, getRequestAuditMeta(req));
  }
}
