import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
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

@ApiTags('Employee Hours')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employee-hours')
export class EmployeeHoursController {
  constructor(private readonly service: EmployeeHoursService) {}

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
