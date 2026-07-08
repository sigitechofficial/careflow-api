import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PayCardsService } from './billing-cards.service';
import {
  BillingCardQueryDto,
  CreatePayCardDto,
  UpdatePayCardDto,
  AssignPayCardMatchingDto,
} from './dto/billing-cards.dto';

@ApiTags('Billing — Pay cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/pay-cards')
export class PayCardsController {
  constructor(private readonly service: PayCardsService) {}

  @Get()
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'List carer pay cards' })
  list(@Query() query: BillingCardQueryDto) {
    return this.service.list(query);
  }

  @Get('resolve/:employeeId')
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'Resolve pay card for an employee (explicit or auto-matched)' })
  resolveForEmployee(@Param('employeeId') employeeId: string) {
    return this.service.resolveForEmployee(employeeId);
  }

  @Get(':id/assignment-preview')
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'Preview how many carers match a pay card assignment' })
  assignmentPreview(@Param('id') id: string) {
    return this.service.getAssignmentPreview(id);
  }

  @Post(':id/assign-matching')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Bulk-assign pay card to matching carers (Birdie-style)' })
  assignMatching(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AssignPayCardMatchingDto,
    @Req() req: Request,
  ) {
    return this.service.assignToMatchingEmployees(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'Get pay card by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Create pay card' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePayCardDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Update pay card' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePayCardDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Soft-delete pay card' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
