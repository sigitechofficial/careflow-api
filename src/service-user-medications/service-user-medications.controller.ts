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
  Query,
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
import { ServiceUserMedicationsService } from './service-user-medications.service';
import { ServiceUserMedicationQueryDto } from './dto/service-user-medication-query.dto';
import { CreateServiceUserMedicationDto } from './dto/create-service-user-medication.dto';
import { UpdateServiceUserMedicationDto } from './dto/update-service-user-medication.dto';
import { UpdateMedicationStatusDto } from './dto/update-medication-status.dto';

@ApiTags('Service User Medications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medications')
export class ServiceUserMedicationsController {
  constructor(private readonly service: ServiceUserMedicationsService) {}

  @Get()
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List medications for a service user' })
  list(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Query() query: ServiceUserMedicationQueryDto,
    @Req() req: Request,
  ) {
    return this.service.list(user.id, serviceUserId, query, getRequestAuditMeta(req));
  }

  @Get(':medicationId')
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'Get a single medication' })
  getOne(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('medicationId') medicationId: string,
    @Req() req: Request,
  ) {
    return this.service.getOne(user.id, serviceUserId, medicationId, getRequestAuditMeta(req));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.medications.create', 'service_users.update')
  @ApiOperation({ summary: 'Create medication' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateServiceUserMedicationDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':medicationId')
  @AnyPermission('service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Update medication' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('medicationId') medicationId: string,
    @Body() dto: UpdateServiceUserMedicationDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, medicationId, dto, getRequestAuditMeta(req));
  }

  @Delete(':medicationId')
  @AnyPermission('service_users.medications.delete', 'service_users.delete')
  @ApiOperation({ summary: 'Soft-delete medication' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('medicationId') medicationId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, medicationId, getRequestAuditMeta(req));
  }

  @Patch(':medicationId/status')
  @AnyPermission(
    'service_users.medications.status.update',
    'service_users.medications.update',
    'service_users.update',
  )
  @ApiOperation({ summary: 'Update medication workflow status' })
  @ApiResponse({ status: 200 })
  patchStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('medicationId') medicationId: string,
    @Body() dto: UpdateMedicationStatusDto,
    @Req() req: Request,
  ) {
    return this.service.patchStatus(user.id, serviceUserId, medicationId, dto, getRequestAuditMeta(req));
  }
}
