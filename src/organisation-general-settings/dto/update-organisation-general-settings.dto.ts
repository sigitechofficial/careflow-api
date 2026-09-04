import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DomCareAllocationRuleDto,
  DomCareShiftDefinitionDto,
  DomJobCancellationRuleDto,
  DomLateVisitZoneAlertDto,
} from './dom-care-settings.dto';
import { IncidentTypeSettingDto } from './incident-management.dto';
import { INCIDENT_DEFAULT_STATUSES } from '../incident-management.util';
import {
  OptionalAboutMeFieldDto,
  OptionalFamilyShareVisitInfoDto,
} from './optional-settings.dto';
import { PreAssessmentChecklistItemDto } from './pre-assessment-settings.dto';
import { EmployeeVisaTypeDto } from './employee-visa-types.dto';
import { ORGANISATION_TIMEZONES } from '../organisation-timezone';

const TIME_DISPLAY_FORMATS = ['HH_XX', 'HH_MM'] as const;
const DATE_DISPLAY_FORMATS = ['DD_MM_YYYY', 'MM_DD_YYYY', 'YYYY_MM_DD'] as const;
const DEFAULT_CARER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
const HOLIDAY_UNITS = ['HOURS', 'DAYS'] as const;
const SALARY_CALCULATION_BASES = ['MONTHLY', 'WEEKLY'] as const;
const MULTI_CARER_FUNDER_CHARGE_MODES = ['COMBINED', 'FIXED'] as const;
const COMPLIANCE_REQUIRED_BY = ['ROLE_WORK_AREA', 'CITIZENSHIP'] as const;
const COMPLIANCE_APPROVAL_TYPES = ['MANAGER_APPROVAL', 'HR_APPROVAL'] as const;
const WELLBEING_REGULARITIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
const ACTIONS_DEFAULT_VIEWS = ['TASK_LIST', 'ACTIONS_LIST'] as const;
const ALLOCATE_EMPLOYEE_BY = ['FLOOR', 'WARD', 'ZONE', 'UNIT'] as const;

export class UpdateOrganisationGeneralSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  reviewCarePlanAfterDays?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 168 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  handoverReportLastHours?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  archiveServiceUserAfterMonths?: number;

  @ApiPropertyOptional({ enum: TIME_DISPLAY_FORMATS })
  @IsOptional()
  @IsIn(TIME_DISPLAY_FORMATS)
  timeDisplayFormat?: (typeof TIME_DISPLAY_FORMATS)[number];

  @ApiPropertyOptional({ enum: DATE_DISPLAY_FORMATS })
  @IsOptional()
  @IsIn(DATE_DISPLAY_FORMATS)
  dateDisplayFormat?: (typeof DATE_DISPLAY_FORMATS)[number];

  @ApiPropertyOptional({
    description: 'IANA timezone used for operational calendar days (schedules, ECM, today)',
    example: 'Europe/London',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @IsIn(ORGANISATION_TIMEZONES)
  timezone?: (typeof ORGANISATION_TIMEZONES)[number];

  @ApiPropertyOptional({ enum: DEFAULT_CARER_STATUSES })
  @IsOptional()
  @IsIn(DEFAULT_CARER_STATUSES)
  defaultCarerStatus?: (typeof DEFAULT_CARER_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sendEmailWhenEmployeeActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowMultipleRoles?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowWeekendDaysInHoliday?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mandateComplianceForNewEmployees?: boolean;

  @ApiPropertyOptional({ enum: HOLIDAY_UNITS })
  @IsOptional()
  @IsIn(HOLIDAY_UNITS)
  defaultHolidaysUnit?: (typeof HOLIDAY_UNITS)[number];

  @ApiPropertyOptional({ enum: SALARY_CALCULATION_BASES })
  @IsOptional()
  @IsIn(SALARY_CALCULATION_BASES)
  salaryCalculationBasis?: (typeof SALARY_CALCULATION_BASES)[number];

  @ApiPropertyOptional({
    enum: MULTI_CARER_FUNDER_CHARGE_MODES,
    description:
      'COMBINED (default): funder charged for each carer hour sum. FIXED: funder charged once for visit window length.',
  })
  @IsOptional()
  @IsIn(MULTI_CARER_FUNDER_CHARGE_MODES)
  multiCarerFunderChargeMode?: (typeof MULTI_CARER_FUNDER_CHARGE_MODES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  recruitmentFunctionalityRequired?: boolean;

  @ApiPropertyOptional({ enum: COMPLIANCE_REQUIRED_BY })
  @IsOptional()
  @IsIn(COMPLIANCE_REQUIRED_BY)
  complianceRequiredBy?: (typeof COMPLIANCE_REQUIRED_BY)[number];

  @ApiPropertyOptional({ enum: COMPLIANCE_APPROVAL_TYPES })
  @IsOptional()
  @IsIn(COMPLIANCE_APPROVAL_TYPES)
  complianceApprovalForNewEmployee?: (typeof COMPLIANCE_APPROVAL_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  calculateSicknessBradfordScale?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  recordServiceUserWellbeing?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  recordEmployeeWellbeing?: boolean;

  @ApiPropertyOptional({ enum: WELLBEING_REGULARITIES })
  @IsOptional()
  @IsIn(WELLBEING_REGULARITIES)
  wellbeingRegularity?: (typeof WELLBEING_REGULARITIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  wellbeingLabel1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  wellbeingLabel2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  wellbeingLabel3?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  wellbeingLabel4?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  wellbeingLabel5?: string;

  @ApiPropertyOptional({ type: [EmployeeVisaTypeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmployeeVisaTypeDto)
  employeeVisaTypes?: EmployeeVisaTypeDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enhancedRegularActionChecks?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showRegularActionsInDailyList?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowFastAction?: boolean;

  @ApiPropertyOptional({ enum: ACTIONS_DEFAULT_VIEWS })
  @IsOptional()
  @IsIn(ACTIONS_DEFAULT_VIEWS)
  actionsDefaultView?: (typeof ACTIONS_DEFAULT_VIEWS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  appDefaultToObservationsTab?: boolean;

  @ApiPropertyOptional({ enum: ALLOCATE_EMPLOYEE_BY })
  @IsOptional()
  @IsIn(ALLOCATE_EMPLOYEE_BY)
  allocateEmployeeBy?: (typeof ALLOCATE_EMPLOYEE_BY)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  restrictCarerToAllocatedServiceUsers?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  restrictLoginToShiftTimes?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  preventCarerWebLogin?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  shiftAccessMinutesBefore?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  shiftAccessMinutesAfter?: number;

  @ApiPropertyOptional({ type: [DomJobCancellationRuleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DomJobCancellationRuleDto)
  domJobCancellationRules?: DomJobCancellationRuleDto[];

  @ApiPropertyOptional({ minimum: 0, maximum: 1440 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  domGlobalToleranceMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 50000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50000)
  domGeofenceDistanceMeters?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 52 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52)
  domWorkPatternCycles?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domShowAllEmployeesAcrossZones?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domEmailTomorrowsSchedule?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 168 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(168)
  domAppShowHoursBefore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domRestrictJobOutsideGeofence?: boolean;

  @ApiPropertyOptional({ description: 'Allow GPS check-in on the carer app' })
  @IsOptional()
  @IsBoolean()
  domCheckInGpsEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Allow manual check-in on the carer app' })
  @IsOptional()
  @IsBoolean()
  domCheckInManualEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Show NFC check-in on the carer app (scanner not shipped yet)' })
  @IsOptional()
  @IsBoolean()
  domCheckInNfcEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Show QR check-in on the carer app (scanner not shipped yet)' })
  @IsOptional()
  @IsBoolean()
  domCheckInQrEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 50000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50000)
  domGeofenceToleranceMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domDownloadAllServiceUsers?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  domFutureVisitsDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domAutoExtendRotaEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  domRotaHorizonDays?: number;

  @ApiPropertyOptional({ enum: ['FIXED_DAYS', 'CALENDAR_MONTH'] })
  @IsOptional()
  @IsIn(['FIXED_DAYS', 'CALENDAR_MONTH'])
  domRotaHorizonMode?: 'FIXED_DAYS' | 'CALENDAR_MONTH';

  @ApiPropertyOptional({ minimum: 0, maximum: 23 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  domAutoExtendRotaRunHour?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domShowWeeklyHours?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domShowServiceUserName?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domShowBlockedCarersInSchedule?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domLateVisitAlertRequired?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 240 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  domLateVisitAlertMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domLateVisitAlertEmail?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domLateVisitAlertText?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  domLateVisitAlertNotification?: boolean;

  @ApiPropertyOptional({ type: [DomLateVisitZoneAlertDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DomLateVisitZoneAlertDto)
  domLateVisitZoneAlerts?: DomLateVisitZoneAlertDto[];

  @ApiPropertyOptional({ type: [DomCareShiftDefinitionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DomCareShiftDefinitionDto)
  domCareShiftDefinitions?: DomCareShiftDefinitionDto[];

  @ApiPropertyOptional({ type: [DomCareAllocationRuleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DomCareAllocationRuleDto)
  domCareAllocationRules?: DomCareAllocationRuleDto[];

  @ApiPropertyOptional({ minimum: 1, maximum: 10080 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10080)
  incidentDetailsEditableMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 8760 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  incidentDisplayHours?: number;

  @ApiPropertyOptional({ enum: INCIDENT_DEFAULT_STATUSES })
  @IsOptional()
  @IsIn([...INCIDENT_DEFAULT_STATUSES])
  incidentDefaultStatus?: (typeof INCIDENT_DEFAULT_STATUSES)[number];

  @ApiPropertyOptional({ type: [IncidentTypeSettingDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IncidentTypeSettingDto)
  incidentTypeSettings?: IncidentTypeSettingDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalEmarIntegration?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalMedicationListRequired?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optionalMedicationAmendRoles?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalMhaDetentionRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalRestraintRecordingRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalCarePlanReadRequired?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  optionalCarePlanReadCycleMonths?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalFormBuilderRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalRemoveCreateNewCarePlan?: boolean;

  @ApiPropertyOptional({ type: [OptionalAboutMeFieldDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionalAboutMeFieldDto)
  optionalAboutMeFields?: OptionalAboutMeFieldDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalServiceManagementRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalLearningDevSessionsRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalFamilyPortalEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalFamilySharingAuthRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalFamilyShareAllActions?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalFamilyShareCarePlans?: boolean;

  @ApiPropertyOptional({ type: OptionalFamilyShareVisitInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OptionalFamilyShareVisitInfoDto)
  optionalFamilyShareVisitInfo?: OptionalFamilyShareVisitInfoDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalAllowInspectorLogin?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  preAssessmentCareRequired?: boolean;

  @ApiPropertyOptional({ type: [PreAssessmentChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreAssessmentChecklistItemDto)
  preAssessmentComponents?: PreAssessmentChecklistItemDto[];

  @ApiPropertyOptional({ type: [PreAssessmentChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreAssessmentChecklistItemDto)
  preAssessmentForms?: PreAssessmentChecklistItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  alertActionsOverdueEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 1440 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  alertActionsOverdueMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  alertRequiredCheckNotTicked?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  alertRequiredMedicationNotGiven?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 168 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  alertScheduleJobsBeforeHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  alertBeepOnNewAlert?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  alertFluidAlertsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  criticalGenerateActions?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  criticalMemorableAnswerRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  criticalLockdownWebAccess?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  criticalLockdownCareAppAccess?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  appSettingPinCodeRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  appSettingViewPoliciesCareApp?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  appSettingViewPoliciesRosterApp?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  appSettingBookHolidaysCareApp?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  appSettingFingerprintLoginCareApp?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  privacyNonActiveServiceUserDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  privacyNotifyInternalMessage?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  privacyNotifyEmail?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  privacySensitiveViewerRoles?: string[];
}
