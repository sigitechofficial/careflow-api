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
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserInventoryService } from './service-user-inventory.service';
import { CreateServiceUserInventoryItemDto } from './dto/create-service-user-inventory-item.dto';
import { UpdateServiceUserInventoryItemDto } from './dto/update-service-user-inventory-item.dto';

function photoUploadRoot() {
  return join(process.cwd(), process.env.UPLOAD_BASE_PATH ?? 'uploads', 'service-users', 'inventory', 'photos');
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

@ApiTags('Service User Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/inventory')
export class ServiceUserInventoryController {
  constructor(private readonly service: ServiceUserInventoryService) {}

  @Get()
  @AnyPermission('service_users.inventory.read', 'service_users.read')
  @ApiOperation({ summary: 'List personal inventory items' })
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.inventory.create', 'service_users.update')
  @ApiOperation({ summary: 'Add inventory item' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateServiceUserInventoryItemDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':itemId')
  @AnyPermission('service_users.inventory.update', 'service_users.update')
  @ApiOperation({ summary: 'Update inventory item' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateServiceUserInventoryItemDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, itemId, dto, getRequestAuditMeta(req));
  }

  @Delete(':itemId')
  @AnyPermission('service_users.inventory.delete', 'service_users.delete')
  @ApiOperation({ summary: 'Remove inventory item' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, itemId, getRequestAuditMeta(req));
  }

  @Post(':itemId/photo')
  @AnyPermission('service_users.inventory.update', 'service_users.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload item photo (JPEG, PNG, WebP)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
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
  uploadPhoto(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadItemPhoto(user.id, serviceUserId, itemId, file, getRequestAuditMeta(req));
  }
}
