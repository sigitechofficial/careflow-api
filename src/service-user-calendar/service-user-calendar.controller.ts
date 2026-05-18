import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserCalendarService } from './service-user-calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { CalendarEventQueryDto } from './dto/calendar-event-query.dto';
import { CalendarViewQueryDto } from './dto/calendar-view-query.dto';
import { UpdateCalendarEventStatusDto } from './dto/update-calendar-event-status.dto';

@ApiTags('Service User Calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/calendar')
export class ServiceUserCalendarController {
  constructor(private readonly service: ServiceUserCalendarService) {}

  @Get()
  @Permissions('service_users.calendar.read')
  @ApiOperation({ summary: 'Calendar view (day / week / month)' })
  @ApiResponse({ status: 200 })
  getCalendarView(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Query() query: CalendarViewQueryDto,
    @Req() req: Request,
  ) {
    return this.service.getCalendarView(serviceUserId, query, user.id, getRequestAuditMeta(req));
  }

  @Get('events')
  @Permissions('service_users.calendar.read')
  @ApiOperation({ summary: 'List calendar events for a service user' })
  listEvents(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Query() query: CalendarEventQueryDto,
    @Req() req: Request,
  ) {
    return this.service.getEventsForServiceUser(serviceUserId, query, user.id, getRequestAuditMeta(req));
  }

  @Get('events/:eventId')
  @Permissions('service_users.calendar.read')
  @ApiOperation({ summary: 'Get a calendar event' })
  getEvent(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('eventId') eventId: string,
    @Req() req: Request,
  ) {
    return this.service.getEventById(serviceUserId, eventId, user.id, getRequestAuditMeta(req));
  }

  @Post('events')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('service_users.calendar.create')
  @ApiOperation({ summary: 'Create a calendar event' })
  createEvent(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateCalendarEventDto,
    @Req() req: Request,
  ) {
    return this.service.createEvent(serviceUserId, dto, user, getRequestAuditMeta(req));
  }

  @Patch('events/:eventId')
  @Permissions('service_users.calendar.update')
  @ApiOperation({ summary: 'Update a calendar event' })
  updateEvent(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateCalendarEventDto,
    @Req() req: Request,
  ) {
    return this.service.updateEvent(serviceUserId, eventId, dto, user, getRequestAuditMeta(req));
  }

  @Delete('events/:eventId')
  @Permissions('service_users.calendar.delete')
  @ApiOperation({ summary: 'Soft-delete a calendar event' })
  deleteEvent(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('eventId') eventId: string,
    @Req() req: Request,
  ) {
    return this.service.softDeleteEvent(serviceUserId, eventId, user, getRequestAuditMeta(req));
  }

  @Patch('events/:eventId/status')
  @Permissions('service_users.calendar.status.update')
  @ApiOperation({ summary: 'Update calendar event status' })
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateCalendarEventStatusDto,
    @Req() req: Request,
  ) {
    return this.service.updateEventStatus(serviceUserId, eventId, dto, user, getRequestAuditMeta(req));
  }
}
