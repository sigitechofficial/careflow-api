import {
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
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ensureFormIconUploadDir, FormBuilderService } from './form-builder.service';
import { FormBuilderQueryDto } from './dto/form-builder-query.dto';
import { CreateCareFormDto } from './dto/create-care-form.dto';
import { UpdateCareFormDto } from './dto/update-care-form.dto';
import { SaveCareFormSchemaDto } from './dto/save-care-form-schema.dto';

@ApiTags('Form Builder')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('form-builder')
export class FormBuilderController {
  constructor(private readonly service: FormBuilderService) {}

  @Get()
  @AnyPermission('form_builder.read', 'form_selection.read', 'service_users.read')
  @ApiOperation({ summary: 'List care pathway forms' })
  list(@Query() query: FormBuilderQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @AnyPermission('form_builder.read', 'form_selection.read', 'service_users.read')
  @ApiOperation({ summary: 'Get form with sections and fields' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('form_builder.create')
  @ApiOperation({ summary: 'Create a new draft form' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCareFormDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/schema')
  @Permissions('form_builder.update')
  @ApiOperation({ summary: 'Save form sections and fields' })
  saveSchema(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SaveCareFormSchemaDto,
    @Req() req: Request,
  ) {
    return this.service.saveSchema(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/icon')
  @Permissions('form_builder.update')
  @ApiOperation({ summary: 'Upload form icon image' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, ensureFormIconUploadDir());
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname).toLowerCase()}`);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);
        const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);
        cb(null, allowed.has(file.mimetype) && exts.has(ext));
      },
    }),
  )
  uploadIcon(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.service.uploadIcon(user.id, id, file, getRequestAuditMeta(req));
  }

  @Post(':id/publish')
  @Permissions('form_builder.publish')
  @ApiOperation({ summary: 'Publish form for use in form selection' })
  publish(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.publish(user.id, id, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('form_builder.update')
  @ApiOperation({ summary: 'Update form metadata' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateCareFormDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('form_builder.delete')
  @ApiOperation({ summary: 'Soft-delete a form' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
