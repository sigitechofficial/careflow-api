import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { ServiceUserCarePlansService } from './service-user-care-plans.service';
import { CarePlanComposeService } from './care-plan-compose.service';
import {
  ApproveCarePlanDto,
  CarePlanLifecycleReasonDto,
  CarePlanRequirementNotApplicableDto,
  LinkCarePlanRiskDto,
  LinkCarePlanVisitTaskDto,
  PublishCarePlanDto,
  RequestCarePlanChangesDto,
  ResolveReassessmentFlagDto,
  ResumeCarePlanDto,
  SaveCarePlanDraftDto,
  UnlinkCarePlanVisitTaskDto,
} from './dto/save-care-plan-draft.dto';
import { CarePlanTaskReconciliationService } from './care-plan-task-reconciliation.service';
import { CarePlanRiskLinkService } from './care-plan-risk-link.service';

@ApiTags('Service User Care Plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:serviceUserId/care-plans')
export class ServiceUserCarePlansController {
  constructor(
    private readonly service: ServiceUserCarePlansService,
    private readonly composeService: CarePlanComposeService,
    private readonly taskReconciliation: CarePlanTaskReconciliationService,
    private readonly riskLinks: CarePlanRiskLinkService,
  ) {}

  @Get(':carePathwayFormId/risks')
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'IA risks linked to this care plan, risks available to link, reassessment review flags' })
  getCarePlanRisks(
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
  ) {
    return this.riskLinks.getRisks(serviceUserId, carePathwayFormId);
  }

  @Post(':carePathwayFormId/risks/links')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Link an existing IA risk record to this care plan (the risk is not changed)' })
  linkCarePlanRisk(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: LinkCarePlanRiskDto,
    @Req() req: Request,
  ) {
    return this.riskLinks.linkRisk(user.id, serviceUserId, carePathwayFormId, dto.riskRecordId, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/risks/links/:linkId/unlink')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Remove a care plan ↔ risk link (the risk record is kept)' })
  unlinkCarePlanRisk(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Param('linkId') linkId: string,
    @Req() req: Request,
  ) {
    return this.riskLinks.unlinkRisk(user.id, serviceUserId, carePathwayFormId, linkId, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/risks/links/:linkId/review')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Confirm the care plan controls still fit the (changed) risk' })
  reviewCarePlanRisk(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Param('linkId') linkId: string,
    @Req() req: Request,
  ) {
    return this.riskLinks.reviewRiskLink(user.id, serviceUserId, carePathwayFormId, linkId, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/reassessment-flags/:flagId/resolve')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Resolve a reassessment review flag after reviewing the care plan' })
  resolveReassessmentFlag(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Param('flagId') flagId: string,
    @Body() dto: ResolveReassessmentFlagDto,
    @Req() req: Request,
  ) {
    return this.riskLinks.resolveReassessmentFlag(user.id, serviceUserId, carePathwayFormId, flagId, dto.note, getRequestAuditMeta(req));
  }

  @Get(':carePathwayFormId/task-reconciliation')
  @AnyPermission('service_users.visit_tasks.read', 'service_users.read')
  @ApiOperation({ summary: 'Published care plan vs existing visit tasks: links, review items, unlinked tasks' })
  getTaskReconciliation(
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
  ) {
    return this.taskReconciliation.getReconciliation(serviceUserId, carePathwayFormId);
  }

  @Post(':carePathwayFormId/task-reconciliation/links')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Link an existing visit task to the care plan or a structured requirement' })
  linkVisitTask(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: LinkCarePlanVisitTaskDto,
    @Req() req: Request,
  ) {
    return this.taskReconciliation.link(user.id, serviceUserId, carePathwayFormId, dto, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/task-reconciliation/links/:linkId/unlink')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Remove an incorrect care plan → visit task link (the task is not changed)' })
  unlinkVisitTask(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Param('linkId') linkId: string,
    @Body() dto: UnlinkCarePlanVisitTaskDto,
    @Req() req: Request,
  ) {
    return this.taskReconciliation.unlink(user.id, serviceUserId, carePathwayFormId, linkId, dto, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/task-reconciliation/links/:linkId/review')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Confirm a link still holds for the current published version' })
  reviewVisitTaskLink(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Param('linkId') linkId: string,
    @Req() req: Request,
  ) {
    return this.taskReconciliation.markReviewed(user.id, serviceUserId, carePathwayFormId, linkId, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/task-reconciliation/not-applicable')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Record that a structured requirement needs no visit task (reason required)' })
  markRequirementNotApplicable(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: CarePlanRequirementNotApplicableDto,
    @Req() req: Request,
  ) {
    return this.taskReconciliation.markNotApplicable(user.id, serviceUserId, carePathwayFormId, dto, getRequestAuditMeta(req));
  }

  @Get()
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'List care plan instances for a service user' })
  list(@Param('serviceUserId') serviceUserId: string) {
    return this.service.listInstances(serviceUserId);
  }

  @Get(':carePathwayFormId/versions/:versionId')
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'Get a published care plan version' })
  getVersion(
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.service.getVersion(serviceUserId, carePathwayFormId, versionId);
  }

  @Get(':carePathwayFormId/versions')
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'List published care plan versions' })
  listVersions(
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
  ) {
    return this.service.listVersions(serviceUserId, carePathwayFormId);
  }

  @Get(':carePathwayFormId/compose')
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'Compose care plan draft values from sources of truth' })
  compose(
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
  ) {
    return this.composeService.compose(serviceUserId, carePathwayFormId);
  }

  @Get(':carePathwayFormId')
  @AnyPermission('service_users.read', 'service_users.update')
  @ApiOperation({ summary: 'Get care plan instance with draft and latest publish' })
  get(
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
  ) {
    return this.service.getInstance(serviceUserId, carePathwayFormId);
  }

  @Post(':carePathwayFormId/instance')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Create care plan instance if missing' })
  ensureInstance(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
  ) {
    return this.service
      .getOrCreateInstance(user.id, serviceUserId, carePathwayFormId)
      .then(() => this.service.getInstance(serviceUserId, carePathwayFormId));
  }

  @Patch(':carePathwayFormId/draft')
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Save care plan draft' })
  saveDraft(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: SaveCarePlanDraftDto,
    @Req() req: Request,
  ) {
    return this.service.saveDraft(
      user.id,
      serviceUserId,
      carePathwayFormId,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post(':carePathwayFormId/draft/submit-for-approval')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Submit the care plan draft for manager approval' })
  submitForApproval(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Req() req: Request,
  ) {
    return this.service.submitForApproval(user.id, serviceUserId, carePathwayFormId, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/draft/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Approve the submitted care plan draft' })
  approveDraft(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: ApproveCarePlanDto,
    @Req() req: Request,
  ) {
    return this.service.approveDraft(user.id, serviceUserId, carePathwayFormId, dto, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/draft/request-changes')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Return the submitted care plan draft to its author with a reason' })
  requestDraftChanges(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: RequestCarePlanChangesDto,
    @Req() req: Request,
  ) {
    return this.service.requestDraftChanges(user.id, serviceUserId, carePathwayFormId, dto, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/suspend')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Suspend a published care plan (hidden from carers, history kept)' })
  suspend(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: CarePlanLifecycleReasonDto,
    @Req() req: Request,
  ) {
    return this.service.suspend(user.id, serviceUserId, carePathwayFormId, dto, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/resume')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Resume a suspended care plan after confirming it is still appropriate' })
  resume(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: ResumeCarePlanDto,
    @Req() req: Request,
  ) {
    return this.service.resume(user.id, serviceUserId, carePathwayFormId, dto, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/archive')
  @HttpCode(HttpStatus.OK)
  @Permissions('service_users.care_plan.approve')
  @ApiOperation({ summary: 'Archive a care plan (hidden from carers, history kept, no hard delete)' })
  archive(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: CarePlanLifecycleReasonDto,
    @Req() req: Request,
  ) {
    return this.service.archive(user.id, serviceUserId, carePathwayFormId, dto, getRequestAuditMeta(req));
  }

  @Post(':carePathwayFormId/publish')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.update')
  @ApiOperation({ summary: 'Publish care plan draft as new version' })
  publish(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('carePathwayFormId') carePathwayFormId: string,
    @Body() dto: PublishCarePlanDto,
    @Req() req: Request,
  ) {
    return this.service.publish(
      user.id,
      serviceUserId,
      carePathwayFormId,
      dto,
      getRequestAuditMeta(req),
    );
  }
}
