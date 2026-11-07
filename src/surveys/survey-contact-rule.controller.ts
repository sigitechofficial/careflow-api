import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveyContactRuleService } from './survey-contact-rule.service';
import { SurveysService } from './surveys.service';
import { SaveSurveyContactRuleDto, SendHeldBackDto } from './dto/survey-contact-rule.dto';

/** Who gets a survey: the 4-week contact rule, sampling, and people held back. */
@ApiTags('Survey contact rule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId')
export class SurveyContactRuleController {
  constructor(
    private readonly rule: SurveyContactRuleService,
    private readonly surveys: SurveysService,
  ) {}

  @Get('contact-rule')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'The 4-week rule and sampling for this survey, and who is held back' })
  get(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.rule.getSettings(user, surveyId);
  }

  @Put('contact-rule')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Change how the 4-week rule applies, or sampling (a reason when it differs from the default)' })
  save(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SaveSurveyContactRuleDto, @Req() req: Request) {
    return this.rule.saveSettings(user, surveyId, { rule: dto.rule, sampling: dto.sampling }, getRequestAuditMeta(req));
  }

  @Post('held-back/send')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Send now to people held back by the 4-week rule, with a reason' })
  sendHeld(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SendHeldBackDto, @Req() req: Request) {
    return this.surveys.sendHeldAnyway(user, surveyId, { heldIds: dto.heldIds, reason: dto.reason }, getRequestAuditMeta(req));
  }

  @Post('held-back/skip')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: "Don't send: people held back by the 4-week rule are not sent this survey at all, with a reason" })
  skipHeld(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SendHeldBackDto, @Req() req: Request) {
    return this.rule.skipHeld(user, surveyId, { heldIds: dto.heldIds, reason: dto.reason }, getRequestAuditMeta(req));
  }
}
