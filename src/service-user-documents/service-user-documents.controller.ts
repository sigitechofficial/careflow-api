import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserDocumentsService } from './service-user-documents.service';
import { PatchServiceUserLegalDocumentsDto } from './dto/patch-service-user-legal-documents.dto';
import { CreateServiceUserDolsRecordDto } from './dto/create-service-user-dols-record.dto';
import { UpdateServiceUserDolsRecordDto } from './dto/update-service-user-dols-record.dto';
import {
  CreateServiceUserLegalAuthorityDto,
  UpdateServiceUserLegalAuthorityDto,
} from './dto/service-user-legal-authority.dto';
import { uploadPath } from '../common/utils/upload-path.util';

function documentsUploadRoot() {
  return uploadPath('service-users', 'documents');
}

function docMaxBytes() {
  const explicit = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 0);
  if (explicit > 0) return explicit;
  const mb = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? 10);
  return (Number.isFinite(mb) ? mb : 10) * 1024 * 1024;
}

function ensureDocumentsDir() {
  const root = documentsUploadRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function docFileFilter(_req: unknown, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  cb(null, allowed.has(file.mimetype));
}

function docMulterOptions(prefix: string) {
  return {
    storage: diskStorage({
      destination: (_req: unknown, _file: Express.Multer.File, cb: (e: Error | null, dest: string) => void) => {
        cb(null, ensureDocumentsDir());
      },
      filename: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, name: string) => void) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${prefix}-${unique}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: docMaxBytes() },
    fileFilter: docFileFilter,
  };
}

@ApiTags('Service User Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/documents')
export class ServiceUserDocumentsController {
  constructor(private readonly service: ServiceUserDocumentsService) {}

  @Get()
  @AnyPermission('service_users.documents.read', 'service_users.read')
  @ApiOperation({ summary: 'Legal documents and DoLS bundle for a service user' })
  bundle(@Param('id') serviceUserId: string) {
    return this.service.getBundle(serviceUserId);
  }

  @Patch('legal')
  @AnyPermission('service_users.documents.update', 'service_users.update')
  @ApiOperation({ summary: 'Update DNACPR / legal fields' })
  patchLegal(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: PatchServiceUserLegalDocumentsDto,
    @Req() req: Request,
  ) {
    return this.service.patchLegal(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Post('legal/dnacpr-certificate')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.documents.update', 'service_users.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload DNACPR certificate (JPEG, PNG, WebP, PDF)' })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiResponse({ status: 201 })
  @UseInterceptors(FileInterceptor('file', docMulterOptions('dnacpr')))
  uploadDnacpr(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadDnacprCertificate(user.id, serviceUserId, file, getRequestAuditMeta(req));
  }

  @Post('legal/lpa-health-certificate')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.documents.update', 'service_users.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload LPA health certificate (JPEG, PNG, WebP, PDF)' })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiResponse({ status: 201 })
  @UseInterceptors(FileInterceptor('file', docMulterOptions('lpa-health')))
  uploadLpaHealth(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadLpaHealthCertificate(user.id, serviceUserId, file, getRequestAuditMeta(req));
  }

  @Post('legal/lpa-finance-certificate')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.documents.update', 'service_users.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload LPA finance certificate (JPEG, PNG, WebP, PDF)' })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiResponse({ status: 201 })
  @UseInterceptors(FileInterceptor('file', docMulterOptions('lpa-finance')))
  uploadLpaFinance(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadLpaFinanceCertificate(user.id, serviceUserId, file, getRequestAuditMeta(req));
  }

  @Post('legal-authorities')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.documents.update', 'service_users.update')
  @ApiOperation({ summary: 'Add a legal authority (LPA, deputy, court order, appointee…)' })
  createLegalAuthority(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateServiceUserLegalAuthorityDto,
    @Req() req: Request,
  ) {
    return this.service.createLegalAuthority(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch('legal-authorities/:authorityId')
  @AnyPermission('service_users.documents.update', 'service_users.update')
  @ApiOperation({ summary: 'Update / verify a legal authority' })
  updateLegalAuthority(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('authorityId') authorityId: string,
    @Body() dto: UpdateServiceUserLegalAuthorityDto,
    @Req() req: Request,
  ) {
    return this.service.updateLegalAuthority(user.id, serviceUserId, authorityId, dto, getRequestAuditMeta(req));
  }

  @Delete('legal-authorities/:authorityId')
  @AnyPermission('service_users.documents.delete', 'service_users.delete')
  @ApiOperation({ summary: 'Remove a legal authority' })
  removeLegalAuthority(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('authorityId') authorityId: string,
    @Req() req: Request,
  ) {
    return this.service.removeLegalAuthority(user.id, serviceUserId, authorityId, getRequestAuditMeta(req));
  }

  @Post('dols')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.documents.update', 'service_users.update')
  @ApiOperation({ summary: 'Create DoLS record' })
  createDols(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateServiceUserDolsRecordDto,
    @Req() req: Request,
  ) {
    return this.service.createDols(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch('dols/:dolsId')
  @AnyPermission('service_users.documents.update', 'service_users.update')
  @ApiOperation({ summary: 'Update DoLS record' })
  updateDols(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('dolsId') dolsId: string,
    @Body() dto: UpdateServiceUserDolsRecordDto,
    @Req() req: Request,
  ) {
    return this.service.updateDols(user.id, serviceUserId, dolsId, dto, getRequestAuditMeta(req));
  }

  @Delete('dols/:dolsId')
  @AnyPermission('service_users.documents.delete', 'service_users.delete')
  @ApiOperation({ summary: 'Remove DoLS record' })
  removeDols(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('dolsId') dolsId: string,
    @Req() req: Request,
  ) {
    return this.service.removeDols(user.id, serviceUserId, dolsId, getRequestAuditMeta(req));
  }

  @Post('dols/:dolsId/certificate')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.documents.update', 'service_users.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload DoLS certificate (JPEG, PNG, WebP, PDF)' })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiResponse({ status: 201 })
  @UseInterceptors(FileInterceptor('file', docMulterOptions('dols')))
  uploadDolsCert(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('dolsId') dolsId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadDolsCertificate(user.id, serviceUserId, dolsId, file, getRequestAuditMeta(req));
  }
}
