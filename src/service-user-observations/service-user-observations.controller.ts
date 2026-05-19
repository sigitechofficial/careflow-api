import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserObservationsService } from './service-user-observations.service';
import { CreateServiceUserObservationDto } from './dto/create-service-user-observation.dto';
import { ObservationQueryDto } from './dto/observation-query.dto';

@ApiTags('Service User Observations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/observations')
export class ServiceUserObservationsController {
  constructor(private readonly service: ServiceUserObservationsService) {}

  @Get()
  @AnyPermission('service_users.observations.read', 'service_users.read')
  @ApiOperation({ summary: 'List observations for a service user (optional type filter)' })
  list(@Param('id') serviceUserId: string, @Query() query: ObservationQueryDto) {
    return this.service.list(serviceUserId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.observations.create', 'service_users.update')
  @ApiOperation({ summary: 'Record an observation' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateServiceUserObservationDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Delete(':observationId')
  @AnyPermission('service_users.observations.delete', 'service_users.delete')
  @ApiOperation({ summary: 'Soft-delete an observation' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('observationId') observationId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, observationId, getRequestAuditMeta(req));
  }
}
