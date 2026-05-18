import {
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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { InitialAssessmentsService } from './initial-assessments.service';
import { InitialAssessmentQueryDto } from './dto/initial-assessment-query.dto';
import { CreateInitialAssessmentSubmissionDto } from './dto/create-initial-assessment-submission.dto';
import { UpdateInitialAssessmentSubmissionDto } from './dto/update-initial-assessment-submission.dto';
import { SaveInitialAssessmentAnswersDto } from './dto/save-initial-assessment-answers.dto';
import { SubmitInitialAssessmentDto } from './dto/submit-initial-assessment.dto';
import { ReviewInitialAssessmentDto } from './dto/review-initial-assessment.dto';
import { UpdateInitialAssessmentStatusDto } from './dto/update-initial-assessment-status.dto';

@ApiTags('Initial Assessments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/initial-assessments')
export class InitialAssessmentsController {
  constructor(private readonly service: InitialAssessmentsService) {}

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
}
