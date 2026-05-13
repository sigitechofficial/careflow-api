import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ServiceUserAllergiesService } from './service-user-allergies.service';
import { CreateServiceUserAllergyDto } from './dto/create-service-user-allergy.dto';
import { UpdateServiceUserAllergyDto } from './dto/update-service-user-allergy.dto';

@ApiTags('Service User Allergies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/allergies')
export class ServiceUserAllergiesController {
  constructor(private readonly service: ServiceUserAllergiesService) {}

  @Get()
  @AnyPermission('service_users.allergies.read', 'service_users.read')
  @ApiOperation({ summary: 'List allergies for a service user' })
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.allergies.create', 'service_users.update')
  @ApiOperation({ summary: 'Add allergy' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateServiceUserAllergyDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':allergyId')
  @AnyPermission('service_users.allergies.update', 'service_users.update')
  @ApiOperation({ summary: 'Update allergy' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('allergyId') allergyId: string,
    @Body() dto: UpdateServiceUserAllergyDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, allergyId, dto, getRequestAuditMeta(req));
  }

  @Delete(':allergyId')
  @AnyPermission('service_users.allergies.delete', 'service_users.delete')
  @ApiOperation({ summary: 'Remove allergy' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('allergyId') allergyId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, allergyId, getRequestAuditMeta(req));
  }
}
