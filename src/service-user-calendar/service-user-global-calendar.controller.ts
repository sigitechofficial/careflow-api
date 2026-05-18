import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserCalendarService } from './service-user-calendar.service';
import { GlobalCalendarEventsQueryDto } from './dto/global-calendar-events-query.dto';

@ApiTags('Service User Calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/calendar')
export class ServiceUserGlobalCalendarController {
  constructor(private readonly service: ServiceUserCalendarService) {}

  @Get('events')
  @Permissions('service_users.calendar.read')
  @ApiOperation({ summary: 'Global service users calendar — events across service users' })
  @ApiResponse({ status: 200 })
  listGlobalEvents(
    @CurrentUser() user: RequestUser,
    @Query() query: GlobalCalendarEventsQueryDto,
    @Req() req: Request,
  ) {
    return this.service.getGlobalCalendarEvents(query, user.id, getRequestAuditMeta(req));
  }
}
