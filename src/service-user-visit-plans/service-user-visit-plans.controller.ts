import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserVisitPlansService } from './service-user-visit-plans.service';
import { CreateVisitPlanDto } from './dto/create-visit-plan.dto';
import { UpdateVisitPlanDto } from './dto/update-visit-plan.dto';
import { SuspendVisitPlanDto, ActivateVisitPlanDto } from './dto/suspend-visit-plan.dto';
import {
  GenerateVisitPlanSchedulePreviewQueryDto,
  VisitPlanReturnImpactPreviewQueryDto,
  VisitPlanSkipImpactPreviewQueryDto,
} from './dto/visit-plan-impact-preview.dto';
import { VisitPlanStatusChangeDto } from './dto/visit-plan-status.dto';
import { VisitPlanScheduleImpactPreviewQueryDto } from './dto/visit-plan-schedule-impact-preview-query.dto';
import { GenerateVisitPlanScheduleDto } from './dto/generate-visit-plan-schedule.dto';
import { SuggestVisitPlanCarersDto } from './dto/suggest-visit-plan-carers.dto';
import { VisitPlanCalendarVisitsQueryDto } from './dto/visit-plan-calendar-visits-query.dto';
import { RecordVisitPlanCalendarOutcomeDto } from './dto/record-visit-plan-calendar-outcome.dto';

@ApiTags('Service User Visit Plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/visit-plans')
export class ServiceUserVisitPlansController {
  constructor(private readonly service: ServiceUserVisitPlansService) {}

  @Get()
  @AnyPermission('service_users.visit_plan.read', 'service_users.read')
  @ApiOperation({ summary: 'List visit plans for a service user' })
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Get('active')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read')
  @ApiOperation({ summary: 'Active visit plan for a service user' })
  getActive(@Param('id') serviceUserId: string) {
    return this.service.getActive(serviceUserId);
  }

  @Post('suggest-carers')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read', 'scheduling.allocate')
  @ApiOperation({ summary: 'Suggest carers for a visit plan slot (availability, skills, preferences)' })
  suggestCarers(@Param('id') serviceUserId: string, @Body() dto: SuggestVisitPlanCarersDto) {
    return this.service.suggestCarers(serviceUserId, dto);
  }

  @Get(':planId')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read')
  @ApiOperation({ summary: 'Get a visit plan by id' })
  getById(@Param('id') serviceUserId: string, @Param('planId') planId: string) {
    return this.service.getById(serviceUserId, planId);
  }

  @Post()
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({ summary: 'Create a draft visit plan' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateVisitPlanDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Post('from-assessment/:submissionId')
  @AnyPermission('service_users.visit_plan.write', 'service_users.initial_assessment.review')
  @ApiOperation({ summary: 'Create draft visit plan from initial assessment submission' })
  createFromAssessment(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('submissionId') submissionId: string,
    @Req() req: Request,
  ) {
    return this.service.createDraftFromAssessment(user.id, serviceUserId, submissionId, getRequestAuditMeta(req));
  }

  @Post(':planId/amendment-impact-preview')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read', 'scheduling.read')
  @ApiOperation({ summary: 'Preview rota impact of a live plan amendment without saving' })
  previewAmendmentImpact(
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Body() dto: UpdateVisitPlanDto,
  ) {
    return this.service.previewAmendmentScheduleImpact(serviceUserId, planId, dto);
  }

  @Get(':planId/activate-impact-preview')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read', 'scheduling.read')
  @ApiOperation({ summary: 'Preview rota cancellations when activating a plan that replaces another active package' })
  previewActivateImpact(@Param('id') serviceUserId: string, @Param('planId') planId: string) {
    return this.service.previewActivateScheduleImpact(serviceUserId, planId);
  }

  @Get(':planId/generate-schedule-preview')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read', 'scheduling.read')
  @ApiOperation({ summary: 'Preview visits that would be created by generate-schedule' })
  previewGenerateSchedule(
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Query() query: GenerateVisitPlanSchedulePreviewQueryDto,
  ) {
    return this.service.previewGenerateSchedule(serviceUserId, planId, query);
  }

  @Get(':planId/slots/:slotId/skip-impact-preview')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read', 'scheduling.read')
  @ApiOperation({ summary: 'Preview rota impact of adding a SKIP exception on a date' })
  previewSkipImpact(
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Param('slotId') slotId: string,
    @Query() query: VisitPlanSkipImpactPreviewQueryDto,
  ) {
    return this.service.previewSkipScheduleImpact(serviceUserId, planId, slotId, query);
  }

  @Patch(':planId')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({ summary: 'Update visit plan (records amendment)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Body() dto: UpdateVisitPlanDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, planId, dto, getRequestAuditMeta(req));
  }

  @Post(':planId/activate')
  @AnyPermission('service_users.visit_plan.activate', 'service_users.visit_plan.write')
  @ApiOperation({ summary: 'Activate visit plan (ends any other active plan)' })
  activate(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Body() dto: ActivateVisitPlanDto,
    @Req() req: Request,
  ) {
    return this.service.activate(user.id, serviceUserId, planId, getRequestAuditMeta(req), dto);
  }

  @Post(':planId/suspend')
  @AnyPermission('service_users.visit_plan.activate', 'service_users.visit_plan.write')
  @ApiOperation({ summary: 'Suspend active visit plan' })
  suspend(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Body() dto: SuspendVisitPlanDto,
    @Req() req: Request,
  ) {
    return this.service.suspend(user.id, serviceUserId, planId, dto, getRequestAuditMeta(req));
  }

  @Get(':planId/end-impact-preview')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read', 'scheduling.read')
  @ApiOperation({ summary: 'Preview rota cancellations when ending a visit plan from a given date' })
  previewEndImpact(
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Query() query: VisitPlanScheduleImpactPreviewQueryDto,
  ) {
    return this.service.previewEndScheduleImpact(serviceUserId, planId, query);
  }

  @Get(':planId/suspend-impact-preview')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read', 'scheduling.read')
  @ApiOperation({ summary: 'Preview rota cancellations when suspending from a given date' })
  previewSuspendImpact(
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Query() query: VisitPlanScheduleImpactPreviewQueryDto,
  ) {
    return this.service.previewSuspendScheduleImpact(serviceUserId, planId, query);
  }

  @Post(':planId/end')
  @AnyPermission('service_users.visit_plan.activate', 'service_users.visit_plan.write')
  @ApiOperation({ summary: 'End visit plan (immediate, retrospective, or scheduled future closure)' })
  end(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Body() dto: VisitPlanStatusChangeDto,
    @Req() req: Request,
  ) {
    return this.service.end(user.id, serviceUserId, planId, dto, getRequestAuditMeta(req));
  }

  @Post(':planId/prefill-dom-care')
  @AnyPermission('service_users.visit_plan.write', 'service_users.dom_care.update')
  @ApiOperation({ summary: 'Prefill contracted hours and carers from dom-care profile' })
  prefillDomCare(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Req() req: Request,
  ) {
    return this.service.prefillFromDomCare(user.id, serviceUserId, planId, getRequestAuditMeta(req));
  }

  @Get(':planId/calendar-visits')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read', 'scheduled_visits.read')
  @ApiOperation({ summary: 'List scheduled visit outcomes for visit plan calendar' })
  listCalendarVisits(
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Query() query: VisitPlanCalendarVisitsQueryDto,
  ) {
    return this.service.listCalendarVisits(serviceUserId, planId, query);
  }

  @Post(':planId/calendar-visits/record-outcome')
  @AnyPermission(
    'scheduled_visits.status.update',
    'scheduled_visits.update',
    'service_users.visit_plan.write',
  )
  @ApiOperation({ summary: 'Record carer outcome for a visit plan calendar occurrence' })
  recordCalendarOutcome(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Body() dto: RecordVisitPlanCalendarOutcomeDto,
    @Req() req: Request,
  ) {
    return this.service.recordCalendarOutcome(user.id, serviceUserId, planId, dto, getRequestAuditMeta(req));
  }

  @Post(':planId/generate-schedule')
  @AnyPermission('scheduling.generate_from_visit_plan', 'schedules.build', 'scheduled_visits.create')
  @ApiOperation({ summary: 'Generate scheduled visits from active visit plan' })
  generateSchedule(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('planId') planId: string,
    @Body() dto: GenerateVisitPlanScheduleDto,
    @Req() req: Request,
  ) {
    return this.service.generateSchedule(user.id, serviceUserId, planId, dto, getRequestAuditMeta(req));
  }
}
