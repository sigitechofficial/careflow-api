import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { CqcNotificationsService } from './cqc-notifications.service';
import { CqcNotificationPoliciesService } from './cqc-notification-policies.service';
import {
  AcknowledgeCqcNotificationDto,
  AddCqcNotificationPolicyDto,
  CloseCqcNotificationDto,
  CreateCqcNotificationDto,
  ListCqcNotificationsQueryDto,
  SubmitCqcNotificationDto,
  UpdateCqcNotificationDto,
} from './dto/cqc-notifications.dto';

/**
 * Governance → CQC notifications. Read: cqc_notifications.read; create, change and record
 * submission: cqc_notifications.manage.
 */
@ApiTags('CQC notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cqc-notifications')
export class CqcNotificationsController {
  constructor(
    private readonly notifications: CqcNotificationsService,
    private readonly policies: CqcNotificationPoliciesService,
  ) {}

  @Get('types')
  @Permissions('cqc_notifications.read')
  @ApiOperation({
    summary: 'Notification types, their fields and the internal target',
  })
  types() {
    return this.notifications.types();
  }

  @Get('summary')
  @Permissions('cqc_notifications.read')
  @ApiOperation({
    summary: 'Counts: drafts, ready, due soon, overdue, submitted this month',
  })
  summary(
    @CurrentUser() user: RequestUser,
    @Query('locationId', new ParseUUIDPipe({ optional: true }))
    locationId?: string,
  ) {
    return this.notifications.summary(user, locationId);
  }

  @Get('candidates')
  @Permissions('cqc_notifications.read')
  @ApiOperation({
    summary:
      'Incidents and safeguarding cases from the last 30 days that may need a notification and have none yet',
  })
  candidates(@CurrentUser() user: RequestUser) {
    return this.notifications.candidates(user);
  }

  @Get()
  @Permissions('cqc_notifications.read')
  @ApiOperation({
    summary: 'Notifications (filters: status, type, branch, overdue, search)',
  })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListCqcNotificationsQueryDto,
  ) {
    return this.notifications.list(user, query);
  }

  @Post()
  @Permissions('cqc_notifications.manage')
  @ApiOperation({ summary: 'Start a draft notification' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCqcNotificationDto,
    @Req() req: Request,
  ) {
    return this.notifications.create(user, dto, getRequestAuditMeta(req));
  }

  @Get(':id')
  @Permissions('cqc_notifications.read')
  @ApiOperation({ summary: 'One notification' })
  get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.get(user, id);
  }

  @Patch(':id')
  @Permissions('cqc_notifications.manage')
  @ApiOperation({ summary: 'Change a draft or ready notification' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCqcNotificationDto,
    @Req() req: Request,
  ) {
    return this.notifications.update(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/ready')
  @Permissions('cqc_notifications.manage')
  @ApiOperation({
    summary: 'Mark ready to submit (required answers must be filled in)',
  })
  ready(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.notifications.markReady(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/reopen')
  @Permissions('cqc_notifications.manage')
  @ApiOperation({
    summary: 'Move a ready or not-required notification back to draft',
  })
  reopen(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.notifications.reopen(user, id, getRequestAuditMeta(req));
  }

  @Post(':id/submit')
  @Permissions('cqc_notifications.manage')
  @ApiOperation({
    summary: 'Record that it was submitted to CQC (freezes what was sent)',
  })
  submit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitCqcNotificationDto,
    @Req() req: Request,
  ) {
    return this.notifications.submit(user, id, dto, getRequestAuditMeta(req));
  }

  @Post(':id/acknowledge')
  @Permissions('cqc_notifications.manage')
  @ApiOperation({ summary: 'Record CQC’s acknowledgement and reference' })
  acknowledge(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcknowledgeCqcNotificationDto,
    @Req() req: Request,
  ) {
    return this.notifications.acknowledge(
      user,
      id,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post(':id/not-required')
  @Permissions('cqc_notifications.manage')
  @ApiOperation({
    summary: 'Record that no notification is needed, with the reason',
  })
  notRequired(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCqcNotificationDto,
    @Req() req: Request,
  ) {
    return this.notifications.markNotRequired(
      user,
      id,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post(':id/cancel')
  @Permissions('cqc_notifications.manage')
  @ApiOperation({ summary: 'Cancel a notification started by mistake' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCqcNotificationDto,
    @Req() req: Request,
  ) {
    return this.notifications.cancel(user, id, dto, getRequestAuditMeta(req));
  }

  @Get(':id/policies')
  @Permissions('cqc_notifications.read')
  @ApiOperation({
    summary:
      'Attached policies, suggestions for this notification, and suggested policies not adopted yet',
  })
  listPolicies(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.policies.overview(user, id);
  }

  @Get(':id/policies/search')
  @Permissions('cqc_notifications.manage')
  @ApiOperation({
    summary: 'Published policies for this branch that can be attached',
  })
  searchPolicies(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('q') q?: string,
  ) {
    return this.policies.search(user, id, q);
  }

  @Post(':id/policies')
  @Permissions('cqc_notifications.manage')
  @ApiOperation({ summary: 'Attach a published policy (draft or ready only)' })
  addPolicy(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCqcNotificationPolicyDto,
    @Req() req: Request,
  ) {
    return this.policies.add(
      user,
      id,
      dto.policyDocumentId,
      dto.source ?? 'MANUAL',
      getRequestAuditMeta(req),
    );
  }

  @Delete(':id/policies/:policyDocumentId')
  @Permissions('cqc_notifications.manage')
  @ApiOperation({ summary: 'Remove an attached policy (draft or ready only)' })
  removePolicy(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('policyDocumentId', ParseUUIDPipe) policyDocumentId: string,
    @Req() req: Request,
  ) {
    return this.policies.remove(
      user,
      id,
      policyDocumentId,
      getRequestAuditMeta(req),
    );
  }
}
