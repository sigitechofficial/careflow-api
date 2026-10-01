import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  AnyPermission,
  Permissions,
} from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PlatformCostsService } from './platform-costs.service';
import { PlatformCostsSyncService } from './platform-costs-sync.service';
import { PlatformCostsReportService } from './platform-costs-report.service';
import {
  AnomaliesQueryDto,
  CostBreakdownQueryDto,
  CostExportQueryDto,
  EstimateRequestDto,
  PricesQueryDto,
  SyncRunsQueryDto,
  UnitEconomicsQueryDto,
  UpdatePlatformCostSettingsDto,
} from './dto/platform-costs.dto';
import {
  PLATFORM_COSTS_MANAGE,
  PLATFORM_COSTS_READ,
} from './platform-costs.constants';

/** Azure Pricing — read endpoints serve stored data only; Azure is never called per page view. */
@ApiTags('Azure Pricing (platform costs)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('platform-costs')
export class PlatformCostsController {
  constructor(
    private readonly service: PlatformCostsService,
    private readonly sync: PlatformCostsSyncService,
    private readonly reports: PlatformCostsReportService,
  ) {}

  @Get('overview')
  @AnyPermission(PLATFORM_COSTS_READ, PLATFORM_COSTS_MANAGE)
  @ApiOperation({
    summary: 'Month-to-date, forecast, budget, trend, top services/resources',
  })
  overview() {
    return this.service.overview();
  }

  @Get('breakdown')
  @AnyPermission(PLATFORM_COSTS_READ, PLATFORM_COSTS_MANAGE)
  @ApiOperation({
    summary:
      'Cost breakdown for a date range grouped by service/resource/resourceGroup/meter',
  })
  breakdown(@Query() q: CostBreakdownQueryDto) {
    return this.service.breakdown(q);
  }

  @Get('prices')
  @AnyPermission(PLATFORM_COSTS_READ, PLATFORM_COSTS_MANAGE)
  @ApiOperation({
    summary: 'Stored Azure retail list prices for the services in use',
  })
  prices(@Query() q: PricesQueryDto) {
    return this.service.prices(q);
  }

  @Get('estimate/baseline')
  @AnyPermission(PLATFORM_COSTS_READ, PLATFORM_COSTS_MANAGE)
  @ApiOperation({
    summary:
      'Monthly estimate of the current architecture from live list prices',
  })
  baseline() {
    return this.service.baselineEstimate();
  }

  @Post('estimate')
  @HttpCode(200)
  @AnyPermission(PLATFORM_COSTS_READ, PLATFORM_COSTS_MANAGE)
  @ApiOperation({ summary: 'What-if estimate vs the baseline' })
  estimate(@Body() dto: EstimateRequestDto) {
    return this.service.scenarioEstimate(dto);
  }

  @Get('recommendations')
  @AnyPermission(PLATFORM_COSTS_READ, PLATFORM_COSTS_MANAGE)
  @ApiOperation({ summary: 'Azure Advisor cost recommendations' })
  recommendations() {
    return this.service.recommendations();
  }

  @Get('unit-economics')
  @AnyPermission(PLATFORM_COSTS_READ, PLATFORM_COSTS_MANAGE)
  @ApiOperation({
    summary:
      'Cost per service user / carer / completed visit (6-month history)',
  })
  unitEconomics(@Query() q: UnitEconomicsQueryDto) {
    return this.service.unitEconomics(q.month);
  }

  @Get('anomalies')
  @AnyPermission(PLATFORM_COSTS_READ, PLATFORM_COSTS_MANAGE)
  @ApiOperation({ summary: 'Daily cost anomalies' })
  anomalies(@Query() q: AnomaliesQueryDto) {
    return this.service.anomalies(q);
  }

  @Post('anomalies/:id/acknowledge')
  @HttpCode(200)
  @Permissions(PLATFORM_COSTS_MANAGE)
  @ApiOperation({ summary: 'Acknowledge an anomaly' })
  acknowledge(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.service.acknowledgeAnomaly(
      id,
      user.id,
      getRequestAuditMeta(req),
    );
  }

  @Get('settings')
  @AnyPermission(PLATFORM_COSTS_READ, PLATFORM_COSTS_MANAGE)
  @ApiOperation({ summary: 'Anomaly rule + monthly report settings' })
  getSettings() {
    return this.service.getSettings();
  }

  @Patch('settings')
  @Permissions(PLATFORM_COSTS_MANAGE)
  @ApiOperation({ summary: 'Update anomaly rule + monthly report settings' })
  updateSettings(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdatePlatformCostSettingsDto,
    @Req() req: Request,
  ) {
    return this.service.updateSettings(dto, user.id, getRequestAuditMeta(req));
  }

  @Post('sync')
  @HttpCode(202)
  @Permissions(PLATFORM_COSTS_MANAGE)
  @ApiOperation({
    summary: 'Trigger a manual Azure sync (max 1 per 5 minutes; 429 otherwise)',
  })
  async triggerSync(@CurrentUser() user: RequestUser, @Req() req: Request) {
    const result = await this.sync.triggerManualSync(user.id);
    await this.service.auditManualSync(
      user.id,
      result.runId,
      getRequestAuditMeta(req),
    );
    return result;
  }

  @Get('sync-runs')
  @AnyPermission(PLATFORM_COSTS_READ, PLATFORM_COSTS_MANAGE)
  @ApiOperation({ summary: 'Recent sync runs' })
  syncRuns(@Query() q: SyncRunsQueryDto) {
    return this.service.syncRuns(q.limit ?? 20);
  }

  @Get('export')
  @Permissions(PLATFORM_COSTS_MANAGE)
  @ApiOperation({ summary: 'Download the cost breakdown as CSV' })
  @ApiProduces('text/csv')
  async export(
    @CurrentUser() user: RequestUser,
    @Query() q: CostExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { csv, filename } = await this.service.exportCsv(
      q,
      user.id,
      getRequestAuditMeta(req),
    );
    res
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  }

  @Post('reports/monthly/preview')
  @HttpCode(200)
  @Permissions(PLATFORM_COSTS_MANAGE)
  @ApiOperation({ summary: "Preview last month's report e-mail" })
  previewReport(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.reports.preview(user.id, getRequestAuditMeta(req));
  }

  @Post('reports/monthly/send-test')
  @HttpCode(200)
  @Permissions(PLATFORM_COSTS_MANAGE)
  @ApiOperation({
    summary: "Send last month's report to the requesting user only",
  })
  sendTestReport(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.reports.sendTest(user.id, getRequestAuditMeta(req));
  }
}
