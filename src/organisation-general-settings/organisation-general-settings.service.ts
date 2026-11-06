import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { hasAnyCheckInMethodEnabled } from '../employee-app/employee-app-check-in-methods.util';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateOrganisationGeneralSettingsDto } from './dto/update-organisation-general-settings.dto';
import {
  parseDomJobCancellationRules,
  parseDomLateVisitZoneAlerts,
  serializeDomJobCancellationRules,
  serializeDomLateVisitZoneAlerts,
  type DomJobCancellationRule,
  type DomLateVisitBranch,
  type DomLateVisitZoneAlert,
} from './dom-care-settings.util';
import {
  parseIncidentDefaultStatus,
  parseIncidentTypeSettings,
  parseIncidentSeveritySettings,
  parseIncidentWhoInformedSettings,
  serializeIncidentTypeSettings,
  incidentStatusLabel,
  type IncidentTypeSetting,
} from './incident-management.util';
import {
  parseServiceUserWeeklyHoursSettings,
  type ServiceUserWeeklyHoursSettings,
} from './service-user-weekly-hours-settings.util';
import { parseSupervisionSettings, type SupervisionSettings } from './supervision-settings.util';
import { parseReviewSettings, type ReviewSettings } from './review-settings.util';
import {
  DEFAULT_WEEKLY_HOURS_RULE_OPTIONS,
  parseDomCareAllocationRules,
  serializeDomCareAllocationRules,
  WEEKLY_HOURS_RULE_KEY,
  type DomAllocationRuleBehavior,
  type DomCareAllocationRule,
  type DomWeeklyHoursRuleOptions,
} from './dom-care-allocation-rules.util';
import {
  parseDomCareShiftDefinitions,
  serializeDomCareShiftDefinitions,
  type DomCareShiftDefinition,
} from './dom-care-shifts.util';
import { parseOrganisationOptionalSettings } from './optional-settings.util';
import {
  parseOrganisationPreAssessmentSettings,
  serializePreAssessmentChecklist,
  type PreAssessmentChecklistItem,
} from './pre-assessment-settings.util';
import { parseOrganisationAlertsSettings } from './alerts-settings.util';
import { parseOrganisationCriticalInformationSettings } from './critical-information-settings.util';
import { parseOrganisationAppSettings } from './app-settings.util';
import { parseOrganisationPrivacySettings } from './privacy-settings.util';
import {
  parseEmployeeVisaTypes,
  serializeEmployeeVisaTypes,
  type EmployeeVisaType,
} from './employee-visa-types.util';
import { parseRotaHorizonMode } from '../service-user-visit-plans/visit-plan-rolling-rota.util';
import { clampOrgMaxBackfillDays } from '../service-user-visit-plans/visit-plan-slot-carer-resolve.util';
import {
  DEFAULT_ORGANISATION_TIMEZONE,
  isOrganisationTimezone,
} from './organisation-timezone';
import { getOperationalTimeZone } from '../common/utils/operational-day.util';
import {
  resolveDateDisplayFormat,
  resolveTimeDisplayFormat,
  type DateDisplayFormat,
  type TimeDisplayFormat,
} from '../common/utils/organisation-display-format.util';

const DEFAULT_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';

const CREATE_DEFAULTS = {
  id: DEFAULT_SETTINGS_ID,
  handoverReportLastHours: 12,
  archiveServiceUserAfterMonths: 3,
  timeDisplayFormat: 'HH_MM' as const,
  dateDisplayFormat: 'DD_MM_YYYY' as const,
  timezone: DEFAULT_ORGANISATION_TIMEZONE,
};

type SettingsRow = {
  id: string;
  handoverReportLastHours: number;
  incidentCandourOverdueDays: number | null;
  archiveServiceUserAfterMonths: number;
  timeDisplayFormat: string;
  dateDisplayFormat: string;
  timezone?: string | null;
  bankHolidayRegion?: string | null;
  defaultCarerStatus: string;
  sendEmailWhenEmployeeActive: boolean;
  allowMultipleRoles: boolean;
  allowWeekendDaysInHoliday: boolean;
  mandateComplianceForNewEmployees: boolean;
  defaultHolidaysUnit: string;
  salaryCalculationBasis: string;
  multiCarerFunderChargeMode: string;
  recruitmentFunctionalityRequired: boolean;
  complianceRequiredBy: string;
  complianceApprovalForNewEmployee: string;
  complianceAllocationMode: string;
  complianceBlockStatuses: string[];
  includeLearningInAllocationBlock: boolean;
  calculateSicknessBradfordScale: boolean;
  recordServiceUserWellbeing: boolean;
  recordEmployeeWellbeing: boolean;
  wellbeingRegularity: string;
  wellbeingLabel1: string;
  wellbeingLabel2: string;
  wellbeingLabel3: string;
  wellbeingLabel4: string;
  wellbeingLabel5: string;
  enhancedRegularActionChecks: boolean;
  showRegularActionsInDailyList: boolean;
  allowFastAction: boolean;
  actionsDefaultView: string;
  appDefaultToObservationsTab: boolean;
  allocateEmployeeBy: string;
  restrictCarerToAllocatedServiceUsers: boolean;
  restrictLoginToShiftTimes: boolean;
  preventCarerWebLogin: boolean;
  shiftAccessMinutesBefore: number;
  shiftAccessMinutesAfter: number;
  domJobCancellationRules: unknown;
  domGlobalToleranceMinutes: number;
  domGeofenceDistanceMeters: number;
  domWorkPatternCycles: number;
  domShowAllEmployeesAcrossZones: boolean;
  domEmailTomorrowsSchedule: boolean;
  domAppShowHoursBefore: number;
  domRestrictJobOutsideGeofence: boolean;
  domCheckInGpsEnabled: boolean;
  domCheckInManualEnabled: boolean;
  domCheckInNfcEnabled: boolean;
  domCheckInQrEnabled: boolean;
  domGeofenceToleranceMeters: number;
  domDownloadAllServiceUsers: boolean;
  domFutureVisitsDays: number;
  domAutoExtendRotaEnabled: boolean;
  domCancellationHospitalExemption: boolean;
  domRotaHorizonDays: number;
  domRotaHorizonMode: string;
  domAutoExtendRotaRunHour: number;
  domMaxBackfillDays: number;
  domShowWeeklyHours: boolean;
  domShowServiceUserName: boolean;
  domShowBlockedCarersInSchedule: boolean;
  domLateVisitAlertRequired: boolean;
  domLateVisitAlertMinutes: number;
  domLateVisitAlertEmail: boolean;
  domLateVisitAlertText: boolean;
  domLateVisitAlertNotification: boolean;
  domTextAlertsSentThisMonth: number;
  domTextAlertsSentLastMonth: number;
  domLateVisitZoneAlerts: unknown;
  domCareShiftDefinitions: unknown;
  domCareAllocationRules: unknown;
  serviceUserWeeklyHoursSettings: unknown;
  supervisionSettings: unknown;
  reviewSettings: unknown;
  incidentDetailsEditableMinutes: number;
  incidentDisplayHours: number;
  incidentDefaultStatus: string;
  incidentTypeSettings: unknown;
  incidentSeveritySettings: unknown;
  incidentWhoInformedSettings: unknown;
  optionalEmarIntegration: boolean;
  optionalMedicationListRequired: boolean;
  optionalMedicationAmendRoles: unknown;
  optionalMhaDetentionRequired: boolean;
  optionalRestraintRecordingRequired: boolean;
  optionalCarePlanReadRequired: boolean;
  optionalCarePlanReadCycleMonths: number;
  optionalFormBuilderRequired: boolean;
  optionalRemoveCreateNewCarePlan: boolean;
  optionalAboutMeFields: unknown;
  optionalServiceManagementRequired: boolean;
  optionalLearningDevSessionsRequired: boolean;
  optionalFamilyPortalEnabled: boolean;
  optionalFamilySharingAuthRequired: boolean;
  optionalFamilyShareAllActions: boolean;
  optionalFamilyShareCarePlans: boolean;
  optionalFamilyShareVisitInfo: unknown;
  optionalAllowInspectorLogin: boolean;
  preAssessmentCareRequired: boolean;
  preAssessmentComponents: unknown;
  preAssessmentForms: unknown;
  alertActionsOverdueEnabled: boolean;
  alertActionsOverdueMinutes: number;
  alertRequiredCheckNotTicked: boolean;
  alertRequiredMedicationNotGiven: boolean;
  alertScheduleJobsBeforeHours: number;
  alertBeepOnNewAlert: boolean;
  alertFluidAlertsEnabled: boolean;
  criticalGenerateActions: boolean;
  criticalMemorableAnswerRequired: boolean;
  criticalLockdownWebAccess: boolean;
  criticalLockdownCareAppAccess: boolean;
  appSettingPinCodeRequired: boolean;
  appSettingViewPoliciesCareApp: boolean;
  appSettingViewPoliciesRosterApp: boolean;
  appSettingBookHolidaysCareApp: boolean;
  appSettingFingerprintLoginCareApp: boolean;
  appSettingSingleDeviceLoginCareApp: boolean;
  privacyNonActiveServiceUserDays: number;
  privacyNotifyInternalMessage: boolean;
  privacyNotifyEmail: boolean;
  privacySensitiveViewerRoles: unknown;
  employeeVisaTypes: unknown;
  updatedAt: Date;
};

function toIso(updatedAt: Date | string): string {
  if (updatedAt instanceof Date) return updatedAt.toISOString();
  return new Date(updatedAt).toISOString();
}

function mapRow(row: SettingsRow, lateVisitBranches?: DomLateVisitBranch[]) {
  return {
    id: row.id,
    handoverReportLastHours: row.handoverReportLastHours,
    incidentCandourOverdueDays: row.incidentCandourOverdueDays,
    archiveServiceUserAfterMonths: row.archiveServiceUserAfterMonths,
    timeDisplayFormat: row.timeDisplayFormat,
    dateDisplayFormat: row.dateDisplayFormat,
    timezone: isOrganisationTimezone(row.timezone ?? '')
      ? row.timezone!
      : DEFAULT_ORGANISATION_TIMEZONE,
    /** Bank holidays for working-day timescales: UK (England and Wales), SCOTLAND or NORTHERN_IRELAND. */
    bankHolidayRegion: row.bankHolidayRegion ?? 'UK',
    defaultCarerStatus: row.defaultCarerStatus,
    sendEmailWhenEmployeeActive: row.sendEmailWhenEmployeeActive,
    allowMultipleRoles: row.allowMultipleRoles,
    allowWeekendDaysInHoliday: row.allowWeekendDaysInHoliday,
    mandateComplianceForNewEmployees: row.mandateComplianceForNewEmployees,
    defaultHolidaysUnit: row.defaultHolidaysUnit,
    salaryCalculationBasis: row.salaryCalculationBasis,
    multiCarerFunderChargeMode: row.multiCarerFunderChargeMode,
    recruitmentFunctionalityRequired: row.recruitmentFunctionalityRequired,
    complianceRequiredBy: row.complianceRequiredBy,
    complianceApprovalForNewEmployee: row.complianceApprovalForNewEmployee,
    complianceAllocationMode: row.complianceAllocationMode === 'BLOCK' ? 'BLOCK' : 'WARN',
    complianceBlockStatuses: Array.isArray(row.complianceBlockStatuses)
      ? row.complianceBlockStatuses
      : ['MISSING', 'EXPIRED', 'REJECTED'],
    includeLearningInAllocationBlock: Boolean(row.includeLearningInAllocationBlock),
    calculateSicknessBradfordScale: row.calculateSicknessBradfordScale,
    recordServiceUserWellbeing: row.recordServiceUserWellbeing,
    recordEmployeeWellbeing: row.recordEmployeeWellbeing,
    wellbeingRegularity: row.wellbeingRegularity,
    wellbeingLabels: [
      row.wellbeingLabel1,
      row.wellbeingLabel2,
      row.wellbeingLabel3,
      row.wellbeingLabel4,
      row.wellbeingLabel5,
    ],
    enhancedRegularActionChecks: row.enhancedRegularActionChecks,
    showRegularActionsInDailyList: row.showRegularActionsInDailyList,
    allowFastAction: row.allowFastAction,
    actionsDefaultView: row.actionsDefaultView,
    appDefaultToObservationsTab: row.appDefaultToObservationsTab,
    allocateEmployeeBy: row.allocateEmployeeBy,
    restrictCarerToAllocatedServiceUsers: row.restrictCarerToAllocatedServiceUsers,
    restrictLoginToShiftTimes: row.restrictLoginToShiftTimes,
    preventCarerWebLogin: row.preventCarerWebLogin,
    shiftAccessMinutesBefore: row.shiftAccessMinutesBefore,
    shiftAccessMinutesAfter: row.shiftAccessMinutesAfter,
    domJobCancellationRules: parseDomJobCancellationRules(
      row.domJobCancellationRules as Parameters<typeof parseDomJobCancellationRules>[0],
    ),
    domGlobalToleranceMinutes: row.domGlobalToleranceMinutes,
    domGeofenceDistanceMeters: row.domGeofenceDistanceMeters,
    domWorkPatternCycles: row.domWorkPatternCycles,
    domShowAllEmployeesAcrossZones: row.domShowAllEmployeesAcrossZones,
    domEmailTomorrowsSchedule: row.domEmailTomorrowsSchedule,
    domAppShowHoursBefore: row.domAppShowHoursBefore,
    domRestrictJobOutsideGeofence: row.domRestrictJobOutsideGeofence,
    domCheckInGpsEnabled: row.domCheckInGpsEnabled,
    domCheckInManualEnabled: row.domCheckInManualEnabled,
    domCheckInNfcEnabled: row.domCheckInNfcEnabled,
    domCheckInQrEnabled: row.domCheckInQrEnabled,
    domGeofenceToleranceMeters: row.domGeofenceToleranceMeters,
    domDownloadAllServiceUsers: row.domDownloadAllServiceUsers,
    domFutureVisitsDays: row.domFutureVisitsDays,
    domAutoExtendRotaEnabled: row.domAutoExtendRotaEnabled,
    domCancellationHospitalExemption: row.domCancellationHospitalExemption,
    domRotaHorizonDays: row.domRotaHorizonDays,
    domRotaHorizonMode: parseRotaHorizonMode(row.domRotaHorizonMode),
    domAutoExtendRotaRunHour: row.domAutoExtendRotaRunHour,
    domMaxBackfillDays: row.domMaxBackfillDays,
    domShowWeeklyHours: row.domShowWeeklyHours,
    domShowServiceUserName: row.domShowServiceUserName,
    domShowBlockedCarersInSchedule: row.domShowBlockedCarersInSchedule,
    domLateVisitAlertRequired: row.domLateVisitAlertRequired,
    domLateVisitAlertMinutes: row.domLateVisitAlertMinutes,
    domLateVisitAlertEmail: row.domLateVisitAlertEmail,
    domLateVisitAlertText: row.domLateVisitAlertText,
    domLateVisitAlertNotification: row.domLateVisitAlertNotification,
    domTextAlertsSentThisMonth: row.domTextAlertsSentThisMonth,
    domTextAlertsSentLastMonth: row.domTextAlertsSentLastMonth,
    domLateVisitZoneAlerts: parseDomLateVisitZoneAlerts(
      row.domLateVisitZoneAlerts as Parameters<typeof parseDomLateVisitZoneAlerts>[0],
      lateVisitBranches,
    ),
    domCareShiftDefinitions: parseDomCareShiftDefinitions(
      row.domCareShiftDefinitions as Parameters<typeof parseDomCareShiftDefinitions>[0],
    ),
    domCareAllocationRules: parseDomCareAllocationRules(
      row.domCareAllocationRules as Parameters<typeof parseDomCareAllocationRules>[0],
    ),
    serviceUserWeeklyHoursSettings: parseServiceUserWeeklyHoursSettings(
      row.serviceUserWeeklyHoursSettings as Parameters<typeof parseServiceUserWeeklyHoursSettings>[0],
    ),
    supervisionSettings: parseSupervisionSettings(
      row.supervisionSettings as Parameters<typeof parseSupervisionSettings>[0],
    ),
    reviewSettings: parseReviewSettings(row.reviewSettings as Parameters<typeof parseReviewSettings>[0]),
    incidentDetailsEditableMinutes: row.incidentDetailsEditableMinutes,
    incidentDisplayHours: row.incidentDisplayHours,
    incidentDefaultStatus: parseIncidentDefaultStatus(row.incidentDefaultStatus),
    incidentDefaultStatusLabel: incidentStatusLabel(parseIncidentDefaultStatus(row.incidentDefaultStatus)),
    incidentTypeSettings: parseIncidentTypeSettings(
      row.incidentTypeSettings as Parameters<typeof parseIncidentTypeSettings>[0],
    ),
    incidentSeveritySettings: parseIncidentSeveritySettings(
      row.incidentSeveritySettings as Parameters<typeof parseIncidentSeveritySettings>[0],
    ),
    incidentWhoInformedSettings: parseIncidentWhoInformedSettings(
      row.incidentWhoInformedSettings as Parameters<typeof parseIncidentWhoInformedSettings>[0],
    ),
    optionalSettings: parseOrganisationOptionalSettings(row),
    preAssessmentSettings: parseOrganisationPreAssessmentSettings(row),
    alertsSettings: parseOrganisationAlertsSettings(row),
    criticalInformationSettings: parseOrganisationCriticalInformationSettings(row),
    appSettings: parseOrganisationAppSettings(row),
    privacySettings: parseOrganisationPrivacySettings(row),
    employeeVisaTypes: parseEmployeeVisaTypes(row.employeeVisaTypes),
    updatedAt: toIso(row.updatedAt),
  };
}

function buildUpdateData(
  userId: string,
  dto: UpdateOrganisationGeneralSettingsDto,
): Prisma.OrganisationGeneralSettingsUpdateInput {
  const data: Prisma.OrganisationGeneralSettingsUpdateInput = {
    updatedBy: { connect: { id: userId } },
  };

  const set = <K extends keyof Prisma.OrganisationGeneralSettingsUpdateInput>(
    key: K,
    value: Prisma.OrganisationGeneralSettingsUpdateInput[K] | undefined,
  ) => {
    if (value !== undefined) data[key] = value;
  };

  set('handoverReportLastHours', dto.handoverReportLastHours);
  set('incidentCandourOverdueDays', dto.incidentCandourOverdueDays);
  set('archiveServiceUserAfterMonths', dto.archiveServiceUserAfterMonths);
  set('timeDisplayFormat', dto.timeDisplayFormat);
  set('dateDisplayFormat', dto.dateDisplayFormat);
  set('timezone', dto.timezone);
  set('bankHolidayRegion', dto.bankHolidayRegion);
  set('defaultCarerStatus', dto.defaultCarerStatus);
  set('sendEmailWhenEmployeeActive', dto.sendEmailWhenEmployeeActive);
  set('allowMultipleRoles', dto.allowMultipleRoles);
  set('allowWeekendDaysInHoliday', dto.allowWeekendDaysInHoliday);
  set('mandateComplianceForNewEmployees', dto.mandateComplianceForNewEmployees);
  set('defaultHolidaysUnit', dto.defaultHolidaysUnit);
  set('salaryCalculationBasis', dto.salaryCalculationBasis);
  set('multiCarerFunderChargeMode', dto.multiCarerFunderChargeMode);
  set('recruitmentFunctionalityRequired', dto.recruitmentFunctionalityRequired);
  set('complianceRequiredBy', dto.complianceRequiredBy);
  set('complianceApprovalForNewEmployee', dto.complianceApprovalForNewEmployee);
  set('complianceAllocationMode', dto.complianceAllocationMode);
  if (dto.complianceBlockStatuses !== undefined) {
    data.complianceBlockStatuses = dto.complianceBlockStatuses;
  }
  set('includeLearningInAllocationBlock', dto.includeLearningInAllocationBlock);
  set('calculateSicknessBradfordScale', dto.calculateSicknessBradfordScale);
  set('recordServiceUserWellbeing', dto.recordServiceUserWellbeing);
  set('recordEmployeeWellbeing', dto.recordEmployeeWellbeing);
  set('wellbeingRegularity', dto.wellbeingRegularity);
  set('wellbeingLabel1', dto.wellbeingLabel1?.trim());
  set('wellbeingLabel2', dto.wellbeingLabel2?.trim());
  set('wellbeingLabel3', dto.wellbeingLabel3?.trim());
  set('wellbeingLabel4', dto.wellbeingLabel4?.trim());
  set('wellbeingLabel5', dto.wellbeingLabel5?.trim());
  if (dto.employeeVisaTypes !== undefined) {
    data.employeeVisaTypes = serializeEmployeeVisaTypes(
      dto.employeeVisaTypes as EmployeeVisaType[],
    );
  }
  set('enhancedRegularActionChecks', dto.enhancedRegularActionChecks);
  set('showRegularActionsInDailyList', dto.showRegularActionsInDailyList);
  set('allowFastAction', dto.allowFastAction);
  set('actionsDefaultView', dto.actionsDefaultView);
  set('appDefaultToObservationsTab', dto.appDefaultToObservationsTab);
  set('allocateEmployeeBy', dto.allocateEmployeeBy);
  set('restrictCarerToAllocatedServiceUsers', dto.restrictCarerToAllocatedServiceUsers);
  set('restrictLoginToShiftTimes', dto.restrictLoginToShiftTimes);
  set('preventCarerWebLogin', dto.preventCarerWebLogin);
  set('shiftAccessMinutesBefore', dto.shiftAccessMinutesBefore);
  set('shiftAccessMinutesAfter', dto.shiftAccessMinutesAfter);

  if (dto.domJobCancellationRules !== undefined) {
    data.domJobCancellationRules = serializeDomJobCancellationRules(
      dto.domJobCancellationRules as DomJobCancellationRule[],
    );
  }
  set('domGlobalToleranceMinutes', dto.domGlobalToleranceMinutes);
  set('domGeofenceDistanceMeters', dto.domGeofenceDistanceMeters);
  set('domWorkPatternCycles', dto.domWorkPatternCycles);
  set('domShowAllEmployeesAcrossZones', dto.domShowAllEmployeesAcrossZones);
  set('domEmailTomorrowsSchedule', dto.domEmailTomorrowsSchedule);
  set('domAppShowHoursBefore', dto.domAppShowHoursBefore);
  set('domRestrictJobOutsideGeofence', dto.domRestrictJobOutsideGeofence);
  set('domCheckInGpsEnabled', dto.domCheckInGpsEnabled);
  set('domCheckInManualEnabled', dto.domCheckInManualEnabled);
  set('domCheckInNfcEnabled', dto.domCheckInNfcEnabled);
  set('domCheckInQrEnabled', dto.domCheckInQrEnabled);
  set('domGeofenceToleranceMeters', dto.domGeofenceToleranceMeters);
  set('domDownloadAllServiceUsers', dto.domDownloadAllServiceUsers);
  set('domFutureVisitsDays', dto.domFutureVisitsDays);
  set('domAutoExtendRotaEnabled', dto.domAutoExtendRotaEnabled);
  set('domCancellationHospitalExemption', dto.domCancellationHospitalExemption);
  set('domRotaHorizonDays', dto.domRotaHorizonDays);
  set('domRotaHorizonMode', dto.domRotaHorizonMode);
  set('domAutoExtendRotaRunHour', dto.domAutoExtendRotaRunHour);
  set('domMaxBackfillDays', dto.domMaxBackfillDays);
  set('domShowWeeklyHours', dto.domShowWeeklyHours);
  set('domShowServiceUserName', dto.domShowServiceUserName);
  set('domShowBlockedCarersInSchedule', dto.domShowBlockedCarersInSchedule);
  set('domLateVisitAlertRequired', dto.domLateVisitAlertRequired);
  set('domLateVisitAlertMinutes', dto.domLateVisitAlertMinutes);
  set('domLateVisitAlertEmail', dto.domLateVisitAlertEmail);
  set('domLateVisitAlertText', dto.domLateVisitAlertText);
  set('domLateVisitAlertNotification', dto.domLateVisitAlertNotification);
  if (dto.domLateVisitZoneAlerts !== undefined) {
    data.domLateVisitZoneAlerts = serializeDomLateVisitZoneAlerts(
      dto.domLateVisitZoneAlerts as DomLateVisitZoneAlert[],
    );
  }
  if (dto.domCareShiftDefinitions !== undefined) {
    data.domCareShiftDefinitions = serializeDomCareShiftDefinitions(
      dto.domCareShiftDefinitions as DomCareShiftDefinition[],
    );
  }
  if (dto.domCareAllocationRules !== undefined) {
    data.domCareAllocationRules = serializeDomCareAllocationRules(
      dto.domCareAllocationRules as DomCareAllocationRule[],
    );
  }
  if (dto.serviceUserWeeklyHoursSettings !== undefined) {
    data.serviceUserWeeklyHoursSettings = parseServiceUserWeeklyHoursSettings(
      dto.serviceUserWeeklyHoursSettings as unknown as Prisma.JsonValue,
    );
  }
  if (dto.reviewSettings !== undefined) {
    data.reviewSettings = parseReviewSettings(dto.reviewSettings as unknown as Prisma.JsonValue);
  }
  if (dto.supervisionSettings !== undefined) {
    data.supervisionSettings = parseSupervisionSettings(
      dto.supervisionSettings as unknown as Prisma.JsonValue,
    );
  }
  set('incidentDetailsEditableMinutes', dto.incidentDetailsEditableMinutes);
  set('incidentDisplayHours', dto.incidentDisplayHours);
  set('incidentDefaultStatus', dto.incidentDefaultStatus);
  if (dto.incidentTypeSettings !== undefined) {
    data.incidentTypeSettings = serializeIncidentTypeSettings(
      dto.incidentTypeSettings as IncidentTypeSetting[],
    );
  }
  if (dto.incidentSeveritySettings !== undefined) {
    data.incidentSeveritySettings = serializeIncidentTypeSettings(
      dto.incidentSeveritySettings as IncidentTypeSetting[],
    );
  }
  if (dto.incidentWhoInformedSettings !== undefined) {
    data.incidentWhoInformedSettings = serializeIncidentTypeSettings(
      dto.incidentWhoInformedSettings as IncidentTypeSetting[],
    );
  }

  set('optionalEmarIntegration', dto.optionalEmarIntegration);
  set('optionalMedicationListRequired', dto.optionalMedicationListRequired);
  set('optionalMhaDetentionRequired', dto.optionalMhaDetentionRequired);
  set('optionalRestraintRecordingRequired', dto.optionalRestraintRecordingRequired);
  set('optionalCarePlanReadRequired', dto.optionalCarePlanReadRequired);
  set('optionalCarePlanReadCycleMonths', dto.optionalCarePlanReadCycleMonths);
  set('optionalFormBuilderRequired', dto.optionalFormBuilderRequired);
  set('optionalRemoveCreateNewCarePlan', dto.optionalRemoveCreateNewCarePlan);
  set('optionalServiceManagementRequired', dto.optionalServiceManagementRequired);
  set('optionalLearningDevSessionsRequired', dto.optionalLearningDevSessionsRequired);
  set('optionalFamilyPortalEnabled', dto.optionalFamilyPortalEnabled);
  set('optionalFamilySharingAuthRequired', dto.optionalFamilySharingAuthRequired);
  set('optionalFamilyShareAllActions', dto.optionalFamilyShareAllActions);
  set('optionalFamilyShareCarePlans', dto.optionalFamilyShareCarePlans);
  set('optionalAllowInspectorLogin', dto.optionalAllowInspectorLogin);
  if (dto.optionalMedicationAmendRoles !== undefined) {
    data.optionalMedicationAmendRoles = dto.optionalMedicationAmendRoles as Prisma.InputJsonValue;
  }
  if (dto.optionalAboutMeFields !== undefined) {
    data.optionalAboutMeFields = dto.optionalAboutMeFields as unknown as Prisma.InputJsonValue;
  }
  if (dto.optionalFamilyShareVisitInfo !== undefined) {
    data.optionalFamilyShareVisitInfo =
      dto.optionalFamilyShareVisitInfo as unknown as Prisma.InputJsonValue;
  }

  set('preAssessmentCareRequired', dto.preAssessmentCareRequired);
  if (dto.preAssessmentComponents !== undefined) {
    data.preAssessmentComponents = serializePreAssessmentChecklist(
      dto.preAssessmentComponents as PreAssessmentChecklistItem[],
    );
  }
  if (dto.preAssessmentForms !== undefined) {
    data.preAssessmentForms = serializePreAssessmentChecklist(
      dto.preAssessmentForms as PreAssessmentChecklistItem[],
    );
  }

  set('alertActionsOverdueEnabled', dto.alertActionsOverdueEnabled);
  set('alertActionsOverdueMinutes', dto.alertActionsOverdueMinutes);
  set('alertRequiredCheckNotTicked', dto.alertRequiredCheckNotTicked);
  set('alertRequiredMedicationNotGiven', dto.alertRequiredMedicationNotGiven);
  set('alertScheduleJobsBeforeHours', dto.alertScheduleJobsBeforeHours);
  set('alertBeepOnNewAlert', dto.alertBeepOnNewAlert);
  set('alertFluidAlertsEnabled', dto.alertFluidAlertsEnabled);

  set('criticalGenerateActions', dto.criticalGenerateActions);
  set('criticalMemorableAnswerRequired', dto.criticalMemorableAnswerRequired);
  set('criticalLockdownWebAccess', dto.criticalLockdownWebAccess);
  set('criticalLockdownCareAppAccess', dto.criticalLockdownCareAppAccess);

  set('appSettingPinCodeRequired', dto.appSettingPinCodeRequired);
  set('appSettingViewPoliciesCareApp', dto.appSettingViewPoliciesCareApp);
  set('appSettingViewPoliciesRosterApp', dto.appSettingViewPoliciesRosterApp);
  set('appSettingBookHolidaysCareApp', dto.appSettingBookHolidaysCareApp);
  set('appSettingFingerprintLoginCareApp', dto.appSettingFingerprintLoginCareApp);
  set('appSettingSingleDeviceLoginCareApp', dto.appSettingSingleDeviceLoginCareApp);

  set('privacyNonActiveServiceUserDays', dto.privacyNonActiveServiceUserDays);
  set('privacyNotifyInternalMessage', dto.privacyNotifyInternalMessage);
  set('privacyNotifyEmail', dto.privacyNotifyEmail);
  if (dto.privacySensitiveViewerRoles !== undefined) {
    data.privacySensitiveViewerRoles = dto.privacySensitiveViewerRoles as Prisma.InputJsonValue;
  }

  return data;
}

@Injectable()
export class OrganisationGeneralSettingsService {
  private readonly logger = new Logger(OrganisationGeneralSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreate() {
    let row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: DEFAULT_SETTINGS_ID },
    });
    if (row) return row;
    row = await this.prisma.organisationGeneralSettings.create({
      data: CREATE_DEFAULTS,
    });
    return row;
  }

  /** Live branches for the Dom Care late-visit alert list (same filter as GET /schedule-areas). */
  private lateVisitBranches(): Promise<DomLateVisitBranch[]> {
    return this.prisma.scheduleArea.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        location: { select: { name: true } },
        zone: { select: { name: true } },
      },
    });
  }

  async get() {
    const [row, branches] = await Promise.all([this.getOrCreate(), this.lateVisitBranches()]);
    return { data: mapRow(row as SettingsRow, branches) };
  }

  /** Care-app: block a second login while a refresh session is still live. Default off. */
  async isSingleDeviceLoginCareApp(): Promise<boolean> {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: DEFAULT_SETTINGS_ID },
      select: { appSettingSingleDeviceLoginCareApp: true },
    });
    return row?.appSettingSingleDeviceLoginCareApp ?? false;
  }

  /** Bank holiday region for working-day timescales (UK = England and Wales). */
  async getBankHolidayRegion(): Promise<string> {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: DEFAULT_SETTINGS_ID },
      select: { bankHolidayRegion: true },
    });
    return row?.bankHolidayRegion || 'UK';
  }

  /** Operational IANA timezone for schedules / ECM / calendar "today". */
  async getOperationalTimezone(): Promise<string> {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: DEFAULT_SETTINGS_ID },
      select: { timezone: true },
    });
    return getOperationalTimeZone(row?.timezone);
  }

  /** Settings → Supervision (defaults when never saved). */
  async getSupervisionSettings(): Promise<SupervisionSettings> {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: DEFAULT_SETTINGS_ID },
      select: { supervisionSettings: true },
    });
    return parseSupervisionSettings(row?.supervisionSettings);
  }

  /** Settings → Reviews & reminders (defaults when never saved). */
  async getReviewSettings(): Promise<ReviewSettings> {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: DEFAULT_SETTINGS_ID },
      select: { reviewSettings: true },
    });
    return parseReviewSettings(row?.reviewSettings);
  }

  /** Most days back Backfill past visits may create (Settings → Dom Care); 0 = backfill off. */
  async getMaxBackfillDays(): Promise<number> {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: DEFAULT_SETTINGS_ID },
      select: { domMaxBackfillDays: true },
    });
    return clampOrgMaxBackfillDays(row?.domMaxBackfillDays);
  }

  /** Service user weekly hours rules (defaults when never saved). */
  async getServiceUserWeeklyHoursSettings(): Promise<ServiceUserWeeklyHoursSettings> {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: DEFAULT_SETTINGS_ID },
      select: { serviceUserWeeklyHoursSettings: true },
    });
    return parseServiceUserWeeklyHoursSettings(row?.serviceUserWeeklyHoursSettings);
  }

  /** Settings → Dom Rules "Carer over weekly hours" (read fresh: it can change at runtime). */
  async getCarerWeeklyHoursRule(): Promise<
    DomWeeklyHoursRuleOptions & { behavior: DomAllocationRuleBehavior; graceMinutes: number }
  > {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: DEFAULT_SETTINGS_ID },
      select: { domCareAllocationRules: true },
    });
    const rule = parseDomCareAllocationRules(
      row?.domCareAllocationRules as Parameters<typeof parseDomCareAllocationRules>[0],
    ).find((r) => r.key === WEEKLY_HOURS_RULE_KEY);
    return {
      ...DEFAULT_WEEKLY_HOURS_RULE_OPTIONS,
      ...rule?.weeklyHours,
      behavior: rule?.behavior ?? 'MANAGER_APPROVAL',
      graceMinutes: rule?.minutes ?? 0,
    };
  }

  /** Operational timezone + date/time display formats for exports and UI helpers. */
  async getOperationalDisplaySettings(): Promise<{
    timeZone: string;
    dateDisplayFormat: DateDisplayFormat;
    timeDisplayFormat: TimeDisplayFormat;
  }> {
    const row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: DEFAULT_SETTINGS_ID },
      select: {
        timezone: true,
        dateDisplayFormat: true,
        timeDisplayFormat: true,
      },
    });
    return {
      timeZone: getOperationalTimeZone(row?.timezone),
      dateDisplayFormat: resolveDateDisplayFormat(row?.dateDisplayFormat),
      timeDisplayFormat: resolveTimeDisplayFormat(row?.timeDisplayFormat),
    };
  }

  async update(userId: string, dto: UpdateOrganisationGeneralSettingsDto) {
    const existing = await this.getOrCreate();
    const mergedCheckIn = {
      domCheckInGpsEnabled:
        dto.domCheckInGpsEnabled ?? existing.domCheckInGpsEnabled,
      domCheckInManualEnabled:
        dto.domCheckInManualEnabled ?? existing.domCheckInManualEnabled,
      domCheckInNfcEnabled:
        dto.domCheckInNfcEnabled ?? existing.domCheckInNfcEnabled,
      domCheckInQrEnabled:
        dto.domCheckInQrEnabled ?? existing.domCheckInQrEnabled,
    };
    if (!hasAnyCheckInMethodEnabled(mergedCheckIn)) {
      throw new BadRequestException('Leave at least one check-in method on.');
    }
    try {
      const row = await this.prisma.organisationGeneralSettings.update({
        where: { id: existing.id },
        data: buildUpdateData(userId, dto),
      });
      return {
        message: 'General settings updated',
        data: mapRow(row as SettingsRow, await this.lateVisitBranches()),
      };
    } catch (error) {
      this.logger.error('Failed to update organisation general settings', error);
      throw error;
    }
  }
}
