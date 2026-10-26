import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
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
import { RequestContractedHoursChangeDto } from './dto/request-contracted-hours-change.dto';
import { RequestServiceUserHoursChangeDto } from './dto/request-service-user-hours-change.dto';

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

  @Get('contracted-hours/preview')
  @Permissions('employees.read')
  @ApiOperation({ summary: 'What approving a contracted weekly hours value would change' })
  previewContractedHours(
    @Query('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Query('contractedWeeklyHours') contractedWeeklyHours: string,
  ) {
    const hours = Number(contractedWeeklyHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
      throw new BadRequestException('contractedWeeklyHours must be a number between 0 and 168');
    }
    return this.service.previewContractedHoursChange(employeeId, hours);
  }

  @Get('contracted-hours/pending')
  @Permissions('employees.read')
  @ApiOperation({ summary: "A carer's contracted hours change waiting for approval" })
  pendingContractedHours(@Query('employeeId', new ParseUUIDPipe()) employeeId: string) {
    return this.service.pendingContractedHoursChange(employeeId);
  }

  @Post('contracted-hours')
  @Permissions('employees.update')
  @ApiOperation({ summary: 'Send a contracted weekly hours change for manager approval' })
  requestContractedHours(
    @CurrentUser() user: RequestUser,
    @Body() dto: RequestContractedHoursChangeDto,
    @Req() req: Request,
  ) {
    return this.service.requestContractedHoursChange(
      user.id,
      dto.employeeId,
      dto.contractedWeeklyHours,
      dto.reason,
      getRequestAuditMeta(req),
    );
  }

  @Get('service-user-hours/pending')
  @Permissions('service_users.read')
  @ApiOperation({ summary: "A service user's weekly hours change waiting for approval" })
  pendingServiceUserHours(@Query('serviceUserId', new ParseUUIDPipe()) serviceUserId: string) {
    return this.service.pendingServiceUserHoursChange(serviceUserId);
  }

  @Post('service-user-hours')
  @Permissions('service_users.update')
  @ApiOperation({ summary: "Send a service user's weekly hours change for manager approval" })
  requestServiceUserHours(
    @CurrentUser() user: RequestUser,
    @Body() dto: RequestServiceUserHoursChangeDto,
    @Req() req: Request,
  ) {
    return this.service.requestServiceUserHoursChange(
      user.id,
      dto.serviceUserId,
      dto.weeklyContractedHours,
      dto.reason,
      getRequestAuditMeta(req),
    );
  }

  @Post(':id/cancel')
  @AnyPermission('employees.update', 'hours_approvals.manage')
  @ApiOperation({ summary: 'Cancel a pending hours request' })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DecideHoursApprovalDto,
    @Req() req: Request,
  ) {
    return this.service.cancel(user.id, id, dto.notes, getRequestAuditMeta(req));
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
