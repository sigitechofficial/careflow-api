import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeCertificationsService } from './employee-certifications.service';
import { CreateEmployeeCertificationDto } from './dto/create-employee-certification.dto';
import { UpdateEmployeeCertificationDto } from './dto/update-employee-certification.dto';

@ApiTags('Employee Certifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/certifications')
export class EmployeeCertificationsController {
  constructor(private readonly service: EmployeeCertificationsService) {}

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
    @Body() dto: CreateEmployeeCertificationDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, employeeId, dto, getRequestAuditMeta(req));
  }

  @Patch(':certificationId')
  @Permissions('employees.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('certificationId') certificationId: string,
    @Body() dto: UpdateEmployeeCertificationDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, employeeId, certificationId, dto, getRequestAuditMeta(req));
  }

  @Delete(':certificationId')
  @Permissions('employees.update')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Param('certificationId') certificationId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, employeeId, certificationId, getRequestAuditMeta(req));
  }
}
