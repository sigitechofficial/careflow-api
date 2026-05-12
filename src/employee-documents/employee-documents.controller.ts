import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import type { Request, Response } from 'express';
import { existsSync, mkdirSync } from 'fs';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CreateEmployeeDocumentDto } from './dto/create-employee-document.dto';
import { UpdateEmployeeDocumentDto } from './dto/update-employee-document.dto';
import { EmployeeDocumentsService } from './employee-documents.service';

const UPLOAD_ROOT = join(process.cwd(), 'uploads', 'employees', 'documents');

function ensureUploadDir() {
  if (!existsSync(UPLOAD_ROOT)) mkdirSync(UPLOAD_ROOT, { recursive: true });
}

@ApiTags('Employee Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/documents')
export class EmployeeDocumentsController {
  constructor(private readonly service: EmployeeDocumentsService) {}

  @Get()
  @Permissions('employees.documents.read')
  list(@Param('id') employeeId: string) {
    return this.service.list(employeeId);
  }

  @Post()
  @Permissions('employees.documents.upload')
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
    @Param('id') employeeId: string,
    @Body() dto: CreateEmployeeDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const fileUrl = `/uploads/employees/documents/${file.filename}`;
    const meta = getRequestAuditMeta(req);
    return this.service.create({
      userId: user.id,
      employeeId,
      dto,
      file,
      fileUrl,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  @Patch(':documentId')
  @Permissions('employees.documents.upload')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('documentId') documentId: string,
    @Body() dto: UpdateEmployeeDocumentDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, employeeId, documentId, dto, getRequestAuditMeta(req));
  }

  @Get(':documentId/download')
  @Permissions('employees.documents.read')
  async download(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('documentId') documentId: string,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const doc = await this.service.getDocumentForDownload(
      user.id,
      employeeId,
      documentId,
      getRequestAuditMeta(req),
    );
    const filePath = join(UPLOAD_ROOT, doc.fileName);
    return res.download(filePath, doc.name);
  }

  @Delete(':documentId')
  @Permissions('employees.documents.delete')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('documentId') documentId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, employeeId, documentId, getRequestAuditMeta(req));
  }
}
