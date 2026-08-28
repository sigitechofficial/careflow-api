import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { LookupsService } from './lookups.service';
import { CreateLookupNameDto } from './dto/create-lookup-name.dto';
import { CreateServiceUserCareTypeDto } from './dto/create-service-user-care-type.dto';
import { CreateServiceUserFundingTypeDto } from './dto/create-service-user-funding-type.dto';
import { UpdateServiceUserCareTypeDto } from './dto/update-service-user-care-type.dto';
import { UpdateServiceUserFundingTypeDto } from './dto/update-service-user-funding-type.dto';
import { CreateBodyMapRecordTypeDto } from './dto/create-body-map-record-type.dto';
import { UpdateBodyMapRecordTypeDto } from './dto/update-body-map-record-type.dto';
import { CreateWelfareOutcomeDto } from './dto/create-welfare-outcome.dto';
import { UpdateWelfareOutcomeDto } from './dto/update-welfare-outcome.dto';
import { CreateAllergyCatalogDto } from './dto/create-allergy-catalog.dto';
import { UpdateAllergyCatalogDto } from './dto/update-allergy-catalog.dto';
import { UpdateVitalAcceptedRangeDto } from './dto/update-vital-accepted-range.dto';

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

  @Get('service-user-care-types')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List service user care types (lookup data)' })
  async serviceUserCareTypes() {
    return { data: await this.service.listServiceUserCareTypes() };
  }

  @Post('service-user-care-types')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create service user care type' })
  async createServiceUserCareType(@Body() dto: CreateServiceUserCareTypeDto) {
    return { data: await this.service.createServiceUserCareType(dto) };
  }

  @Patch('service-user-care-types/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update service user care type' })
  async updateServiceUserCareType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceUserCareTypeDto,
  ) {
    return { data: await this.service.updateServiceUserCareType(id, dto) };
  }

  @Delete('service-user-care-types/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate service user care type' })
  async deleteServiceUserCareType(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteServiceUserCareType(id);
    return { message: 'Care type deleted' };
  }

  @Get('service-user-funding-types')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List service user funding types (lookup data)' })
  async serviceUserFundingTypes() {
    return { data: await this.service.listServiceUserFundingTypes() };
  }

  @Post('service-user-funding-types')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create service user funding type' })
  async createServiceUserFundingType(@Body() dto: CreateServiceUserFundingTypeDto) {
    return { data: await this.service.createServiceUserFundingType(dto) };
  }

  @Patch('service-user-funding-types/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update service user funding type' })
  async updateServiceUserFundingType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceUserFundingTypeDto,
  ) {
    return { data: await this.service.updateServiceUserFundingType(id, dto) };
  }

  @Delete('service-user-funding-types/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate service user funding type' })
  async deleteServiceUserFundingType(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteServiceUserFundingType(id);
    return { message: 'Funding type deleted' };
  }

  @Get('service-user-ethnicities')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List service user ethnicities (lookup data)' })
  async serviceUserEthnicities() {
    return { data: await this.service.listServiceUserEthnicities() };
  }

  @Post('service-user-ethnicities')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create service user ethnicity' })
  async createServiceUserEthnicity(@Body() dto: CreateServiceUserFundingTypeDto) {
    return { data: await this.service.createServiceUserEthnicity(dto) };
  }

  @Patch('service-user-ethnicities/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update service user ethnicity' })
  async updateServiceUserEthnicity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceUserFundingTypeDto,
  ) {
    return { data: await this.service.updateServiceUserEthnicity(id, dto) };
  }

  @Delete('service-user-ethnicities/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate service user ethnicity' })
  async deleteServiceUserEthnicity(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteServiceUserEthnicity(id);
    return { message: 'Ethnicity deleted' };
  }

  @Get('service-user-languages')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List service user languages (lookup data)' })
  async serviceUserLanguages() {
    return { data: await this.service.listServiceUserLanguages() };
  }

  @Post('service-user-languages')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create service user language' })
  async createServiceUserLanguage(@Body() dto: CreateServiceUserFundingTypeDto) {
    return { data: await this.service.createServiceUserLanguage(dto) };
  }

  @Patch('service-user-languages/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update service user language' })
  async updateServiceUserLanguage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceUserFundingTypeDto,
  ) {
    return { data: await this.service.updateServiceUserLanguage(id, dto) };
  }

  @Delete('service-user-languages/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate service user language' })
  async deleteServiceUserLanguage(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteServiceUserLanguage(id);
    return { message: 'Language deleted' };
  }

  @Get('allergy-catalog')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List service user allergy catalogue (lookup data)' })
  async allergyCatalog() {
    return { data: await this.service.listAllergyCatalog() };
  }

  @Post('allergy-catalog')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create allergy catalogue entry' })
  async createAllergyCatalog(@Body() dto: CreateAllergyCatalogDto) {
    return { data: await this.service.createAllergyCatalog(dto) };
  }

  @Patch('allergy-catalog/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update allergy catalogue entry' })
  async updateAllergyCatalog(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAllergyCatalogDto,
  ) {
    return { data: await this.service.updateAllergyCatalog(id, dto) };
  }

  @Delete('allergy-catalog/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate allergy catalogue entry' })
  async deleteAllergyCatalog(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteAllergyCatalog(id);
    return { message: 'Allergy deleted' };
  }

  @Get('body-map-record-types')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List body map record types and sub-types' })
  async bodyMapRecordTypes() {
    return { data: await this.service.listBodyMapRecordTypes() };
  }

  @Post('body-map-record-types')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create body map record type or sub-type' })
  async createBodyMapRecordType(@Body() dto: CreateBodyMapRecordTypeDto) {
    return { data: await this.service.createBodyMapRecordType(dto) };
  }

  @Patch('body-map-record-types/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update body map record type or sub-type' })
  async updateBodyMapRecordType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBodyMapRecordTypeDto,
  ) {
    return { data: await this.service.updateBodyMapRecordType(id, dto) };
  }

  @Delete('body-map-record-types/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate body map record type (and sub-types if parent)' })
  async deleteBodyMapRecordType(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteBodyMapRecordType(id);
    return { message: 'Record type deleted' };
  }

  @Get('welfare-outcomes')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List on-entry welfare outcomes (carer-app clock-in)' })
  async welfareOutcomes() {
    return { data: await this.service.listWelfareOutcomes() };
  }

  @Post('welfare-outcomes')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create an on-entry welfare outcome' })
  async createWelfareOutcome(@Body() dto: CreateWelfareOutcomeDto) {
    return { data: await this.service.createWelfareOutcome(dto) };
  }

  @Patch('welfare-outcomes/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update an on-entry welfare outcome' })
  async updateWelfareOutcome(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWelfareOutcomeDto,
  ) {
    return { data: await this.service.updateWelfareOutcome(id, dto) };
  }

  @Delete('welfare-outcomes/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate an on-entry welfare outcome' })
  async deleteWelfareOutcome(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteWelfareOutcome(id);
    return { message: 'Welfare outcome deleted' };
  }

  @Get('vital-accepted-ranges')
  @AnyPermission(
    'lookups.read',
    'lookups.manage',
    'service_users.initial_assessment.read',
    'service_users.read',
  )
  @ApiOperation({ summary: 'Guidance-only accepted vital sign ranges for initial assessment §4' })
  async vitalAcceptedRanges() {
    return { data: await this.service.listVitalAcceptedRanges() };
  }

  @Patch('vital-accepted-ranges/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update min/max for a vital accepted range lookup row' })
  async updateVitalAcceptedRange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVitalAcceptedRangeDto,
  ) {
    return { data: await this.service.updateVitalAcceptedRange(id, dto) };
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

