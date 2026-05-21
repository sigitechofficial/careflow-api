import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { LocationManagementService } from './location-management.service';
import { UpdateLocationZoneDto } from './dto/update-location-zone.dto';
import { UpdateMemberLocationDto } from './dto/update-member-location.dto';
import { UpdateEmployeeLocationDto } from './dto/update-employee-location.dto';

@ApiTags('Location Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('location-management')
export class LocationManagementController {
  constructor(private readonly service: LocationManagementService) {}

  @Get('tree')
  @AnyPermission('lookups.read', 'schedule_areas.read')
  @ApiOperation({ summary: 'Organisation location tree (zones, service users, employees)' })
  getTree() {
    return this.service.getTree();
  }

  @Get('active-users')
  @AnyPermission('lookups.read', 'schedule_areas.read')
  @ApiOperation({ summary: 'Active users for incident notification selection' })
  listActiveUsers() {
    return this.service.listActiveUsers();
  }

  @Get('zones/:id')
  @AnyPermission('lookups.read', 'schedule_areas.read')
  getZone(@Param('id') id: string) {
    return this.service.getZone(id);
  }

  @Patch('zones/:id')
  @AnyPermission('lookups.manage', 'schedule_areas.update')
  @ApiOperation({ summary: 'Update zone (schedule area) settings' })
  updateZone(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateLocationZoneDto,
    @Req() req: Request,
  ) {
    return this.service.updateZone(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Get('service-users')
  @AnyPermission('lookups.read', 'service_users.read')
  listServiceUserLocations() {
    return this.service.listServiceUserLocations();
  }

  @Patch('service-users/:id/location')
  @AnyPermission('lookups.manage', 'service_users.update')
  updateServiceUserLocation(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateMemberLocationDto,
    @Req() req: Request,
  ) {
    return this.service.updateServiceUserLocation(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Get('employees')
  @AnyPermission('lookups.read', 'employees.read')
  listEmployeeLocations() {
    return this.service.listEmployeeLocations();
  }

  @Patch('employees/:id/location')
  @AnyPermission('lookups.manage', 'employees.update')
  updateEmployeeLocation(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeLocationDto,
    @Req() req: Request,
  ) {
    return this.service.updateEmployeeLocation(user.id, id, dto, getRequestAuditMeta(req));
  }
}
