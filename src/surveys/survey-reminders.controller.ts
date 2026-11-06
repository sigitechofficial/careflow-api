import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveyRemindersService } from './survey-reminders.service';
import { SurveysService } from './surveys.service';
import { RecordSurveyCallDto, SaveSurveyContactPlanDto, SetSurveyOptOutsDto, SurveyOptOutQueryDto } from './dto/survey-reminders.dto';

/** Reminders and follow-up (contact plan), "Remind now", and the phone call list. */
@ApiTags('Survey reminders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId')
export class SurveyRemindersController {
  constructor(
    private readonly reminders: SurveyRemindersService,
    private readonly surveys: SurveysService,
  ) {}

  @Get('contact-plan')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'This survey’s reminders and follow-up, and past reminder runs' })
  getPlan(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.reminders.getPlan(user, surveyId);
  }

  @Put('contact-plan')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Save (or turn off) reminders and follow-up' })
  savePlan(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SaveSurveyContactPlanDto, @Req() req: Request) {
    return this.reminders.savePlan(user, surveyId, dto.plan ?? null, getRequestAuditMeta(req));
  }

  @Post('reminders')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Remind everyone who has not answered now' })
  remindNow(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Req() req: Request) {
    return this.reminders.remindNow(user, surveyId, getRequestAuditMeta(req));
  }

  @Post('recipients/:recipientId/reminder')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Remind one person who has not answered a named survey' })
  remindOne(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('recipientId', ParseUUIDPipe) recipientId: string,
    @Req() req: Request,
  ) {
    return this.reminders.remindOne(user, surveyId, recipientId, getRequestAuditMeta(req));
  }

  @Post('recipients/:recipientId/resend')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Send a lapsed invitation again (named surveys, once the person can be sent it again)' })
  resend(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('recipientId', ParseUUIDPipe) recipientId: string,
    @Req() req: Request,
  ) {
    return this.surveys.resendLapsed(user, surveyId, recipientId, getRequestAuditMeta(req), req.headers.origin);
  }

  @Get('calls')
  @Permissions('surveys.responses.record')
  @ApiOperation({ summary: 'Call list: people who have not answered a named survey' })
  callList(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.reminders.callList(user, surveyId);
  }

  @Post('calls/:recipientId')
  @Permissions('surveys.responses.record')
  @ApiOperation({ summary: 'Record a call to someone who has not answered' })
  recordCall(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('recipientId', ParseUUIDPipe) recipientId: string,
    @Body() dto: RecordSurveyCallDto,
    @Req() req: Request,
  ) {
    return this.reminders.recordCall(user, surveyId, recipientId, dto, getRequestAuditMeta(req));
  }
}

/** A person's survey contact preferences (opt-outs), honoured by every invitation and reminder. */
@ApiTags('Survey reminders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys-contact-preferences')
export class SurveyContactPreferencesController {
  constructor(private readonly reminders: SurveyRemindersService) {}

  @Get()
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'How a person does not want to be contacted about surveys' })
  get(@CurrentUser() user: RequestUser, @Query() q: SurveyOptOutQueryDto) {
    return this.reminders.getOptOuts(user, q.subjectKind, q.subjectId);
  }

  @Put()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Change how a person may be contacted about surveys' })
  set(@CurrentUser() user: RequestUser, @Body() dto: SetSurveyOptOutsDto, @Req() req: Request) {
    return this.reminders.setOptOuts(user, dto, getRequestAuditMeta(req));
  }
}
