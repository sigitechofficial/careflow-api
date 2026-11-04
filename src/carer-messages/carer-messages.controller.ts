import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CarerMessagesService } from './carer-messages.service';
import { CarerMessageAudienceDto, SendCarerMessageDto } from './dto/send-carer-message.dto';

@ApiTags('Carer notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('carer-messages')
export class CarerMessagesController {
  constructor(private readonly service: CarerMessagesService) {}

  @Get()
  @Permissions('carer_notifications.send')
  @ApiOperation({ summary: 'Notifications sent to carers, most recent first' })
  list(@Query('limit') limit?: string) {
    return this.service.list(limit ? Number(limit) || 50 : 50);
  }

  @Post('preview')
  @Permissions('carer_notifications.send')
  @ApiOperation({ summary: 'How many carers a notification would reach' })
  preview(@Body() dto: CarerMessageAudienceDto) {
    return this.service.preview(dto);
  }

  @Post()
  @Permissions('carer_notifications.send')
  @ApiOperation({ summary: 'Send a push notification to carers' })
  send(@CurrentUser() user: RequestUser, @Body() dto: SendCarerMessageDto, @Req() req: Request) {
    return this.service.send(user.id, dto, getRequestAuditMeta(req));
  }
}
