import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeEmergencyContactsService } from './employee-emergency-contacts.service';
import { CreateEmergencyContactDto } from './dto/create-emergency-contact.dto';
import { UpdateEmergencyContactDto } from './dto/update-emergency-contact.dto';

@ApiTags('Employee Emergency Contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/emergency-contacts')
export class EmployeeEmergencyContactsController {
  constructor(private readonly service: EmployeeEmergencyContactsService) {}

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
    @Body() dto: CreateEmergencyContactDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Patch(':contactId')
  @Permissions('employees.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateEmergencyContactDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, employeeId, contactId, dto, getRequestAuditMeta(req));
  }

  @Delete(':contactId')
  @Permissions('employees.update')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('contactId') contactId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, employeeId, contactId, getRequestAuditMeta(req));
  }
}
