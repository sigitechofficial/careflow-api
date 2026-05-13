import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserContactsService } from './service-user-contacts.service';
import { CreateServiceUserContactDto } from './dto/create-service-user-contact.dto';
import { UpdateServiceUserContactDto } from './dto/update-service-user-contact.dto';

@ApiTags('Service User Contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/contacts')
export class ServiceUserContactsController {
  constructor(private readonly service: ServiceUserContactsService) {}

  @Get()
  @Permissions('service_users.contacts.read')
  @ApiOperation({ summary: 'List contacts for a service user' })
  @ApiResponse({ status: 200 })
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('service_users.contacts.create')
  @ApiOperation({ summary: 'Add contact' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateServiceUserContactDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':contactId')
  @Permissions('service_users.contacts.update')
  @ApiOperation({ summary: 'Update contact' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateServiceUserContactDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, contactId, dto, getRequestAuditMeta(req));
  }

  @Delete(':contactId')
  @Permissions('service_users.contacts.delete')
  @ApiOperation({ summary: 'Soft-delete contact' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('contactId') contactId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, contactId, getRequestAuditMeta(req));
  }
}
