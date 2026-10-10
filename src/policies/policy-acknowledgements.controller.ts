import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PolicyAcknowledgementsService } from './policy-acknowledgements.service';

@ApiTags('Policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('policy-acknowledgements')
export class PolicyAcknowledgementsController {
  constructor(private readonly service: PolicyAcknowledgementsService) {}

  @Get('mine')
  @Permissions('policies.read')
  @ApiOperation({ summary: 'Policies the current user must read and acknowledge, with their status' })
  mine(@CurrentUser() user: RequestUser) {
    return this.service.mine(user);
  }

  @Get('summary')
  @Permissions('policies.read')
  @ApiOperation({ summary: 'Read-and-acknowledge compliance across policies and staff' })
  summary() {
    return this.service.summary();
  }

  @Get('documents/:documentId')
  @Permissions('policies.read')
  @ApiOperation({ summary: 'Staff who must read a policy’s current version, with their acknowledgement status' })
  forDocument(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.service.forDocument(documentId);
  }

  @Post('versions/:versionId/view')
  @HttpCode(HttpStatus.OK)
  @Permissions('policies.read')
  @ApiOperation({ summary: 'Record that the current user opened a policy version' })
  view(@CurrentUser() user: RequestUser, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.service.markViewed(user, versionId);
  }

  @Post('versions/:versionId/acknowledge')
  @HttpCode(HttpStatus.OK)
  @Permissions('policies.read')
  @ApiOperation({ summary: 'Confirm the current user has read and understood a policy version' })
  acknowledge(
    @CurrentUser() user: RequestUser,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() req: Request,
  ) {
    return this.service.acknowledge(user, versionId, getRequestAuditMeta(req));
  }
}
