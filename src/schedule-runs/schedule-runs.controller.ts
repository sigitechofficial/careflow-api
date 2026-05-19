import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ScheduleRunsService } from './schedule-runs.service';
import { ScheduleRunQueryDto } from './dto/schedule-run-query.dto';
import { CreateScheduleRunDto } from './dto/create-schedule-run.dto';
import { UpdateScheduleRunDto } from './dto/update-schedule-run.dto';

@ApiTags('Schedule Runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schedule-runs')
export class ScheduleRunsController {
  constructor(private readonly service: ScheduleRunsService) {}

  @Get()
  @Permissions('schedule_runs.read')
  @ApiOperation({ summary: 'List schedule runs' })
  list(@Query() query: ScheduleRunQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('schedule_runs.read')
  @ApiOperation({ summary: 'Get schedule run by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('schedule_runs.create')
  @ApiOperation({ summary: 'Create schedule run' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateScheduleRunDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('schedule_runs.update')
  @ApiOperation({ summary: 'Update schedule run' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleRunDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('schedule_runs.delete')
  @ApiOperation({ summary: 'Soft-delete schedule run' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
