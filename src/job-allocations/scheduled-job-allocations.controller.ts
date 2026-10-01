import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { JobAllocationsService } from './job-allocations.service';
import { AllocateJobDto } from './dto/allocate-job.dto';
import { AllocateTeamDto } from './dto/allocate-team.dto';
import { UnallocateJobDto } from './dto/unallocate-job.dto';
import { ConfirmAllocationDto } from './dto/confirm-allocation.dto';
import { UpdateAllocationTimingDto } from './dto/update-allocation-timing.dto';
import { SetLeadCarerDto } from './dto/set-lead-carer.dto';

@ApiTags('Scheduled Jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('scheduled-jobs')
export class ScheduledJobAllocationsController {
  constructor(private readonly allocations: JobAllocationsService) {}

  @Get(':id/allocations')
  @Permissions('job_allocations.read')
  @ApiOperation({ summary: 'List allocations for a scheduled job' })
  listForJob(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.allocations.listForJob(id, user);
  }

  @Post(':id/allocate')
  @Permissions('job_allocations.create')
  @ApiOperation({ summary: 'Allocate carer to scheduled job' })
  allocate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AllocateJobDto,
    @Req() req: Request,
  ) {
    return this.allocations.allocate(user.id, id, dto, getRequestAuditMeta(req), user);
  }

  @Post(':id/allocate-team')
  @Permissions('job_allocations.create')
  @ApiOperation({
    summary: 'Allocate the carer team of a multi-carer visit (all-or-nothing, one lead)',
    description:
      'For visits needing 2+ carers. employeeIds = carers to add; together with carers already on the visit they must equal requiredCarers. leadEmployeeId must be on the resulting team. Runs the same checks as /allocate for every carer; if any carer is hard-blocked, or has overridable warnings without force=true, nothing is saved and `carers` lists warnings per carer.',
  })
  allocateTeam(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AllocateTeamDto,
    @Req() req: Request,
  ) {
    return this.allocations.allocateTeam(user.id, id, dto, getRequestAuditMeta(req), user);
  }

  @Post(':id/unallocate')
  @Permissions('job_allocations.delete')
  @ApiOperation({ summary: 'Unallocate carer from scheduled job' })
  unallocate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UnallocateJobDto,
    @Req() req: Request,
  ) {
    return this.allocations.unallocate(user.id, id, dto, getRequestAuditMeta(req), user);
  }

  @Patch(':id/allocations/:allocationId')
  @Permissions('job_allocations.create')
  @ApiOperation({ summary: 'Update assignment timing / lead carer for an allocation' })
  updateTiming(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('allocationId') allocationId: string,
    @Body() dto: UpdateAllocationTimingDto,
    @Req() req: Request,
  ) {
    return this.allocations.updateTiming(
      user.id,
      id,
      allocationId,
      dto,
      getRequestAuditMeta(req),
      user,
    );
  }

  @Post(':id/lead-carer')
  @Permissions('job_allocations.create')
  @ApiOperation({ summary: 'Set the lead carer for a scheduled job' })
  setLeadCarer(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetLeadCarerDto,
    @Req() req: Request,
  ) {
    return this.allocations.setLeadCarer(
      user.id,
      id,
      dto.employeeId,
      getRequestAuditMeta(req),
      user,
    );
  }

  @Post(':id/allocations/:allocationId/confirm')
  @Permissions('job_allocations.confirm')
  @ApiOperation({ summary: 'Confirm pending job allocation' })
  confirm(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('allocationId') allocationId: string,
    @Body() dto: ConfirmAllocationDto,
    @Req() req: Request,
  ) {
    return this.allocations.confirm(
      user.id,
      id,
      allocationId,
      dto,
      getRequestAuditMeta(req),
      user,
    );
  }
}
