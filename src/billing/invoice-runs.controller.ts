import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { InvoiceRunsService } from './invoice-runs.service';
import { CreateBillingRunDto } from './dto/billing-runs.dto';

@ApiTags('Billing — Invoice runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/invoice-runs')
export class InvoiceRunsController {
  constructor(private readonly service: InvoiceRunsService) {}

  @Get('summary')
  @Permissions('billing.invoice_runs.read')
  @ApiOperation({ summary: 'Invoice run draft summary for dashboard' })
  summary() {
    return this.service.getSummary();
  }

  @Get('service-user/:serviceUserId')
  @AnyPermission('billing.invoice_runs.read', 'service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'Invoice runs and funder totals for one service user' })
  forServiceUser(@Param('serviceUserId') serviceUserId: string) {
    return this.service.getForServiceUser(serviceUserId);
  }

  @Get()
  @Permissions('billing.invoice_runs.read')
  @ApiOperation({ summary: 'List invoice runs' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @Permissions('billing.invoice_runs.read')
  @ApiOperation({ summary: 'Get invoice run with lines' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({ summary: 'Create invoice run draft' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBillingRunDto) {
    return this.service.create(user.id, dto);
  }

  @Post(':id/calculate')
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({ summary: 'Calculate invoice lines from approved visits' })
  calculate(@Param('id') id: string) {
    return this.service.calculate(id);
  }

  @Post(':id/approve')
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({ summary: 'Approve invoice run for locking' })
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.approve(user.id, id);
  }

  @Post(':id/lock')
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({ summary: 'Lock invoice run and mark visits as invoiced' })
  lock(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.lock(user.id, id);
  }

  @Post(':id/send')
  @Permissions('billing.invoice_runs.manage')
  @ApiOperation({ summary: 'Mark invoice run as sent to funders' })
  send(@Param('id') id: string) {
    return this.service.markSent(id);
  }
}
