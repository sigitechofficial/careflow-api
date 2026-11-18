import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  CreatePolicyDto,
  CreatePolicyVersionDto,
  PolicyCommentsDto,
  PolicyListQueryDto,
  ApplicablePoliciesQueryDto,
  PublishPolicyDto,
  UpdatePolicyDto,
} from './dto/policy.dto';
import { PoliciesService } from './policies.service';
import { PolicyExportService, type PolicyExportFile, type PolicyExportFormat } from './policy-export.service';
import { policyUploadMulterOptions } from './policy-upload.util';

@ApiTags('Policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('policies')
export class PoliciesController {
  constructor(
    private readonly service: PoliciesService,
    private readonly exports: PolicyExportService,
  ) {}

  @Get(':id/export')
  @Permissions('policies.read')
  @ApiOperation({ summary: 'Download a policy (a version, or its current one) as PDF or Word' })
  async exportPolicy(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Query('versionId') versionId: string | undefined,
    @Res() res: Response,
  ) {
    sendExport(res, await this.exports.exportPolicy(user, id, exportFormat(format), versionId || undefined));
  }

  @Get()
  @Permissions('policies.read')
  @ApiOperation({ summary: 'List policies in the library' })
  list(@CurrentUser() user: RequestUser, @Query() query: PolicyListQueryDto) {
    return this.service.list(user, query);
  }

  @Get('audience-roles')
  @AnyPermission('policies.read', 'policies.create', 'policies.update')
  @ApiOperation({
    summary: 'Sign-in roles a policy audience can target (the roles saving and acknowledgement matching use)',
  })
  async audienceRoles() {
    return { data: await this.service.audienceRoles() };
  }

  @Get('applicable')
  @Permissions('policies.read')
  @ApiOperation({
    summary: 'List published policies applicable to a CareFlow context',
  })
  listApplicable(
    @CurrentUser() user: RequestUser,
    @Query() query: ApplicablePoliciesQueryDto,
  ) {
    return this.service.listApplicable(user, query);
  }

  @Post()
  @Permissions('policies.create')
  @ApiOperation({ summary: 'Create a policy document with version 1.0 DRAFT' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePolicyDto,
    @Req() req: Request,
  ) {
    return this.service.create(user, dto, getRequestAuditMeta(req));
  }

  @Get(':id/versions')
  @Permissions('policies.read')
  @ApiOperation({ summary: 'List policy versions' })
  listVersions(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listVersions(user, id);
  }

  @Post(':id/versions')
  @Permissions('policies.update')
  @ApiOperation({
    summary: 'Create a new minor or major draft from the published version',
  })
  createVersion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreatePolicyVersionDto,
    @Req() req: Request,
  ) {
    return this.service.createVersion(user, id, dto, getRequestAuditMeta(req));
  }

  @Get(':id/versions/:versionId')
  @Permissions('policies.read')
  @ApiOperation({ summary: 'Get a policy version' })
  getVersion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.service.getVersion(user, id, versionId);
  }

  @Post(':id/versions/:versionId/upload')
  @Permissions('policies.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      ...policyUploadMulterOptions(),
    }),
  )
  @ApiOperation({
    summary: 'Upload a PDF or Word document onto a DRAFT policy version',
  })
  uploadVersionDocument(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.service.uploadVersionDocument(
      user,
      id,
      versionId,
      file,
      getRequestAuditMeta(req),
    );
  }

  @Get(':id/versions/:versionId/document')
  @Permissions('policies.read')
  @ApiOperation({
    summary: 'Download or view an uploaded policy document (authenticated)',
  })
  async downloadVersionDocument(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ) {
    const file = await this.service.getVersionDocumentForDownload(
      user,
      id,
      versionId,
      disposition,
    );
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', file.contentDisposition);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(file.absolutePath);
  }

  @Delete(':id/versions/:versionId/document')
  @Permissions('policies.update')
  @ApiOperation({
    summary: 'Remove an uploaded document from a DRAFT policy version',
  })
  removeVersionDocument(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Req() req: Request,
  ) {
    return this.service.removeVersionDocument(
      user,
      id,
      versionId,
      getRequestAuditMeta(req),
    );
  }

  @Post(':id/submit-review')
  @Permissions('policies.submit')
  @ApiOperation({ summary: 'Submit the current DRAFT version for review' })
  submitForReview(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: PolicyCommentsDto,
    @Req() req: Request,
  ) {
    return this.service.submitForReview(
      user,
      id,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post(':id/request-changes')
  @Permissions('policies.review')
  @ApiOperation({ summary: 'Return an IN_REVIEW version to DRAFT' })
  requestChanges(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: PolicyCommentsDto,
    @Req() req: Request,
  ) {
    return this.service.requestChanges(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/approve')
  @Permissions('policies.approve')
  @ApiOperation({ summary: 'Approve an IN_REVIEW version' })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: PolicyCommentsDto,
    @Req() req: Request,
  ) {
    return this.service.approve(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/publish')
  @Permissions('policies.publish')
  @ApiOperation({
    summary:
      'Publish an APPROVED version and supersede the previous published version',
  })
  publish(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: PublishPolicyDto,
    @Req() req: Request,
  ) {
    return this.service.publish(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/archive')
  @Permissions('policies.archive')
  @ApiOperation({ summary: 'Archive a policy without deleting history' })
  archive(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.archive(user, id, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('policies.archive')
  @ApiOperation({
    summary: 'Permanently delete a never-published DRAFT policy',
  })
  deleteDraft(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.deleteDraftDocument(user, id, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('policies.read')
  @ApiOperation({ summary: 'Get a policy and its current version' })
  getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getById(user, id);
  }

  @Patch(':id')
  @Permissions('policies.update')
  @ApiOperation({ summary: 'Update a DRAFT policy and its editable version' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdatePolicyDto,
    @Req() req: Request,
  ) {
    return this.service.update(user, id, dto, getRequestAuditMeta(req));
  }
}

/** Sends a made document as a download (attachment, a safe file name). */
export function sendExport(res: Response, file: PolicyExportFile) {
  const ascii = file.fileName.replace(/[^ -~]/g, '_').replace(/"/g, "'");
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.buffer);
}

export function exportFormat(raw: string | undefined): PolicyExportFormat {
  if (raw === 'pdf' || raw === 'docx') return raw;
  throw new BadRequestException('Choose pdf or docx.');
}
