import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import { MedicationPackDeliveriesService } from './medication-pack-deliveries.service';
import { CreateMedicationPackDeliveryDto } from './dto/create-medication-pack-delivery.dto';
import { ReconcileMedicationPackDeliveryLineDto } from './dto/reconcile-medication-pack-delivery-line.dto';
import { CountersignMedicationPackDeliveryDto } from './dto/countersign-medication-pack-delivery.dto';
import { MedicationPackDeliveryDto } from './dto/medication-pack-delivery-response.dto';

@ApiTags('Medication Packs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-packs/:packId/deliveries')
export class MedicationPackDeliveriesController {
  constructor(private readonly service: MedicationPackDeliveriesService) {}

  @Get()
  @AnyPermission('service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List pack cycle deliveries' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiOkResponse({ type: [MedicationPackDeliveryDto] })
  @ApiMedicationStandardResponses()
  list(@Param('id') serviceUserId: string, @Param('packId') packId: string) {
    return this.service.list(serviceUserId, packId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.medications.packs.deliver', 'service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Log a new cycle delivery (reconciliation generated from published manifest)' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiCreatedResponse({ type: MedicationPackDeliveryDto })
  @ApiMedicationStandardResponses()
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Body() dto: CreateMedicationPackDeliveryDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, packId, dto, getRequestAuditMeta(req));
  }

  @Patch(':deliveryId/lines/:lineId')
  @AnyPermission('service_users.medications.packs.deliver', 'service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Reconcile a delivery line (confirm present / flag discrepancy)' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiParam({ name: 'deliveryId', description: 'Delivery UUID' })
  @ApiParam({ name: 'lineId', description: 'Delivery line UUID' })
  @ApiOkResponse({ type: MedicationPackDeliveryDto })
  @ApiMedicationStandardResponses()
  reconcileLine(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Param('deliveryId') deliveryId: string,
    @Param('lineId') lineId: string,
    @Body() dto: ReconcileMedicationPackDeliveryLineDto,
    @Req() req: Request,
  ) {
    return this.service.reconcileLine(user.id, serviceUserId, packId, deliveryId, lineId, dto, getRequestAuditMeta(req));
  }

  @Post(':deliveryId/countersign')
  @AnyPermission('service_users.medications.packs.deliver', 'service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Manager countersign — cycle goes live (hard gate on reconciliation)' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'packId', description: 'Pack UUID' })
  @ApiParam({ name: 'deliveryId', description: 'Delivery UUID' })
  @ApiOkResponse({ type: MedicationPackDeliveryDto })
  @ApiMedicationStandardResponses()
  countersign(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('packId') packId: string,
    @Param('deliveryId') deliveryId: string,
    @Body() dto: CountersignMedicationPackDeliveryDto,
    @Req() req: Request,
  ) {
    return this.service.countersign(user.id, serviceUserId, packId, deliveryId, dto, getRequestAuditMeta(req));
  }
}
