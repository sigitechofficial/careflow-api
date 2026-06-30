import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserVisitTasksService } from './service-user-visit-tasks.service';
import { ReplaceServiceUserVisitTasksDto } from './dto/replace-service-user-visit-tasks.dto';

@ApiTags('Service User Visit Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/visit-tasks')
export class ServiceUserVisitTasksController {
  constructor(private readonly service: ServiceUserVisitTasksService) {}

  @Get()
  @AnyPermission('service_users.visit_tasks.read', 'service_users.read')
  @ApiOperation({ summary: 'List visit task assignments for a service user' })
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Put()
  @AnyPermission('service_users.visit_tasks.write', 'service_users.update')
  @ApiOperation({ summary: 'Replace visit task assignments grouped by medication round' })
  replace(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: ReplaceServiceUserVisitTasksDto,
    @Req() req: Request,
  ) {
    return this.service.replace(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }
}
