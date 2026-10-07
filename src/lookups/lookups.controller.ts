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
import { CreateClockInArrivalReasonDto } from './dto/create-clock-in-arrival-reason.dto';
import { UpdateClockInArrivalReasonDto } from './dto/update-clock-in-arrival-reason.dto';
import { CreateClockOutEndReasonDto } from './dto/create-clock-out-end-reason.dto';
import { UpdateClockOutEndReasonDto } from './dto/update-clock-out-end-reason.dto';
import { CreateVisitOutcomeReasonDto } from './dto/create-visit-outcome-reason.dto';
import { UpdateVisitOutcomeReasonDto } from './dto/update-visit-outcome-reason.dto';
import { CreateAllergyCatalogDto } from './dto/create-allergy-catalog.dto';
import { UpdateAllergyCatalogDto } from './dto/update-allergy-catalog.dto';
import { UpdateVitalAcceptedRangeDto } from './dto/update-vital-accepted-range.dto';
import { CreateEmergencyProtocolDto } from './dto/create-emergency-protocol.dto';
import { UpdateEmergencyProtocolDto } from './dto/update-emergency-protocol.dto';
import { CreateManualAuthorisationReasonDto } from './dto/create-manual-authorisation-reason.dto';
import { UpdateManualAuthorisationReasonDto } from './dto/update-manual-authorisation-reason.dto';

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

  @Post('visit-status-reasons')
  @Permissions('lookups.manage')
  async createVisitStatusReason(@Body() dto: CreateLookupNameDto) {
    return { data: await this.service.upsertVisitStatusReason(dto.name) };
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

  @Get('visit-status-reasons')
  @Permissions('lookups.read')
  async visitStatusReasons() {
    return { data: await this.service.visitStatusReasons() };
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

  @Get('service-user-genders')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List service user genders (lookup data)' })
  async serviceUserGenders() {
    return { data: await this.service.listServiceUserGenders() };
  }

  @Post('service-user-genders')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create service user gender' })
  async createServiceUserGender(@Body() dto: CreateServiceUserFundingTypeDto) {
    return { data: await this.service.createServiceUserGender(dto) };
  }

  @Patch('service-user-genders/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update service user gender' })
  async updateServiceUserGender(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceUserFundingTypeDto,
  ) {
    return { data: await this.service.updateServiceUserGender(id, dto) };
  }

  @Delete('service-user-genders/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate service user gender' })
  async deleteServiceUserGender(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteServiceUserGender(id);
    return { message: 'Gender deleted' };
  }

  @Get('service-user-sexes')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List service user sex options (lookup data)' })
  async serviceUserSexes() {
    return { data: await this.service.listServiceUserSexes() };
  }

  @Post('service-user-sexes')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create service user sex option' })
  async createServiceUserSex(@Body() dto: CreateServiceUserFundingTypeDto) {
    return { data: await this.service.createServiceUserSex(dto) };
  }

  @Patch('service-user-sexes/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update service user sex option' })
  async updateServiceUserSex(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceUserFundingTypeDto,
  ) {
    return { data: await this.service.updateServiceUserSex(id, dto) };
  }

  @Delete('service-user-sexes/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate service user sex option' })
  async deleteServiceUserSex(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteServiceUserSex(id);
    return { message: 'Sex option deleted' };
  }

  @Get('service-user-sexual-orientations')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List service user sexual orientations (lookup data)' })
  async serviceUserSexualOrientations() {
    return { data: await this.service.listServiceUserSexualOrientations() };
  }

  @Post('service-user-sexual-orientations')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create service user sexual orientation' })
  async createServiceUserSexualOrientation(@Body() dto: CreateServiceUserFundingTypeDto) {
    return { data: await this.service.createServiceUserSexualOrientation(dto) };
  }

  @Patch('service-user-sexual-orientations/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update service user sexual orientation' })
  async updateServiceUserSexualOrientation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceUserFundingTypeDto,
  ) {
    return { data: await this.service.updateServiceUserSexualOrientation(id, dto) };
  }

  @Delete('service-user-sexual-orientations/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate service user sexual orientation' })
  async deleteServiceUserSexualOrientation(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteServiceUserSexualOrientation(id);
    return { message: 'Sexual orientation deleted' };
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

  @Get('clock-in-arrival-reasons')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List clock-in early/late arrival reasons (carer-app)' })
  async clockInArrivalReasons() {
    return { data: await this.service.listClockInArrivalReasons() };
  }

  @Post('clock-in-arrival-reasons')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create a clock-in early or late arrival reason' })
  async createClockInArrivalReason(@Body() dto: CreateClockInArrivalReasonDto) {
    return { data: await this.service.createClockInArrivalReason(dto) };
  }

  @Patch('clock-in-arrival-reasons/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update a clock-in arrival reason' })
  async updateClockInArrivalReason(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClockInArrivalReasonDto,
  ) {
    return { data: await this.service.updateClockInArrivalReason(id, dto) };
  }

  @Delete('clock-in-arrival-reasons/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate a clock-in arrival reason' })
  async deleteClockInArrivalReason(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteClockInArrivalReason(id);
    return { message: 'Arrival reason deleted' };
  }

  @Get('manual-authorisation-reasons')
  @AnyPermission('lookups.read', 'ecm.read', 'ecm.monitor', 'ecm.exceptions.manage')
  @ApiOperation({ summary: 'List office Manual check-in authorisation reasons' })
  async manualAuthorisationReasons() {
    return { data: await this.service.listManualAuthorisationReasons() };
  }

  @Post('manual-authorisation-reasons')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create a Manual check-in authorisation reason' })
  async createManualAuthorisationReason(@Body() dto: CreateManualAuthorisationReasonDto) {
    return { data: await this.service.createManualAuthorisationReason(dto) };
  }

  @Patch('manual-authorisation-reasons/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update a Manual check-in authorisation reason' })
  async updateManualAuthorisationReason(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManualAuthorisationReasonDto,
  ) {
    return { data: await this.service.updateManualAuthorisationReason(id, dto) };
  }

  @Delete('manual-authorisation-reasons/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate a Manual check-in authorisation reason' })
  async deleteManualAuthorisationReason(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteManualAuthorisationReason(id);
    return { message: 'Authorisation reason deleted' };
  }

  @Get('left-area-allow-reasons')
  @AnyPermission('lookups.read', 'ecm.read', 'ecm.monitor', 'ecm.exceptions.manage')
  @ApiOperation({ summary: 'List office left-area allow reasons' })
  async leftAreaAllowReasons() {
    return { data: await this.service.listLeftAreaAllowReasons() };
  }

  @Post('left-area-allow-reasons')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create a left-area allow reason' })
  async createLeftAreaAllowReason(@Body() dto: CreateManualAuthorisationReasonDto) {
    return { data: await this.service.createLeftAreaAllowReason(dto) };
  }

  @Patch('left-area-allow-reasons/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update a left-area allow reason' })
  async updateLeftAreaAllowReason(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManualAuthorisationReasonDto,
  ) {
    return { data: await this.service.updateLeftAreaAllowReason(id, dto) };
  }

  @Delete('left-area-allow-reasons/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate a left-area allow reason' })
  async deleteLeftAreaAllowReason(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteLeftAreaAllowReason(id);
    return { message: 'Allow reason deleted' };
  }

  @Get('clock-out-end-reasons')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List clock-out early/late end reasons (carer-app)' })
  async clockOutEndReasons() {
    return { data: await this.service.listClockOutEndReasons() };
  }

  @Post('clock-out-end-reasons')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create a clock-out early or late end reason' })
  async createClockOutEndReason(@Body() dto: CreateClockOutEndReasonDto) {
    return { data: await this.service.createClockOutEndReason(dto) };
  }

  @Patch('clock-out-end-reasons/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update a clock-out end reason' })
  async updateClockOutEndReason(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClockOutEndReasonDto,
  ) {
    return { data: await this.service.updateClockOutEndReason(id, dto) };
  }

  @Delete('clock-out-end-reasons/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate a clock-out end reason' })
  async deleteClockOutEndReason(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteClockOutEndReason(id);
    return { message: 'Clock-out reason deleted' };
  }

  @Get('visit-outcomes')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List visit outcomes with nested reasons (Medication / Task / Observation)' })
  async visitOutcomes() {
    return { data: await this.service.listVisitOutcomes() };
  }

  @Post('visit-outcomes/:outcomeId/reasons')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Add a reason under a visit outcome' })
  async createVisitOutcomeReason(
    @Param('outcomeId', ParseUUIDPipe) outcomeId: string,
    @Body() dto: CreateVisitOutcomeReasonDto,
  ) {
    return { data: await this.service.createVisitOutcomeReason(outcomeId, dto) };
  }

  @Patch('visit-outcome-reasons/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update a visit outcome reason' })
  async updateVisitOutcomeReason(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVisitOutcomeReasonDto,
  ) {
    return { data: await this.service.updateVisitOutcomeReason(id, dto) };
  }

  @Delete('visit-outcome-reasons/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate a visit outcome reason' })
  async deleteVisitOutcomeReason(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteVisitOutcomeReason(id);
    return { message: 'Outcome reason deleted' };
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

  @Get('emergency-protocols')
  @Permissions('lookups.read')
  @ApiOperation({ summary: 'List emergency protocols for the carer-app runner' })
  async emergencyProtocols() {
    return { data: await this.service.listEmergencyProtocols() };
  }

  @Post('emergency-protocols')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Create an emergency protocol' })
  async createEmergencyProtocol(@Body() dto: CreateEmergencyProtocolDto) {
    return { data: await this.service.createEmergencyProtocol(dto) };
  }

  @Patch('emergency-protocols/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Update an emergency protocol and optionally replace steps' })
  async updateEmergencyProtocol(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmergencyProtocolDto,
  ) {
    return { data: await this.service.updateEmergencyProtocol(id, dto) };
  }

  @Delete('emergency-protocols/:id')
  @Permissions('lookups.manage')
  @ApiOperation({ summary: 'Deactivate an emergency protocol' })
  async deleteEmergencyProtocol(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteEmergencyProtocol(id);
    return { message: 'Emergency protocol deleted' };
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

