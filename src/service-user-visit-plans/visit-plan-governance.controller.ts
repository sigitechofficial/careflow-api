import { Controller, ForbiddenException, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { ServiceUserVisitPlansService } from './service-user-visit-plans.service';

@ApiTags('Visit Plans Governance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('visit-plans')
export class VisitPlanGovernanceController {
  constructor(private readonly service: ServiceUserVisitPlansService) {}

  @Get('suspension-reviews-overdue')
  @AnyPermission('service_users.visit_plan.read', 'service_users.read', 'scheduling.read')
  @ApiOperation({ summary: 'List suspended visit plans with overdue suspension review dates' })
  listSuspensionReviewsOverdue() {
    return this.service.listSuspensionReviewsOverdue();
  }

  @Post('dev/clear-visit-plans-and-rota')
  @AnyPermission('service_users.visit_plan.write', 'service_users.update', 'scheduling.write')
  @ApiOperation({
    summary: 'Dev only — delete all visit plans and rota (same as prisma/scripts/clear-visit-plans-and-rota.ts)',
  })
  clearVisitPlansAndRota(@Query('dryRun') dryRun?: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Clear visit plans and rota is not available in production');
    }
    const isDryRun = dryRun === 'true' || dryRun === '1';
    return this.service.clearAllVisitPlansAndRota(isDryRun);
  }
}
