import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { LearningDashboardService } from './learning-dashboard.service';

@ApiTags('Learning — Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/dashboard')
export class LearningDashboardController {
  constructor(private readonly service: LearningDashboardService) {}

  @Get('summary')
  @Permissions('learning.dashboard.read')
  @ApiOperation({ summary: 'Learning dashboard KPI summary' })
  summary() {
    return this.service.summary();
  }
}
