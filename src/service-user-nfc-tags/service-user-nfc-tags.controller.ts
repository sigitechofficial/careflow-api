import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserNfcTagsService } from './service-user-nfc-tags.service';
import { CreateServiceUserNfcTagDto } from './dto/create-service-user-nfc-tag.dto';
import { UpdateServiceUserNfcTagDto } from './dto/update-service-user-nfc-tag.dto';

/** NFC tags in a service user's home (DOM Care tab). Carers scan them at clock-in. */
@ApiTags('Service User NFC Tags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/nfc-tags')
export class ServiceUserNfcTagsController {
  constructor(private readonly service: ServiceUserNfcTagsService) {}

  @Get()
  @AnyPermission('service_users.dom_care.read', 'service_users.read')
  @ApiOperation({ summary: 'List NFC tags for a service user' })
  list(@Param('id', ParseUUIDPipe) serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Get(':tagId/scans')
  @AnyPermission('service_users.dom_care.read', 'service_users.read')
  @ApiOperation({ summary: 'Scan history of one NFC tag (newest first)' })
  listScans(
    @Param('id', ParseUUIDPipe) serviceUserId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ) {
    return this.service.listScans(serviceUserId, tagId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.dom_care.update', 'service_users.update')
  @ApiOperation({ summary: 'Register an NFC tag' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) serviceUserId: string,
    @Body() dto: CreateServiceUserNfcTagDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':tagId')
  @AnyPermission('service_users.dom_care.update', 'service_users.update')
  @ApiOperation({ summary: 'Rename an NFC tag or mark it lost / retired / active' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) serviceUserId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Body() dto: UpdateServiceUserNfcTagDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, tagId, dto, getRequestAuditMeta(req));
  }

  @Delete(':tagId')
  @AnyPermission('service_users.dom_care.update', 'service_users.update')
  @ApiOperation({ summary: 'Remove an NFC tag registered by mistake' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) serviceUserId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, tagId, getRequestAuditMeta(req));
  }
}
