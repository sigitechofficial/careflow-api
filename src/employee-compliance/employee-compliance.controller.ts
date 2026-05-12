import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { EmployeeComplianceService } from './employee-compliance.service';
import { CreateEmployeeComplianceDto } from './dto/create-employee-compliance.dto';
import { UpdateEmployeeComplianceDto } from './dto/update-employee-compliance.dto';
import { VerifyEmployeeComplianceDto } from './dto/verify-employee-compliance.dto';
import { RejectEmployeeComplianceDto } from './dto/reject-employee-compliance.dto';
import { NoLongerRequiredEmployeeComplianceDto } from './dto/no-longer-required-employee-compliance.dto';

const UPLOAD_ROOT = join(process.cwd(), 'uploads', 'employees', 'compliance');

function ensureUploadDir() {
  if (!existsSync(UPLOAD_ROOT)) mkdirSync(UPLOAD_ROOT, { recursive: true });
}

@ApiTags('Employee Compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/compliance')
export class EmployeeComplianceController {
  constructor(private readonly service: EmployeeComplianceService) {}

  @Get()
  @Permissions('employees.compliance.read')
  list(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) employeeId: string, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.list(employeeId, { actorUserId: user.id, ...m });
  }

  @Get('required-types')
  @Permissions('employees.compliance.read')
  requiredTypes(@Param('id', ParseUUIDPipe) employeeId: string) {
    return this.service.getRequiredComplianceTypesForEmployee(employeeId);
  }

  @Get(':complianceId/documents/:documentId/download')
  @Permissions('employees.compliance.documents.download')
  @ApiOperation({ summary: 'Download compliance evidence file' })
  async downloadDocument(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Param('complianceId', ParseUUIDPipe) complianceId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const m = getRequestAuditMeta(req);
    return this.service.downloadDocument(user.id, employeeId, complianceId, documentId, res, m);
  }

  @Delete(':complianceId/documents/:documentId')
  @Permissions('employees.compliance.documents.delete')
  removeDocument(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Param('complianceId', ParseUUIDPipe) complianceId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
  ) {
    return this.service.removeDocument(user.id, employeeId, complianceId, documentId, getRequestAuditMeta(req));
  }

  @Post(':complianceId/documents')
  @Permissions('employees.compliance.documents.upload')
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
      limits: {
        fileSize: Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? 10_485_760),
      },
      fileFilter: (_req, file, cb) => {
        const allowed = new Set([
          'application/pdf',
          'image/jpeg',
          'image/jpg',
          'image/png',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ]);
        cb(null, allowed.has(file.mimetype));
      },
    }),
  )
  uploadDocument(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Param('complianceId', ParseUUIDPipe) complianceId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    const fileUrl = `/uploads/employees/compliance/${file.filename}`;
    return this.service.addDocument(user.id, employeeId, complianceId, file, fileUrl, getRequestAuditMeta(req));
  }

  @Patch(':complianceId/verify')
  @Permissions('employees.compliance.verify')
  verify(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Param('complianceId', ParseUUIDPipe) complianceId: string,
    @Body() dto: VerifyEmployeeComplianceDto,
    @Req() req: Request,
  ) {
    return this.service.verify(user.id, employeeId, complianceId, dto.notes, getRequestAuditMeta(req));
  }

  @Patch(':complianceId/reject')
  @Permissions('employees.compliance.reject')
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Param('complianceId', ParseUUIDPipe) complianceId: string,
    @Body() dto: RejectEmployeeComplianceDto,
    @Req() req: Request,
  ) {
    return this.service.reject(user.id, employeeId, complianceId, dto.rejectionReason, getRequestAuditMeta(req));
  }

  @Patch(':complianceId/no-longer-required')
  @Permissions('employees.compliance.update')
  noLongerRequired(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Param('complianceId', ParseUUIDPipe) complianceId: string,
    @Body() dto: NoLongerRequiredEmployeeComplianceDto,
    @Req() req: Request,
  ) {
    return this.service.markNoLongerRequired(user.id, employeeId, complianceId, dto.reason, getRequestAuditMeta(req));
  }

  @Get(':complianceId')
  @Permissions('employees.compliance.read')
  getOne(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Param('complianceId', ParseUUIDPipe) complianceId: string,
    @Req() req: Request,
  ) {
    const m = getRequestAuditMeta(req);
    return this.service.getOne(employeeId, complianceId, { actorUserId: user.id, ...m });
  }

  @Post()
  @Permissions('employees.compliance.create')
  create(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Body() dto: CreateEmployeeComplianceDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Patch(':complianceId')
  @Permissions('employees.compliance.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Param('complianceId', ParseUUIDPipe) complianceId: string,
    @Body() dto: UpdateEmployeeComplianceDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, employeeId, complianceId, dto, getRequestAuditMeta(req));
  }

  @Delete(':complianceId')
  @Permissions('employees.compliance.delete')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) employeeId: string,
    @Param('complianceId', ParseUUIDPipe) complianceId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, employeeId, complianceId, getRequestAuditMeta(req));
  }
}
