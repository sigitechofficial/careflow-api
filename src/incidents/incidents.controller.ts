import {
  ParseUUIDPipe,
  Body,
  Controller,
  Get,
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
import {
  AnyPermission,
  Permissions,
} from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { IncidentsService } from './incidents.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { IncidentVisitOptionsQueryDto } from './dto/incident-visit-options-query.dto';
import { ListIncidentsQueryDto } from './dto/list-incidents-query.dto';
import {
  AssignIncidentOwnerDto,
  ChangeIncidentSeverityDto,
  ChangeIncidentStatusDto,
} from './dto/incident-workflow.dto';
import {
  PauseIncidentInvestigationDto,
  UpsertIncidentInvestigationDto,
  UpsertIncidentReviewDto,
} from './dto/incident-review.dto';
import {
  CompleteIncidentActionDto,
  CreateIncidentActionDto,
  UpdateIncidentActionDto,
  RemoveIncidentActionDto,
} from './dto/incident-action.dto';
import { UpsertIncidentOutcomeDto } from './dto/incident-outcome.dto';
import {
  AddIncidentClarificationDto,
  CorrectIncidentDto,
} from './dto/incident-correction.dto';
import {
  ExtendIncidentCarerSuspensionDto,
  LiftIncidentCarerSuspensionDto,
  SuspendIncidentCarerDto,
} from './dto/suspend-incident-carer.dto';
import { IncidentAnalyticsService } from './incident-analytics.service';
import { IncidentAnalyticsQueryDto } from './dto/incident-analytics-query.dto';

@ApiTags('Incidents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(
    private readonly service: IncidentsService,
    private readonly analytics: IncidentAnalyticsService,
  ) {}

  @Get('categories')
  @AnyPermission('incidents.read', 'incidents.create')
  @ApiOperation({
    summary: 'List configurable incident categories and subtypes',
  })
  listCategories() {
    return this.service.listCategories();
  }

  @Get('stats')
  @Permissions('incidents.read')
  @ApiOperation({ summary: 'Dashboard summary statistics (privacy-filtered)' })
  getStats(
    @CurrentUser() user: RequestUser,
    @Query('locationId') locationId?: string,
  ) {
    return this.service.getStats(user, locationId);
  }

  @Get('analytics')
  @Permissions('incidents.view_analytics')
  @ApiOperation({
    summary: 'Incident analytics & trend warnings (privacy-filtered)',
  })
  getAnalytics(
    @CurrentUser() user: RequestUser,
    @Query() query: IncidentAnalyticsQueryDto,
  ) {
    return this.analytics.getAnalytics(user, query);
  }

  @Get('visit-options')
  @Permissions('incidents.create')
  @ApiOperation({
    summary:
      'Visits a new incident can be linked to: the date given ± 1 day, for a service user (or staff member)',
  })
  visitOptions(
    @CurrentUser() user: RequestUser,
    @Query() query: IncidentVisitOptionsQueryDto,
  ) {
    return this.service.listVisitOptions(user, query);
  }

  @Get('my-actions')
  @Permissions('incidents.read')
  @ApiOperation({ summary: 'Corrective actions assigned to the current user' })
  myActions(
    @CurrentUser() user: RequestUser,
    @Query('openOnly') openOnly?: string,
  ) {
    return this.service.listMyActions(user, openOnly !== 'false');
  }

  @Post()
  @Permissions('incidents.create')
  @ApiOperation({ summary: 'Report a new accident / incident' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateIncidentDto,
    @Req() req: Request,
  ) {
    return this.service.create(user, dto, getRequestAuditMeta(req));
  }

  @Get()
  @Permissions('incidents.read')
  @ApiOperation({ summary: 'List incidents (privacy-filtered, paginated)' })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListIncidentsQueryDto,
  ) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @Permissions('incidents.read')
  @ApiOperation({ summary: 'Get an incident with its timeline' })
  getById(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(user, id);
  }

  @Post(':id/start-review')
  @Permissions('incidents.review')
  @ApiOperation({
    summary:
      'Start the review (Reported → Under Review); the reviewer becomes the owner',
  })
  startReview(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.service.startReview(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/corrections')
  @Permissions('incidents.correct')
  @ApiOperation({
    summary:
      'Correct raised details with a reason (old values kept; closed incidents must be reopened first)',
  })
  correct(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectIncidentDto,
    @Req() req: Request,
  ) {
    return this.service.correctIncident(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/clarifications')
  @Permissions('incidents.correct')
  @ApiOperation({
    summary: "Add a clarification note to the reporter's account (the original text never changes)",
  })
  addClarification(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddIncidentClarificationDto,
    @Req() req: Request,
  ) {
    return this.service.addClarification(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/status')
  @Permissions('incidents.review')
  @ApiOperation({ summary: 'Transition incident workflow status' })
  changeStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeIncidentStatusDto,
    @Req() req: Request,
  ) {
    return this.service.changeStatus(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/severity')
  @Permissions('incidents.review')
  @ApiOperation({
    summary: 'Change incident severity (audited, history preserved)',
  })
  changeSeverity(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeIncidentSeverityDto,
    @Req() req: Request,
  ) {
    return this.service.changeSeverity(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/owner')
  @Permissions('incidents.assign')
  @ApiOperation({ summary: 'Assign an incident owner' })
  assignOwner(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignIncidentOwnerDto,
    @Req() req: Request,
  ) {
    return this.service.assignOwner(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/review')
  @Permissions('incidents.review')
  @ApiOperation({ summary: 'Save the manager triage / review' })
  upsertReview(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertIncidentReviewDto,
    @Req() req: Request,
  ) {
    return this.service.upsertReview(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/investigation')
  @Permissions('incidents.investigate')
  @ApiOperation({ summary: 'Save the incident investigation' })
  upsertInvestigation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertIncidentInvestigationDto,
    @Req() req: Request,
  ) {
    return this.service.upsertInvestigation(
      user,
      id,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Get(':id/investigators')
  @Permissions('incidents.investigate')
  @ApiOperation({
    summary: 'Users who can lead this investigation (can investigate and can see this incident)',
  })
  investigators(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.eligibleInvestigators(user, id);
  }

  @Post(':id/investigation/pause')
  @Permissions('incidents.investigate')
  @ApiOperation({ summary: 'Pause the investigation (reason and next review date)' })
  pauseInvestigation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PauseIncidentInvestigationDto,
    @Req() req: Request,
  ) {
    return this.service.pauseInvestigation(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/investigation/resume')
  @Permissions('incidents.investigate')
  @ApiOperation({ summary: 'Resume a paused investigation' })
  resumeInvestigation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.service.resumeInvestigation(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/suspend-carer')
  @Permissions('incidents.investigate')
  @ApiOperation({
    summary:
      'Interim suspension of a carer during the investigation (starts today or on a later start date)',
  })
  suspendCarer(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendIncidentCarerDto,
    @Req() req: Request,
  ) {
    return this.service.suspendCarer(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/carer-suspensions/:suspensionId/lift')
  @Permissions('incidents.investigate')
  @ApiOperation({
    summary: 'Lift a carer suspension (reason required); reactivates when no other suspension remains',
  })
  liftCarerSuspension(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('suspensionId', ParseUUIDPipe) suspensionId: string,
    @Body() dto: LiftIncidentCarerSuspensionDto,
    @Req() req: Request,
  ) {
    return this.service.liftCarerSuspension(user, id, suspensionId, dto, getRequestAuditMeta(req));
  }

  @Post(':id/carer-suspensions/:suspensionId/continue')
  @AnyPermission('incidents.investigate', 'incidents.close')
  @ApiOperation({
    summary:
      'Outcome & close: continue a suspension beyond the incident (reason + review / end date)',
  })
  continueCarerSuspension(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('suspensionId', ParseUUIDPipe) suspensionId: string,
    @Body() dto: ExtendIncidentCarerSuspensionDto,
    @Req() req: Request,
  ) {
    return this.service.continueCarerSuspension(user, id, suspensionId, dto, getRequestAuditMeta(req));
  }

  @Get('carer-suspensions/by-employee/:employeeId')
  @Permissions('incidents.read')
  @ApiOperation({ summary: "A carer's interim suspension history across incidents" })
  employeeSuspensions(
    @CurrentUser() user: RequestUser,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.service.listEmployeeSuspensions(user, employeeId);
  }

  @Post(':id/carer-suspensions/:suspensionId/extend')
  @Permissions('incidents.investigate')
  @ApiOperation({ summary: 'Extend a carer suspension to a later end date (reason required)' })
  extendCarerSuspension(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('suspensionId', ParseUUIDPipe) suspensionId: string,
    @Body() dto: ExtendIncidentCarerSuspensionDto,
    @Req() req: Request,
  ) {
    return this.service.extendCarerSuspension(user, id, suspensionId, dto, getRequestAuditMeta(req));
  }

  @Post(':id/outcome')
  @Permissions('incidents.review')
  @ApiOperation({ summary: 'Save the closure outcome & lessons learned' })
  upsertOutcome(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertIncidentOutcomeDto,
    @Req() req: Request,
  ) {
    return this.service.upsertOutcome(user, id, dto, getRequestAuditMeta(req));
  }

  @Get(':id/actions')
  @Permissions('incidents.read')
  @ApiOperation({ summary: 'List corrective actions for an incident' })
  listActions(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listActions(user, id);
  }

  @Post(':id/actions')
  @Permissions('incidents.manage_actions')
  @ApiOperation({ summary: 'Create a corrective action' })
  createAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateIncidentActionDto,
    @Req() req: Request,
  ) {
    return this.service.createAction(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch('actions/:actionId')
  @Permissions('incidents.manage_actions')
  @ApiOperation({ summary: 'Update a corrective action' })
  updateAction(
    @CurrentUser() user: RequestUser,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: UpdateIncidentActionDto,
    @Req() req: Request,
  ) {
    return this.service.updateAction(
      user,
      actionId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('actions/:actionId/complete')
  @AnyPermission('incidents.manage_actions', 'incidents.read')
  @ApiOperation({
    summary: 'Complete a corrective action (manager or assignee)',
  })
  completeAction(
    @CurrentUser() user: RequestUser,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: CompleteIncidentActionDto,
    @Req() req: Request,
  ) {
    return this.service.completeAction(
      user,
      actionId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('actions/:actionId/remove')
  @Permissions('incidents.manage_actions')
  @ApiOperation({
    summary: 'Remove a corrective measure added by mistake (reason required; kept in the audit log)',
  })
  removeAction(
    @CurrentUser() user: RequestUser,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: RemoveIncidentActionDto,
    @Req() req: Request,
  ) {
    return this.service.removeAction(user, actionId, dto, getRequestAuditMeta(req));
  }
}
