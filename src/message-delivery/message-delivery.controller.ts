import { Body, Controller, Get, HttpCode, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { MessageDeliverySettingsService } from './message-delivery-settings.service';
import { MessageDeliveryLogQueryDto, SendTestMessageDto, UpdateMessageDeliveryDto } from './dto/message-delivery.dto';

export const MESSAGE_DELIVERY_READ = 'message_delivery.read';
export const MESSAGE_DELIVERY_MANAGE = 'message_delivery.manage';

@ApiTags('Message delivery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('message-delivery')
export class MessageDeliveryController {
  constructor(private readonly service: MessageDeliverySettingsService) {}

  @Get()
  @AnyPermission(MESSAGE_DELIVERY_READ, MESSAGE_DELIVERY_MANAGE)
  @ApiOperation({ summary: 'Who emails, texts, WhatsApp messages and push notifications may go to, and what is switched off' })
  get() {
    return this.service.get();
  }

  @Patch()
  @Permissions(MESSAGE_DELIVERY_MANAGE)
  @ApiOperation({ summary: 'Change message delivery settings' })
  update(@CurrentUser() user: RequestUser, @Body() dto: UpdateMessageDeliveryDto, @Req() req: Request) {
    return this.service.update(dto, user.id, getRequestAuditMeta(req));
  }

  @Get('log')
  @AnyPermission(MESSAGE_DELIVERY_READ, MESSAGE_DELIVERY_MANAGE)
  @ApiOperation({ summary: 'Messages sent or held back (last 30 days)' })
  log(@Query() q: MessageDeliveryLogQueryDto) {
    return this.service.log(q);
  }

  @Post('test')
  @HttpCode(200)
  @Permissions(MESSAGE_DELIVERY_MANAGE)
  @ApiOperation({ summary: 'Send a test email, text or push notification through the current settings' })
  test(@Body() dto: SendTestMessageDto) {
    return this.service.sendTest(dto);
  }
}
