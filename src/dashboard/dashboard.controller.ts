import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { DashboardService } from './dashboard.service';
import { HandoverReportQueryDto } from './dto/handover-report-query.dto';
import { HomeSignalsService } from './home-signals.service';
import { MedicationOverviewService } from './medication-overview.service';
import { OperationsOverviewService } from './operations-overview.service';
import { FinanceOverviewService } from './finance-overview.service';
import { AdminOverviewService } from './admin-overview.service';
import {
  MedicationExceptionsQueryDto,
  MedicationOverviewQueryDto,
  OperationsOverviewQueryDto,
  StaffOffQueryDto,
  UpcomingWindowQueryDto,
} from './dto/home-signals-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly service: DashboardService,
    private readonly signals: HomeSignalsService,
    private readonly medication: MedicationOverviewService,
    private readonly operations: OperationsOverviewService,
    private readonly finance: FinanceOverviewService,
    private readonly admin: AdminOverviewService,
  ) {}

  @Get('handover-report')
  @AnyPermission('schedule.read', 'scheduled_visits.read', 'service_users.read')
  @ApiOperation({
    summary: 'Handover report for the home dashboard',
    description:
      'Returns recent visit handover / visit notes. Default window uses Organisation General Settings → Handover report last (hours).',
  })
  handoverReport(@Query() query: HandoverReportQueryDto) {
    return this.service.handoverReport(query);
  }

  @Get('medication-exceptions')
  @AnyPermission('service_users.medications.reports.read', 'service_users.read')
  @ApiOperation({
    summary: 'Missed, refused, not given and held doses for the home dashboard',
    description: 'Counts by status plus the latest 20 doses, for a day range (defaults to today, org timezone). Scoped to the caller’s branches.',
  })
  medicationExceptions(@CurrentUser() user: RequestUser, @Query() query: MedicationExceptionsQueryDto) {
    return this.signals.medicationExceptions(user, query);
  }

  @Get('admin-overview')
  @AnyPermission('audit_logs.read', 'users.read')
  @ApiOperation({
    summary: 'Administration module dashboard',
    description:
      'Active users in the last 7 days, dormant accounts (no sign-in for 90 days), failed sign-ins (24h / 7 days) and security events by type (7 days). Organisation-wide.',
  })
  adminOverview() {
    return this.admin.overview();
  }

  @Get('finance-overview')
  @AnyPermission('billing.invoice_runs.read', 'billing.payments.read')
  @ApiOperation({
    summary: 'Finance module dashboard',
    description:
      'Income invoiced this month and last month (by invoice period), cash received this month, disputed invoices and invoice runs awaiting review. Organisation-wide.',
  })
  financeOverview() {
    return this.finance.overview();
  }

  @Get('operations-overview')
  @AnyPermission('ecm.read', 'ecm.monitor', 'schedule.read', 'schedules.read', 'scheduled_visits.read', 'scheduled_jobs.read')
  @ApiOperation({
    summary: 'Care Operations module dashboard',
    description:
      'Open ECM alert backlog, unfilled visits (today, 7 and 28 days), planned hours, cancellations in the last 7 days and continuity of care over 28 days. Counted in the database and scoped to the caller’s branches.',
  })
  operationsOverview(@CurrentUser() user: RequestUser, @Query() query: OperationsOverviewQueryDto) {
    return this.operations.overview(user, query);
  }

  @Get('medication-overview')
  @AnyPermission('service_users.medications.reports.read', 'service_users.read')
  @ApiOperation({
    summary: 'Medication (eMAR) module dashboard',
    description:
      'Dose outcomes and on-time % over the last N days, medicines on record, support levels, medication reviews, packs/deliveries and stock movements. Scoped to the caller’s branches.',
  })
  medicationOverview(@CurrentUser() user: RequestUser, @Query() query: MedicationOverviewQueryDto) {
    return this.medication.overview(user, query);
  }

  @Get('service-user-upcoming')
  @AnyPermission('service_users.read')
  @ApiOperation({
    summary: 'Service-user expiries and reviews due',
    description: 'DoLS renewals, legal authorities, documents, funding end dates, purchase orders, funding reviews and visit plan reviews due within `days` (overdue always included).',
  })
  serviceUserUpcoming(@CurrentUser() user: RequestUser, @Query() query: UpcomingWindowQueryDto) {
    return this.signals.serviceUserUpcoming(user, query);
  }

  @Get('staff-off')
  @AnyPermission('employees.read', 'employees.reports.read')
  @ApiOperation({
    summary: 'Staff absent or on holiday on a given day',
    description: 'Absence records and booked holidays overlapping the day (defaults to today, org timezone). One row per employee.',
  })
  staffOff(@CurrentUser() user: RequestUser, @Query() query: StaffOffQueryDto) {
    return this.signals.staffOff(user, query);
  }

  @Get('policy-reviews')
  @AnyPermission('policies.read')
  @ApiOperation({
    summary: 'Published policies due for review',
    description: 'Current published policy versions whose review date falls within `days` (overdue always included).',
  })
  policyReviews(@Query() query: UpcomingWindowQueryDto) {
    return this.signals.policyReviews(query);
  }
}
