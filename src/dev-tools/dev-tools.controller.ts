import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { DevToolsGuard } from '../common/guards/dev-tools.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { RunIaSectionDto } from './dto/run-ia-section.dto';
import { DevToolsService } from './dev-tools.service';

@ApiTags('dev-tools')
@ApiBearerAuth()
@Controller('dev')
// DevToolsGuard: non-production only (or ENABLE_DEV_TOOLS=true) — never fabricate data in prod.
@UseGuards(JwtAuthGuard, PermissionsGuard, DevToolsGuard)
export class DevToolsController {
  constructor(private readonly devTools: DevToolsService) {}

  /** Populates ONE holistic tab/section by severity (dev/QA). Never submits the assessment. */
  @Post('run-ia-section')
  @Permissions('service_users.initial_assessment.update')
  @ApiOperation({ summary: 'Populate a single initial-assessment section with demo data (dev/QA)' })
  async runIaSection(
    @CurrentUser() user: RequestUser,
    @Body() body: RunIaSectionDto,
    @Req() req: Request,
  ) {
    const data = await this.devTools.runIaSectionAutofill(
      user.id,
      body.serviceUserId,
      body.level,
      body.tabId,
      body.questionIds,
      getRequestAuditMeta(req),
    );
    return { data };
  }
}
