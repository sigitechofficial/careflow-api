import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeNonCoreActivitiesService } from './employee-non-core-activities.service';
import { CreateNonCoreActivityDto } from './dto/create-non-core-activity.dto';
import { UpdateNonCoreActivityDto } from './dto/update-non-core-activity.dto';

@ApiTags('Employee Non-core Activities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/non-core-activities')
export class EmployeeNonCoreActivitiesController {
  constructor(private readonly service: EmployeeNonCoreActivitiesService) {}

  @Get()
  @Permissions('employees.read')
  list(@Param('id') employeeId: string) {
    return this.service.list(employeeId);
  }

  @Post()
  @Permissions('employees.update')
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Body() dto: CreateNonCoreActivityDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Patch(':activityId')
  @Permissions('employees.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('activityId') activityId: string,
    @Body() dto: UpdateNonCoreActivityDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, employeeId, activityId, dto, getRequestAuditMeta(req));
  }

  @Delete(':activityId')
  @Permissions('employees.update')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('activityId') activityId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, employeeId, activityId, getRequestAuditMeta(req));
  }
}
