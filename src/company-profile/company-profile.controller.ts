import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname } from 'path';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Public } from '../common/decorators/public.decorator';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { CompanyProfileService } from './company-profile.service';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';

function maxBytes() {
  const explicit = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 0);
  if (explicit > 0) return explicit;
  const mb = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? 10);
  return (Number.isFinite(mb) ? mb : 10) * 1024 * 1024;
}

function ensureDir() {
  const root = CompanyProfileService.uploadDirectory();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

const imageUpload = FileInterceptor('file', {
  storage: diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureDir()),
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: maxBytes() },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  },
});

@ApiTags('Company Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('settings/company')
export class CompanyProfileController {
  constructor(private readonly service: CompanyProfileService) {}

  @Get('branding')
  @Public()
  @ApiOperation({ summary: 'Public organisation branding (login shell)' })
  getBranding() {
    return this.service.getBranding();
  }

  @Get()
  @AnyPermission('settings.company.read', 'lookups.read')
  @ApiOperation({ summary: 'Get company profile (singleton)' })
  get() {
    return this.service.get();
  }

  @Patch()
  @AnyPermission('settings.company.update', 'lookups.manage')
  @ApiOperation({ summary: 'Update company profile' })
  update(@CurrentUser() user: RequestUser, @Body() dto: UpdateCompanyProfileDto) {
    return this.service.update(user.id, dto);
  }

  @Post('display-logo')
  @AnyPermission('settings.company.update', 'lookups.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(imageUpload)
  uploadDisplayLogo(@CurrentUser() user: RequestUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadDisplayLogo(user.id, file);
  }

  @Delete('display-logo')
  @AnyPermission('settings.company.update', 'lookups.manage')
  @ApiOperation({ summary: 'Remove display logo' })
  clearDisplayLogo(@CurrentUser() user: RequestUser) {
    return this.service.clearDisplayLogo(user.id);
  }

  @Post('company-logo')
  @AnyPermission('settings.company.update', 'lookups.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(imageUpload)
  uploadCompanyLogo(@CurrentUser() user: RequestUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadCompanyLogo(user.id, file);
  }
}
