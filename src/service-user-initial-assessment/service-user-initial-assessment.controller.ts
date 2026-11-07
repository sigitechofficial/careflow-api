import {
  BadRequestException,
  Body,
  Controller,
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
import { ServiceUserInitialAssessmentService } from './service-user-initial-assessment.service';
import { PatchServiceUserInitialAssessmentDto } from './dto/patch-service-user-initial-assessment.dto';
import { uploadPath } from '../common/utils/upload-path.util';

function pictureUploadRoot() {
  return uploadPath('service-users', 'initial-assessment', 'pictures');
}

function pictureMaxBytes() {
  const explicit = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 0);
  if (explicit > 0) return explicit;
  const mb = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? 10);
  return (Number.isFinite(mb) ? mb : 10) * 1024 * 1024;
}

function ensurePictureDir() {
  const root = pictureUploadRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function pictureFileFilter(_req: unknown, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(file.mimetype)) {
    cb(new BadRequestException('Invalid file type. Allowed: JPEG, PNG, WebP.'), false);
    return;
  }
  cb(null, true);
}

function pictureMulterOptions() {
  return {
    storage: diskStorage({
      destination: (_req: unknown, _file: Express.Multer.File, cb: (e: Error | null, dest: string) => void) => {
        cb(null, ensurePictureDir());
      },
      filename: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, name: string) => void) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `initial-assessment-${unique}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: pictureMaxBytes() },
    fileFilter: pictureFileFilter,
  };
}

@ApiTags('Service User Initial Assessment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/initial-assessment')
export class ServiceUserInitialAssessmentController {
  constructor(private readonly service: ServiceUserInitialAssessmentService) {}

  @Get()
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  @ApiOperation({ summary: 'Initial assessment for a service user' })
  get(@Param('id') serviceUserId: string) {
    return this.service.get(serviceUserId);
  }

  @Patch()
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  @ApiOperation({ summary: 'Update initial assessment' })
  patch(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: PatchServiceUserInitialAssessmentDto,
    @Req() req: Request,
  ) {
    return this.service.patch(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Post('picture')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload assessment picture (JPEG, PNG, WebP)' })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiResponse({ status: 201 })
  @UseInterceptors(FileInterceptor('file', pictureMulterOptions()))
  uploadPicture(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadPicture(user.id, serviceUserId, file, getRequestAuditMeta(req));
  }
}
