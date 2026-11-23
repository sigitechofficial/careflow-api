import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { QualityAuditsService } from './quality-audits.service';
import { QualityAuditTemplatesService } from './quality-audit-templates.service';
import { QualityAuditSchedulesService } from './quality-audit-schedules.service';
import {
  AnswerStandardDto,
  AuditFiltersDto,
  AuditReportsQueryDto,
  BeginQualityAuditDto,
  CreateAuditAreaDto,
  CreateAuditScheduleDto,
  CreateQualityAuditActionDto,
  ListAuditSchedulesQueryDto,
  ListAuditTemplatesQueryDto,
  ListQualityAuditsQueryDto,
  SaveAuditTemplateDto,
  StartQualityAuditDto,
  UpdateAuditScheduleDto,
  UpdateQualityAuditActionDto,
  UpdateQualityAuditDto,
} from './dto/quality-audits.dto';

/**
 * Governance → Audits. Read: quality_audits.read; areas, templates, schedules, and carrying out
 * audits (start, answer, complete, cancel, actions): quality_audits.manage.
 */
@ApiTags('Audits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('quality-audits')
export class QualityAuditsController {
  constructor(
    private readonly audits: QualityAuditsService,
    private readonly templates: QualityAuditTemplatesService,
    private readonly schedules: QualityAuditSchedulesService,
  ) {}

  // ─── Dashboard and reports ────────────────────────────────────────────────

  @Get('dashboard')
  @Permissions('quality_audits.read')
  @ApiOperation({ summary: 'Tab counts and the month-by-month audit timeline' })
  dashboard(@CurrentUser() user: RequestUser, @Query() query: AuditFiltersDto) {
    return this.audits.dashboard(user, query);
  }

  @Get('reports')
  @Permissions('quality_audits.read')
  @ApiOperation({
    summary: 'Compliance levels, audits coming due and compliance by month',
  })
  reports(
    @CurrentUser() user: RequestUser,
    @Query() query: AuditReportsQueryDto,
  ) {
    return this.audits.reports(user, query);
  }

  // ─── Areas ────────────────────────────────────────────────────────────────

  @Get('areas')
  @Permissions('quality_audits.read')
  @ApiOperation({ summary: 'Audit areas, with how many templates each has' })
  areas() {
    return this.templates.areas();
  }

  @Post('areas')
  @Permissions('quality_audits.manage')
  @ApiOperation({ summary: 'Add an audit area of your own' })
  createArea(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAuditAreaDto,
    @Req() req: Request,
  ) {
    return this.templates.createArea(user, dto, getRequestAuditMeta(req));
  }

  // ─── Templates ────────────────────────────────────────────────────────────

  @Get('templates')
  @Permissions('quality_audits.read')
  @ApiOperation({
    summary: 'Audit templates: the library and your own (filters: area, kind)',
  })
  listTemplates(
    @CurrentUser() user: RequestUser,
    @Query() query: ListAuditTemplatesQueryDto,
  ) {
    return this.templates.templates(user, query);
  }

  @Post('templates')
  @Permissions('quality_audits.manage')
  @ApiOperation({
    summary: 'Create a template of your own: area, details and standards',
  })
  createTemplate(
    @CurrentUser() user: RequestUser,
    @Body() dto: SaveAuditTemplateDto,
    @Req() req: Request,
  ) {
    return this.templates.createTemplate(user, dto, getRequestAuditMeta(req));
  }

  @Get('templates/:code')
  @Permissions('quality_audits.read')
  @ApiOperation({ summary: 'One template with its sections and standards' })
  template(@CurrentUser() user: RequestUser, @Param('code') code: string) {
    return this.templates.template(user, code);
  }

  @Put('templates/:code')
  @Permissions('quality_audits.manage')
  @ApiOperation({
    summary:
      'Change one of your own templates (audits already started keep their copy)',
  })
  updateTemplate(
    @CurrentUser() user: RequestUser,
    @Param('code') code: string,
    @Body() dto: SaveAuditTemplateDto,
    @Req() req: Request,
  ) {
    return this.templates.updateTemplate(
      user,
      code,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('templates/:code/retire')
  @Permissions('quality_audits.manage')
  @ApiOperation({
    summary: 'Remove one of your own templates (its audits are kept)',
  })
  retireTemplate(
    @CurrentUser() user: RequestUser,
    @Param('code') code: string,
    @Req() req: Request,
  ) {
    return this.templates.retireTemplate(user, code, getRequestAuditMeta(req));
  }

  // ─── Schedules ────────────────────────────────────────────────────────────

  @Get('schedules')
  @Permissions('quality_audits.read')
  @ApiOperation({ summary: 'Audit schedules with their next due audit' })
  listSchedules(
    @CurrentUser() user: RequestUser,
    @Query() query: ListAuditSchedulesQueryDto,
  ) {
    return this.schedules.list(user, query);
  }

  @Post('schedules')
  @Permissions('quality_audits.manage')
  @ApiOperation({
    summary:
      'Schedule an audit for a branch: how often, the window and who is accountable',
  })
  createSchedule(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAuditScheduleDto,
    @Req() req: Request,
  ) {
    return this.schedules.create(user, dto, getRequestAuditMeta(req));
  }

  @Patch('schedules/:id')
  @Permissions('quality_audits.manage')
  @ApiOperation({
    summary: 'Change how often, the window or the person accountable',
  })
  updateSchedule(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAuditScheduleDto,
    @Req() req: Request,
  ) {
    return this.schedules.update(user, id, dto, getRequestAuditMeta(req));
  }

  @Post('schedules/:id/stop')
  @Permissions('quality_audits.manage')
  @ApiOperation({
    summary: 'Stop a schedule (the audit waiting to be done is cancelled)',
  })
  stopSchedule(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.schedules.stop(user, id, getRequestAuditMeta(req));
  }

  // ─── Audits ───────────────────────────────────────────────────────────────

  @Get()
  @Permissions('quality_audits.read')
  @ApiOperation({
    summary:
      'Audits (filters: tab, status, branch, area, person accountable, level, audit, words)',
  })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListQualityAuditsQueryDto,
  ) {
    return this.audits.list(user, query);
  }

  @Post()
  @Permissions('quality_audits.manage')
  @ApiOperation({
    summary: 'Start an audit now, for a branch or the whole organisation',
  })
  start(
    @CurrentUser() user: RequestUser,
    @Body() dto: StartQualityAuditDto,
    @Req() req: Request,
  ) {
    return this.audits.start(user, dto, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('quality_audits.read')
  @ApiOperation({
    summary: 'One audit: its standards, answers, score, window and actions',
  })
  get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.audits.get(user, id);
  }

  @Patch(':id')
  @Permissions('quality_audits.manage')
  @ApiOperation({
    summary:
      'Change the title, date, auditor, person accountable, audited item or summary',
  })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQualityAuditDto,
    @Req() req: Request,
  ) {
    return this.audits.update(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/begin')
  @Permissions('quality_audits.manage')
  @ApiOperation({ summary: 'Start a due (scheduled) audit' })
  begin(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BeginQualityAuditDto,
    @Req() req: Request,
  ) {
    return this.audits.begin(user, id, dto, getRequestAuditMeta(req));
  }

  @Put(':id/answers/:standardId')
  @Permissions('quality_audits.manage')
  @ApiOperation({
    summary:
      'Mark one standard met or not met, with a note (answer null clears it)',
  })
  answer(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('standardId') standardId: string,
    @Body() dto: AnswerStandardDto,
    @Req() req: Request,
  ) {
    return this.audits.answer(
      user,
      id,
      standardId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post(':id/complete')
  @Permissions('quality_audits.manage')
  @ApiOperation({
    summary:
      'Complete the audit (every standard answered, a note for each not met, within its window)',
  })
  complete(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.audits.complete(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/cancel')
  @Permissions('quality_audits.manage')
  @ApiOperation({ summary: 'Cancel an audit that is due or in progress' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.audits.cancel(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/actions')
  @Permissions('quality_audits.manage')
  @ApiOperation({
    summary: 'Add an action, for one standard or the audit as a whole',
  })
  createAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQualityAuditActionDto,
    @Req() req: Request,
  ) {
    return this.audits.createAction(user, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/actions/:actionId')
  @Permissions('quality_audits.manage')
  @ApiOperation({ summary: 'Change an action or mark it done' })
  updateAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: UpdateQualityAuditActionDto,
    @Req() req: Request,
  ) {
    return this.audits.updateAction(
      user,
      id,
      actionId,
      dto,
      getRequestAuditMeta(req),
    );
  }
}
