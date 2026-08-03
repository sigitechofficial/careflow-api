import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreateUkPayrollRunDto, EnrolUkPayrollRunDto } from './dto/payroll.dto';
import { PayrollRunsService } from './payroll-runs.service';

@ApiTags('UK Payroll — Runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('payroll/runs')
export class PayrollRunsController {
  constructor(private readonly service: PayrollRunsService) {}

  @Get()
  @Permissions('payroll.runs.read')
  @ApiOperation({ summary: 'List UK payroll runs (shell)' })
  list() {
    return this.service.list();
  }

  @Delete()
  @Permissions('payroll.runs.manage')
  @ApiOperation({
    summary:
      'Delete all UK payroll runs (test/ops). Also removes linked employee payout batches. Does not delete tax years, schedules, or employee payroll profiles.',
  })
  deleteAll(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.deleteAll(user.id, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('payroll.runs.read')
  @ApiOperation({ summary: 'Get UK payroll run detail' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
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

  @Post(':id/close')
  @Permissions('payroll.runs.manage')
  @ApiOperation({ summary: 'Close UK payroll run' })
  close(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.close(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/cancel')
  @Permissions('payroll.runs.manage')
  @ApiOperation({ summary: 'Cancel UK payroll run shell' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.cancel(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/reactivate')
  @Permissions('payroll.runs.manage')
  @ApiOperation({ summary: 'Reactivate a closed or cancelled UK payroll run' })
  reactivate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.reactivate(user.id, id, getRequestAuditMeta(req));
  }
}
