import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { LiveInLookupsService } from './live-in-lookups.service';

@ApiTags('Live-in Lookups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('live-in-lookups')
export class LiveInLookupsController {
  constructor(private readonly service: LiveInLookupsService) {}

  @Get()
  @AnyPermission(
    'service_users.live_in_profile.lookups.read',
    'service_users.lookups.read',
    'service_users.read',
  )
  @ApiOperation({ summary: 'All live-in lookup lists (service types, levels of care, scan types)' })
  @ApiResponse({ status: 200 })
  bundle() {
    return this.service.bundle();
  }

  @Get('service-types')
  @AnyPermission(
    'service_users.live_in_profile.lookups.read',
    'service_users.lookups.read',
    'service_users.read',
  )
  @ApiOperation({ summary: 'Live-in service types' })
  serviceTypes() {
    return this.service.listServiceTypes();
  }

  @Get('levels-of-care')
  @AnyPermission(
    'service_users.live_in_profile.lookups.read',
    'service_users.lookups.read',
    'service_users.read',
  )
  @ApiOperation({ summary: 'Live-in levels of care' })
  levelsOfCare() {
    return this.service.listLevelsOfCare();
  }

  @Get('scan-types')
  @AnyPermission(
    'service_users.live_in_profile.lookups.read',
    'service_users.lookups.read',
    'service_users.read',
  )
  @ApiOperation({ summary: 'Live-in scan / check-in types' })
  scanTypes() {
    return this.service.listScanTypes();
  }
}
