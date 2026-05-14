import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { MedicationChartsService } from './medication-charts.service';
import { MedicationPrnChartQueryDto, MedicationRegularChartQueryDto } from './dto/medication-chart-query.dto';

@ApiTags('Medication Charts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-chart')
export class MedicationChartsController {
  constructor(private readonly service: MedicationChartsService) {}

  @Get('regular')
  @AnyPermission('service_users.medications.chart.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'Regular medication chart for a calendar month' })
  regular(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Query() q: MedicationRegularChartQueryDto,
    @Req() req: Request,
  ) {
    return this.service.regularChart(user.id, serviceUserId, q.month, getRequestAuditMeta(req));
  }

  @Get('prn')
  @AnyPermission('service_users.medications.prn.read', 'service_users.medications.chart.read', 'service_users.read')
  @ApiOperation({ summary: 'PRN medication administration chart' })
  prn(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Query() q: MedicationPrnChartQueryDto,
    @Req() req: Request,
  ) {
    return this.service.prnChart(user.id, serviceUserId, q.dateFrom, q.dateTo, getRequestAuditMeta(req));
  }
}
