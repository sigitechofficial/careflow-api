import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PayrollScope, PayrollScopeGuard } from '../common/guards/payroll-scope.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  CreatePayrollScheduleDto,
  CreatePayrollTaxCodeDto,
  CreatePayrollTaxYearDto,
  DeletePayrollPeriodsDto,
  EnterSalariedHoursMethodDto,
  WithdrawSalariedHoursMethodDto,
  GeneratePayrollPeriodsDto,
  PayrollPeriodsQueryDto,
  PreviewEpsQueryDto,
  PurgePayrollDataDto,
  ApproveHmrcEpsSubmissionDto,
  ListHmrcEpsSubmissionsQueryDto,
  RejectHmrcEpsSubmissionDto,
  SubmitHmrcEpsDto,
  UpdatePayrollEmployerSettingsDto,
  UpdatePayrollScheduleDto,
  UpdatePayrollStatutoryRatesDto,
  UpdatePayrollTaxCodeDto,
  UpdatePayrollTaxYearDto,
} from './dto/payroll.dto';
import { PayrollHmrcEpsSubmissionsService } from './payroll-hmrc-eps-submissions.service';
import { PayrollSettingsService } from './payroll-settings.service';

@ApiTags('UK Payroll — Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@PayrollScope({ kind: 'organisation' })
@Controller('payroll')
export class PayrollSettingsController {
  constructor(
    private readonly service: PayrollSettingsService,
    private readonly epsSubmissions: PayrollHmrcEpsSubmissionsService,
  ) {}

  @Get('overview')
  @AnyPermission('payroll.settings.read', 'payroll.runs.read', 'payroll.employees.read')
  @ApiOperation({ summary: 'UK payroll Phase 1 overview counters' })
  overview() {
    return this.service.getOverview();
  }

  @Get('employer-settings')
  @Permissions('payroll.settings.read')
  @ApiOperation({
    summary:
      'Get org HMRC employer PAYE identity (office number, PAYE ref, Accounts Office ref). Auto-creates empty singleton.',
  })
  getEmployerSettings() {
    return this.service.getEmployerSettings();
  }

  @Patch('employer-settings')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'Update org HMRC employer PAYE identity for future FPS/EPS' })
  updateEmployerSettings(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdatePayrollEmployerSettingsDto,
    @Req() req: Request,
  ) {
    return this.service.updateEmployerSettings(user.id, dto, getRequestAuditMeta(req));
  }

  @Get('eps/preview')
  @Permissions('payroll.settings.read')
  @ApiOperation({
    summary:
      'Build EPS preview JSON for a UK tax month (Care schema; nil payment, EA, recoveries, deadline)',
  })
  buildEpsPreview(@Query() query: PreviewEpsQueryDto) {
    return this.service.buildEpsPreview(query);
  }

  @Get('eps/submissions')
  @Permissions('payroll.settings.read')
  @ApiOperation({ summary: 'List HMRC EPS submission attempts (T19)' })
  listEpsSubmissions(@Query() query: ListHmrcEpsSubmissionsQueryDto) {
    return this.epsSubmissions.list(query);
  }

  @Get('eps/submissions/:submissionId')
  @Permissions('payroll.settings.read')
  @ApiOperation({ summary: 'Get one HMRC EPS submission detail' })
  getEpsSubmission(@Param('submissionId') submissionId: string) {
    return this.epsSubmissions.getById(submissionId);
  }

  @Post('eps/submit')
  @Permissions('payroll.settings.manage')
  @ApiOperation({
    summary:
      'T19: Dry-run or submit EPS. TEST posts when HTTP enabled. LIVE SUBMIT creates dual-control pending approval.',
  })
  submitEps(
    @CurrentUser() user: RequestUser,
    @Body() dto: SubmitHmrcEpsDto,
    @Req() req: Request,
  ) {
    return this.epsSubmissions.submitEps(user.id, dto, getRequestAuditMeta(req));
  }

  @Post('eps/submissions/:submissionId/approve')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'T19: Second user approves pending LIVE EPS and posts to HMRC' })
  approveEps(
    @CurrentUser() user: RequestUser,
    @Param('submissionId') submissionId: string,
    @Body() dto: ApproveHmrcEpsSubmissionDto,
    @Req() req: Request,
  ) {
    return this.epsSubmissions.approveLive(
      user.id,
      submissionId,
      dto.confirmPhrase,
      getRequestAuditMeta(req),
      dto.clientContext ?? null,
    );
  }

  @Post('eps/submissions/:submissionId/reject')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'T19: Reject / cancel a pending LIVE EPS dual-control request' })
  rejectEps(
    @CurrentUser() user: RequestUser,
    @Param('submissionId') submissionId: string,
    @Body() dto: RejectHmrcEpsSubmissionDto,
    @Req() req: Request,
  ) {
    return this.epsSubmissions.rejectLive(
      user.id,
      submissionId,
      dto.reason,
      getRequestAuditMeta(req),
    );
  }

  @Post('purge-all')
  @Permissions('billing.financial_reset')
  @ApiOperation({
    summary:
      'Test reset (disabled in production): delete UK payroll transactional data (tax years, schedules, periods, profiles, agreements, runs). Keeps employer PAYE settings.',
  })
  purgeAll(
    @CurrentUser() user: RequestUser,
    @Body() dto: PurgePayrollDataDto,
    @Req() req: Request,
  ) {
    return this.service.purgeAllPayrollData(user.id, dto, getRequestAuditMeta(req));
  }

  @Get('tax-years')
  @Permissions('payroll.settings.read')
  @ApiOperation({ summary: 'List payroll tax years' })
  listTaxYears() {
    return this.service.listTaxYears();
  }

  @Post('tax-years/ensure-uk')
  @Permissions('payroll.settings.manage')
  @ApiOperation({
    summary:
      'Create standard UK tax years (6 Apr–5 Apr) around today if missing, and activate the current year when none is active',
  })
  ensureUkTaxYears(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.ensureUkTaxYears(user.id, getRequestAuditMeta(req));
  }

  @Post('tax-years')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'Create a payroll tax year' })
  createTaxYear(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePayrollTaxYearDto,
    @Req() req: Request,
  ) {
    return this.service.createTaxYear(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch('tax-years/:id')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'Update a payroll tax year' })
  updateTaxYear(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePayrollTaxYearDto,
    @Req() req: Request,
  ) {
    return this.service.updateTaxYear(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post('tax-years/:id/activate')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'Mark tax year as current / active' })
  activateTaxYear(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.activateTaxYear(user.id, id, getRequestAuditMeta(req));
  }

  @Get('tax-codes')
  @AnyPermission('payroll.settings.read', 'payroll.employees.read')
  @ApiOperation({ summary: 'List PAYE tax codes (catalogue for employee setup)' })
  listTaxCodes(@Query('includeInactive') includeInactive?: string) {
    return this.service.listTaxCodes({
      includeInactive: includeInactive === '1' || includeInactive === 'true',
    });
  }

  @Post('tax-codes')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'Create a PAYE tax code' })
  createTaxCode(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePayrollTaxCodeDto,
    @Req() req: Request,
  ) {
    return this.service.createTaxCode(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch('tax-codes/:id')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'Update a PAYE tax code' })
  updateTaxCode(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePayrollTaxCodeDto,
    @Req() req: Request,
  ) {
    return this.service.updateTaxCode(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete('tax-codes/:id')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'Soft-delete a PAYE tax code' })
  deleteTaxCode(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.deleteTaxCode(user.id, id, getRequestAuditMeta(req));
  }

  @Get('statutory-rates')
  @AnyPermission('payroll.settings.read', 'payroll.employees.read')
  @ApiOperation({
    summary: 'List active PAYE / NI statutory rate sets (auto-seeds current tax year if missing)',
  })
  listStatutoryRates(@Query('taxYearId') taxYearId?: string) {
    return this.service.listStatutoryRates({ taxYearId: taxYearId || undefined });
  }

  @Patch('statutory-rates/:id')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'Update PAYE / NI statutory rates for a tax year' })
  updateStatutoryRates(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePayrollStatutoryRatesDto,
    @Req() req: Request,
  ) {
    return this.service.updateStatutoryRates(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Get('schedules')
  @Permissions('payroll.settings.read')
  @ApiOperation({ summary: 'List pay schedules' })
  listSchedules() {
    return this.service.listSchedules();
  }

  @Post('schedules')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'Create a pay schedule' })
  createSchedule(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePayrollScheduleDto,
    @Req() req: Request,
  ) {
    return this.service.createSchedule(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch('schedules/:id')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'Update a pay schedule' })
  updateSchedule(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePayrollScheduleDto,
    @Req() req: Request,
  ) {
    return this.service.updateSchedule(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post('schedules/:id/generate-periods')
  @Permissions('payroll.periods.manage')
  @ApiOperation({ summary: 'Generate pay periods for a schedule + tax year' })
  generatePeriods(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: GeneratePayrollPeriodsDto,
    @Req() req: Request,
  ) {
    return this.service.generatePeriods(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Get('periods')
  @Permissions('payroll.periods.read')
  @ApiOperation({ summary: 'List pay periods' })
  listPeriods(@Query() query: PayrollPeriodsQueryDto) {
    return this.service.listPeriods(query);
  }

  @Delete('periods/:id')
  @Permissions('payroll.periods.manage')
  @ApiOperation({
    summary: 'Delete a pay period (blocked if any UK payroll run is linked)',
  })
  deletePeriod(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.deletePeriod(user.id, id, getRequestAuditMeta(req));
  }

  @Post('periods/delete')
  @Permissions('payroll.periods.manage')
  @ApiOperation({
    summary:
      'Delete all pay periods for a schedule + tax year (blocked if any period has a UK payroll run)',
  })
  deletePeriods(
    @CurrentUser() user: RequestUser,
    @Body() dto: DeletePayrollPeriodsDto,
    @Req() req: Request,
  ) {
    return this.service.deletePeriods(user.id, dto, getRequestAuditMeta(req));
  }

  @Get('salaried-hours-methods')
  @Permissions('payroll.settings.read')
  @ApiOperation({ summary: 'How contracted weekly hours become basic hours for a year (minimum wage, salaried hours work)' })
  listSalariedHoursMethods() {
    return this.service.listSalariedHoursMethods();
  }

  @Post('salaried-hours-methods')
  @Permissions('payroll.settings.manage')
  @ApiOperation({ summary: 'Enter an annualisation method; it is used once a second person approves it' })
  enterSalariedHoursMethod(@CurrentUser() user: RequestUser, @Body() dto: EnterSalariedHoursMethodDto, @Req() req: Request) {
    return this.service.enterSalariedHoursMethod(user.id, dto, getRequestAuditMeta(req));
  }

  @Post('salaried-hours-methods/:id/approve')
  @Permissions('payroll.pay_agreements.approve')
  @ApiOperation({ summary: 'Approve an annualisation method (a different user from the one who entered it)' })
  approveSalariedHoursMethod(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.approveSalariedHoursMethod(user.id, id, getRequestAuditMeta(req));
  }

  @Post('salaried-hours-methods/:id/withdraw')
  @Permissions('payroll.pay_agreements.approve')
  @ApiOperation({ summary: 'Withdraw an annualisation method' })
  withdrawSalariedHoursMethod(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: WithdrawSalariedHoursMethodDto,
    @Req() req: Request,
  ) {
    return this.service.withdrawSalariedHoursMethod(user.id, id, dto.note, getRequestAuditMeta(req));
  }
}
