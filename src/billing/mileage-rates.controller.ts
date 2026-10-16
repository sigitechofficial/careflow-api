import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { MileageRatesService } from './mileage-rates.service';
import { CreateMileageRateDto, VerifyApprovedMileageAmountsDto } from './dto/mileage-rates.dto';

@ApiTags('Billing — Mileage rates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/mileage-rates')
export class MileageRatesController {
  constructor(private readonly service: MileageRatesService) {}

  @Get()
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'Mileage rates per period and vehicle type, with HMRC approved amounts where verified' })
  list() {
    return this.service.list();
  }

  @Post()
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: "Record the organisation's mileage rates from a date" })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateMileageRateDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/approved-amounts')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Record HMRC approved amounts for a period, with where they were checked' })
  verifyApprovedAmounts(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: VerifyApprovedMileageAmountsDto,
    @Req() req: Request,
  ) {
    return this.service.verifyApprovedAmounts(user.id, id, dto, getRequestAuditMeta(req));
  }
}
