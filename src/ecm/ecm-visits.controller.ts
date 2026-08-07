import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions, AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { EcmVisitsService } from './ecm-visits.service';
import { EcmEvaluationService } from './ecm-evaluation.service';
import { EcmExceptionsService } from './ecm-exceptions.service';
import { EcmLiveDashboardQueryDto } from './dto/ecm-live-dashboard.dto';
import {
  AcknowledgeEcmExceptionDto,
  CloseEcmExceptionDto,
  ResolveEcmExceptionDto,
} from './dto/ecm-exception.dto';
import {
  CreateNotificationEvidenceDto,
  ManualAttendanceDto,
  MissedTriageDto,
} from './dto/ecm-manual-ops.dto';
import { ECM_REASON_CODES } from './ecm-reason-codes';
import { EcmScheduleVersionService } from './ecm-schedule-version.service';
import { EcmManualAttendanceService } from './ecm-manual-attendance.service';
import { EcmNotificationEvidenceService } from './ecm-notification-evidence.service';
import { EcmReportsService } from './ecm-reports.service';
import { EcmGraphAnalyticsService } from './ecm-graph-analytics.service';
import { EcmHealthService } from './ecm-health.service';
import { EcmAuditService } from './ecm-audit.service';
import { EcmMissedTriageService } from './ecm-missed-triage.service';
import { EcmThresholdLookupsService } from './ecm-threshold-lookups.service';
import { UpdateEcmThresholdLookupDto } from './dto/update-ecm-threshold-lookup.dto';

@ApiTags('ECM')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ecm')
export class EcmVisitsController {
  constructor(
    private readonly visits: EcmVisitsService,
    private readonly evaluation: EcmEvaluationService,
    private readonly exceptions: EcmExceptionsService,
    private readonly scheduleVersions: EcmScheduleVersionService,
    private readonly manualAttendance: EcmManualAttendanceService,
    private readonly notifications: EcmNotificationEvidenceService,
    private readonly reports: EcmReportsService,
    private readonly graphAnalytics: EcmGraphAnalyticsService,
    private readonly health: EcmHealthService,
    private readonly audit: EcmAuditService,
    private readonly missedTriage: EcmMissedTriageService,
    private readonly thresholdLookups: EcmThresholdLookupsService,
  ) {}

  @Get('health')
  @AnyPermission('ecm.read', 'ecm.monitor')
  @ApiOperation({ summary: 'ECM monitoring health (GAP6) — quiet ≠ healthy' })
  getHealth() {
    return this.health.getHealth();
  }

  @Get('threshold-lookups')
  @AnyPermission('ecm.read', 'ecm.monitor', 'ecm.settings.manage', 'lookups.read', 'lookups.manage')
  @ApiOperation({
    summary: 'ECM categorization threshold lookups (Due now, Late, Missed, geofence, …)',
  })
  async listThresholdLookups() {
    return { data: await this.thresholdLookups.list() };
  }

  @Patch('threshold-lookups/:id')
  @AnyPermission('ecm.settings.manage', 'lookups.manage')
  @ApiOperation({ summary: 'Update an ECM threshold lookup value' })
  async updateThresholdLookup(
    @Param('id') id: string,
    @Body() dto: UpdateEcmThresholdLookupDto,
  ) {
    return { data: await this.thresholdLookups.update(id, dto.valueInt) };
  }

  @Get('reports/graph-dashboard')
  @AnyPermission('ecm.read', 'ecm.monitor', 'ecm.reports.export')
  @ApiOperation({
    summary: 'Graph-first ECM analytics aggregates (first-8 charts + drill-down visits)',
  })
  graphDashboard(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('scheduleAreaId') scheduleAreaId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.graphAnalytics.graphDashboard({
      dateFrom,
      dateTo,
      scheduleAreaId,
      locationId,
    });
  }

  @Get('reports/daily-operations')
  @AnyPermission('ecm.read', 'ecm.monitor', 'ecm.reports.export')
  @ApiOperation({ summary: 'Daily ECM operations report with KPI numerator/denominator' })
  dailyOps(
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('scheduleAreaId') scheduleAreaId?: string,
    @Query('locationId') locationId?: string,
    @Query('serviceUserId') serviceUserId?: string,
    @Query('criticality') criticality?: string,
  ) {
    const from = dateFrom ?? date;
    return this.reports.dailyOperations({
      dateFrom: from,
      dateTo: dateTo ?? from,
      scheduleAreaId,
      locationId,
      serviceUserId,
      criticality,
    });
  }

  @Get('reports/compliance')
  @AnyPermission('ecm.read', 'ecm.reports.export')
  @ApiOperation({ summary: 'ECM compliance report with confidence integrity metrics' })
  compliance(
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reports.compliance({
      dateFrom: dateFrom ?? date,
      dateTo,
    });
  }

  @Get('visits/live-dashboard')
  @AnyPermission('ecm.read', 'ecm.monitor')
  @ApiOperation({ summary: 'Live ECM monitoring dashboard' })
  liveDashboard(@Query() query: EcmLiveDashboardQueryDto) {
    return this.visits.getLiveDashboard(query);
  }

  @Get('visits/:jobId/schedule-history')
  @AnyPermission('ecm.read', 'ecm.monitor')
  @ApiOperation({ summary: 'Original vs revised schedule version history (GAP1)' })
  scheduleHistory(@Param('jobId') jobId: string) {
    return this.scheduleVersions.listForJob(jobId);
  }

  @Get('visits/:jobId/audit')
  @AnyPermission('ecm.read', 'ecm.monitor')
  @ApiOperation({ summary: 'Immutable ECM audit trail for a visit' })
  auditTrail(@Param('jobId') jobId: string) {
    return this.audit.listForJob(jobId);
  }

  @Get('visits/:jobId/notifications')
  @AnyPermission('ecm.read', 'ecm.monitor', 'ecm.exceptions.manage')
  @ApiOperation({ summary: 'SU/family notification evidence for a visit' })
  listNotifications(@Param('jobId') jobId: string) {
    return this.notifications.listForJob(jobId);
  }

  @Post('visits/:jobId/notifications')
  @Permissions('ecm.exceptions.manage')
  @ApiOperation({ summary: 'Record SU/family contact evidence (never a boolean flag)' })
  createNotification(
    @Param('jobId') jobId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateNotificationEvidenceDto,
  ) {
    return this.notifications.create({
      scheduledJobId: jobId,
      contactedByUserId: user.id,
      ...dto,
    });
  }

  @Post('visits/:jobId/manual-attendance')
  @Permissions('ecm.attendance.amend')
  @ApiOperation({ summary: 'Office manual check-in/out (append-only)' })
  recordManualAttendance(
    @Param('jobId') jobId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ManualAttendanceDto,
  ) {
    return this.manualAttendance.recordManual({
      scheduledJobId: jobId,
      employeeId: dto.employeeId,
      eventType: dto.eventType,
      occurredAt: dto.occurredAt,
      reasonCode: dto.reasonCode,
      note: dto.note,
      overrideGeofence: dto.overrideGeofence,
      approvedByUserId: user.id,
    });
  }

  @Post('visits/:jobId/amend-attendance')
  @Permissions('ecm.attendance.amend')
  @ApiOperation({ summary: 'Amend attendance with reason; original events preserved' })
  amendAttendance(
    @Param('jobId') jobId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ManualAttendanceDto,
  ) {
    return this.manualAttendance.amendAttendance({
      scheduledJobId: jobId,
      employeeId: dto.employeeId,
      eventType: dto.eventType,
      occurredAt: dto.occurredAt,
      reasonCode: dto.reasonCode,
      note: dto.note,
      overrideGeofence: dto.overrideGeofence,
      originalEventId: dto.originalEventId,
      approvedByUserId: user.id,
    });
  }

  @Patch('visits/:jobId/missed-triage')
  @Permissions('ecm.exceptions.manage')
  @ApiOperation({ summary: 'Missed-visit triage: potential → confirmed / false alert / disputed' })
  missedTriageAction(
    @Param('jobId') jobId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: MissedTriageDto,
  ) {
    return this.missedTriage.applyTriage(jobId, user.id, dto.outcome, dto.note);
  }

  @Get('visits/:jobId')
  @AnyPermission('ecm.read', 'ecm.monitor')
  @ApiOperation({ summary: 'ECM visit detail' })
  visitDetail(@Param('jobId') jobId: string) {
    return this.visits.getVisitDetail(jobId);
  }

  @Post('visits/:jobId/evaluate')
  @Permissions('ecm.monitor')
  @ApiOperation({ summary: 'Force re-evaluate ECM timing for a scheduled job' })
  async reevaluate(@Param('jobId') jobId: string) {
    const result = await this.evaluation.evaluateJob(jobId);
    return {
      data: {
        evaluationId: result.evaluation.id,
        lifecycleStatus: result.evaluation.lifecycleStatus,
        arrivalClassification: result.evaluation.arrivalClassification,
        timingSummary: result.timing.timingSummary,
        appliedSettingsLevel: result.resolved.appliedSettingsLevel,
      },
    };
  }

  @Get('exceptions')
  @AnyPermission('ecm.read', 'ecm.monitor', 'ecm.exceptions.manage')
  @ApiOperation({ summary: 'Open ECM exception queue' })
  listExceptions(
    @Query('limit') limit?: string,
    @Query('serviceUserId') serviceUserId?: string,
  ) {
    return this.exceptions.listOpen(
      limit ? Number(limit) : 50,
      serviceUserId?.trim() || undefined,
    );
  }

  @Patch('exceptions/:id/acknowledge')
  @Permissions('ecm.exceptions.manage')
  @ApiOperation({ summary: 'Acknowledge an ECM exception' })
  acknowledge(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: AcknowledgeEcmExceptionDto,
  ) {
    return this.exceptions.acknowledge(id, user.id, dto.note);
  }

  @Patch('exceptions/:id/resolve')
  @Permissions('ecm.exceptions.manage')
  @ApiOperation({ summary: 'Resolve an ECM exception with reason code' })
  resolve(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ResolveEcmExceptionDto,
  ) {
    return this.exceptions.resolve(id, user.id, dto.reasonCode, dto.note);
  }

  @Patch('exceptions/:id/close')
  @Permissions('ecm.exceptions.manage')
  @ApiOperation({ summary: 'Close a resolved ECM exception' })
  close(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CloseEcmExceptionDto,
  ) {
    return this.exceptions.close(id, user.id, dto.note);
  }

  @Get('reason-codes')
  @AnyPermission('ecm.read', 'ecm.monitor', 'ecm.exceptions.manage')
  @ApiOperation({ summary: 'Structured ECM reason-code catalog' })
  reasonCodes() {
    return { data: ECM_REASON_CODES };
  }
}
