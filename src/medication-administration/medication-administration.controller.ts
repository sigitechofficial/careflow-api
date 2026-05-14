import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { MedicationAdministrationService } from './medication-administration.service';
import { MedicationAdministrationQueryDto } from './dto/medication-administration-query.dto';
import { CreateMedicationAdministrationEventDto } from './dto/create-medication-administration-event.dto';

@ApiTags('Medication Administration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-events')
export class MedicationAdministrationController {
  constructor(private readonly service: MedicationAdministrationService) {}

  @Get()
  @AnyPermission('service_users.medications.events.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'Medication administration event history' })
  list(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Query() query: MedicationAdministrationQueryDto,
    @Req() req: Request,
  ) {
    return this.service.list(user.id, serviceUserId, query, getRequestAuditMeta(req));
  }

  @Get(':eventId')
  @AnyPermission('service_users.medications.events.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'Get single administration event' })
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('eventId') eventId: string,
    @Req() req: Request,
  ) {
    return this.service.findOne(user.id, serviceUserId, eventId, getRequestAuditMeta(req));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.medications.administer', 'service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Record a medication administration event' })
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateMedicationAdministrationEventDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }
}
