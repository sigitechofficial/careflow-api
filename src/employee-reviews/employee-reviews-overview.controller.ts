import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { EmployeeReviewsService } from './employee-reviews.service';

@ApiTags('Employee Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employee-reviews')
export class EmployeeReviewsOverviewController {
  constructor(private readonly service: EmployeeReviewsService) {}

  @Get('overview')
  @Permissions('employees.read')
  @ApiOperation({ summary: 'Organisation-wide staff review rows for hub / reports' })
  listOverview() {
    return this.service.listOverview();
  }
}
