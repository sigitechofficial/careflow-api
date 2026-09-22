import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { EmployeeHoursApprovalStatus } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeHoursApprovalsService } from './employee-hours-approvals.service';
import { DecideHoursApprovalDto } from './dto/decide-hours-approval.dto';

@ApiTags('Employee hours approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hours-approvals')
export class EmployeeHoursApprovalsController {
  constructor(private readonly service: EmployeeHoursApprovalsService) {}

  @Get()
  @AnyPermission('hours_approvals.read', 'hours_approvals.manage')
  @ApiOperation({ summary: 'List employee over-contracted-hours approvals' })
  list(@Query('status') status?: EmployeeHoursApprovalStatus) {
    return this.service.list(status);
  }

  @Post(':id/approve')
  @Permissions('hours_approvals.manage')
  @ApiOperation({ summary: 'Approve extra hours for a carer' })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DecideHoursApprovalDto,
    @Req() req: Request,
  ) {
    return this.service.approve(user.id, id, dto.notes, getRequestAuditMeta(req));
  }

  @Post(':id/reject')
  @Permissions('hours_approvals.manage')
  @ApiOperation({ summary: 'Reject extra hours and remove the carer from the plan' })
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DecideHoursApprovalDto,
    @Req() req: Request,
  ) {
    return this.service.reject(user.id, id, dto.notes, getRequestAuditMeta(req));
  }
}
