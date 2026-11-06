import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  AnyPermission,
  Permissions,
} from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveysService } from './surveys.service';
import { SurveyLibraryService } from './survey-library.service';
import { QuestionBankQueryDto } from './dto/question-bank-query.dto';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';
import { DuplicateSurveyDto } from './dto/duplicate-survey.dto';
import {
  CreateSurveyQuestionDto,
  MoveSurveyQuestionDto,
  UpdateSurveyQuestionDto,
} from './dto/survey-question.dto';
import { SendSurveyDto } from './dto/send-survey.dto';
import { ListSurveysQueryDto } from './dto/list-surveys-query.dto';
import { ReopenSurveyDto } from './dto/reopen-survey.dto';
import {
  RecordSurveyResponseDto,
  UpdateRecordedSurveyResponseDto,
} from './dto/record-survey-response.dto';

/** Admin survey endpoints. Every one is limited to the user's branches (OrgScopeService). */
@ApiTags('Surveys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys')
export class SurveysController {
  constructor(
    private readonly service: SurveysService,
    private readonly library: SurveyLibraryService,
  ) {}

  @Get()
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'List surveys' })
  list(@CurrentUser() user: RequestUser, @Query() query: ListSurveysQueryDto) {
    return this.service.list(user, query);
  }

  // Before ':id', so "question-bank" is not read as a survey id.
  @Get('question-bank')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({
    summary: 'Question bank: the ready-made library questions, each once, with the surveys they come from (no "Show only if" rules)',
  })
  questionBank(@Query() query: QuestionBankQueryDto) {
    return this.library.questionBank(query);
  }

  @Get(':id')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Get a survey with its questions' })
  getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getById(user, id);
  }

  @Get(':id/results')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Response rate, per-question summary, periods and group breakdowns' })
  results(@CurrentUser() user: RequestUser, @Param('id') id: string, @Query('respondentGroup') respondentGroup?: string) {
    return this.service.results(user, id, { respondentGroup: typeof respondentGroup === 'string' ? respondentGroup.slice(0, 200) : undefined });
  }

  @Get(':id/responses')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'List submitted survey responses with answers' })
  listResponses(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listResponses(user, id);
  }

  @Get(':id/record-candidates')
  @Permissions('surveys.responses.record')
  @ApiOperation({ summary: 'People a response can be recorded for (survey target, your branches)' })
  recordCandidates(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query('search') search?: string,
  ) {
    return this.service.listRecordCandidates(user, id, search);
  }

  @Get(':id/former-staff')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: "Leavers' surveys: staff who left in the last 3 months, to choose by name (sent to their personal email)" })
  formerStaff(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Query('search') search?: string) {
    return this.service.listFormerStaff(user, id, search);
  }

  @Get(':id/send-candidates')
  @Permissions('surveys.manage')
  @ApiOperation({
    summary:
      'People we support who can be chosen for a send (your branches), with portal status; ids=a,b looks up saved choices',
  })
  sendCandidates(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query('search') search?: string,
    @Query('ids') ids?: string,
  ) {
    const idList = ids === undefined ? undefined : ids.split(',').map((s) => s.trim()).filter(Boolean);
    return this.service.listSendCandidates(user, id, search, idList);
  }

  @Post(':id/responses/record')
  @Permissions('surveys.responses.record')
  @ApiOperation({ summary: 'Record a response by telephone, paper or in person' })
  recordResponse(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: RecordSurveyResponseDto,
    @Req() req: Request,
  ) {
    return this.service.recordResponse(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/responses/:responseId')
  @Permissions('surveys.responses.record')
  @ApiOperation({ summary: 'Correct a staff-recorded response (reason required)' })
  updateRecordedResponse(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('responseId') responseId: string,
    @Body() dto: UpdateRecordedSurveyResponseDto,
    @Req() req: Request,
  ) {
    return this.service.updateRecordedResponse(user, id, responseId, dto, getRequestAuditMeta(req));
  }

  @Get(':id/recipients')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({
    summary: 'Recipients and completion (status counts only for anonymous surveys; never link tokens)',
  })
  listRecipients(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listRecipients(user, id);
  }

  @Post()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Create a survey or template' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateSurveyDto, @Req() req: Request) {
    return this.service.create(user, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Update survey details (not status or schedule)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateSurveyDto,
    @Req() req: Request,
  ) {
    return this.service.update(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/duplicate')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Duplicate a survey, or start a survey from a template' })
  duplicate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DuplicateSurveyDto,
    @Req() req: Request,
  ) {
    return this.service.duplicate(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/save-as-template')
  @Permissions('surveys.manage')
  @ApiOperation({
    summary: 'Save as template (a template copy when the survey has been sent, answered or scheduled)',
  })
  saveAsTemplate(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.saveAsTemplate(user, id, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Soft-delete a survey' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/questions')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Add a question to a survey' })
  addQuestion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateSurveyQuestionDto,
    @Req() req: Request,
  ) {
    return this.service.addQuestion(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/questions/:questionId')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Update a survey question (help text only once answered)' })
  updateQuestion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: UpdateSurveyQuestionDto,
    @Req() req: Request,
  ) {
    return this.service.updateQuestion(user, id, questionId, dto, getRequestAuditMeta(req));
  }

  @Post(':id/questions/:questionId/move')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Move a question one place up or down ("Show only if" rules permitting)' })
  moveQuestion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: MoveSurveyQuestionDto,
    @Req() req: Request,
  ) {
    return this.service.moveQuestion(user, id, questionId, dto.direction, getRequestAuditMeta(req));
  }

  @Post(':id/questions/:questionId/copy')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Copy a question straight after it (new key; nothing depends on the copy)' })
  copyQuestion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Req() req: Request,
  ) {
    return this.service.copyQuestion(user, id, questionId, getRequestAuditMeta(req));
  }

  @Delete(':id/questions/:questionId')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Remove a survey question (not once it has answers)' })
  removeQuestion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Req() req: Request,
  ) {
    return this.service.removeQuestion(user, id, questionId, getRequestAuditMeta(req));
  }

  @Post(':id/send')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Send now, schedule, or start a repeating survey' })
  send(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SendSurveyDto,
    @Req() req: Request,
  ) {
    return this.service.send(user, id, dto, getRequestAuditMeta(req), req.headers.origin);
  }

  @Post(':id/send/check')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Before sending: who the 4-week rule holds back and who sampling leaves out' })
  checkSend(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SendSurveyDto) {
    return this.service.checkSend(user, id, dto);
  }

  @Post(':id/schedule/cancel')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Cancel a scheduled or repeating distribution' })
  cancelSchedule(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.cancelSchedule(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/publish')
  @Permissions('surveys.manage')
  @ApiOperation({
    summary: 'Publish a public survey and enable its shareable link (also reopens; a passed end date must be replaced or removed)',
  })
  publish(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReopenSurveyDto,
    @Req() req: Request,
  ) {
    return this.service.publish(user, id, getRequestAuditMeta(req), dto);
  }

  @Post(':id/open')
  @Permissions('surveys.manage')
  @ApiOperation({
    summary:
      'Open for responses without sending (record phone / visit / paper answers); also reopens. A passed end date must be replaced or removed (closesAt).',
  })
  open(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReopenSurveyDto,
    @Req() req: Request,
  ) {
    return this.service.openForResponses(user, id, getRequestAuditMeta(req), dto);
  }

  @Post(':id/close')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Close a survey (no new answers; cancels any schedule)' })
  close(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.close(user, id, getRequestAuditMeta(req));
  }
}
