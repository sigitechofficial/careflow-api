import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeeHoursService } from './employee-hours.service';
import { EmployeeHoursWeeklyQueryDto } from './dto/employee-hours-weekly-query.dto';
import {
  EmployeeHoursMonthlyQueryDto,
  UpsertEmployeeHoursMonthlyReviewDto,
} from './dto/employee-hours-monthly.dto';
import { EmployeeHoursMonthlyDetailQueryDto } from './dto/employee-hours-monthly-detail.dto';
import {
  CarerTimebankDetailQueryDto,
  CarerTimebankQueryDto,
} from './dto/carer-timebank-query.dto';
import { CarerTimebankService } from './carer-timebank.service';

@ApiTags('Employee Hours')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employee-hours')
export class EmployeeHoursController {
  constructor(
    private readonly service: EmployeeHoursService,
    private readonly timebankService: CarerTimebankService,
  ) {}

  @Get('weekly-summary')
  @AnyPermission('employees.read', 'employees.reports.read')
  @ApiOperation({
    summary:
      'Weekly employee hours overview — assigned, contracted weekly, worked, and hours over 40',
  })
  weeklySummary(@Query() query: EmployeeHoursWeeklyQueryDto) {
    return this.service.weeklySummary(query);
  }

  @Get('monthly-summary')
  @AnyPermission('employees.read', 'employees.reports.read')
  @ApiOperation({
    summary:
      'Monthly sponsor-compliance hours report — CoS weekly hours, week 1–5 worked hours, SMS reporting, review status',
  })
  monthlySummary(@Query() query: EmployeeHoursMonthlyQueryDto) {
    return this.service.monthlySummary(query);
  }

  @Get('monthly-detail')
  @AnyPermission('employees.read', 'employees.reports.read')
  @ApiOperation({
    summary:
      'Per-employee monthly hours detail — calendar week blocks with contracted, assigned, and worked hours',
  })
  monthlyDetail(@Query() query: EmployeeHoursMonthlyDetailQueryDto) {
    return this.service.monthlyDetail(query);
  }

  @Get('timebank')
  @AnyPermission('employees.read', 'employees.reports.read')
  @ApiOperation({
    summary:
      'Carer timebank — contracted weekly hours (less days off) against visits given and time worked, per carer for a week',
  })
  timebank(@Query() query: CarerTimebankQueryDto) {
    return this.timebankService.list(query);
  }

  @Get('timebank/:employeeId')
  @AnyPermission('employees.read', 'employees.reports.read')
  @ApiOperation({
    summary:
      'Carer timebank — one carer, every week since their start, with each visit',
  })
  timebankDetail(
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Query() query: CarerTimebankDetailQueryDto,
  ) {
    return this.timebankService.detail(employeeId, query);
  }

  @Patch('monthly-review')
  @AnyPermission('employees.update')
  @ApiOperation({ summary: 'Create or update the monthly compliance review for an employee' })
  upsertMonthlyReview(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpsertEmployeeHoursMonthlyReviewDto,
  ) {
    return this.service.upsertMonthlyReview(user.id, dto);
  }
}
