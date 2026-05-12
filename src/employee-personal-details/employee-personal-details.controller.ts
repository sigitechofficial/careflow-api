import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
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
import { EmployeePersonalDetailsService } from './employee-personal-details.service';
import { UpdateEmployeePersonalDetailsDto } from './dto/update-employee-personal-details.dto';

const PHOTO_UPLOAD_ROOT = join(process.cwd(), 'uploads', 'employees', 'photos');

function ensurePhotoUploadDir() {
  if (!existsSync(PHOTO_UPLOAD_ROOT)) mkdirSync(PHOTO_UPLOAD_ROOT, { recursive: true });
}

@ApiTags('Employee Personal Details')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/personal-details')
export class EmployeePersonalDetailsController {
  constructor(private readonly service: EmployeePersonalDetailsService) {}

  @Get()
  @Permissions('employees.read')
  get(@CurrentUser() user: RequestUser, @Param('id') employeeId: string, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.get(employeeId, { actorUserId: user.id, ...m });
  }

  @Patch()
  @Permissions('employees.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Body() dto: UpdateEmployeePersonalDetailsDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Post('photo')
  @Permissions('employees.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          ensurePhotoUploadDir();
          cb(null, PHOTO_UPLOAD_ROOT);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = extname(file.originalname).toLowerCase();
          const safe = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
          cb(null, `${unique}${safe}`);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
        cb(null, allowed.has(file.mimetype));
      },
    }),
  )
  uploadPhoto(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Choose a JPEG, PNG, WebP, or GIF image (max 2 MB).');
    }
    return this.service.uploadPhoto(user.id, employeeId, file, getRequestAuditMeta(req));
  }
}
