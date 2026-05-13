import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserAssignmentsService } from './service-user-assignments.service';
import { UpdateServiceUserAssignmentDto } from './dto/update-service-user-assignment.dto';

@ApiTags('Service User Assignments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/assignments')
export class ServiceUserAssignmentsController {
  constructor(private readonly service: ServiceUserAssignmentsService) {}

  @Get()
  @Permissions('service_users.assignments.read')
  @ApiOperation({ summary: 'Get current assignment row' })
  @ApiResponse({ status: 200 })
  get(@Param('id') serviceUserId: string) {
    return this.service.get(serviceUserId);
  }

  @Patch()
  @Permissions('service_users.assignments.update')
  @ApiOperation({ summary: 'Update assignments (syncs ServiceUser + assignment row)' })
  patch(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: UpdateServiceUserAssignmentDto,
    @Req() req: Request,
  ) {
    return this.service.patch(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }
}
