import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { LookupsService } from './lookups.service';
import { CreateLookupNameDto } from './dto/create-lookup-name.dto';

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
  @Permissions('lookups.manage')
  async createJobTitle(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertJobTitle(dto.name) };
  }

  @Post('skill-types')
  @Permissions('lookups.manage')
  async createSkillType(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertSkillType(dto.name) };
  }

  @Post('work-areas')
  @Permissions('lookups.manage')
  async createWorkArea(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertWorkArea(dto.name) };
  }

  @Post('grades')
  @Permissions('lookups.manage')
  async createGrade(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertGrade(dto.name) };
  }

  @Post('contract-types')
  @Permissions('lookups.manage')
  async createContractType(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertContractType(dto.name) };
  }

  @Post('certification-types')
  @Permissions('lookups.manage')
  async createCertificationType(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertCertificationType(dto.name) };
  }

  @Post('non-core-activity-reasons')
  @Permissions('lookups.manage')
  async createNonCoreActivityReason(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertNonCoreActivityReason(dto.name) };
  }

  @Post('leaving-reasons')
  @Permissions('lookups.manage')
  async createLeavingReason(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertLeavingReason(dto.name) };
  }

  @Post('review-types')
  @Permissions('lookups.manage')
  async createReviewType(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertReviewType(dto.name) };
  }

  @Post('locations')
  @Permissions('lookups.manage')
  async createLocation(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertLocation(dto.name) };
  }

  @Post('zones')
  @Permissions('lookups.manage')
  async createZone(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertZone(dto.name) };
  }

  @Post('travel-payment-types')
  @Permissions('lookups.manage')
  async createTravelPaymentType(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertTravelPaymentType(dto.name) };
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

  @Patch(':resource/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Rename a manageable lookup item' })
  async updateNamedLookup(
    @Param('resource') resource: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLookupNameDto,
  ) {
    return { data: await this.service.updateNamedLookup(resource, id, dto.name) };
  }

  @Delete(':resource/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Soft-delete a manageable lookup item' })
  async deleteNamedLookup(
    @Param('resource') resource: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.deleteNamedLookup(resource, id);
    return { message: 'Lookup item deleted' };
  }
}

