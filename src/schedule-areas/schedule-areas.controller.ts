import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ScheduleAreasService } from './schedule-areas.service';
import { ScheduleAreaQueryDto } from './dto/schedule-area-query.dto';
import { CreateScheduleAreaDto } from './dto/create-schedule-area.dto';
import { UpdateScheduleAreaDto } from './dto/update-schedule-area.dto';

@ApiTags('Schedule Areas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schedule-areas')
export class ScheduleAreasController {
  constructor(private readonly service: ScheduleAreasService) {}

  @Get()
  @Permissions('schedule_areas.read')
  @ApiOperation({ summary: 'List schedule areas (zones/groups)' })
  @ApiResponse({ status: 200 })
  list(@Query() query: ScheduleAreaQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('schedule_areas.read')
  @ApiOperation({ summary: 'Get schedule area by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('schedule_areas.create')
  @ApiOperation({ summary: 'Create schedule area' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateScheduleAreaDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('schedule_areas.update')
  @ApiOperation({ summary: 'Update schedule area' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleAreaDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('schedule_areas.delete')
  @ApiOperation({ summary: 'Soft-delete schedule area' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
