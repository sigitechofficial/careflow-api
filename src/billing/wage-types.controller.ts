import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { WageTypesService } from './wage-types.service';
import { BankHolidaysService } from './bank-holidays.service';
import {
  BankHolidayQueryDto,
  CreateBankHolidayDto,
  UpdateBankHolidayDto,
  UpdateWageTypeDto,
} from './dto/wage-types.dto';

@ApiTags('Billing — Wage types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/wage-types')
export class WageTypesController {
  constructor(private readonly service: WageTypesService) {}

  @Get()
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'Wage type catalogue with current support level' })
  list() {
    return this.service.list();
  }

  @Patch(':code')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Rename / describe / activate a wage type (codes are protected)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('code') code: string,
    @Body() dto: UpdateWageTypeDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, code, dto, getRequestAuditMeta(req));
  }
}

@ApiTags('Billing — Bank holidays')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('billing/bank-holidays')
export class BankHolidaysController {
  constructor(private readonly service: BankHolidaysService) {}

  @Get()
  @Permissions('billing.pay_cards.read')
  @ApiOperation({ summary: 'Bank holiday calendar (filter by nation and year)' })
  list(@Query() query: BankHolidayQueryDto) {
    return this.service.list(query);
  }

  @Post()
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Add a bank holiday date for a nation' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBankHolidayDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Post('import-gov-uk')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Add upcoming bank holidays from GOV.UK (England & Wales, Scotland, NI)' })
  importFromGovUk(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.importFromGovUk(user.id, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('billing.pay_cards.manage')
  @ApiOperation({ summary: 'Rename or switch a bank holiday on/off' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateBankHolidayDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }
}
