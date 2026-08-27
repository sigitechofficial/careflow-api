import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { IncidentCareService } from './incident-care.service';
import { incidentAttachmentUploadOptions } from './incident-attachment.config';
import {
  CreateIncidentAttachmentMetaDto,
  CreateIncidentInjuryDto,
  CreateIncidentWitnessDto,
  CreateRelatedCareRecordDto,
  LinkRelatedIncidentDto,
  UpdateRelatedCareRecordDto,
} from './dto/incident-care.dto';

@ApiTags('Incidents — Care integration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('incidents')
export class IncidentCareController {
  constructor(private readonly service: IncidentCareService) {}

  // Injuries
  @Get(':id/injuries')
  @Permissions('incidents.read')
  @ApiOperation({ summary: 'List injuries for an incident' })
  listInjuries(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listInjuries(user, id);
  }

  @Post(':id/injuries')
  @Permissions('incidents.update')
  @ApiOperation({ summary: 'Record an injury' })
  addInjury(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateIncidentInjuryDto,
    @Req() req: Request,
  ) {
    return this.service.addInjury(user, id, dto, getRequestAuditMeta(req));
  }

  @Delete('injuries/:injuryId')
  @Permissions('incidents.update')
  @ApiOperation({ summary: 'Remove an injury' })
  deleteInjury(
    @CurrentUser() user: RequestUser,
    @Param('injuryId') injuryId: string,
    @Req() req: Request,
  ) {
    return this.service.deleteInjury(user, injuryId, getRequestAuditMeta(req));
  }

  // Witnesses
  @Get(':id/witnesses')
  @Permissions('incidents.read')
  @ApiOperation({ summary: 'List witnesses' })
  listWitnesses(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listWitnesses(user, id);
  }

  @Post(':id/witnesses')
  @Permissions('incidents.update')
  @ApiOperation({ summary: 'Add a witness and statement' })
  addWitness(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateIncidentWitnessDto,
    @Req() req: Request,
  ) {
    return this.service.addWitness(user, id, dto, getRequestAuditMeta(req));
  }

  @Delete('witnesses/:witnessId')
  @Permissions('incidents.update')
  @ApiOperation({ summary: 'Remove a witness' })
  deleteWitness(
    @CurrentUser() user: RequestUser,
    @Param('witnessId') witnessId: string,
    @Req() req: Request,
  ) {
    return this.service.deleteWitness(
      user,
      witnessId,
      getRequestAuditMeta(req),
    );
  }

  // Related incidents
  @Get(':id/related-incidents')
  @Permissions('incidents.read')
  @ApiOperation({ summary: 'List linked incidents' })
  listRelated(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listRelatedIncidents(user, id);
  }

  @Post(':id/related-incidents')
  @Permissions('incidents.update')
  @ApiOperation({ summary: 'Link a related incident' })
  linkRelated(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: LinkRelatedIncidentDto,
    @Req() req: Request,
  ) {
    return this.service.linkRelatedIncident(
      user,
      id,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Delete('related-incidents/:linkId')
  @Permissions('incidents.update')
  @ApiOperation({ summary: 'Unlink a related incident' })
  unlinkRelated(
    @CurrentUser() user: RequestUser,
    @Param('linkId') linkId: string,
    @Req() req: Request,
  ) {
    return this.service.unlinkRelatedIncident(
      user,
      linkId,
      getRequestAuditMeta(req),
    );
  }

  // Related care records
  @Get(':id/care-records')
  @Permissions('incidents.read')
  @ApiOperation({ summary: 'List linked care records' })
  listCareRecords(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listCareRecords(user, id);
  }

  @Post(':id/care-records')
  @Permissions('incidents.update')
  @ApiOperation({ summary: 'Link a care record that needs review' })
  addCareRecord(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateRelatedCareRecordDto,
    @Req() req: Request,
  ) {
    return this.service.addCareRecord(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch('care-records/:recordId')
  @Permissions('incidents.update')
  @ApiOperation({ summary: 'Update a linked care record (e.g. mark reviewed)' })
  updateCareRecord(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: UpdateRelatedCareRecordDto,
    @Req() req: Request,
  ) {
    return this.service.updateCareRecord(
      user,
      recordId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Delete('care-records/:recordId')
  @Permissions('incidents.update')
  @ApiOperation({ summary: 'Remove a care record link' })
  deleteCareRecord(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Req() req: Request,
  ) {
    return this.service.deleteCareRecord(
      user,
      recordId,
      getRequestAuditMeta(req),
    );
  }

  // Attachments
  @Get(':id/attachments')
  @Permissions('incidents.read')
  @ApiOperation({ summary: 'List incident attachments' })
  listAttachments(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listAttachments(user, id);
  }

  @Post(':id/attachments')
  @Permissions('incidents.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', incidentAttachmentUploadOptions))
  @ApiOperation({ summary: 'Upload a secure incident attachment' })
  addAttachment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateIncidentAttachmentMetaDto,
    @Req() req: Request,
  ) {
    return this.service.addAttachment(
      user,
      id,
      file,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Get('attachments/:attachmentId/download')
  @Permissions('incidents.read')
  @ApiOperation({
    summary: 'Download an attachment (authenticated, permission-checked)',
  })
  async downloadAttachment(
    @CurrentUser() user: RequestUser,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const file = await this.service.getAttachmentForDownload(
      user,
      attachmentId,
    );
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    );
    return res.sendFile(file.absolutePath);
  }

  @Delete('attachments/:attachmentId')
  @Permissions('incidents.update')
  @ApiOperation({ summary: 'Remove an attachment' })
  deleteAttachment(
    @CurrentUser() user: RequestUser,
    @Param('attachmentId') attachmentId: string,
    @Req() req: Request,
  ) {
    return this.service.deleteAttachment(
      user,
      attachmentId,
      getRequestAuditMeta(req),
    );
  }

  // Service-user incident history + trend indicators
  @Get('service-user/:serviceUserId/history')
  @Permissions('incidents.read')
  @ApiOperation({
    summary: 'Incident history and trend indicators for a service user',
  })
  serviceUserHistory(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
  ) {
    return this.service.getServiceUserHistory(user, serviceUserId);
  }
}
