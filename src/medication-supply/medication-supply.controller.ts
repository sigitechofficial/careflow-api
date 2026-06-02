import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiEnvelopeOkResponse } from '../common/decorators/api-envelope-ok-response.decorator';
import { MEDICATION_SUPPLY_BUNDLE_ENVELOPE_EXAMPLE } from '../common/swagger/medication-api.examples';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import { MedicationSupplyService } from './medication-supply.service';
import { CreateMedicationSupplyDeliveryDto } from './dto/create-medication-supply-delivery.dto';
import {
  MedicationSupplyBundleResponseDto,
  MedicationSupplyDeliveryDto,
} from './dto/medication-supply-response.dto';

@ApiTags('Medication Supply')
@ApiBearerAuth()
@ApiExtraModels(MedicationSupplyBundleResponseDto)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-supply')
export class MedicationSupplyController {
  constructor(private readonly service: MedicationSupplyService) {}

  @Get()
  @AnyPermission(
    'service_users.medications.read',
    'service_users.medications.chart.read',
    'service_users.read',
  )
  @ApiOperation({
    summary: 'Supply cards and recent deliveries per medication',
    description: 'Regular active medications with supply summary stats and delivery history.',
  })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiEnvelopeOkResponse({
    description: 'Supply cards per regular medication with summaries and recent deliveries',
    example: MEDICATION_SUPPLY_BUNDLE_ENVELOPE_EXAMPLE,
    innerType: MedicationSupplyBundleResponseDto,
  })
  @ApiMedicationStandardResponses()
  getBundle(@Param('id') serviceUserId: string) {
    return this.service.getBundle(serviceUserId);
  }

  @Post('deliveries')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission(
    'service_users.medications.update',
    'service_users.update',
    'service_users.medications.create',
  )
  @ApiOperation({
    summary: 'Log medication supply delivery (not administration)',
    description: 'Books in blister cycle, bottle, or prescription quantity — parallel to MAR events.',
  })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiCreatedResponse({ type: MedicationSupplyDeliveryDto })
  @ApiMedicationStandardResponses()
  createDelivery(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateMedicationSupplyDeliveryDto,
    @Req() req: Request,
  ) {
    return this.service.createDelivery(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }
}
