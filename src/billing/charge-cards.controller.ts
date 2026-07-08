import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ChargeCardsService } from './billing-cards.service';
import {
  AssignChargeCardMatchingDto,
  BillingCardQueryDto,
  CreateChargeCardDto,
  UpdateChargeCardDto,
} from './dto/billing-cards.dto';

@ApiTags('Billing — Charge cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/charge-cards')
export class ChargeCardsController {
  constructor(private readonly service: ChargeCardsService) {}

  @Get()
  @Permissions('billing.charge_cards.read')
  @ApiOperation({ summary: 'List service user charge cards' })
  list(@Query() query: BillingCardQueryDto) {
    return this.service.list(query);
  }

  @Get('resolve/:serviceUserId')
  @Permissions('billing.charge_cards.read')
  @ApiOperation({ summary: 'Resolve charge card for a service user' })
  resolveForServiceUser(@Param('serviceUserId') serviceUserId: string) {
    return this.service.resolveForServiceUser(serviceUserId);
  }

  @Get(':id/assignment-preview')
  @Permissions('billing.charge_cards.read')
  @ApiOperation({ summary: 'Preview matching attach-to records for a charge card' })
  assignmentPreview(@Param('id') id: string) {
    return this.service.getAssignmentPreview(id);
  }

  @Post(':id/assign-matching')
  @Permissions('billing.charge_cards.manage')
  @ApiOperation({ summary: 'Bulk-assign charge card to matching funders or service users' })
  assignMatching(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AssignChargeCardMatchingDto,
    @Req() req: Request,
  ) {
    return this.service.assignToMatching(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('billing.charge_cards.read')
  @ApiOperation({ summary: 'Get charge card by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('billing.charge_cards.manage')
  @ApiOperation({ summary: 'Create charge card' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateChargeCardDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('billing.charge_cards.manage')
  @ApiOperation({ summary: 'Update charge card' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateChargeCardDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('billing.charge_cards.manage')
  @ApiOperation({ summary: 'Soft-delete charge card' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
