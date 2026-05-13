import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserPhotosService } from './service-user-photos.service';
import { UploadServiceUserPhotoDto } from './dto/upload-service-user-photo.dto';

function photoUploadRoot() {
  return join(process.cwd(), process.env.UPLOAD_BASE_PATH ?? 'uploads', 'service-users', 'photos');
}

function photoMaxBytes() {
  const explicit = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 0);
  if (explicit > 0) return explicit;
  const mb = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? 10);
  return (Number.isFinite(mb) ? mb : 10) * 1024 * 1024;
}

function ensurePhotoDir() {
  const root = photoUploadRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

@ApiTags('Service User Photos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/photo')
export class ServiceUserPhotosController {
  constructor(private readonly service: ServiceUserPhotosService) {}

  @Post()
  @Permissions('service_users.photos.upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload profile photo (JPEG, PNG, WebP)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        caption: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201 })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, ensurePhotoDir());
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: photoMaxBytes() },
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        cb(null, allowed.includes(file.mimetype));
      },
    }),
  )
  upload(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() _dto: UploadServiceUserPhotoDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadProfile(user.id, serviceUserId, file, getRequestAuditMeta(req));
  }

  @Delete()
  @Permissions('service_users.photos.delete')
  @ApiOperation({ summary: 'Remove profile photo' })
  remove(@CurrentUser() user: RequestUser, @Param('id') serviceUserId: string, @Req() req: Request) {
    return this.service.deleteProfile(user.id, serviceUserId, getRequestAuditMeta(req));
  }
}
