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
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { unlink } from 'fs';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getPublicOrigin, getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { InitialAssessmentsService } from './initial-assessments.service';
import { InitialAssessmentQueryDto } from './dto/initial-assessment-query.dto';
import { CreateInitialAssessmentSubmissionDto } from './dto/create-initial-assessment-submission.dto';
import { UpdateInitialAssessmentSubmissionDto } from './dto/update-initial-assessment-submission.dto';
import { SaveInitialAssessmentAnswersDto } from './dto/save-initial-assessment-answers.dto';
import { SubmitInitialAssessmentDto } from './dto/submit-initial-assessment.dto';
import { ReviewInitialAssessmentDto } from './dto/review-initial-assessment.dto';
import { UpdateInitialAssessmentStatusDto } from './dto/update-initial-assessment-status.dto';
import {
  CreateInitialAssessmentActionDto,
  UpdateInitialAssessmentActionDto,
} from './dto/initial-assessment-action.dto';
import {
  CreateInitialAssessmentRiskRecordDto,
  UpdateInitialAssessmentRiskRecordDto,
} from './dto/initial-assessment-risk-record.dto';
import { UploadInitialAssessmentAttachmentDto } from './dto/initial-assessment-attachment.dto';
import { InitialAssessmentCarePlanDecisionDto } from './dto/initial-assessment-care-plan-decision.dto';
import { initialAssessmentUploadMulterOptionsFromRequest } from './initial-assessment-upload.util';
import {
  InitialAssessmentTranscriptionService,
  transcriptionMulterOptions,
} from './initial-assessment-transcription.service';
import { InitialAssessmentAiFillService } from './initial-assessment-ai-fill.service';
import { InitialAssessmentConversationFilesService } from './initial-assessment-conversation-files.service';
import { InitialAssessmentAiFillDto } from './dto/initial-assessment-ai-fill.dto';

@ApiTags('Initial Assessments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/initial-assessments')
export class InitialAssessmentsController {
  constructor(
    private readonly service: InitialAssessmentsService,
    private readonly transcription: InitialAssessmentTranscriptionService,
    private readonly aiFillService: InitialAssessmentAiFillService,
    private readonly conversationFiles: InitialAssessmentConversationFilesService,
  ) {}

  @Get()
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  list(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Query() query: InitialAssessmentQueryDto,
    @Req() req: Request,
  ) {
    return this.service.getSubmissions(user.id, serviceUserId, query, getRequestAuditMeta(req));
  }

  @Get('latest')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  latest(@CurrentUser() user: RequestUser, @Param('id') serviceUserId: string, @Req() req: Request) {
    return this.service.getLatestSubmission(user.id, serviceUserId, getRequestAuditMeta(req));
  }

  @Get('accepted-care-plans')
  @ApiOperation({ summary: 'Care pathway forms accepted via initial assessment for this service user' })
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  acceptedCarePlans(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Req() req: Request,
  ) {
    return this.service.getAcceptedCarePlans(user.id, serviceUserId, getRequestAuditMeta(req));
  }

  @Get('lone-worker-facts')
  @ApiOperation({ summary: 'Staff-safety facts the system already holds (visit plan, SOS, incidents)' })
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  loneWorkerFacts(@Param('id') serviceUserId: string) {
    return this.service.getLoneWorkerSystemFacts(serviceUserId);
  }

  @Get(':submissionId')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  getOne(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.getSubmissionById(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.initial_assessment.create', 'service_users.update')
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateInitialAssessmentSubmissionDto,
    @Req() req: Request,
  ) {
    return this.service.createSubmission(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':submissionId')
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: UpdateInitialAssessmentSubmissionDto,
    @Req() req: Request,
  ) {
    return this.service.updateSubmission(user.id, serviceUserId, submissionId, dto, getRequestAuditMeta(req));
  }

  @Delete(':submissionId')
  @Permissions('service_users.initial_assessment.delete')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.softDeleteSubmission(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Get(':submissionId/answers')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  getAnswers(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.getAnswers(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Post(':submissionId/answers/:questionId/reveal-secure')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  revealSecureField(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Param('questionId') questionId: string,
    @Req() req: Request,
  ) {
    return this.service.revealSecureFieldAnswer(
      user.id,
      serviceUserId,
      submissionId,
      questionId,
      getRequestAuditMeta(req),
    );
  }

  @Patch(':submissionId/answers')
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  saveAnswers(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: SaveInitialAssessmentAnswersDto,
    @Req() req: Request,
  ) {
    return this.service.saveAnswers(user.id, serviceUserId, submissionId, dto, getRequestAuditMeta(req));
  }

  @Post(':submissionId/validate')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.initial_assessment.read', 'service_users.initial_assessment.submit')
  validate(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.validateSubmission(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Patch(':submissionId/submit')
  @Permissions('service_users.initial_assessment.submit')
  submit(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: SubmitInitialAssessmentDto,
    @Req() req: Request,
  ) {
    return this.service.submitAssessment(user.id, serviceUserId, submissionId, dto, getRequestAuditMeta(req));
  }

  @Patch(':submissionId/review')
  @Permissions('service_users.initial_assessment.review')
  review(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: ReviewInitialAssessmentDto,
    @Req() req: Request,
  ) {
    return this.service.reviewAssessment(user.id, serviceUserId, submissionId, dto, getRequestAuditMeta(req));
  }

  @Patch(':submissionId/status')
  @Permissions('service_users.initial_assessment.update')
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: UpdateInitialAssessmentStatusDto,
    @Req() req: Request,
  ) {
    return this.service.updateStatus(user.id, serviceUserId, submissionId, dto, getRequestAuditMeta(req));
  }

  @Get(':submissionId/html')
  @AnyPermission('service_users.initial_assessment.export', 'service_users.initial_assessment.read')
  @ApiOperation({ summary: 'Download initial assessment submission as HTML' })
  async exportHtml(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Query('includeSecureFields') includeSecureFieldsRaw: string | undefined,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const includeSecureFields = includeSecureFieldsRaw === 'true';
    const { html, filename } = await this.service.exportSubmissionHtml(
      user.id,
      serviceUserId,
      submissionId,
      includeSecureFields,
      getRequestAuditMeta(req),
      getPublicOrigin(req),
    );
    res
      .type('text/html; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(html);
  }

  @Get(':submissionId/pdf')
  @AnyPermission('service_users.initial_assessment.export', 'service_users.initial_assessment.read')
  @ApiOperation({ summary: 'Download initial assessment submission as PDF' })
  async exportPdf(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Query('includeSecureFields') includeSecureFieldsRaw: string | undefined,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const includeSecureFields = includeSecureFieldsRaw === 'true';
    const { pdf, filename } = await this.service.exportSubmissionPdf(
      user.id,
      serviceUserId,
      submissionId,
      includeSecureFields,
      getRequestAuditMeta(req),
      getPublicOrigin(req),
    );
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdf);
  }

  @Get(':submissionId/clinical')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  clinical(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.getClinicalSnapshot(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Get(':submissionId/cqc-evidence')
  @AnyPermission('service_users.initial_assessment.export', 'service_users.initial_assessment.read')
  @ApiOperation({ summary: 'CQC evidence bundle (JSON) for inspection' })
  cqcEvidence(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.exportCqcEvidence(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Patch(':submissionId/care-plan-recommendations/:recommendationId')
  @AnyPermission('service_users.initial_assessment.review', 'service_users.initial_assessment.update')
  decideCarePlanRecommendation(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() dto: InitialAssessmentCarePlanDecisionDto,
    @Req() req: Request,
  ) {
    return this.service.decideCarePlanRecommendation(
      user.id,
      serviceUserId,
      submissionId,
      recommendationId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Get(':submissionId/summary')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  summary(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.getSummary(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Get(':submissionId/risk-summary')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  riskSummary(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.getRiskSummary(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Get(':submissionId/care-plan-triggers')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  carePlanTriggers(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.getCarePlanTriggers(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Get(':submissionId/actions')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  listActions(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.listActions(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Post(':submissionId/actions')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  createAction(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: CreateInitialAssessmentActionDto,
    @Req() req: Request,
  ) {
    return this.service.createAction(user.id, serviceUserId, submissionId, dto, getRequestAuditMeta(req));
  }

  @Post(':submissionId/actions/regenerate')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  regenerateActions(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.regenerateActions(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Patch(':submissionId/actions/:actionId')
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  updateAction(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Param('actionId') actionId: string,
    @Body() dto: UpdateInitialAssessmentActionDto,
    @Req() req: Request,
  ) {
    return this.service.updateAction(
      user.id,
      serviceUserId,
      submissionId,
      actionId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Get(':submissionId/risk-records')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  listRiskRecords(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.listRiskRecords(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Post(':submissionId/risk-records')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  createRiskRecord(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: CreateInitialAssessmentRiskRecordDto,
    @Req() req: Request,
  ) {
    return this.service.createRiskRecord(user.id, serviceUserId, submissionId, dto, getRequestAuditMeta(req));
  }

  @Post(':submissionId/risk-records/regenerate')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  regenerateRiskRecords(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.regenerateRiskRecords(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Patch(':submissionId/risk-records/:riskRecordId')
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  updateRiskRecord(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Param('riskRecordId') riskRecordId: string,
    @Body() dto: UpdateInitialAssessmentRiskRecordDto,
    @Req() req: Request,
  ) {
    return this.service.updateRiskRecord(
      user.id,
      serviceUserId,
      submissionId,
      riskRecordId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Get(':submissionId/attachments')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  listAttachments(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.listAttachments(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Post(':submissionId/transcriptions')
  @HttpCode(HttpStatus.ACCEPTED)
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Transcribe a recorded conversation to text (Whisper, on this server)' })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(FileInterceptor('file', transcriptionMulterOptions()))
  async startTranscription(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Audio file is required');
    // The recording is kept on the assessment (and so the service user) before it is transcribed.
    let saved: Awaited<ReturnType<InitialAssessmentConversationFilesService['saveRecording']>>;
    try {
      saved = await this.conversationFiles.saveRecording(user.id, serviceUserId, submissionId, file, getRequestAuditMeta(req));
    } catch (e) {
      unlink(file.path, () => undefined);
      throw e;
    }
    const recording = saved.attachment;
    return this.transcription.start(
      user.id,
      submissionId,
      { path: saved.path, originalName: file.originalname, recordingAttachmentId: recording.id },
      async (text) =>
        (await this.conversationFiles.saveTranscript(user.id, serviceUserId, submissionId, recording, text))?.id ?? null,
    );
  }

  @Get(':submissionId/attachments/:attachmentId/file')
  @AnyPermission('service_users.initial_assessment.read', 'service_users.read')
  @ApiOperation({ summary: 'Download an assessment attachment (recordings and transcripts are only served here)' })
  async attachmentFile(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.conversationFiles.fileFor(user.id, serviceUserId, submissionId, attachmentId, getRequestAuditMeta(req));
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${file.originalName.replace(/["\\\r\n]/g, '_')}"`);
    res.sendFile(file.path);
  }

  @Post(':submissionId/ai-fill')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  @ApiOperation({ summary: 'Suggest answers for the given questions from a conversation transcript (AI)' })
  aiFill(
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: InitialAssessmentAiFillDto,
  ) {
    return this.aiFillService.suggest(serviceUserId, submissionId, dto);
  }

  @Get(':submissionId/transcriptions/:jobId')
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  async getTranscription(
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Param('jobId') jobId: string,
  ) {
    await this.service.assertSubmissionExists(serviceUserId, submissionId);
    return this.transcription.get(submissionId, jobId);
  }

  @Post(':submissionId/attachments')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload assessment attachment (JPEG, PNG, WebP, PDF)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        category: { type: 'string' },
        label: { type: 'string' },
        sectionNumber: { type: 'integer' },
      },
      required: ['file', 'category'],
    },
  })
  @UseInterceptors(FileInterceptor('file', initialAssessmentUploadMulterOptionsFromRequest()))
  uploadAttachment(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: UploadInitialAssessmentAttachmentDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.uploadAttachment(
      user.id,
      serviceUserId,
      submissionId,
      dto,
      file,
      getRequestAuditMeta(req),
    );
  }

  @Delete(':submissionId/attachments/:attachmentId')
  @AnyPermission('service_users.initial_assessment.update', 'service_users.update')
  deleteAttachment(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: Request,
  ) {
    return this.service.deleteAttachment(
      user.id,
      serviceUserId,
      submissionId,
      attachmentId,
      getRequestAuditMeta(req),
    );
  }
}
