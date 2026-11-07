import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ScriptsService } from './scripts.service';
import {
  FinishVisitCreationRunDto,
  StartVisitCreationRunDto,
} from './dto/visit-creation-run.dto';

/**
 * Scripts page → Visit Creation. The run itself calls the existing visit plan, visit task and
 * medication endpoints (each with its own permission); these routes serve the configured automation,
 * check a run's selections and record it in the audit log. Same permission as saving a visit plan.
 */
@ApiTags('Scripts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('scripts/visit-creation')
export class ScriptsController {
  constructor(private readonly service: ScriptsService) {}

  @Get('config')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({
    summary:
      'The configured Visit Creation automation (Automatic Visit Creation)',
  })
  config() {
    return this.service.visitCreationConfig();
  }

  @Post('runs')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({
    summary: 'Check and record the start of a Visit Creation run',
  })
  start(
    @CurrentUser() user: RequestUser,
    @Body() dto: StartVisitCreationRunDto,
    @Req() req: Request,
  ) {
    return this.service.startVisitCreationRun(
      user,
      dto,
      getRequestAuditMeta(req),
    );
  }

  @Post('runs/:runId/finish')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update')
  @ApiOperation({
    summary: 'Record how a Visit Creation run ended, with its result',
  })
  finish(
    @CurrentUser() user: RequestUser,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: FinishVisitCreationRunDto,
    @Req() req: Request,
  ) {
    return this.service.finishVisitCreationRun(
      user,
      runId,
      dto,
      getRequestAuditMeta(req),
    );
  }
}
