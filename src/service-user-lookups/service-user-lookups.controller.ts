import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ServiceUserLookupsService } from './service-user-lookups.service';

@ApiTags('Service User Lookups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('service-user-lookups')
export class ServiceUserLookupsController {
  constructor(private readonly service: ServiceUserLookupsService) {}

  @Get()
  @Permissions('service_users.lookups.read')
  @ApiOperation({ summary: 'All service user lookups (aggregated)' })
  @ApiResponse({ status: 200 })
  all() {
    return this.service.all();
  }

  @Get('statuses')
  @Permissions('service_users.lookups.read')
  statuses() {
    return { data: this.service.statuses() };
  }

  @Get('titles')
  @Permissions('service_users.lookups.read')
  titles() {
    return { data: this.service.titles() };
  }

  @Get('genders')
  @Permissions('service_users.lookups.read')
  genders() {
    return { data: this.service.genders() };
  }

  @Get('marital-statuses')
  @Permissions('service_users.lookups.read')
  maritalStatuses() {
    return { data: this.service.maritalStatuses() };
  }

  @Get('care-types')
  @Permissions('service_users.lookups.read')
  careTypes() {
    return { data: this.service.careTypes() };
  }

  @Get('funding-types')
  @Permissions('service_users.lookups.read')
  fundingTypes() {
    return { data: this.service.fundingTypes() };
  }

  @Get('risk-levels')
  @Permissions('service_users.lookups.read')
  riskLevels() {
    return { data: this.service.riskLevels() };
  }

  @Get('relationship-types')
  @Permissions('service_users.lookups.read')
  relationshipTypes() {
    return { data: this.service.relationshipTypes() };
  }

  @Get('allergies')
  @Permissions('service_users.lookups.read')
  allergies() {
    return { data: this.service.allergies() };
  }

  @Get('absence-reasons')
  @Permissions('service_users.lookups.read')
  absenceReasons() {
    return { data: this.service.absenceReasons() };
  }
}
