import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppScheduleService } from './employee-app-schedule.service';

class EmployeeAppScheduleQueryDto {
  @ApiPropertyOptional({
    description: 'Selected schedule day (YYYY-MM-DD). Defaults to today (UTC).',
    example: '2026-06-30',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({
    description: 'Date strip start (YYYY-MM-DD). Defaults to 14 days before `date`.',
    example: '2026-06-16',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    description: 'Date strip end (YYYY-MM-DD). Defaults to 21 days after `date`.',
    example: '2026-07-21',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

/**
 * Carer mobile Schedule screen — separate from web admin APIs.
 */
@ApiTags('Employee App Schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app')
export class EmployeeAppScheduleController {
  constructor(private readonly scheduleService: EmployeeAppScheduleService) {}

  @Get('schedule')
  @ApiOperation({
    summary: 'Schedule screen for the carer app',
    description:
      'Date strip, selected-day totals (visits / planned hours / miles), and ordered visit list.',
  })
  @ApiQuery({ name: 'date', required: false, example: '2026-06-30' })
  @ApiQuery({ name: 'from', required: false, example: '2026-06-16' })
  @ApiQuery({ name: 'to', required: false, example: '2026-07-21' })
  schedule(@CurrentUser() user: RequestUser, @Query() query: EmployeeAppScheduleQueryDto) {
    return this.scheduleService.getSchedule(user.employeeId!, {
      date: query.date,
      from: query.from,
      to: query.to,
    });
  }
}
