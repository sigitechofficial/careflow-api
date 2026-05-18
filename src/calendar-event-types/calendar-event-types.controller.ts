import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CalendarEventTypesService } from './calendar-event-types.service';
import { CalendarEventTypeQueryDto } from './dto/calendar-event-type-query.dto';
import { CreateCalendarEventTypeDto } from './dto/create-calendar-event-type.dto';
import { UpdateCalendarEventTypeDto } from './dto/update-calendar-event-type.dto';

@ApiTags('Calendar Event Types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('calendar-event-types')
export class CalendarEventTypesController {
  constructor(private readonly service: CalendarEventTypesService) {}

  @Get()
  @AnyPermission('service_users.calendar_event_types.read', 'service_users.calendar.read')
  @ApiOperation({ summary: 'List calendar event types' })
  @ApiResponse({ status: 200 })
  list(@Query() query: CalendarEventTypeQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @AnyPermission('service_users.calendar_event_types.read', 'service_users.calendar.read')
  @ApiOperation({ summary: 'Get calendar event type by id' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('service_users.calendar_event_types.create')
  @ApiOperation({ summary: 'Create calendar event type' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCalendarEventTypeDto, @Req() req: Request) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('service_users.calendar_event_types.update')
  @ApiOperation({ summary: 'Update calendar event type' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventTypeDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('service_users.calendar_event_types.delete')
  @ApiOperation({ summary: 'Soft-delete calendar event type' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
