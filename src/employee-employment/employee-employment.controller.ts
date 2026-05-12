import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeEmploymentService } from './employee-employment.service';
import { UpdateEmployeeEmploymentDto } from './dto/update-employee-employment.dto';

@ApiTags('Employee Employment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employees/:id/employment')
export class EmployeeEmploymentController {
  constructor(private readonly service: EmployeeEmploymentService) {}

  @Get()
  @Permissions('employees.read')
  get(@CurrentUser() user: RequestUser, @Param('id') employeeId: string, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.get(employeeId, { actorUserId: user.id, ...m });
  }

  @Patch()
  @Permissions('employees.update')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') employeeId: string,
    @Body() dto: UpdateEmployeeEmploymentDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, employeeId, dto, getRequestAuditMeta(req));
  }
}
