import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { RunIaPlaywrightDto } from './dto/run-ia-playwright.dto';
import { DevToolsService } from './dev-tools.service';

@ApiTags('dev-tools')
@ApiBearerAuth()
@Controller('dev')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DevToolsController {
  constructor(private readonly devTools: DevToolsService) {}

  /** Fills initial assessment in-process (no Playwright / care-admin folder required). */
  @Post('run-ia-playwright')
  @Permissions('service_users.initial_assessment.update')
  @ApiOperation({ summary: 'Autofill initial assessment for a service user (dev/demo)' })
  async runIaPlaywright(
    @CurrentUser() user: RequestUser,
    @Body() body: RunIaPlaywrightDto,
    @Req() req: Request,
  ) {
    const data = await this.devTools.runIaPlaywrightAutofill(
      user.id,
      body.serviceUserId,
      body.level,
      getRequestAuditMeta(req),
    );
    return { data };
  }
}
