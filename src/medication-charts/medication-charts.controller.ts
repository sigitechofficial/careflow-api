import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiEnvelopeOkResponse } from '../common/decorators/api-envelope-ok-response.decorator';
import { MEDICATION_REGULAR_CHART_ENVELOPE_EXAMPLE } from '../common/swagger/medication-api.examples';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import { MedicationChartsService } from './medication-charts.service';
import {
  MedicationPrnChartQueryDto,
  MedicationRegularChartExportQueryDto,
  MedicationRegularChartQueryDto,
} from './dto/medication-chart-query.dto';
import { MedicationRegularChartResponseDto } from './dto/medication-regular-chart-response.dto';
import { MedicationPrnChartResponseDto } from './dto/medication-prn-chart-response.dto';
import { ApiMarExportResponses } from './decorators/api-mar-export-responses.decorator';

@ApiTags('Medication Charts')
@ApiBearerAuth()
@ApiExtraModels(MedicationRegularChartResponseDto)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-chart')
export class MedicationChartsController {
  constructor(private readonly service: MedicationChartsService) {}

  @Get('regular')
  @AnyPermission('service_users.medications.chart.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({
    summary: 'Regular medication MAR chart (grid)',
    description:
      'Returns the month (or custom date range up to 93 days) administration grid, status legend, today KPIs (`summary`), and MAR completion aggregates (`monthStats`) through min(today, periodEnd). Query: `month=YYYY-MM` **or** `dateFrom` + `dateTo`. Optional `medicationIds` (comma-separated UUIDs).',
  })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiEnvelopeOkResponse({
    description: 'MAR calendar grid with legend, today summary, and MAR completion monthStats',
    example: MEDICATION_REGULAR_CHART_ENVELOPE_EXAMPLE,
    innerType: MedicationRegularChartResponseDto,
  })
  @ApiMedicationStandardResponses()
  regular(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Query() q: MedicationRegularChartQueryDto,
    @Req() req: Request,
  ) {
    return this.service.regularChart(user.id, serviceUserId, q, getRequestAuditMeta(req));
  }

  @Get('prn')
  @AnyPermission('service_users.medications.prn.read', 'service_users.medications.chart.read', 'service_users.read')
  @ApiOperation({
    summary: 'PRN medication administration chart',
    description: 'PRN administrations in a date range, grouped by medication name.',
  })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiOkResponse({ type: MedicationPrnChartResponseDto })
  @ApiMedicationStandardResponses()
  prn(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Query() q: MedicationPrnChartQueryDto,
    @Req() req: Request,
  ) {
    return this.service.prnChart(user.id, serviceUserId, q.dateFrom, q.dateTo, getRequestAuditMeta(req));
  }

  @Get('regular/export')
  @AnyPermission('service_users.medications.chart.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({
    summary: 'Export MAR chart (HTML, PDF, Excel, CSV)',
    description:
      'HTML/PDF/CSV: single month or custom range (same query as GET regular). Excel: optional `months=2026-03,2026-04` (max 6, one sheet per month). `format`: html (default) | pdf | csv | xlsx | xls. `packExportDetail`: summary (compartment round row only) | full (default, includes individual medicines). `preview=true` skips export audit log (in-app preview only). Export header includes MAR completion to-date fields from `monthStats`.',
  })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiMarExportResponses()
  async exportRegular(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Query() q: MedicationRegularChartExportQueryDto,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ) {
    const meta = getRequestAuditMeta(req);
    const fileSuffix = this.service.exportFilenameSuffix(q);
    if (q.format === 'pdf') {
      const pdf = await this.service.exportRegularMarPdf(user.id, serviceUserId, q, meta);
      res
        .type('application/pdf')
        .setHeader('Content-Disposition', `attachment; filename="mar-${serviceUserId}-${fileSuffix}.pdf"`)
        .send(pdf);
      return;
    }
    if (q.format === 'csv') {
      const csv = await this.service.exportRegularMarCsv(user.id, serviceUserId, q, meta);
      res
        .type('text/csv; charset=utf-8')
        .setHeader('Content-Disposition', `attachment; filename="mar-${serviceUserId}-${fileSuffix}.csv"`)
        .send(csv);
      return;
    }
    if (q.format === 'xls' || q.format === 'xlsx') {
      const xlsx = await this.service.exportRegularMarExcel(user.id, serviceUserId, q, meta);
      res
        .type(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        .setHeader(
          'Content-Disposition',
          `attachment; filename="mar-${serviceUserId}-${fileSuffix}.xlsx"`,
        )
        .send(xlsx);
      return;
    }
    const html = await this.service.exportRegularMarHtml(user.id, serviceUserId, q, meta);
    res.type('text/html; charset=utf-8').send(html);
  }
}
