import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFloatPipe,
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
import { CarerExtraHoursService } from './carer-extra-hours.service';
import { CancelExtraWeeklyHoursDto, GrantExtraWeeklyHoursDto } from './dto/grant-extra-weekly-hours.dto';
import { HoursHistoryService } from './hours-history.service';
import { HoursHistoryQueryDto } from './dto/hours-history-query.dto';

@ApiTags('Employee hours approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hours-approvals')
export class EmployeeHoursApprovalsController {
  constructor(
    private readonly service: EmployeeHoursApprovalsService,
    private readonly extraHours: CarerExtraHoursService,
    private readonly history: HoursHistoryService,
  ) {}

  @Get()
  @AnyPermission('hours_approvals.read', 'hours_approvals.manage')
  @ApiOperation({ summary: 'List employee over-contracted-hours approvals' })
  list(@Query('status') status?: EmployeeHoursApprovalStatus) {
    return this.service.list(status);
  }

  @Get('history')
  @AnyPermission('hours_approvals.read', 'hours_approvals.manage')
  @ApiOperation({
    summary: 'Extra hours, hours requests, extra and special visits: who gave, asked and approved',
  })
  historyList(@Query() query: HoursHistoryQueryDto) {
    return this.history.list(query);
  }

  @Delete()
  @Permissions('hours_approvals.manage')
  @ApiOperation({ summary: 'Delete every hours request with the given status' })
  deleteAll(
    @CurrentUser() user: RequestUser,
    @Query('status') status: EmployeeHoursApprovalStatus,
    @Req() req: Request,
  ) {
    return this.service.deleteAll(user.id, status, getRequestAuditMeta(req));
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

  @Post('check-within-limit')
  @AnyPermission('hours_approvals.read', 'hours_approvals.manage')
  @ApiOperation({
    summary: 'Expire stale visit requests, then approve carer requests back within the weekly hours (runs when Hours approvals opens)',
  })
  async checkWithinLimit() {
    // Visits that can no longer happen move to Expired first.
    await this.service.expireStaleRequests();
    return this.extraHours.approveBackWithinLimit().then((data) => ({
      message: data.approved.length
        ? `${data.approved.length} request(s) approved automatically`
        : 'No request is back within the weekly hours',
      data,
    }));
  }

  @Get('extra-hours')
  @Permissions('employees.read')
  @ApiOperation({ summary: "A carer's extra weekly hours (with cancelled ones, as the record)" })
  listExtraHours(@Query('employeeId', new ParseUUIDPipe()) employeeId: string) {
    return this.extraHours.list(employeeId);
  }

  @Post('extra-hours')
  @Permissions('employees.extra_hours.manage')
  @ApiOperation({ summary: 'Give a carer extra weekly hours for a day, a week or a date range' })
  grantExtraHours(
    @CurrentUser() user: RequestUser,
    @Body() dto: GrantExtraWeeklyHoursDto,
    @Req() req: Request,
  ) {
    return this.extraHours.grant(user.id, dto, getRequestAuditMeta(req));
  }

  @Post('extra-hours/preview')
  @Permissions('employees.extra_hours.manage')
  @ApiOperation({ summary: 'What adding extra weekly hours would do (nothing is saved)' })
  previewExtraHours(@Body() dto: GrantExtraWeeklyHoursDto) {
    return this.extraHours.preview(dto);
  }

  @Post('extra-hours/:id/cancel')
  @Permissions('employees.extra_hours.manage')
  @ApiOperation({ summary: 'Cancel extra weekly hours given by mistake' })
  cancelExtraHours(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelExtraWeeklyHoursDto,
    @Req() req: Request,
  ) {
    return this.extraHours.cancel(user.id, id, dto.reason, getRequestAuditMeta(req));
  }

  @Get('service-user-hours/pending')
  @Permissions('service_users.read')
  @ApiOperation({ summary: "A service user's weekly hours change waiting for approval" })
  pendingServiceUserHours(@Query('serviceUserId', new ParseUUIDPipe()) serviceUserId: string) {
    return this.service.pendingServiceUserHoursChange(serviceUserId);
  }

  @Get('service-user-hours/impact')
  @Permissions('service_users.read')
  @ApiOperation({ summary: 'What lowering a service user\'s weekly hours would do to their visits' })
  serviceUserHoursImpact(
    @Query('serviceUserId', new ParseUUIDPipe()) serviceUserId: string,
    @Query('weeklyHours', new ParseFloatPipe()) weeklyHours: number,
  ) {
    return this.service.serviceUserHoursImpact(serviceUserId, weeklyHours);
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

  @Get(':id/reject-preview')
  @Permissions('hours_approvals.manage')
  @ApiOperation({ summary: 'Visits Reject would leave without the carer (nothing saved)' })
  rejectPreview(@Param('id') id: string) {
    return this.service.rejectPreview(id);
  }

  @Post(':id/reject')
  @Permissions('hours_approvals.manage')
  @ApiOperation({ summary: 'Reject a request (a reason is required); over-hours visits stay without the carer' })
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DecideHoursApprovalDto,
    @Req() req: Request,
  ) {
    return this.service.reject(user.id, id, dto.notes, getRequestAuditMeta(req));
  }
}
