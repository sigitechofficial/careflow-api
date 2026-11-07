import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SupervisionService } from './supervision.service';
import {
  AttendeeSignDto,
  CancelSupervisionSessionDto,
  CreateSupervisionAddendumDto,
  CreateSupervisionSessionDto,
  ListSupervisionSessionsQueryDto,
  SupervisorSignDto,
  UpdateSupervisionSessionDto,
} from './dto/supervision-session.dto';
import { CreateSupervisionActionDto, UpdateSupervisionActionDto } from './dto/supervision-action.dto';
import { SetEmployeeSupervisorDto, SetReviewScheduleDto, SetSupervisionFormDto } from './dto/supervision-form.dto';

@ApiTags('Supervision')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('supervision')
export class SupervisionController {
  constructor(private readonly service: SupervisionService) {}

  @Get('forms')
  @Permissions('supervision.read')
  @ApiOperation({ summary: 'Care Pathway form per review type, and the staff forms to choose from' })
  listForms() {
    return this.service.listForms();
  }

  @Put('forms/:reviewTypeId')
  @Permissions('supervision.settings')
  @ApiOperation({ summary: 'Set the staff form a review type is recorded on; past sessions keep theirs' })
  setForm(
    @CurrentUser() user: RequestUser,
    @Param('reviewTypeId', ParseUUIDPipe) reviewTypeId: string,
    @Body() dto: SetSupervisionFormDto,
    @Req() req: Request,
  ) {
    return this.service.setForm(user, reviewTypeId, dto, getRequestAuditMeta(req));
  }

  @Put('review-types/:reviewTypeId/schedule')
  @Permissions('supervision.settings')
  @ApiOperation({ summary: 'When a review type is due (repeating, milestones from the start date, or on events) and who for' })
  setSchedule(
    @CurrentUser() user: RequestUser,
    @Param('reviewTypeId', ParseUUIDPipe) reviewTypeId: string,
    @Body() dto: SetReviewScheduleDto,
    @Req() req: Request,
  ) {
    return this.service.setSchedule(user, reviewTypeId, dto, getRequestAuditMeta(req));
  }

  @Get('overview')
  @Permissions('supervision.read')
  @ApiOperation({ summary: 'Supervision due / overdue and % supervised in the last 3 months (dashboard)' })
  overview(@Query('locationId', new ParseUUIDPipe({ optional: true })) locationId?: string) {
    return this.service.overview(locationId);
  }

  @Get('supervisors')
  @Permissions('supervision.read')
  @ApiOperation({ summary: 'Users who can supervise (hold supervision.manage)' })
  listSupervisors() {
    return this.service.listSupervisors();
  }

  @Get('sessions')
  @Permissions('supervision.read')
  listSessions(@Query() query: ListSupervisionSessionsQueryDto) {
    return this.service.listSessions(query);
  }

  @Post('sessions')
  @Permissions('supervision.manage')
  @ApiOperation({ summary: 'Schedule a supervision; the review type agenda is copied in' })
  createSession(@CurrentUser() user: RequestUser, @Body() dto: CreateSupervisionSessionDto, @Req() req: Request) {
    return this.service.createSession(user, dto, getRequestAuditMeta(req));
  }

  @Get('sessions/:id')
  @Permissions('supervision.read')
  getSession(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getSession(user, id);
  }

  @Patch('sessions/:id')
  @Permissions('supervision.manage')
  @ApiOperation({ summary: 'Edit details and agenda notes (until the supervisor signs)' })
  updateSession(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupervisionSessionDto,
    @Req() req: Request,
  ) {
    return this.service.updateSession(user, id, dto, getRequestAuditMeta(req));
  }

  @Post('sessions/:id/start')
  @Permissions('supervision.manage')
  start(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.service.startSession(user, id, getRequestAuditMeta(req));
  }

  @Post('sessions/:id/sign')
  @Permissions('supervision.manage')
  @ApiOperation({ summary: 'Supervisor signs; then each carer signs (or completes, per settings)' })
  sign(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupervisorSignDto,
    @Req() req: Request,
  ) {
    return this.service.supervisorSign(user, id, dto, getRequestAuditMeta(req));
  }

  @Post('sessions/:id/attendees/:employeeId/sign')
  @Permissions('supervision.manage')
  @ApiOperation({ summary: 'Carer signs or records disagreement (on the supervisor device)' })
  attendeeSign(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: AttendeeSignDto,
    @Req() req: Request,
  ) {
    return this.service.attendeeSign(user, id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Post('sessions/:id/cancel')
  @Permissions('supervision.manage')
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSupervisionSessionDto,
    @Req() req: Request,
  ) {
    return this.service.cancelSession(user, id, dto, getRequestAuditMeta(req));
  }

  @Post('sessions/:id/addenda')
  @Permissions('supervision.manage')
  @ApiOperation({ summary: 'Dated correction or later note on a signed session' })
  addAddendum(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSupervisionAddendumDto,
    @Req() req: Request,
  ) {
    return this.service.addAddendum(user, id, dto, getRequestAuditMeta(req));
  }

  @Post('sessions/:id/actions')
  @Permissions('supervision.manage')
  addAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSupervisionActionDto,
    @Req() req: Request,
  ) {
    return this.service.addAction(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch('actions/:actionId')
  @Permissions('supervision.manage')
  updateAction(
    @CurrentUser() user: RequestUser,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: UpdateSupervisionActionDto,
    @Req() req: Request,
  ) {
    return this.service.updateAction(user, actionId, dto, getRequestAuditMeta(req));
  }

  @Get('employees/:employeeId/summary')
  @Permissions('supervision.read')
  @ApiOperation({ summary: 'Held in the last 12 months vs expected, last done and next due, per repeating review' })
  employeeSummary(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.service.employeeSummary(employeeId);
  }

  @Get('employees/:employeeId/supervisor')
  @Permissions('supervision.read')
  getEmployeeSupervisor(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.service.getEmployeeSupervisor(employeeId);
  }

  @Put('employees/:employeeId/supervisor')
  @Permissions('supervision.manage')
  @ApiOperation({ summary: "Set the carer's named supervisor (gets their supervision reminders)" })
  setEmployeeSupervisor(
    @CurrentUser() user: RequestUser,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: SetEmployeeSupervisorDto,
    @Req() req: Request,
  ) {
    return this.service.setEmployeeSupervisor(user, employeeId, dto, getRequestAuditMeta(req));
  }

  @Get('employees/:employeeId/open-actions')
  @Permissions('supervision.read')
  @ApiOperation({ summary: "A carer's open actions from earlier sessions" })
  openActions(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.service.openActions(employeeId);
  }
}
