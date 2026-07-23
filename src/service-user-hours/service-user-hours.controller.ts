import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { ServiceUserHoursService } from './service-user-hours.service';
import { ServiceUserHoursMonthlyDetailQueryDto } from './dto/service-user-hours-monthly-detail.dto';
import { ServiceUserHoursWeeklyQueryDto } from './dto/service-user-hours-weekly-query.dto';

@ApiTags('Service User Hours')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-user-hours')
export class ServiceUserHoursController {
  constructor(private readonly service: ServiceUserHoursService) {}

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
}
