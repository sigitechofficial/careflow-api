import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { ServiceUserCommunicationNotesService } from './service-user-communication-notes.service';
import { CreateCommunicationNoteDto } from './dto/create-communication-note.dto';

@ApiTags('Service User Communication Notes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/communication-notes')
export class ServiceUserCommunicationNotesController {
  constructor(private readonly service: ServiceUserCommunicationNotesService) {}

  @Get()
  @AnyPermission('service_users.read')
  @ApiOperation({ summary: 'List communication notes for a service user' })
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.update', 'service_users.read')
  @ApiOperation({ summary: 'Create a communication note' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateCommunicationNoteDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Delete(':noteId')
  @AnyPermission('service_users.update', 'service_users.delete')
  @ApiOperation({ summary: 'Soft-delete a communication note' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('noteId') noteId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, noteId, getRequestAuditMeta(req));
  }
}
