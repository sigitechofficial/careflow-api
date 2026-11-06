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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserDocumentStoreService } from './service-user-document-store.service';
import { CreateServiceUserDocumentRecordDto } from './dto/create-service-user-document-record.dto';
import { UpdateServiceUserDocumentRecordDto } from './dto/update-service-user-document-record.dto';
import { uploadPath } from '../common/utils/upload-path.util';

function storeUploadRoot() {
  return uploadPath('service-users', 'documents', 'store');
}

function docMaxBytes() {
  const explicit = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 0);
  if (explicit > 0) return explicit;
  const mb = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? 10);
  return (Number.isFinite(mb) ? mb : 10) * 1024 * 1024;
}

function ensureStoreDir() {
  const root = storeUploadRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function docFileFilter(_req: unknown, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  cb(null, allowed.has(file.mimetype));
}

function storeMulterOptions() {
  return {
    storage: diskStorage({
      destination: (_req: unknown, _file: Express.Multer.File, cb: (e: Error | null, dest: string) => void) => {
        cb(null, ensureStoreDir());
      },
      filename: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, name: string) => void) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `doc-${unique}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: docMaxBytes() },
    fileFilter: docFileFilter,
  };
}

@ApiTags('Service User Document Store')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ServiceUserDocumentStoreController {
  constructor(private readonly service: ServiceUserDocumentStoreService) {}

  @Get('service-user-document-types')
  @AnyPermission('service_users.documents.read', 'service_users.read')
  @ApiOperation({ summary: 'Document type catalog (1G)' })
  listTypes() {
    return this.service.listDocumentTypes();
  }

  @Get('service-users/:id/document-store')
  @AnyPermission('service_users.documents.read', 'service_users.read')
  @ApiOperation({ summary: 'Document store with compliance dashboard' })
  getStore(@Param('id') serviceUserId: string) {
    return this.service.getStore(serviceUserId);
  }

  @Post('service-users/:id/document-store')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.documents.update', 'service_users.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a service user document record' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'documentTypeId', 'title', 'documentDate'],
      properties: {
        file: { type: 'string', format: 'binary' },
        documentTypeId: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        documentDate: { type: 'string', format: 'date' },
        expiryDate: { type: 'string', format: 'date' },
        physicalLocationInHome: { type: 'string' },
        accessLevel: { type: 'string' },
        status: { type: 'string' },
        supersedesDocumentId: { type: 'string', format: 'uuid' },
        linkedRecordType: { type: 'string' },
        linkedRecordId: { type: 'string', format: 'uuid' },
        notes: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', storeMulterOptions()))
  upload(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateServiceUserDocumentRecordDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.createRecord(user.id, serviceUserId, dto, file, getRequestAuditMeta(req));
  }

  @Patch('service-users/:id/document-store/:documentId')
  @AnyPermission('service_users.documents.update', 'service_users.update')
  @ApiOperation({ summary: 'Update document record metadata' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('documentId') documentId: string,
    @Body() dto: UpdateServiceUserDocumentRecordDto,
    @Req() req: Request,
  ) {
    return this.service.updateRecord(user.id, serviceUserId, documentId, dto, getRequestAuditMeta(req));
  }

  @Get('service-users/:id/document-store/:documentId/download')
  @AnyPermission('service_users.documents.read', 'service_users.read')
  @ApiOperation({ summary: 'Download a document record file' })
  download(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: false }) res: Response,
    @Req() req: Request,
  ) {
    return this.service.downloadRecord(user.id, serviceUserId, documentId, res, getRequestAuditMeta(req));
  }

  @Delete('service-users/:id/document-store/:documentId')
  @AnyPermission('service_users.documents.delete', 'service_users.delete')
  @ApiOperation({ summary: 'Remove document record' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('documentId') documentId: string,
    @Req() req: Request,
  ) {
    return this.service.removeRecord(user.id, serviceUserId, documentId, getRequestAuditMeta(req));
  }
}
