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
  Query,
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
import { ServiceUserDomCareService } from './service-user-dom-care.service';
import { PatchServiceUserDomCareDto } from './dto/patch-service-user-dom-care.dto';
import { DomCareEmployeeSearchQueryDto } from './dto/dom-care-employee-search-query.dto';

function domContractUploadRoot() {
  return join(process.cwd(), process.env.UPLOAD_BASE_PATH ?? 'uploads', 'service-users', 'dom-care', 'contracts');
}

function domMaxBytes() {
  const explicit = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 0);
  if (explicit > 0) return explicit;
  const mb = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? 10);
  return (Number.isFinite(mb) ? mb : 10) * 1024 * 1024;
}

function ensureDomContractDir() {
  const root = domContractUploadRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function domContractFileFilter(_req: unknown, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  if (!allowed.has(file.mimetype)) {
    cb(new BadRequestException('Invalid file type. Allowed: JPEG, PNG, WebP, PDF.'), false);
    return;
  }
  cb(null, true);
}

function domContractMulterOptions() {
  return {
    storage: diskStorage({
      destination: (_req: unknown, _file: Express.Multer.File, cb: (e: Error | null, dest: string) => void) => {
        cb(null, ensureDomContractDir());
      },
      filename: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, name: string) => void) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `dom-contract-${unique}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: domMaxBytes() },
    fileFilter: domContractFileFilter,
  };
}

@ApiTags('Service User DOM Care')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/dom-care')
export class ServiceUserDomCareController {
  constructor(private readonly service: ServiceUserDomCareService) {}

  @Get()
  @AnyPermission('service_users.dom_care.read', 'service_users.read')
  @ApiOperation({ summary: 'Domiciliary care profile for a service user' })
  get(@Param('id') serviceUserId: string) {
    return this.service.get(serviceUserId);
  }

  @Get('employee-search')
  @AnyPermission('service_users.dom_care.read', 'service_users.read')
  @ApiOperation({ summary: 'Search active employees for preferred / blocked carers (DOM care)' })
  searchEmployees(
    @Param('id') serviceUserId: string,
    @Query() query: DomCareEmployeeSearchQueryDto,
  ) {
    return this.service.searchEmployeesForDomCare(serviceUserId, query.search, query.limit);
  }

  @Patch()
  @AnyPermission('service_users.dom_care.update', 'service_users.update')
  @ApiOperation({ summary: 'Update DOM care access, instructions, preferences' })
  patch(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: PatchServiceUserDomCareDto,
    @Req() req: Request,
  ) {
    return this.service.patch(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Post('contract')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.dom_care.update', 'service_users.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload contract document (JPEG, PNG, WebP, PDF)' })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiResponse({ status: 201 })
  @UseInterceptors(FileInterceptor('file', domContractMulterOptions()))
  uploadContract(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadContract(user.id, serviceUserId, file, getRequestAuditMeta(req));
  }
}
