import {
  Controller,
  Delete,
  Get,
  Param,
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
import type { Request } from 'express';
import { existsSync, mkdirSync } from 'fs';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreateHrDocumentDto } from './dto/create-hr-document.dto';
import { HrDocumentsService } from './hr-documents.service';

const UPLOAD_ROOT = join(process.cwd(), 'uploads', 'employees', 'hr-documents');

function ensureUploadDir() {
  if (!existsSync(UPLOAD_ROOT)) mkdirSync(UPLOAD_ROOT, { recursive: true });
}

@ApiTags('HR Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/employees/:employeeId/documents')
export class HrEmployeeDocumentsController {
  constructor(private readonly service: HrDocumentsService) {}

  @Get()
  @Permissions('hr.read')
  list(@Param('employeeId') employeeId: string) {
    return this.service.list(employeeId);
  }

  @Post()
  @Permissions('hr.documents.upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          ensureUploadDir();
          cb(null, UPLOAD_ROOT);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'application/pdf',
          'image/jpeg',
          'image/png',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        cb(null, allowed.includes(file.mimetype));
      },
    }),
  )
  upload(
    @CurrentUser() user: RequestUser,
    @Param('employeeId') employeeId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const body = req.body as Record<string, string | undefined>;
    const dto: CreateHrDocumentDto = {
      documentType: body.documentType as CreateHrDocumentDto['documentType'],
      name: body.name,
      expiryDate: body.expiryDate ? new Date(body.expiryDate) : undefined,
      status: body.status as CreateHrDocumentDto['status'],
    };
    const fileUrl = `/uploads/employees/hr-documents/${file.filename}`;
    return this.service.create({
      userId: user.id,
      employeeId,
      dto,
      file,
      fileUrl,
      meta: getRequestAuditMeta(req),
    });
  }
}

@ApiTags('HR Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/documents')
export class HrDocumentsController {
  constructor(private readonly service: HrDocumentsService) {}

  @Delete(':id')
  @Permissions('hr.documents.delete')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }
}
