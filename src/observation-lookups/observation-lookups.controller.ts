import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { ObservationLookupsService } from './observation-lookups.service';

@ApiTags('Observation Lookups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('observation-lookups')
export class ObservationLookupsController {
  constructor(private readonly service: ObservationLookupsService) {}

  @Get('types')
  @AnyPermission('service_users.observations.lookups.read', 'service_users.observations.read', 'service_users.read')
  @ApiOperation({ summary: 'List observation types (tabs)' })
  listTypes() {
    return this.service.listTypes();
  }

  @Get('share-targets')
  @AnyPermission('service_users.observations.lookups.read', 'service_users.observations.read', 'service_users.read')
  @ApiOperation({ summary: 'List observation share targets (Handover, Manager)' })
  listShareTargets() {
    return this.service.listShareTargets();
  }

  @Get('wellbeing-scale')
  @AnyPermission('service_users.observations.lookups.read', 'service_users.observations.read', 'service_users.read')
  @ApiOperation({ summary: 'Wellbeing dimensions and level labels (1–5)' })
  getWellbeingScale() {
    return this.service.getWellbeingScale();
  }
}
