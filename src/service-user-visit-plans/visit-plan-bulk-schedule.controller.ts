import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { BulkGenerateVisitPlanScheduleDto } from './dto/bulk-generate-visit-plan-schedule.dto';
import { BulkVisitPlanScheduleCandidatesQueryDto } from './dto/bulk-visit-plan-schedule-query.dto';
import { VisitPlanBulkScheduleService } from './visit-plan-bulk-schedule.service';

@ApiTags('Visit Plan Bulk Schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('visit-plan-bulk-schedule')
export class VisitPlanBulkScheduleController {
  constructor(private readonly service: VisitPlanBulkScheduleService) {}

  @Get('candidates')
  @AnyPermission(
    'scheduling.generate_from_visit_plan',
    'schedules.build',
    'scheduled_visits.create',
    'service_users.visit_plan.read',
  )
  @ApiOperation({ summary: 'List active visit plans eligible for bulk rota generation' })
  listCandidates(@Query() query: BulkVisitPlanScheduleCandidatesQueryDto) {
    return this.service.listCandidates(query);
  }

  @Post('generate')
  @AnyPermission('scheduling.generate_from_visit_plan', 'schedules.build', 'scheduled_visits.create')
  @ApiOperation({ summary: 'Generate rota from multiple active visit plans' })
  bulkGenerate(
    @CurrentUser() user: RequestUser,
    @Body() dto: BulkGenerateVisitPlanScheduleDto,
    @Req() req: Request,
  ) {
    return this.service.bulkGenerate(user.id, dto, getRequestAuditMeta(req));
  }
}
