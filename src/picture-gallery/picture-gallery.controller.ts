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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PictureGalleryService } from './picture-gallery.service';
import { PictureGalleryQueryDto } from './dto/picture-gallery-query.dto';
import { UploadCarePictureDto } from './dto/upload-care-picture.dto';
import { UpdateCarePictureDto } from './dto/update-care-picture.dto';
import { uploadPath } from '../common/utils/upload-path.util';

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function pictureUploadRoot() {
    return uploadPath('care-pathway', 'pictures');
}

function pictureMaxBytes() {
  const explicit = Number(process.env.CARE_PICTURE_MAX_BYTES ?? 0);
  if (explicit > 0) return explicit;
  return 5 * 1024 * 1024;
}

function ensurePictureDir() {
  const root = pictureUploadRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function pictureMulterOptions() {
  return {
    storage: diskStorage({
      destination: (_req: Request, _file: Express.Multer.File, cb) => {
        cb(null, ensurePictureDir());
      },
      filename: (_req: Request, file: Express.Multer.File, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${extname(file.originalname).toLowerCase()}`);
      },
    }),
    limits: { fileSize: pictureMaxBytes() },
    fileFilter: (
      _req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      const ext = extname(file.originalname).toLowerCase();
      cb(null, ALLOWED_MIMES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext));
    },
  };
}

@ApiTags('Picture Gallery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('picture-gallery')
export class PictureGalleryController {
  constructor(private readonly service: PictureGalleryService) {}

  @Get('standard')
  @Permissions('picture_gallery.read')
  @ApiOperation({ summary: 'List standard care pictures' })
  listStandard(@Query() query: PictureGalleryQueryDto) {
    return this.service.listStandard(query);
  }

  @Get('uploaded')
  @Permissions('picture_gallery.read')
  @ApiOperation({ summary: 'List uploaded care pictures' })
  listUploaded(@Query() query: PictureGalleryQueryDto) {
    return this.service.listUploaded(query);
  }

  @Get('search')
  @Permissions('picture_gallery.read')
  @ApiOperation({ summary: 'Search care pictures by name' })
  search(
    @CurrentUser() user: RequestUser,
    @Query() query: PictureGalleryQueryDto,
    @Req() req: Request,
  ) {
    return this.service.search(user.id, query, getRequestAuditMeta(req));
  }

  @Post('uploaded')
  @Permissions('picture_gallery.upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a care picture (JPG, JPEG, PNG, WebP)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
        category: { type: 'string' },
      },
      required: ['file', 'name'],
    },
  })
  @UseInterceptors(FileInterceptor('file', pictureMulterOptions()))
  upload(
    @CurrentUser() user: RequestUser,
    @Body() dto: UploadCarePictureDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.upload(user.id, dto, file, getRequestAuditMeta(req));
  }

  @Patch('uploaded/:id')
  @Permissions('picture_gallery.update')
  @ApiOperation({ summary: 'Update uploaded care picture metadata' })
  updateUploaded(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateCarePictureDto,
    @Req() req: Request,
  ) {
    return this.service.updateUploaded(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete('uploaded/:id')
  @Permissions('picture_gallery.delete')
  @ApiOperation({ summary: 'Soft delete uploaded care picture' })
  removeUploaded(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.removeUploaded(user.id, id, getRequestAuditMeta(req));
  }
}
