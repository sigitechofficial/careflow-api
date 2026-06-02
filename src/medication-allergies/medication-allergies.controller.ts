import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { ApiMedicationStandardResponses } from '../common/decorators/api-standard-responses.decorator';
import { MedicationAllergiesService } from './medication-allergies.service';
import { CreateMedicationAllergyDto } from './dto/create-medication-allergy.dto';
import { UpdateMedicationAllergyDto } from './dto/update-medication-allergy.dto';
import { ApiSimpleDeleteResultDto } from '../common/dto/api-error-response.dto';
import { MedicationAllergyDto } from './dto/medication-allergy-response.dto';

@ApiTags('Medication Allergies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-allergies')
export class MedicationAllergiesController {
  constructor(private readonly service: MedicationAllergiesService) {}

  @Get()
  @AnyPermission('service_users.medications.allergies.read', 'service_users.medications.read', 'service_users.read')
  @ApiOperation({ summary: 'List medication-specific allergies' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiOkResponse({ type: [MedicationAllergyDto] })
  @ApiMedicationStandardResponses()
  list(@Param('id') serviceUserId: string) {
    return this.service.list(serviceUserId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.medications.allergies.manage', 'service_users.update')
  @ApiOperation({ summary: 'Create medication allergy' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiCreatedResponse({ type: MedicationAllergyDto })
  @ApiMedicationStandardResponses()
  create(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: CreateMedicationAllergyDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }

  @Patch(':allergyId')
  @AnyPermission('service_users.medications.allergies.manage', 'service_users.update')
  @ApiOperation({ summary: 'Update medication allergy' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'allergyId', description: 'Allergy UUID' })
  @ApiOkResponse({ type: MedicationAllergyDto })
  @ApiMedicationStandardResponses()
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('allergyId') allergyId: string,
    @Body() dto: UpdateMedicationAllergyDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, allergyId, dto, getRequestAuditMeta(req));
  }

  @Delete(':allergyId')
  @AnyPermission('service_users.medications.allergies.manage', 'service_users.delete')
  @ApiOperation({ summary: 'Delete medication allergy' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiParam({ name: 'allergyId', description: 'Allergy UUID' })
  @ApiOkResponse({ type: ApiSimpleDeleteResultDto })
  @ApiMedicationStandardResponses()
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Param('allergyId') allergyId: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, serviceUserId, allergyId, getRequestAuditMeta(req));
  }
}
