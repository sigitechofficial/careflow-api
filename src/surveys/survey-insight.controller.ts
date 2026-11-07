import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveyInsightService } from './survey-insight.service';

const uuidOrUndefined = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

/** One survey's trends, branch heatmap, themes, response quality and scores (results access; branch scope). */
@ApiTags('Survey insight')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId')
export class SurveyInsightController {
  constructor(private readonly insight: SurveyInsightService) {}

  @Get('trends')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Each question across the periods and years of a repeating survey' })
  trends(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.insight.trends(user, surveyId);
  }

  @Get('heatmap')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Questions by branch, with small groups combined or left blank' })
  heatmap(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.insight.heatmap(user, surveyId);
  }

  @Get('themes')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Themes in written answers (counts only, worked out inside CareFlow)' })
  themes(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.insight.themes(user, surveyId);
  }

  @Get('quality')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Response quality flags (counts)' })
  quality(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.insight.quality(user, surveyId);
  }

  @Get('quality/responses')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Flags on each response (individual responses access)' })
  responseFlags(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.insight.responseFlags(user, surveyId);
  }

  @Get('scores')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Scale scores for a scored survey' })
  scores(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.insight.scores(user, surveyId);
  }

  @Put('scoring')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Set (or remove) the scales a survey is scored on' })
  saveScoring(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() body: { scoring?: unknown; unlockReason?: unknown }, @Req() req: Request) {
    return this.insight.saveScoring(user, surveyId, body?.scoring ?? null, getRequestAuditMeta(req), body?.unlockReason);
  }
}

/** Across surveys: role dashboards, pooled copies and the 360 report. */
@ApiTags('Survey insight')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('survey-insight')
export class SurveyInsightOverviewController {
  constructor(private readonly insight: SurveyInsightService) {}

  @Get('dashboard')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Surveys dashboard for a registered manager, branch manager or nominated individual' })
  dashboard(@CurrentUser() user: RequestUser, @Query('view') view?: string, @Query('locationId') locationId?: string) {
    return this.insight.dashboard(user, view, uuidOrUndefined(locationId));
  }

  @Get('pools')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Templates and ready-made surveys with two or more copies to pool' })
  pools(@CurrentUser() user: RequestUser) {
    return this.insight.poolOptions(user);
  }

  @Get('pool')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'One report over every copy of a template or ready-made survey' })
  pool(@CurrentUser() user: RequestUser, @Query('templateId') templateId?: string, @Query('libraryReference') libraryReference?: string) {
    return this.insight.pool(user, {
      templateId: uuidOrUndefined(templateId),
      libraryReference: typeof libraryReference === 'string' && /^SUR-[A-Z]{3}-\d{3}$/.test(libraryReference) ? libraryReference : undefined,
    });
  }

  @Get('360')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'The year’s people, family, staff and professional surveys side by side by CQC key question' })
  report360(
    @CurrentUser() user: RequestUser,
    @Query('year') year?: string,
    @Query('people') people?: string,
    @Query('families') families?: string,
    @Query('staff') staff?: string,
    @Query('professionals') professionals?: string,
  ) {
    return this.insight.report360(user, Number(year ?? new Date().getUTCFullYear()), {
      PEOPLE: uuidOrUndefined(people),
      FAMILIES: uuidOrUndefined(families),
      STAFF: uuidOrUndefined(staff),
      PROFESSIONALS: uuidOrUndefined(professionals),
    });
  }
}

