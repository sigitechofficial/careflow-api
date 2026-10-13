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
import {
  CreateDisruptionRuleDto,
  DecideDisruptionDto,
  DisruptionNoteDto,
  DisruptionQueryDto,
  RecordDisruptionDto,
} from './dto/visit-disruptions.dto';
import { VisitDisruptionsService } from './visit-disruptions.service';

@ApiTags('Billing — Disrupted visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@PayrollScope({ kind: 'organisation' })
@Controller('billing/visit-disruptions')
export class VisitDisruptionsController {
  constructor(private readonly service: VisitDisruptionsService) {}

  @Get('rules')
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'Rules for what is paid when a visit does not go ahead as planned' })
  listRules() {
    return this.service.listRules();
  }

  @Post('rules')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Enter a rule (applies once a second person approves it)' })
  createRule(@CurrentUser() user: RequestUser, @Body() dto: CreateDisruptionRuleDto, @Req() req: Request) {
    return this.service.createRule(user.id, dto, getRequestAuditMeta(req));
  }

  @Post('rules/:id/approve')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Second person puts a rule into effect' })
  approveRule(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.approveRule(user.id, id, getRequestAuditMeta(req));
  }

  @Post('rules/:id/retire')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Stop a rule applying to new events' })
  retireRule(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.retireRule(user.id, id, getRequestAuditMeta(req));
  }

  @Get('undecided-cancellations')
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'Cancelled visits that had a carer allocated and have no pay decision' })
  undecidedCancellations() {
    return this.service.undecidedCancellations();
  }

  @Get()
  @Permissions('billing.payroll_runs.read')
  @ApiOperation({ summary: 'Pay decisions for disrupted visits' })
  list(@Query() query: DisruptionQueryDto) {
    return this.service.list(query);
  }

  @Post()
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Record an event for a carer; the rule in force proposes what is paid' })
  record(@CurrentUser() user: RequestUser, @Body() dto: RecordDisruptionDto, @Req() req: Request) {
    return this.service.record(user.id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/decide')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Set the amount: where no rule decides, or in place of what a rule proposed' })
  decide(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DecideDisruptionDto,
    @Req() req: Request,
  ) {
    return this.service.decide(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/approve')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Second person approves; an amount is then paid in the next visit pay run' })
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.approve(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/reject')
  @Permissions('billing.payroll_runs.manage')
  @ApiOperation({ summary: 'Reject an event recorded in error' })
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DisruptionNoteDto,
    @Req() req: Request,
  ) {
    return this.service.reject(user.id, id, dto.note, getRequestAuditMeta(req));
  }
}
