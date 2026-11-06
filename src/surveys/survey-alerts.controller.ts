import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { SurveyAlertsService } from './survey-alerts.service';
import {
  ListSurveyFollowUpsQueryDto,
  NeverRouteToDto,
  SaveSurveyAlertRuleDto,
  SetAlertOwnerRoleDto,
  UpdateSurveyFollowUpDto,
} from './dto/survey-alerts.dto';

/** Survey alert rules (per survey). */
@ApiTags('Survey alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId/alert-rules')
export class SurveyAlertRulesController {
  constructor(private readonly alerts: SurveyAlertsService) {}

  @Get()
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: "A survey's alert rules, the questions they can check and the library alerts checked by hand" })
  list(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.alerts.listRules(user, surveyId);
  }

  @Post()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Add an alert rule' })
  create(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: SaveSurveyAlertRuleDto) {
    return this.alerts.createRule(user, surveyId, dto);
  }

  @Post('restore-library')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Ready-made surveys: put back the ready-made alert rules' })
  restore(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.alerts.restoreLibraryRules(user, surveyId);
  }

  @Put('never-route-to')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Roles this survey rates: its alerts never go to them' })
  neverRouteTo(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() dto: NeverRouteToDto) {
    return this.alerts.setNeverRouteTo(user, surveyId, dto.ownerKeys);
  }

  @Put(':ruleId')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Change an alert rule' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: SaveSurveyAlertRuleDto,
  ) {
    return this.alerts.updateRule(user, surveyId, ruleId, dto);
  }

  @Delete(':ruleId')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Remove an alert rule (alerts already raised keep their tasks)' })
  remove(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Param('ruleId', ParseUUIDPipe) ruleId: string) {
    return this.alerts.deleteRule(user, surveyId, ruleId);
  }
}

/** Which organisation role handles each ready-made alert role (e.g. Safeguarding lead). */
@ApiTags('Survey alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('survey-alert-roles')
export class SurveyAlertRolesController {
  constructor(private readonly alerts: SurveyAlertsService) {}

  @Put(':ownerKey')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Choose the role that handles a ready-made alert role' })
  set(@CurrentUser() user: RequestUser, @Param('ownerKey') ownerKey: string, @Body() dto: SetAlertOwnerRoleDto) {
    return this.alerts.setOwnerRole(user, ownerKey, dto.roleId ?? null);
  }
}

/**
 * The survey follow-up list: alerts raised from answers and contact-me requests. Office users with
 * survey access see those in their branches; anyone else only the ones given to their roles.
 */
@ApiTags('Survey alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('survey-follow-ups')
export class SurveyFollowUpsController {
  constructor(private readonly alerts: SurveyAlertsService) {}

  private officeOnly(user: RequestUser) {
    if (user.accountKind !== 'user') throw new ForbiddenException('Survey follow-ups are for office users');
  }

  @Get()
  @ApiOperation({ summary: 'Open, overdue, contact-me and done follow-ups' })
  list(@CurrentUser() user: RequestUser, @Query() query: ListSurveyFollowUpsQueryDto) {
    this.officeOnly(user);
    return this.alerts.listFollowUps(user, query);
  }

  @Get(':alertId/owners')
  @ApiOperation({ summary: 'People in the role a follow-up was given to' })
  owners(@CurrentUser() user: RequestUser, @Param('alertId', ParseUUIDPipe) alertId: string) {
    this.officeOnly(user);
    return this.alerts.ownerOptions(user, alertId);
  }

  @Patch(':alertId')
  @ApiOperation({ summary: 'Owner, status, outcome, role and linked record of a follow-up' })
  update(@CurrentUser() user: RequestUser, @Param('alertId', ParseUUIDPipe) alertId: string, @Body() dto: UpdateSurveyFollowUpDto) {
    this.officeOnly(user);
    return this.alerts.updateFollowUp(user, alertId, dto);
  }
}
