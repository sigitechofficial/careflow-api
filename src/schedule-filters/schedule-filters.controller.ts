import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ScheduleFiltersService } from './schedule-filters.service';
import { FilterJobsDto } from './dto/filter-jobs.dto';
import { FilterCarersDto } from './dto/filter-carers.dto';
import { FilterCustomersDto } from './dto/filter-customers.dto';

@ApiTags('Schedule Filters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schedule-filters')
export class ScheduleFiltersController {
  constructor(private readonly service: ScheduleFiltersService) {}

  @Post('jobs')
  @Permissions('schedule_filters.jobs')
  @ApiOperation({ summary: 'Filter scheduled jobs' })
  filterJobs(@CurrentUser() user: RequestUser, @Body() dto: FilterJobsDto, @Req() req: Request) {
    return this.service.filterJobs(user.id, dto, getRequestAuditMeta(req));
  }

  @Post('carers')
  @Permissions('schedule_filters.carers')
  @ApiOperation({ summary: 'Filter carers / employees for scheduling' })
  filterCarers(@CurrentUser() user: RequestUser, @Body() dto: FilterCarersDto, @Req() req: Request) {
    return this.service.filterCarers(user.id, dto, getRequestAuditMeta(req));
  }

  @Post('customers')
  @Permissions('schedule_filters.customers')
  @ApiOperation({ summary: 'Filter service users (customers) for scheduling' })
  filterCustomers(
    @CurrentUser() user: RequestUser,
    @Body() dto: FilterCustomersDto,
    @Req() req: Request,
  ) {
    return this.service.filterCustomers(user.id, dto, getRequestAuditMeta(req));
  }
}
