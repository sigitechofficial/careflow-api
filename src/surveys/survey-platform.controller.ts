import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveyPlatformService } from './survey-platform.service';

/** Repeats that skip months, the rotating question, answer retention, grouped answers and the wording check. */
@ApiTags('Survey settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId')
export class SurveyPlatformController {
  constructor(private readonly platform: SurveyPlatformService) {}

  @Get('platform')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Months a repeat skips, the rotating question and how long answers are kept' })
  get(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.platform.getSettings(user, surveyId);
  }

  @Put('platform')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Change the months a repeat skips, the rotating question or how long answers are kept' })
  save(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.platform.saveSettings(user, surveyId, body ?? {}, getRequestAuditMeta(req));
  }

  @Put('questions/:questionId/option-groups')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Group a choice question’s answers under headings (reported by group)' })
  groups(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() body: { groups?: unknown },
    @Req() req: Request,
  ) {
    return this.platform.setOptionGroups(user, surveyId, questionId, body?.groups ?? null, getRequestAuditMeta(req));
  }

  @Get('wording-check')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Check the wording against the library standard (plain English, one idea, scales, time)' })
  wording(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.platform.wordingCheck(user, surveyId);
  }
}
