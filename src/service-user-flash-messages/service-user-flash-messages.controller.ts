import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserFlashMessagesService } from './service-user-flash-messages.service';
import { UpsertFlashMessageDto } from './dto/upsert-flash-message.dto';
import { ClearFlashMessageDto } from './dto/clear-flash-message.dto';
import { FlashMessageQueryDto } from './dto/flash-message-query.dto';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

@ApiTags('Service User Flash Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/flash-message')
export class ServiceUserFlashMessagesController {
  constructor(private readonly service: ServiceUserFlashMessagesService) {}

  @Get()
  @AnyPermission('service_users.flash_message.read', 'service_users.read')
  @ApiOperation({ summary: 'Get current active flash message for a service user' })
  @ApiResponse({ status: 200, description: 'Current flash message or null' })
  getCurrent(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Req() req: Request,
  ) {
    return this.service.getCurrent(serviceUserId, user.id, getRequestAuditMeta(req));
  }

  @Get('history')
  @AnyPermission('service_users.flash_message.history.read')
  @ApiOperation({ summary: 'Paginated flash message history' })
  @ApiResponse({ status: 200, description: 'History list with pagination meta' })
  getHistory(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Query() query: FlashMessageQueryDto,
    @Req() req: Request,
  ) {
    return this.service.getHistory(serviceUserId, query, user.id, getRequestAuditMeta(req));
  }

  @Put()
  @AnyPermission('service_users.flash_message.update', 'service_users.update')
  @ApiOperation({ summary: 'Create or replace current flash message' })
  @ApiResponse({ status: 200, description: 'Flash message created or updated' })
  upsert(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: UpsertFlashMessageDto,
    @Req() req: Request,
  ) {
    return this.service.upsert(serviceUserId, dto, user.id, getRequestAuditMeta(req));
  }

  @Patch('clear')
  @AnyPermission('service_users.flash_message.delete', 'service_users.update')
  @ApiOperation({ summary: 'Clear current flash message with optional reason' })
  @ApiResponse({ status: 200, description: 'Flash message cleared' })
  clearWithReason(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: ClearFlashMessageDto,
    @Req() req: Request,
  ) {
    return this.service.clear(serviceUserId, dto.reason, user.id, getRequestAuditMeta(req));
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.flash_message.delete', 'service_users.update')
  @ApiOperation({ summary: 'Clear current flash message' })
  @ApiResponse({ status: 200, description: 'Flash message cleared' })
  deleteCurrent(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Req() req: Request,
  ) {
    return this.service.clear(
      serviceUserId,
      undefined,
      user.id,
      getRequestAuditMeta(req),
      AuditAction.SERVICE_USER_FLASH_MESSAGE_DELETED,
    );
  }
}
