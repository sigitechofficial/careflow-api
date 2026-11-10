import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserPrivacyService } from './service-user-privacy.service';
import {
  RecordConsentChangeDto,
  RecordSharingExceptionDto,
  SaveCommunicationNeedsDto,
  SaveSharingAgreementDto,
  StopSharingDto,
} from './dto/service-user-privacy.dto';

/** Profile → Privacy: communication needs, who we may share information with, and sharing without consent. */
@ApiTags('Service User Privacy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/privacy')
export class ServiceUserPrivacyController {
  constructor(private readonly service: ServiceUserPrivacyService) {}

  @Get()
  @AnyPermission('service_users.read')
  @ApiOperation({ summary: 'Communication needs, sharing and exceptions, with what the assessment recorded' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Put('communication-needs')
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Save how the person needs information and communication' })
  saveNeeds(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveCommunicationNeedsDto, @Req() req: Request) {
    return this.service.saveNeeds(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post('sharing')
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Record who information may be shared with' })
  createSharing(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveSharingAgreementDto, @Req() req: Request) {
    return this.service.createSharing(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Patch('sharing/:sharingId')
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Change a sharing line' })
  updateSharing(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sharingId', ParseUUIDPipe) sharingId: string,
    @Body() dto: SaveSharingAgreementDto,
    @Req() req: Request,
  ) {
    return this.service.updateSharing(user.id, id, sharingId, dto, getRequestAuditMeta(req));
  }

  @Post('sharing/:sharingId/stop')
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Stop sharing now (kept as history)' })
  stopSharing(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sharingId', ParseUUIDPipe) sharingId: string,
    @Body() dto: StopSharingDto,
    @Req() req: Request,
  ) {
    return this.service.stopSharing(user.id, id, sharingId, dto, getRequestAuditMeta(req));
  }

  @Delete('sharing/:sharingId')
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Remove a sharing line entered by mistake' })
  removeSharing(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sharingId', ParseUUIDPipe) sharingId: string,
    @Req() req: Request,
  ) {
    return this.service.removeSharing(user.id, id, sharingId, getRequestAuditMeta(req));
  }

  @Post('consents')
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Record a consent given, changed or withdrawn (kept with its history)' })
  recordConsent(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordConsentChangeDto, @Req() req: Request) {
    return this.service.recordConsent(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post('exceptions')
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Record information shared without consent' })
  recordException(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordSharingExceptionDto, @Req() req: Request) {
    return this.service.recordException(user.id, id, dto, getRequestAuditMeta(req));
  }
}
