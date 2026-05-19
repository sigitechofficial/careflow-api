import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SchedulesService } from './schedules.service';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import { ScheduleStatusQueryDto } from './dto/schedule-status-query.dto';
import { BuildScheduleDto } from './dto/build-schedule.dto';
import { UpdateScheduleStatusDto } from './dto/update-schedule-status.dto';

@ApiTags('Schedules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly service: SchedulesService) {}

  @Get()
  @Permissions('schedules.read')
  @ApiOperation({ summary: 'List schedule batches' })
  @ApiResponse({ status: 200 })
  list(@Query() query: ScheduleQueryDto) {
    return this.service.list(query);
  }

  @Get('previous')
  @Permissions('schedules.read')
  @ApiOperation({ summary: 'List previous schedule batches (by date desc)' })
  listPrevious(
    @CurrentUser() user: RequestUser,
    @Query() query: ScheduleQueryDto,
    @Req() req: Request,
  ) {
    return this.service.listPrevious(user.id, query, getRequestAuditMeta(req));
  }

  @Get('status')
  @Permissions('schedules.status.read')
  @ApiOperation({ summary: 'Schedule status modal — batch + per-area statuses for a date' })
  getStatus(
    @CurrentUser() user: RequestUser,
    @Query() query: ScheduleStatusQueryDto,
    @Req() req: Request,
  ) {
    return this.service.getStatusForDate(user.id, query.date, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('schedules.read')
  @ApiOperation({ summary: 'Get schedule batch by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post('build')
  @Permissions('schedules.build')
  @ApiOperation({
    summary: 'Build schedule — batch/area status; optional jobs[] creates ScheduledJob/Visit rows',
  })
  build(@CurrentUser() user: RequestUser, @Body() dto: BuildScheduleDto, @Req() req: Request) {
    return this.service.build(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/status')
  @Permissions('schedules.update')
  @ApiOperation({ summary: 'Update schedule batch and/or area statuses' })
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleStatusDto,
    @Req() req: Request,
  ) {
    return this.service.updateStatus(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('schedules.delete')
  @ApiOperation({ summary: 'Soft-delete schedule batch' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
