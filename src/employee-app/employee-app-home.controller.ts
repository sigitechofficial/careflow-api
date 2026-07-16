import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppHomeService } from './employee-app-home.service';

class EmployeeAppHomeQueryDto {
  @ApiPropertyOptional({
    description: 'Schedule day (YYYY-MM-DD). Defaults to today (UTC).',
    example: '2026-07-15',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

/**
 * Carer mobile home / Today screen — separate from web admin APIs.
 */
@ApiTags('Employee App Home')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app')
export class EmployeeAppHomeController {
  constructor(private readonly homeService: EmployeeAppHomeService) {}

  @Get('home')
  @ApiOperation({
    summary: 'Today / home screen for the carer app',
    description:
      'Greeting, daily progress, active visit card, and ordered visit list for the authenticated carer.',
  })
  @ApiQuery({ name: 'date', required: false, example: '2026-07-15' })
  home(@CurrentUser() user: RequestUser, @Query() query: EmployeeAppHomeQueryDto) {
    return this.homeService.getHome(user.employeeId!, query.date);
  }
}
