import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { ServiceUserHoursService } from './service-user-hours.service';
import { ServiceUserHoursMonthlyDetailQueryDto } from './dto/service-user-hours-monthly-detail.dto';
import { ServiceUserHoursWeeklyQueryDto } from './dto/service-user-hours-weekly-query.dto';
import {
  ServiceUserTimebankDetailQueryDto,
  ServiceUserTimebankQueryDto,
} from './dto/service-user-timebank-query.dto';
import { ServiceUserTimebankService } from './service-user-timebank.service';
import { ServiceUserTimebankLedgerService } from './service-user-timebank-ledger.service';

@ApiTags('Service User Hours')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-user-hours')
export class ServiceUserHoursController {
  constructor(
    private readonly service: ServiceUserHoursService,
    private readonly timebankService: ServiceUserTimebankService,
    private readonly timebankLedger: ServiceUserTimebankLedgerService,
  ) {}

  @Get('weekly-summary')
  @AnyPermission('service_users.read')
  @ApiOperation({
    summary:
      'Weekly service user hours overview — package (contracted), assigned (scheduled), worked (billable), and over-package flags',
  })
  weeklySummary(@Query() query: ServiceUserHoursWeeklyQueryDto) {
    return this.service.weeklySummary(query);
  }

  @Get('monthly-detail')
  @AnyPermission('service_users.read')
  @ApiOperation({
    summary:
      'Monthly service user hours detail — package, assigned, and worked hours by calendar week blocks (1–7, 8–14, 15–21, 22–28, 29–end)',
  })
  monthlyDetail(@Query() query: ServiceUserHoursMonthlyDetailQueryDto) {
    return this.service.monthlyDetail(query);
  }

  @Get('timebank')
  @AnyPermission('service_users.read')
  @ApiOperation({
    summary:
      'Timebank — service users whose week got fewer hours than their weekly hours (current week: delivered, waiting for approval and still to come)',
  })
  timebank(@Query() query: ServiceUserTimebankQueryDto) {
    return this.timebankService.list(query);
  }

  @Get('timebank/jobs/:scheduledJobId')
  @AnyPermission('scheduled_jobs.read', 'service_users.read')
  @ApiOperation({ summary: 'Timebank hours taken for one rota visit and given back (visit workspace)' })
  timebankForJob(@Param('scheduledJobId', ParseUUIDPipe) scheduledJobId: string) {
    return this.timebankLedger.forJob(scheduledJobId).then((data) => ({ data }));
  }

  @Get('timebank/:serviceUserId/balance')
  @AnyPermission('service_users.read')
  @ApiOperation({ summary: 'Timebank balance for one service user: earned, held by visits, available' })
  async timebankBalance(@Param('serviceUserId', ParseUUIDPipe) serviceUserId: string) {
    const [balance, rules] = await Promise.all([
      this.timebankLedger.balance(serviceUserId),
      this.timebankLedger.rules(),
    ]);
    return {
      data: {
        earnedMinutes: balance.earnedMinutes,
        reservedMinutes: balance.reservedMinutes,
        availableMinutes: balance.availableMinutes,
        useTimebank: rules.useTimebank,
      },
    };
  }

  @Get('timebank/:serviceUserId')
  @AnyPermission('service_users.read')
  @ApiOperation({
    summary: 'Timebank for one service user — totals since the start date, the chosen week and every week',
  })
  async timebankDetail(
    @Param('serviceUserId', ParseUUIDPipe) serviceUserId: string,
    @Query() query: ServiceUserTimebankDetailQueryDto,
  ) {
    // The ledger settles first, so the bank and the visits' entries are current.
    const [balance, rules] = await Promise.all([
      this.timebankLedger.balance(serviceUserId),
      this.timebankLedger.rules(),
    ]);
    const [detail, entries] = await Promise.all([
      this.timebankService.detail(serviceUserId, query),
      this.timebankLedger.entries(serviceUserId),
    ]);
    return {
      ...detail,
      timebank: {
        useTimebank: rules.useTimebank,
        earnedMinutes: balance.earnedMinutes,
        reservedMinutes: balance.reservedMinutes,
        availableMinutes: balance.availableMinutes,
        entries,
      },
    };
  }
}
