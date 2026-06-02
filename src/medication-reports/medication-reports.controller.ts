import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import { ApiEnvelopeOkResponse } from '../common/decorators/api-envelope-ok-response.decorator';
import { MEDICATION_ADMINISTERED_REPORT_ENVELOPE_EXAMPLE } from '../common/swagger/medication-api.examples';
import { MedicationReportsService } from './medication-reports.service';
import { MedicationReportQueryDto } from './dto/medication-report-query.dto';
import {
  MedicationLateReportListResponseDto,
  MedicationReportListResponseDto,
  MedicationStockReportListResponseDto,
} from './dto/medication-report-response.dto';
import { MedicationAuditReportResponseDto } from './dto/medication-audit-report-response.dto';

@ApiTags('Medication Reports')
@ApiBearerAuth()
@ApiExtraModels(MedicationReportListResponseDto)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('medication-reports')
export class MedicationReportsController {
  constructor(private readonly service: MedicationReportsService) {}

  @Get('administered')
  @AnyPermission('service_users.medications.reports.read', 'service_users.read')
  @ApiOperation({ summary: 'Administered medications report' })
  @ApiEnvelopeOkResponse({
    description: 'Given administrations in date range with service user and medication context',
    example: MEDICATION_ADMINISTERED_REPORT_ENVELOPE_EXAMPLE,
  })
  @ApiMedicationStandardResponses()
  administered(@CurrentUser() user: RequestUser, @Query() q: MedicationReportQueryDto, @Req() req: Request) {
    return this.service.administered(user.id, q, getRequestAuditMeta(req));
  }

  @Get('stock-levels')
  @AnyPermission('service_users.medications.reports.read', 'service_users.read')
  @ApiOperation({ summary: 'Stock movement placeholder report' })
  @ApiOkResponse({ type: MedicationStockReportListResponseDto })
  @ApiMedicationStandardResponses()
  stock(@CurrentUser() user: RequestUser, @Query() q: MedicationReportQueryDto, @Req() req: Request) {
    return this.service.stockLevels(user.id, q, getRequestAuditMeta(req));
  }

  @Get('late-administrations')
  @AnyPermission('service_users.medications.reports.read', 'service_users.read')
  @ApiOperation({ summary: 'Late administrations (actual vs scheduled)' })
  @ApiOkResponse({ type: MedicationLateReportListResponseDto })
  @ApiMedicationStandardResponses()
  late(@CurrentUser() user: RequestUser, @Query() q: MedicationReportQueryDto, @Req() req: Request) {
    return this.service.lateAdministrations(user.id, q, getRequestAuditMeta(req));
  }

  @Get('audit')
  @AnyPermission('service_users.medications.reports.read', 'audit_logs.read', 'service_users.read')
  @ApiOperation({ summary: 'Medication audit trail summary' })
  @ApiOkResponse({ type: MedicationAuditReportResponseDto })
  @ApiMedicationStandardResponses()
  auditReport(@CurrentUser() user: RequestUser, @Query() q: MedicationReportQueryDto, @Req() req: Request) {
    return this.service.auditReport(user.id, q, getRequestAuditMeta(req));
  }
}
