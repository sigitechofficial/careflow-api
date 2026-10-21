import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { DashboardService } from './dashboard.service';
import { HandoverReportQueryDto } from './dto/handover-report-query.dto';
import { PolicyReviewsQueryDto } from './dto/policy-reviews-query.dto';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('handover-report')
  @AnyPermission('schedule.read', 'scheduled_visits.read', 'service_users.read')
  @ApiOperation({
    summary: 'Handover report for the home dashboard',
    description:
      'Returns recent visit handover / visit notes. Default window uses Organisation General Settings → Handover report last (hours).',
  })
  handoverReport(@Query() query: HandoverReportQueryDto) {
    return this.service.handoverReport(query);
  }

  @Get('policy-reviews')
  @AnyPermission('policies.read')
  @ApiOperation({
    summary: 'Published policies due for review',
    description:
      'Published policies whose current version review date is within the next `days` days (overdue included), plus policy counts by status and published policies with no review date.',
  })
  policyReviews(@Query() query: PolicyReviewsQueryDto) {
    return this.service.policyReviews(query.days ?? 30);
  }
}
