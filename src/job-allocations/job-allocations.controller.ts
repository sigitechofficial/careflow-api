import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { JobAllocationsService } from './job-allocations.service';
import { AllocationQueryDto } from './dto/allocation-query.dto';

@ApiTags('Job Allocations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('job-allocations')
export class JobAllocationsController {
  constructor(private readonly service: JobAllocationsService) {}

  @Get()
  @Permissions('job_allocations.read')
  @ApiOperation({ summary: 'List job allocations' })
  list(@CurrentUser() user: RequestUser, @Query() query: AllocationQueryDto) {
    return this.service.list(query, user);
  }

  @Get(':id')
  @Permissions('job_allocations.read')
  @ApiOperation({ summary: 'Get job allocation by id' })
  getById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.getById(id, user);
  }
}
