import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiEnvelopeCreatedResponse,
  ApiEnvelopeOkResponse,
} from '../common/decorators/api-envelope-ok-response.decorator';
import {
  MEDICATION_EVENT_CREATED_ENVELOPE_EXAMPLE,
  MEDICATION_EVENTS_LIST_ENVELOPE_EXAMPLE,
} from '../common/swagger/medication-api.examples';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import { MedicationAdministrationService } from './medication-administration.service';
import { MedicationAdministrationQueryDto } from './dto/medication-administration-query.dto';
import { CreateMedicationAdministrationEventDto } from './dto/create-medication-administration-event.dto';
import { UpdateMedicationAdministrationEventDto } from './dto/update-medication-administration-event.dto';
import { ReviewMedicationAdministrationEventDto } from './dto/review-medication-administration-event.dto';
import { MedicationAdministrationEventDto } from './dto/medication-administration-response.dto';

@ApiTags('Medication Administration')
@ApiBearerAuth()
@ApiExtraModels(MedicationAdministrationEventDto)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-events')
export class MedicationAdministrationController {
  constructor(private readonly service: MedicationAdministrationService) {}

  @Get()
  @AnyPermission('service_users.medications.events.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({
    summary: 'Medication administration event history',
    description:
      'Paginated list with filters: medicationIds, status, date range, reportType (given/not_given/missed), needsReview.',
  })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiEnvelopeOkResponse({
    description: 'Paginated administration events (`data` is an array; `meta` has pagination)',
    example: MEDICATION_EVENTS_LIST_ENVELOPE_EXAMPLE,
  })
  @ApiMedicationStandardResponses()
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
  @ApiOperation({ summary: 'Get single administration event (drawer detail)' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'eventId', description: 'Administration event UUID' })
  @ApiOkResponse({ type: MedicationAdministrationEventDto })
  @ApiMedicationStandardResponses()
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
  @ApiOperation({
    summary: 'Record a medication administration event',
    description: 'Creates MAR cell record. Requires status or statusCode. PRN requires reason/notes.',
  })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiEnvelopeCreatedResponse({
    description: 'Administration event recorded',
    example: MEDICATION_EVENT_CREATED_ENVELOPE_EXAMPLE,
    innerType: MedicationAdministrationEventDto,
  })
  @ApiMedicationStandardResponses()
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateMedicationAdministrationEventDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':eventId')
  @AnyPermission('service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Correct an administration event (audit preserved)' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'eventId', description: 'Administration event UUID' })
  @ApiOkResponse({ type: MedicationAdministrationEventDto })
  @ApiMedicationStandardResponses()
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateMedicationAdministrationEventDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, eventId, dto, getRequestAuditMeta(req));
  }

  @Post(':eventId/review')
  @HttpCode(HttpStatus.OK)
  @AnyPermission('service_users.medications.update', 'service_users.update')
  @ApiOperation({ summary: 'Mark an exception administration as manager-reviewed' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'eventId', description: 'Administration event UUID' })
  @ApiOkResponse({ type: MedicationAdministrationEventDto })
  @ApiMedicationStandardResponses()
  review(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('eventId') eventId: string,
    @Body() dto: ReviewMedicationAdministrationEventDto,
    @Req() req: Request,
  ) {
    return this.service.review(user.id, serviceUserId, eventId, dto.notes, getRequestAuditMeta(req));
  }
}
