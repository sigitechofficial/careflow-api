import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PayrollScope, PayrollScopeGuard } from '../common/guards/payroll-scope.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  CancelUkPayrollRunDto,
  ReviewNmwAssessmentDto,
  CreateUkPayrollRunDto,
  EnrolUkPayrollRunDto,
  ApproveHmrcFpsSubmissionDto,
  RejectHmrcFpsSubmissionDto,
  SubmitHmrcFpsDto,
} from './dto/payroll.dto';
import { PayrollHmrcSubmissionsService } from './payroll-hmrc-submissions.service';
import type { NmwReviewOutcome } from '../billing/nmw-period.util';
import { PayrollRunsService } from './payroll-runs.service';

@ApiTags('UK Payroll — Runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, PayrollScopeGuard)
@PayrollScope({ kind: 'organisation' })
@Controller('payroll/runs')
export class PayrollRunsController {
  constructor(
    private readonly service: PayrollRunsService,
    private readonly hmrcSubmissions: PayrollHmrcSubmissionsService,
  ) {}

  @Get()
  @Permissions('payroll.runs.read')
  @ApiOperation({ summary: 'List UK payroll runs (shell)' })
  list(@Query('locationId') locationId?: string) {
    return this.service.list(locationId);
  }

  @Delete()
  @Permissions('billing.financial_reset')
  @ApiOperation({
    summary:
      'Test reset (disabled in production): delete all UK payroll runs, linked payout batches and year-to-date ledgers. Does not delete tax years, schedules, or employee payroll profiles.',
  })
  deleteAll(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.deleteAll(user.id, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('payroll.runs.read')
  @ApiOperation({ summary: 'Get UK payroll run detail' })
  getById(
    @Param('id') id: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.service.getById(id, locationId);
  }

  @Get(':id/fps')
  @Permissions('payroll.runs.read')
  @ApiOperation({
    summary:
      'Build FPS preview JSON from a CLOSED UK payroll run (Care schema; not HMRC GovTalk submit)',
  })
  buildFpsPreview(@Param('id') id: string) {
    return this.service.buildFpsPreview(id);
  }

  @Get(':id/fps/export')
  @Permissions('payroll.runs.read')
  @ApiOperation({
    summary: 'Download FPS preview as Excel (.xlsx) — companion to GovTalk XML',
  })
  async exportFpsExcel(
    @Param('id') id: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    const { buffer, filename } = await this.service.exportFpsExcel(id);
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  }

  @Get(':id/employees/:runEmployeeId/payslip')
  @Permissions('payroll.runs.read')
  @ApiOperation({
    summary:
      'Download ERA 1996 itemised pay statement PDF for one CLOSED-run employee (Care payslip v1)',
  })
  async exportEmployeePayslip(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('runEmployeeId') runEmployeeId: string,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ) {
    const { buffer, filename } = await this.service.exportEmployeePayslip(
      id,
      runEmployeeId,
      user.id,
      getRequestAuditMeta(req),
    );
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  }

  @Get(':id/hmrc-submissions')
  @Permissions('payroll.runs.read')
  @ApiOperation({ summary: 'List HMRC RTI submission attempts for a UK payroll run (T16)' })
  listHmrcSubmissions(@Param('id') id: string) {
    return this.hmrcSubmissions.listForRun(id);
  }

  @Get(':id/hmrc-submissions/:submissionId')
  @Permissions('payroll.runs.read')
  @ApiOperation({ summary: 'Get one HMRC RTI submission (includes redacted request XML)' })
  getHmrcSubmission(@Param('id') id: string, @Param('submissionId') submissionId: string) {
    return this.hmrcSubmissions.getSubmission(id, submissionId);
  }

  @Post()
  @Permissions('payroll.runs.manage')
  @ApiOperation({ summary: 'Create UK payroll run shell for a period' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateUkPayrollRunDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/fps/submit')
  @Permissions('payroll.runs.manage')
  @ApiOperation({
    summary:
      'T16–T18: Dry-run or submit FPS. TEST posts when HTTP enabled. LIVE SUBMIT creates dual-control pending approval.',
  })
  submitFps(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SubmitHmrcFpsDto,
    @Req() req: Request,
  ) {
    return this.hmrcSubmissions.submitFps(
      user.id,
      id,
      dto.mode,
      getRequestAuditMeta(req),
      dto.clientContext ?? null,
      dto.environment === 'LIVE' ? 'LIVE' : 'TEST',
    );
  }

  @Post(':id/hmrc-submissions/:submissionId/approve')
  @Permissions('payroll.runs.manage')
  @ApiOperation({
    summary: 'T18: Second user approves pending LIVE FPS and posts to HMRC live gateway',
  })
  approveLiveFps(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: ApproveHmrcFpsSubmissionDto,
    @Req() req: Request,
  ) {
    return this.hmrcSubmissions.approveLiveSubmission(
      user.id,
      id,
      submissionId,
      dto.confirmPhrase,
      getRequestAuditMeta(req),
      dto.clientContext ?? null,
    );
  }

  @Post(':id/hmrc-submissions/:submissionId/reject')
  @Permissions('payroll.runs.manage')
  @ApiOperation({ summary: 'T18: Reject / cancel a pending LIVE FPS dual-control request' })
  rejectLiveFps(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: RejectHmrcFpsSubmissionDto,
    @Req() req: Request,
  ) {
    return this.hmrcSubmissions.rejectLiveSubmission(
      user.id,
      id,
      submissionId,
      dto.reason,
      getRequestAuditMeta(req),
    );
  }

  @Post(':id/enrol')
  @Permissions('payroll.runs.manage')
  @ApiOperation({ summary: 'Enrol employees onto a UK payroll run' })
  enrol(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: EnrolUkPayrollRunDto,
    @Req() req: Request,
  ) {
    return this.service.enrol(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/calculate-gross')
  @Permissions('payroll.runs.manage')
  @ApiOperation({
    summary:
      'Phase 2: import visit-pay / salary inputs and calculate employee gross totals (no PAYE/NI)',
  })
  calculateGross(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.calculateGross(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/calculate-statutory')
  @Permissions('payroll.runs.manage')
  @ApiOperation({
    summary:
      'Phase 3: Week 1/Month 1 PAYE + Class 1 NI on gross (GOV.UK England/NI/Wales rates)',
  })
  calculateStatutory(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.calculateStatutory(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/nmw-assessments/:assessmentId/review')
  @Permissions('payroll.runs.close')
  @ApiOperation({
    summary: 'Record the review of a minimum wage exception that stops the run closing (not the user who created the run)',
  })
  reviewNmwAssessment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('assessmentId') assessmentId: string,
    @Body() dto: ReviewNmwAssessmentDto,
    @Req() req: Request,
  ) {
    return this.service.reviewNmwAssessment(
      user.id,
      id,
      assessmentId,
      dto.note,
      (dto.outcome as NmwReviewOutcome | undefined) ?? 'EVIDENCE_SUPPORTS_COMPLIANCE',
      getRequestAuditMeta(req),
    );
  }

  @Post(':id/close')
  @Permissions('payroll.runs.close')
  @ApiOperation({
    summary: 'Close UK payroll run (a different user from the one who created the run)',
  })
  close(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.close(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/cancel')
  @Permissions('payroll.runs.manage')
  @ApiOperation({
    summary:
      'Cancel a UK payroll run that has not been closed. Its inputs stay as a snapshot and its earnings become collectable by a replacement run',
  })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CancelUkPayrollRunDto,
    @Req() req: Request,
  ) {
    return this.service.cancel(user.id, id, getRequestAuditMeta(req), dto?.reason);
  }

  @Post(':id/reactivate')
  @Permissions('payroll.runs.manage')
  @ApiOperation({
    summary:
      'Reactivate a cancelled UK payroll run, or reopen a closed one (reopening needs payroll.runs.reopen)',
  })
  reactivate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.reactivate(user.id, id, getRequestAuditMeta(req), {
      mayReopenClosed: (user.permissions ?? []).includes('payroll.runs.reopen'),
    });
  }
}
