import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { BodyMapService } from './body-map.service';
import {
  CreateMedicationBodyMapSiteFromMarDto,
} from './dto/body-map-medication-site.dto';

@ApiTags('Service User Medication Body Map')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-users/:serviceUserId/medications/:medicationId/body-map-site')
export class ServiceUserMedicationBodyMapController {
  constructor(private readonly service: BodyMapService) {}

  @Get()
  @AnyPermission(
    'service_users.medications.read',
    'service_users.body_map.read',
    'service_users.read',
  )
  @ApiOperation({ summary: 'Lookup active body map medication site for a MAR chart line' })
  @ApiParam({ name: 'serviceUserId', description: 'Service user UUID' })
  @ApiParam({ name: 'medicationId', description: 'Service user medication UUID' })
  getSite(
    @Param('serviceUserId') serviceUserId: string,
    @Param('medicationId') medicationId: string,
  ) {
    return this.service.getMedicationSiteForChart(serviceUserId, medicationId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission(
    'service_users.body_map.create',
    'service_users.medications.update',
    'service_users.update',
  )
  @ApiOperation({ summary: 'Create MEDICATION body map record + site linked to chart line' })
  createSite(
    @CurrentUser() user: RequestUser,
    @Param('serviceUserId') serviceUserId: string,
    @Param('medicationId') medicationId: string,
    @Body() dto: CreateMedicationBodyMapSiteFromMarDto,
  ) {
    return this.service.createMedicationSiteFromMar(user.id, serviceUserId, medicationId, dto);
  }
}
