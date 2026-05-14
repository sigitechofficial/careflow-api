import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { NotificationsService } from './notifications.service';

function assertNotificationsUser(user: RequestUser) {
  if (user.accountKind === 'temporary_inspector') {
    throw new ForbiddenException('Notifications are not available for temporary inspector sessions');
  }
}

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Permissions('notifications.read')
  async list(@CurrentUser() user: RequestUser, @Query() query: NotificationQueryDto) {
    assertNotificationsUser(user);
    return this.notifications.getMyNotifications(user.id, query);
  }

  @Get('unread-count')
  @Permissions('notifications.read')
  async unreadCount(@CurrentUser() user: RequestUser) {
    assertNotificationsUser(user);
    const count = await this.notifications.getUnreadCount(user.id);
    return { data: { count } };
  }

  @Get(':id')
  @Permissions('notifications.read')
  async getOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    assertNotificationsUser(user);
    const data = await this.notifications.getMyNotificationById(user.id, id);
    return { data };
  }

  @Post()
  @Permissions('notifications.create')
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateNotificationDto) {
    assertNotificationsUser(user);
    const data = await this.notifications.createNotification(dto, user);
    return { data, message: 'Notification created' };
  }

  @Patch(':id/read')
  @Permissions('notifications.update')
  async markRead(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    assertNotificationsUser(user);
    const data = await this.notifications.markAsRead(user.id, id);
    return { data, message: 'Marked as read' };
  }

  @Patch('read-all')
  @Permissions('notifications.update')
  async markAllRead(@CurrentUser() user: RequestUser) {
    assertNotificationsUser(user);
    const data = await this.notifications.markAllAsRead(user.id);
    return { data, message: 'All notifications marked read' };
  }

  @Patch(':id/dismiss')
  @Permissions('notifications.dismiss')
  async dismiss(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    assertNotificationsUser(user);
    const data = await this.notifications.dismiss(user.id, id);
    return { data, message: 'Notification dismissed' };
  }
}

@ApiTags('Notification preferences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Permissions('notifications.preferences.read')
  async get(@CurrentUser() user: RequestUser) {
    assertNotificationsUser(user);
    const data = await this.notifications.getMyPreferences(user.id);
    return { data };
  }

  @Patch()
  @Permissions('notifications.preferences.update')
  async patch(@CurrentUser() user: RequestUser, @Body() dto: UpdateNotificationPreferencesDto) {
    assertNotificationsUser(user);
    const data = await this.notifications.updateMyPreferences(user.id, dto);
    return { data, message: 'Preferences updated' };
  }
}
