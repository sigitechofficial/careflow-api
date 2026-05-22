import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CarePathwayService } from './care-pathway.service';

@ApiTags('Care Pathway')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('care-pathway')
export class CarePathwayController {
  constructor(private readonly service: CarePathwayService) {}

  @Get('overview')
  @Permissions('care_pathway.read')
  @ApiOperation({ summary: 'Care Pathway wizard overview and tab metadata' })
  overview(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.service.getOverview(user.id, getRequestAuditMeta(req));
  }
}
