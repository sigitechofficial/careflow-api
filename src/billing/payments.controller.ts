import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { AddPaymentAllocationDto, CreatePaymentDto } from './dto/payments.dto';

@ApiTags('Billing — Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get('summary')
  @Permissions('billing.payments.read')
  @ApiOperation({ summary: 'Payments summary for dashboard and aged debt' })
  summary() {
    return this.service.getSummary();
  }

  @Get('aged-debt')
  @Permissions('billing.payments.read')
  @ApiOperation({ summary: 'Aged receivables buckets' })
  agedDebt() {
    return this.service.getAgedDebt();
  }

  @Get('outstanding-invoices')
  @Permissions('billing.payments.read')
  @ApiOperation({ summary: 'Locked/sent invoice runs with outstanding balance' })
  outstandingInvoices() {
    return this.service.listOutstandingInvoiceRuns();
  }

  @Get()
  @Permissions('billing.payments.read')
  @ApiOperation({ summary: 'List payments' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @Permissions('billing.payments.read')
  @ApiOperation({ summary: 'Get payment with allocations' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('billing.payments.manage')
  @ApiOperation({ summary: 'Record a payment and optional invoice allocations' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePaymentDto) {
    return this.service.create(user.id, dto);
  }

  @Post(':id/allocations')
  @Permissions('billing.payments.manage')
  @ApiOperation({ summary: 'Allocate payment to an invoice run' })
  addAllocation(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AddPaymentAllocationDto,
  ) {
    return this.service.addAllocation(user.id, id, dto);
  }

  @Delete(':id/allocations/:allocationId')
  @Permissions('billing.payments.manage')
  @ApiOperation({ summary: 'Remove a payment allocation' })
  removeAllocation(@Param('id') id: string, @Param('allocationId') allocationId: string) {
    return this.service.removeAllocation(id, allocationId);
  }
}
