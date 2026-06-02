import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { MedicationSupportProfilesService } from './medication-support-profiles.service';
import { UpdateMedicationSupportProfileDto } from './dto/update-medication-support-profile.dto';
import { MedicationSupportProfileDto } from './dto/medication-support-profile-response.dto';

@ApiTags('Medication Support Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:id/medication-support-profile')
export class MedicationSupportProfilesController {
  constructor(private readonly service: MedicationSupportProfilesService) {}

  @Get()
  @AnyPermission(
    'service_users.medications.support_profile.read',
    'service_users.medications.read',
    'service_users.read',
  )
  @ApiOperation({ summary: 'Get medication support profile (creates default if missing)' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiOkResponse({ type: MedicationSupportProfileDto })
  @ApiMedicationStandardResponses()
  get(@Param('id') serviceUserId: string) {
    return this.service.get(serviceUserId);
  }

  @Patch()
  @AnyPermission(
    'service_users.medications.support_profile.update',
    'service_users.medications.update',
    'service_users.update',
  )
  @ApiOperation({ summary: 'Update medication support profile' })
  @ApiParam({ name: 'id', description: 'Service user UUID' })
  @ApiOkResponse({ type: MedicationSupportProfileDto })
  @ApiMedicationStandardResponses()
  patch(
    @CurrentUser() user: RequestUser,
    @Param('id') serviceUserId: string,
    @Body() dto: UpdateMedicationSupportProfileDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, serviceUserId, dto, getRequestAuditMeta(req));
  }
}
