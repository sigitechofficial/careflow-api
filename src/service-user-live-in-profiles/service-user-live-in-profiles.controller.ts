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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
import { ServiceUserLiveInProfilesService } from './service-user-live-in-profiles.service';
import { CreateLiveInProfileDto } from './dto/create-live-in-profile.dto';
import { UpdateLiveInProfileDto } from './dto/update-live-in-profile.dto';
import { UpdateLiveInProfileStatusDto } from './dto/update-live-in-profile-status.dto';
import { AddPreferredCarerDto } from './dto/add-preferred-carer.dto';
import { AddBlockedCarerDto } from './dto/add-blocked-carer.dto';
import { uploadPath } from '../common/utils/upload-path.util';

function liveInContractUploadRoot() {
  return uploadPath('service-users', 'live-in-contracts');
}

function liveInMaxBytes() {
  const explicit = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 0);
  if (explicit > 0) return explicit;
  const mb = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? 10);
  return (Number.isFinite(mb) ? mb : 10) * 1024 * 1024;
}

function ensureLiveInContractDir() {
  const root = liveInContractUploadRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

const LIVE_IN_CONTRACT_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]);

function liveInContractFileFilter(_req: unknown, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) {
  if (!LIVE_IN_CONTRACT_MIMES.has(file.mimetype)) {
    cb(
      new BadRequestException('Invalid file type. Allowed: PDF, DOC, DOCX, JPG, JPEG, PNG.'),
      false,
    );
    return;
  }
  cb(null, true);
}

function liveInContractMulterOptions() {
  return {
    storage: diskStorage({
      destination: (_req: unknown, _file: Express.Multer.File, cb: (e: Error | null, dest: string) => void) => {
        cb(null, ensureLiveInContractDir());
      },
      filename: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, name: string) => void) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `live-in-contract-${unique}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: liveInMaxBytes() },
    fileFilter: liveInContractFileFilter,
  };
}

@ApiTags('Service User Live-in Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/live-in-profile')
export class ServiceUserLiveInProfilesController {
  constructor(private readonly service: ServiceUserLiveInProfilesService) {}

  @Get('contract-documents/:documentId/download')
  @AnyPermission('service_users.live_in_profile.documents.download')
  @ApiOperation({ summary: 'Download a live-in contract document (streams file; audit + data access log)' })
  @ApiParam({ name: 'id', description: 'Service user id' })
  @ApiParam({ name: 'documentId' })
  @ApiResponse({ status: 200 })
  async downloadContract(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: false }) res: Response,
    @Req() req: Request,
  ) {
    await this.service.downloadContractDocument(
      user.id,
      serviceUserId,
      documentId,
      res,
      getRequestAuditMeta(req),
    );
  }

  @Get('contract-documents')
  @AnyPermission('service_users.live_in_profile.documents.read')
  @ApiOperation({ summary: 'List active live-in contract documents' })
  contractDocumentsList(@Param('id') serviceUserId: string) {
    return this.service.getContractDocuments(serviceUserId);
  }

  @Post('contract-documents')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.live_in_profile.documents.upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload live-in contract (PDF, DOC, DOCX, JPG, PNG)' })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @UseInterceptors(FileInterceptor('file', liveInContractMulterOptions()))
  uploadContract(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadContractDocument(user.id, serviceUserId, file, getRequestAuditMeta(req));
  }

  @Delete('contract-documents/:documentId')
  @AnyPermission('service_users.live_in_profile.documents.delete')
  @ApiOperation({ summary: 'Soft-delete a contract document' })
  deleteContract(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('documentId') documentId: string,
    @Req() req: Request,
  ) {
    return this.service.deleteContractDocument(user.id, serviceUserId, documentId, getRequestAuditMeta(req));
  }

  @Get('preferred-carers')
  @AnyPermission('service_users.live_in_profile.carers.read')
  @ApiOperation({ summary: 'Preferred carers for live-in profile' })
  preferredList(@Param('id') serviceUserId: string) {
    return this.service.getPreferredCarers(serviceUserId);
  }

  @Post('preferred-carers')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.live_in_profile.carers.manage')
  @ApiOperation({ summary: 'Add preferred carer' })
  preferredAdd(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: AddPreferredCarerDto,
    @Req() req: Request,
  ) {
    return this.service.addPreferredCarer(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Delete('preferred-carers/:employeeId')
  @AnyPermission('service_users.live_in_profile.carers.manage')
  @ApiOperation({ summary: 'Remove preferred carer' })
  preferredRemove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('employeeId') employeeId: string,
    @Req() req: Request,
  ) {
    return this.service.removePreferredCarer(user.id, serviceUserId, employeeId, getRequestAuditMeta(req));
  }

  @Get('blocked-carers')
  @AnyPermission('service_users.live_in_profile.carers.read')
  @ApiOperation({ summary: 'Blocked carers for live-in profile' })
  blockedList(@Param('id') serviceUserId: string) {
    return this.service.getBlockedCarers(serviceUserId);
  }

  @Post('blocked-carers')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.live_in_profile.carers.manage')
  @ApiOperation({ summary: 'Add blocked carer' })
  blockedAdd(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: AddBlockedCarerDto,
    @Req() req: Request,
  ) {
    return this.service.addBlockedCarer(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Delete('blocked-carers/:employeeId')
  @AnyPermission('service_users.live_in_profile.carers.manage')
  @ApiOperation({ summary: 'Remove blocked carer' })
  blockedRemove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('employeeId') employeeId: string,
    @Req() req: Request,
  ) {
    return this.service.removeBlockedCarer(user.id, serviceUserId, employeeId, getRequestAuditMeta(req));
  }

  @Patch('status')
  @AnyPermission('service_users.live_in_profile.status.update')
  @ApiOperation({ summary: 'Update live-in profile status (validated transitions)' })
  patchStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: UpdateLiveInProfileStatusDto,
    @Req() req: Request,
  ) {
    return this.service.updateStatus(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Get()
  @AnyPermission('service_users.live_in_profile.read', 'service_users.read')
  @ApiOperation({
    summary: 'Get live-in profile (includes lookups, contact, carers, documents; audit + data access log)',
  })
  get(@CurrentUser() user: RequestUser, @Param('id') serviceUserId: string, @Req() req: Request) {
    return this.service.getByServiceUser(user.id, serviceUserId, getRequestAuditMeta(req));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.live_in_profile.create')
  @ApiOperation({ summary: 'Create live-in profile (or reactivate a soft-deleted one)' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateLiveInProfileDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch()
  @AnyPermission('service_users.live_in_profile.update')
  @ApiOperation({ summary: 'Update live-in profile' })
  patch(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: UpdateLiveInProfileDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Delete()
  @AnyPermission('service_users.live_in_profile.delete')
  @ApiOperation({ summary: 'Soft-delete live-in profile and related carers / contract metadata' })
  remove(@CurrentUser() user: RequestUser, @Param('id') serviceUserId: string, @Req() req: Request) {
    return this.service.softDelete(user.id, serviceUserId, getRequestAuditMeta(req));
  }
}
