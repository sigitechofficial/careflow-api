import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { LookupsService } from './lookups.service';
import { CreateJobTitleDto } from './dto/create-job-title.dto';

@ApiTags('Lookups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('lookups')
export class LookupsController {
  constructor(private readonly service: LookupsService) {}

  @Get('employee')
  @Permissions('lookups.read')
  employee() {
    return this.service.employeeLookups();
  }

  @Get('titles')
  @Permissions('lookups.read')
  async titles() {
    return { data: await this.service.titles() };
  }

  @Get('genders')
  @Permissions('lookups.read')
  async genders() {
    return { data: await this.service.genders() };
  }

  @Get('nationalities')
  @Permissions('lookups.read')
  async nationalities() {
    return { data: await this.service.nationalities() };
  }

  @Get('work-areas')
  @Permissions('lookups.read')
  async workAreas() {
    return { data: await this.service.workAreas() };
  }

  @Get('job-titles')
  @Permissions('lookups.read')
  async jobTitles() {
    return { data: await this.service.jobTitles() };
  }

  @Post('job-titles')
  @Permissions('employees.update')
  async createJobTitle(@Body() dto: CreateJobTitleDto) {
    return { data: await this.service.upsertJobTitle(dto.name) };
  }

  @Get('rbac-levels')
  @Permissions('lookups.read')
  async rbacLevels() {
    return { data: await this.service.rbacLevels() };
  }

  @Get('grades')
  @Permissions('lookups.read')
  async grades() {
    return { data: await this.service.grades() };
  }

  @Get('contract-types')
  @Permissions('lookups.read')
  async contractTypes() {
    return { data: await this.service.contractTypes() };
  }

  @Get('travel-payment-types')
  @Permissions('lookups.read')
  async travelPaymentTypes() {
    return { data: await this.service.travelPaymentTypes() };
  }

  @Get('locations')
  @Permissions('lookups.read')
  async locations() {
    return { data: await this.service.locations() };
  }

  @Get('zones')
  @Permissions('lookups.read')
  async zones() {
    return { data: await this.service.zones() };
  }

  @Get('leaving-reasons')
  @Permissions('lookups.read')
  async leavingReasons() {
    return { data: await this.service.leavingReasons() };
  }

  @Get('skill-types')
  @Permissions('lookups.read')
  async skillTypes() {
    return { data: await this.service.skillTypes() };
  }

  @Get('certification-types')
  @Permissions('lookups.read')
  async certificationTypes() {
    return { data: await this.service.certificationTypes() };
  }

  @Get('compliance-types')
  @Permissions('lookups.read')
  async complianceTypes() {
    return { data: await this.service.complianceTypes() };
  }

  @Get('review-types')
  @Permissions('lookups.read')
  async reviewTypes() {
    return { data: await this.service.reviewTypes() };
  }

  @Get('non-core-activity-reasons')
  @Permissions('lookups.read')
  async nonCoreActivityReasons() {
    return { data: await this.service.nonCoreActivityReasons() };
  }
}

