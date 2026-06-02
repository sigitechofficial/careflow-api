import { Controller, Get, Param, Patch, Query, Res, UseGuards } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { BodyMapService } from './body-map.service';

@ApiTags('Service User Body Map')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:serviceUserId/body-map')
export class ServiceUserBodyMapController {
  constructor(private readonly service: BodyMapService) {}

  @Get()
  @AnyPermission('service_users.body_map.read', 'service_users.read')
  @ApiOperation({ summary: 'List body map records with markers for a service user' })
  list(
    @Param('serviceUserId') serviceUserId: string,
    @Query('includeResolved') includeResolved?: string,
  ) {
    return this.service.listForServiceUser(serviceUserId, includeResolved === 'true');
  }

  @Get('summary')
  @AnyPermission('service_users.body_map.read', 'service_users.read')
  @ApiOperation({ summary: 'Body map KPI summary for header' })
  summary(@Param('serviceUserId') serviceUserId: string) {
    return this.service.summary(serviceUserId);
  }

  @Get('handover')
  @AnyPermission('service_users.body_map.read', 'service_users.read')
  @ApiOperation({ summary: 'Handover preview — active body map concerns before a visit (§13)' })
  handover(@Param('serviceUserId') serviceUserId: string) {
    return this.service.handoverPreview(serviceUserId);
  }

  @Get('alerts')
  @AnyPermission('service_users.body_map.read', 'service_users.read')
  @ApiOperation({ summary: 'Governance alerts for body map records (§15.3)' })
  alerts(@Param('serviceUserId') serviceUserId: string) {
    return this.service.listAlerts(serviceUserId);
  }

  @Patch('alerts/:alertId/dismiss')
  @AnyPermission('service_users.body_map.review', 'service_users.body_map.close')
  @ApiOperation({ summary: 'Dismiss a body map governance alert' })
  dismissAlert(
    @Param('alertId') alertId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.dismissAlert(user.id, alertId);
  }

  @Get('export')
  @AnyPermission(
    'service_users.body_map.export',
    'service_users.body_map.review',
    'service_users.body_map.close',
    'service_users.update',
  )
  @ApiOperation({ summary: 'CQC evidence pack (JSON) for service user body map' })
  exportEvidence(@Param('serviceUserId') serviceUserId: string) {
    return this.service.exportEvidence(serviceUserId);
  }

  @Get('export/pdf')
  @AnyPermission(
    'service_users.body_map.export',
    'service_users.body_map.review',
    'service_users.body_map.close',
    'service_users.update',
  )
  @ApiOperation({ summary: 'Download CQC evidence pack as PDF (§21)' })
  async exportEvidencePdf(
    @Param('serviceUserId') serviceUserId: string,
    @Res() res: Response,
  ) {
    const { pdf, filename } = await this.service.exportEvidencePdf(serviceUserId);
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdf);
  }

  @Get('patch-rotation-check')
  @AnyPermission('service_users.body_map.read', 'service_users.read')
  @ApiOperation({
    summary: 'Warn when a new patch marker is close to recent patch sites (§9.3 rotation)',
  })
  patchRotationCheck(
    @Param('serviceUserId') serviceUserId: string,
    @Query('bodyView') bodyView: string,
    @Query('x') xRaw: string,
    @Query('y') yRaw: string,
    @Query('excludeRecordId') excludeRecordId?: string,
  ) {
    return this.service.patchRotationCheck(serviceUserId, {
      bodyView,
      x: Number(xRaw),
      y: Number(yRaw),
      excludeRecordId,
    });
  }
}
