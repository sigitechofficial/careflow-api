import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveyEventTriggersService } from './survey-event-triggers.service';
import { DecideEventSendsDto, SaveSurveyEventTriggerDto } from './dto/survey-event-trigger.dto';

/** Sent when something happens in the care records (Phase 2 part 3). */
@ApiTags('Survey event triggers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId/event-trigger')
export class SurveyEventTriggersController {
  constructor(private readonly triggers: SurveyEventTriggersService) {}

  @Get()
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'The event this survey is sent after, and (surveys.manage) who it is due for or was sent to' })
  get(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.triggers.getSettings(user, surveyId);
  }

  @Put()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Switch the event on, change it, or switch it off (null). Audited' })
  save(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SaveSurveyEventTriggerDto, @Req() req: Request) {
    return this.triggers.saveSettings(user, surveyId, dto.trigger, getRequestAuditMeta(req));
  }

  @Post('decide')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Rows waiting for a check or an offer: send, do not send (with a reason), or mark offered' })
  decide(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: DecideEventSendsDto, @Req() req: Request) {
    return this.triggers.decide(user, surveyId, { ids: dto.ids, action: dto.action, reason: dto.reason }, getRequestAuditMeta(req));
  }
}
