import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeePayoutsService } from './employee-payouts.service';
import {
  CreateEmployeePayoutBatchDto,
  EmployeePayoutsQueryDto,
} from './dto/employee-payouts.dto';

@ApiTags('Billing — Employee payouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/employee-payouts')
export class EmployeePayoutsController {
  constructor(private readonly service: EmployeePayoutsService) {}

  @Get()
  @Permissions('billing.employee_payouts.read')
  @ApiOperation({ summary: 'List employee payout batches' })
  list(@Query() query: EmployeePayoutsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('billing.employee_payouts.read')
  @ApiOperation({ summary: 'Get payout batch with lines' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('billing.employee_payouts.manage')
  @ApiOperation({ summary: 'Create DRAFT payout batch from salary overview net' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateEmployeePayoutBatchDto) {
    return this.service.create(user.id, dto);
  }

  @Post(':id/approve')
  @Permissions('billing.employee_payouts.manage')
  @ApiOperation({ summary: 'Approve DRAFT payout batch' })
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.approve(user.id, id);
  }

  @Post(':id/mark-paid')
  @Permissions('billing.employee_payouts.manage')
  @ApiOperation({ summary: 'Mark APPROVED payout batch as bank paid' })
  markPaid(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.markPaid(user.id, id);
  }

  @Post(':id/cancel')
  @Permissions('billing.employee_payouts.manage')
  @ApiOperation({ summary: 'Cancel DRAFT or APPROVED payout batch' })
  cancel(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.cancel(user.id, id);
  }
}
