import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CqcEvidenceService } from './cqc-evidence.service';
import { CqcFrameworkService } from './cqc-framework.service';
import { CqcSurveyEvidenceService } from './cqc-survey-evidence.service';
import { cqcEvidenceMulterOptions } from './cqc-evidence-upload.util';
import {
  CaptureSurveyEvidenceDto,
  CreateCqcEvidenceDto,
  ExportCqcEvidenceQueryDto,
  ListCqcEvidenceQueryDto,
  OverviewQueryDto,
  UpdateCqcEvidenceDto,
} from './dto/cqc-evidence.dto';

/**
 * Quality & compliance → CQC evidence. Read: cqc_evidence.read; add, edit, archive, attach and
 * add surveys: cqc_evidence.manage; PDF / CSV packs: cqc_evidence.export.
 */
@ApiTags('CQC evidence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cqc-evidence')
export class CqcEvidenceController {
  constructor(
    private readonly evidence: CqcEvidenceService,
    private readonly framework: CqcFrameworkService,
    private readonly surveys: CqcSurveyEvidenceService,
  ) {}

  @Get('framework')
  @Permissions('cqc_evidence.read')
  @ApiOperation({ summary: 'The active CQC framework: key questions, quality statements, evidence categories' })
  getFramework() {
    return this.framework.describe();
  }

  @Get('overview')
  @Permissions('cqc_evidence.read')
  @ApiOperation({ summary: 'Evidence by key question and quality statement, with gaps' })
  overview(@CurrentUser() user: RequestUser, @Query() query: OverviewQueryDto) {
    return this.evidence.overview(user, query);
  }

  @Get('export')
  @Permissions('cqc_evidence.export')
  @ApiOperation({ summary: 'Export current evidence (one statement or all) as PDF or CSV' })
  async export(
    @CurrentUser() user: RequestUser,
    @Query() query: ExportCqcEvidenceQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.evidence.export(user, query, getRequestAuditMeta(req));
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', file.disposition);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.buffer);
  }

  @Get('surveys/:surveyId')
  @Permissions('cqc_evidence.manage')
  @ApiOperation({ summary: 'Quality statements a survey evidences, and evidence already kept from it' })
  forSurvey(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.surveys.forSurvey(user, surveyId);
  }

  @Post('surveys/:surveyId/capture')
  @Permissions('cqc_evidence.manage')
  @ApiOperation({ summary: 'Add a closed survey (or every closed period of a repeating survey) to CQC evidence' })
  captureSurvey(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Body() dto: CaptureSurveyEvidenceDto,
    @Req() req: Request,
  ) {
    return this.surveys.captureForUser(user, surveyId, dto, getRequestAuditMeta(req));
  }

  @Get()
  @Permissions('cqc_evidence.read')
  @ApiOperation({ summary: 'List evidence (filters: statement, key question, status, source, category, branch, dates)' })
  list(@CurrentUser() user: RequestUser, @Query() query: ListCqcEvidenceQueryDto) {
    return this.evidence.list(user, query);
  }

  @Post()
  @Permissions('cqc_evidence.manage')
  @ApiOperation({ summary: 'Add evidence by hand (a note, with files attached afterwards)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCqcEvidenceDto, @Req() req: Request) {
    return this.evidence.create(user, dto, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('cqc_evidence.read')
  @ApiOperation({ summary: 'One piece of evidence' })
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.evidence.get(user, id);
  }

  @Patch(':id')
  @Permissions('cqc_evidence.manage')
  @ApiOperation({ summary: 'Edit evidence, its "You said, we did" actions, or its status (current / superseded / archived)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCqcEvidenceDto,
    @Req() req: Request,
  ) {
    return this.evidence.update(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/attachments')
  @Permissions('cqc_evidence.manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Attach a file (PDF, Word, Excel, PNG or JPEG, up to 25 MB)' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), ...cqcEvidenceMulterOptions() }))
  addAttachment(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return this.evidence.addAttachment(user, id, file, getRequestAuditMeta(req));
  }

  @Get(':id/attachments/:attachmentId')
  @Permissions('cqc_evidence.read')
  @ApiOperation({ summary: 'Download an attached file' })
  async downloadAttachment(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ) {
    const file = await this.evidence.readAttachment(user, id, attachmentId, disposition === 'inline');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', file.disposition);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.buffer);
  }

  @Delete(':id/attachments/:attachmentId')
  @Permissions('cqc_evidence.manage')
  @ApiOperation({ summary: 'Remove an attached file from the evidence' })
  removeAttachment(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Req() req: Request,
  ) {
    return this.evidence.removeAttachment(user, id, attachmentId, getRequestAuditMeta(req));
  }
}
