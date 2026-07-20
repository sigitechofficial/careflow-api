import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppSalaryService } from './employee-app-salary.service';

class EmployeeAppMySalaryQueryDto {
  @ApiPropertyOptional({
    description:
      'Salary period: YYYY-MM (calendar month) or YYYY-Www (ISO week). Defaults from org salaryCalculationBasis (current month or week).',
    example: '2026-07',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(\d{4}-\d{2}|\d{4}-W\d{2})$/, {
    message: 'period must be YYYY-MM or YYYY-Www',
  })
  period?: string;

  @ApiPropertyOptional({
    description: 'Alias for monthly period (YYYY-MM). Ignored if `period` or date range is set.',
    example: '2026-07',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be YYYY-MM' })
  month?: string;

  @ApiPropertyOptional({
    description: 'Custom range start (YYYY-MM-DD). Must be paired with dateTo.',
    example: '2026-07-01',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateFrom must be YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Custom range end (YYYY-MM-DD). Must be paired with dateFrom.',
    example: '2026-07-31',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateTo must be YYYY-MM-DD' })
  dateTo?: string;
}

/**
 * Carer mobile salary / earnings — read-only, scoped to JWT employeeId.
 * Mirrors admin Employee edit → Salary tab (visit pay − fines − penalties).
 */
@ApiTags('Employee App Salary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app')
export class EmployeeAppSalaryController {
  constructor(private readonly salaryService: EmployeeAppSalaryService) {}

  @Get('me/salary')
  @ApiOperation({
    summary: 'My salary / earnings (read-only)',
    description:
      'Net salary for the authenticated carer for a month or ISO week: accepted visit pay minus fines and penalties, plus visit lines and deductions. Same figures as admin Salary tab. Cannot add deductions or edit visit amounts.',
  })
  @ApiQuery({ name: 'period', required: false, example: '2026-07' })
  @ApiQuery({ name: 'month', required: false, example: '2026-07' })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2026-07-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2026-07-31' })
  mySalary(@CurrentUser() user: RequestUser, @Query() query: EmployeeAppMySalaryQueryDto) {
    return this.salaryService.getMySalary(user.employeeId!, {
      period: query.period,
      month: query.month,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  }
}
