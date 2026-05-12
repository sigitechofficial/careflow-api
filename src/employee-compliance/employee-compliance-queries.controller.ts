import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { EmployeeComplianceService } from './employee-compliance.service';

class ExpiringQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 30;
}

@ApiTags('Employee Compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('employee-compliance')
export class EmployeeComplianceQueriesController {
  constructor(private readonly service: EmployeeComplianceService) {}

  @Get('expiring')
  @Permissions('employees.compliance.read')
  expiring(@CurrentUser() user: RequestUser, @Query() query: ExpiringQueryDto, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.expiring(query.days ?? 30, { actorUserId: user.id, ...m });
  }

  @Get('missing')
  @Permissions('employees.compliance.read')
  missing(@CurrentUser() user: RequestUser, @Req() req: Request) {
    const m = getRequestAuditMeta(req);
    return this.service.missing({ actorUserId: user.id, ...m });
  }
}
