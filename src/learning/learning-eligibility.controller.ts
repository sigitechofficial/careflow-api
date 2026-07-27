import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { LearningEligibilityService } from './learning-eligibility.service';

@ApiTags('Learning — Eligibility')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('learning/employees')
export class LearningEligibilityController {
  constructor(private readonly service: LearningEligibilityService) {}

  @Get(':employeeId/eligibility')
  @Permissions('learning.compliance.read')
  @ApiOperation({ summary: 'Check employee learning eligibility for roster restrictions' })
  getEligibility(@Param('employeeId') employeeId: string) {
    return this.service.getEmployeeEligibility(employeeId);
  }
}
