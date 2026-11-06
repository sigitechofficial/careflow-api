import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PortalAuthGuard } from '../service-user-portal/guards/portal-auth.guard';
import { EmployeeAppAuthGuard } from '../employee-app/guards/employee-app-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { SurveyActionsService, type ActionInput } from './survey-actions.service';

/** Acting on results: actions, team discussions, "You said, we did" and the CQC and commissioner pack. */
@ApiTags('Survey actions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId')
export class SurveyActionsController {
  constructor(private readonly actions: SurveyActionsService) {}

  @Get('actions')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Actions, discussions and "You said, we did" for a survey (results access)' })
  overview(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.actions.overview(user, surveyId);
  }

  @Post('actions')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Raise an action from a result' })
  create(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() body: ActionInput, @Req() req: Request) {
    return this.actions.createAction(user, surveyId, body ?? {}, getRequestAuditMeta(req));
  }

  @Post('discussions')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Record when results were discussed and what was agreed' })
  discuss(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.actions.createDiscussion(user, surveyId, body as never, getRequestAuditMeta(req));
  }

  @Post('you-said-we-did')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Save a "You said, we did" draft' })
  createUpdate(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.actions.saveUpdate(user, surveyId, null, body as never, getRequestAuditMeta(req));
  }

  @Put('you-said-we-did/:updateId')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Change a "You said, we did" draft' })
  saveUpdate(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('updateId', ParseUUIDPipe) updateId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.actions.saveUpdate(user, surveyId, updateId, body as never, getRequestAuditMeta(req));
  }

  @Post('you-said-we-did/:updateId/publish')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Publish "You said, we did" to the chosen places' })
  publish(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Param('updateId', ParseUUIDPipe) updateId: string, @Req() req: Request) {
    return this.actions.publishUpdate(user, surveyId, updateId, true, getRequestAuditMeta(req));
  }

  @Post('you-said-we-did/:updateId/withdraw')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Withdraw "You said, we did" from everywhere' })
  withdraw(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Param('updateId', ParseUUIDPipe) updateId: string, @Req() req: Request) {
    return this.actions.publishUpdate(user, surveyId, updateId, false, getRequestAuditMeta(req));
  }

  @Get('you-said-we-did/:updateId/letter')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'The printable "You said, we did" letter' })
  letter(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Param('updateId', ParseUUIDPipe) updateId: string) {
    return this.actions.letter(user, surveyId, updateId);
  }

  @Get('pack')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'CQC and commissioner pack (audited as an export)' })
  pack(@CurrentUser() user: RequestUser, @Param('surveyId', ParseUUIDPipe) surveyId: string, @Query('periodId') periodId: string | undefined, @Req() req: Request) {
    return this.actions.pack(user, surveyId, periodId && /^[0-9a-f-]{36}$/i.test(periodId) ? periodId : null, getRequestAuditMeta(req));
  }
}

/** One action and one discussion by id. */
@ApiTags('Survey actions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('survey-actions')
export class SurveyActionItemsController {
  constructor(private readonly actions: SurveyActionsService) {}

  @Patch(':actionId')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Change an action, record progress or close it (managers; or its owner)' })
  update(@CurrentUser() user: RequestUser, @Param('actionId', ParseUUIDPipe) actionId: string, @Body() body: ActionInput, @Req() req: Request) {
    return this.actions.updateAction(user, actionId, body ?? {}, getRequestAuditMeta(req));
  }

  @Delete('discussions/:discussionId')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Remove a discussion record' })
  removeDiscussion(@CurrentUser() user: RequestUser, @Param('discussionId', ParseUUIDPipe) discussionId: string, @Req() req: Request) {
    return this.actions.deleteDiscussion(user, discussionId, getRequestAuditMeta(req));
  }
}

/** The portal: "You said, we did" for people we support and families. */
@ApiTags('Service User Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PortalAuthGuard)
@Controller('portal/you-said-we-did')
export class SurveyUpdatesPortalController {
  constructor(private readonly actions: SurveyActionsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '"You said, we did" published for the signed-in person’s branch' })
  list(@CurrentUser() user: RequestUser) {
    return this.actions.forPortal(user.serviceUserId!);
  }
}

/** The carer app payload: "You said, we did" from staff surveys. */
@ApiTags('Employee App')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/you-said-we-did')
export class SurveyUpdatesEmployeeAppController {
  constructor(private readonly actions: SurveyActionsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '"You said, we did" from staff surveys for the signed-in employee’s branch' })
  list(@CurrentUser() user: RequestUser) {
    return this.actions.forEmployeeApp(user.employeeId!);
  }
}

/** The public page (no login). */
@ApiTags('Survey actions')
@Controller('you-said-we-did')
export class SurveyUpdatesPublicController {
  constructor(private readonly actions: SurveyActionsService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  // Never kept by a browser or proxy: a withdrawn page must stop showing at once.
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'A published "You said, we did" page' })
  show(@Param('token') token: string) {
    return this.actions.forPublic(token);
  }
}
