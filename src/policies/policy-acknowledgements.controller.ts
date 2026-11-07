import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PolicyAcknowledgementsService } from './policy-acknowledgements.service';

/**
 * Staff read-and-acknowledge (admin web app). Acknowledgements belong to the employee whose
 * personal email matches the signed-in user; managers see reports within their branch scope.
 */
@ApiTags('Policy acknowledgements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('policy-acknowledgements')
export class PolicyAcknowledgementsController {
  constructor(private readonly service: PolicyAcknowledgementsService) {}

  @Get('mine')
  @Permissions('policies.acknowledgements.me')
  @ApiOperation({ summary: 'Policies I must read and acknowledge, with status and due dates' })
  mine(@CurrentUser() user: RequestUser) {
    return this.service.listForUser(user);
  }

  @Get('summary')
  @Permissions('policies.acknowledgements.manage')
  @ApiOperation({ summary: 'Per published policy needing acknowledgement: required, acknowledged and overdue counts' })
  summary(@CurrentUser() user: RequestUser) {
    return this.service.summary(user);
  }

  @Get('policies/:documentId/publish-preview')
  @AnyPermission('policies.publish', 'policies.acknowledgements.manage')
  @ApiOperation({
    summary: 'Publish dialog: how many staff would need to acknowledge the working version, and by when',
  })
  publishPreview(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.service.publishPreview(documentId);
  }

  @Get('policies/:documentId')
  @Permissions('policies.acknowledgements.manage')
  @ApiOperation({ summary: 'Staff acknowledgements for the current published version of a policy' })
  report(@CurrentUser() user: RequestUser, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.service.documentReport(user, documentId);
  }

  @Post(':documentId/viewed')
  @Permissions('policies.acknowledgements.me')
  @ApiOperation({ summary: 'Record that I opened the policy (no change once acknowledged)' })
  viewed(@CurrentUser() user: RequestUser, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.service.recordViewedForUser(user, documentId);
  }

  @Post(':documentId/acknowledge')
  @Permissions('policies.acknowledgements.me')
  @ApiOperation({ summary: 'Confirm I have read and understood the current version of the policy' })
  acknowledge(
    @CurrentUser() user: RequestUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
  ) {
    return this.service.acknowledgeForUser(user, documentId, getRequestAuditMeta(req));
  }
}
