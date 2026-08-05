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
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  CreatePayrollScheduleDto,
  CreatePayrollTaxYearDto,
  DeletePayrollPeriodsDto,
  GeneratePayrollPeriodsDto,
  PayrollPeriodsQueryDto,
  PurgePayrollDataDto,
  UpdatePayrollScheduleDto,
  UpdatePayrollTaxYearDto,
} from './dto/payroll.dto';
import { PayrollSettingsService } from './payroll-settings.service';

@ApiTags('UK Payroll — Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('payroll')
export class PayrollSettingsController {
  constructor(private readonly service: PayrollSettingsService) {}

  @Get('overview')
  @AnyPermission('payroll.settings.read', 'payroll.runs.read', 'payroll.employees.read')
  @ApiOperation({ summary: 'UK payroll Phase 1 overview counters' })
  overview() {
    return this.service.getOverview();
  }

  @Post('purge-all')
  @Permissions('payroll.settings.manage')
  @ApiOperation({
    summary:
      'Delete all UK payroll foundation data (tax years, schedules, periods, profiles, agreements, runs). Does not touch billing or employees.',
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
}
