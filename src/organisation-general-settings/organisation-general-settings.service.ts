import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateOrganisationGeneralSettingsDto } from './dto/update-organisation-general-settings.dto';
import {
  parseDomJobCancellationRules,
  parseDomLateVisitZoneAlerts,
  serializeDomJobCancellationRules,
  serializeDomLateVisitZoneAlerts,
  type DomJobCancellationRule,
  type DomLateVisitZoneAlert,
} from './dom-care-settings.util';
import {
  parseIncidentDefaultStatus,
  parseIncidentTypeSettings,
  serializeIncidentTypeSettings,
  incidentStatusLabel,
  type IncidentTypeSetting,
} from './incident-management.util';
import {
  parseDomCareAllocationRules,
  serializeDomCareAllocationRules,
  type DomCareAllocationRule,
} from './dom-care-allocation-rules.util';
import {
  parseDomCareShiftDefinitions,
  serializeDomCareShiftDefinitions,
  type DomCareShiftDefinition,
} from './dom-care-shifts.util';

const DEFAULT_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';

const CREATE_DEFAULTS = {
  id: DEFAULT_SETTINGS_ID,
  reviewCarePlanAfterDays: 180,
  handoverReportLastHours: 12,
  archiveServiceUserAfterMonths: 3,
  timeDisplayFormat: 'HH_MM' as const,
};

type SettingsRow = {
  id: string;
  reviewCarePlanAfterDays: number;
  handoverReportLastHours: number;
  archiveServiceUserAfterMonths: number;
  timeDisplayFormat: string;
  defaultCarerStatus: string;
  sendEmailWhenEmployeeActive: boolean;
  allowMultipleRoles: boolean;
  allowWeekendDaysInHoliday: boolean;
  mandateComplianceForNewEmployees: boolean;
  defaultHolidaysUnit: string;
  recruitmentFunctionalityRequired: boolean;
  complianceRequiredBy: string;
  complianceApprovalForNewEmployee: string;
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
  domGeofenceToleranceMeters: number;
  domDownloadAllServiceUsers: boolean;
  domFutureVisitsDays: number;
  domShowWeeklyHours: boolean;
  domShowServiceUserName: boolean;
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
  incidentDetailsEditableMinutes: number;
  incidentDisplayHours: number;
  incidentDefaultStatus: string;
  incidentTypeSettings: unknown;
  updatedAt: Date;
};

function toIso(updatedAt: Date | string): string {
  if (updatedAt instanceof Date) return updatedAt.toISOString();
  return new Date(updatedAt).toISOString();
}

function mapRow(row: SettingsRow) {
  return {
    id: row.id,
    reviewCarePlanAfterDays: row.reviewCarePlanAfterDays,
    handoverReportLastHours: row.handoverReportLastHours,
    archiveServiceUserAfterMonths: row.archiveServiceUserAfterMonths,
    timeDisplayFormat: row.timeDisplayFormat,
    defaultCarerStatus: row.defaultCarerStatus,
    sendEmailWhenEmployeeActive: row.sendEmailWhenEmployeeActive,
    allowMultipleRoles: row.allowMultipleRoles,
    allowWeekendDaysInHoliday: row.allowWeekendDaysInHoliday,
    mandateComplianceForNewEmployees: row.mandateComplianceForNewEmployees,
    defaultHolidaysUnit: row.defaultHolidaysUnit,
    recruitmentFunctionalityRequired: row.recruitmentFunctionalityRequired,
    complianceRequiredBy: row.complianceRequiredBy,
    complianceApprovalForNewEmployee: row.complianceApprovalForNewEmployee,
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
    domGeofenceToleranceMeters: row.domGeofenceToleranceMeters,
    domDownloadAllServiceUsers: row.domDownloadAllServiceUsers,
    domFutureVisitsDays: row.domFutureVisitsDays,
    domShowWeeklyHours: row.domShowWeeklyHours,
    domShowServiceUserName: row.domShowServiceUserName,
    domLateVisitAlertRequired: row.domLateVisitAlertRequired,
    domLateVisitAlertMinutes: row.domLateVisitAlertMinutes,
    domLateVisitAlertEmail: row.domLateVisitAlertEmail,
    domLateVisitAlertText: row.domLateVisitAlertText,
    domLateVisitAlertNotification: row.domLateVisitAlertNotification,
    domTextAlertsSentThisMonth: row.domTextAlertsSentThisMonth,
    domTextAlertsSentLastMonth: row.domTextAlertsSentLastMonth,
    domLateVisitZoneAlerts: parseDomLateVisitZoneAlerts(
      row.domLateVisitZoneAlerts as Parameters<typeof parseDomLateVisitZoneAlerts>[0],
    ),
    domCareShiftDefinitions: parseDomCareShiftDefinitions(
      row.domCareShiftDefinitions as Parameters<typeof parseDomCareShiftDefinitions>[0],
    ),
    domCareAllocationRules: parseDomCareAllocationRules(
      row.domCareAllocationRules as Parameters<typeof parseDomCareAllocationRules>[0],
    ),
    incidentDetailsEditableMinutes: row.incidentDetailsEditableMinutes,
    incidentDisplayHours: row.incidentDisplayHours,
    incidentDefaultStatus: parseIncidentDefaultStatus(row.incidentDefaultStatus),
    incidentDefaultStatusLabel: incidentStatusLabel(parseIncidentDefaultStatus(row.incidentDefaultStatus)),
    incidentTypeSettings: parseIncidentTypeSettings(
      row.incidentTypeSettings as Parameters<typeof parseIncidentTypeSettings>[0],
    ),
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

  set('reviewCarePlanAfterDays', dto.reviewCarePlanAfterDays);
  set('handoverReportLastHours', dto.handoverReportLastHours);
  set('archiveServiceUserAfterMonths', dto.archiveServiceUserAfterMonths);
  set('timeDisplayFormat', dto.timeDisplayFormat);
  set('defaultCarerStatus', dto.defaultCarerStatus);
  set('sendEmailWhenEmployeeActive', dto.sendEmailWhenEmployeeActive);
  set('allowMultipleRoles', dto.allowMultipleRoles);
  set('allowWeekendDaysInHoliday', dto.allowWeekendDaysInHoliday);
  set('mandateComplianceForNewEmployees', dto.mandateComplianceForNewEmployees);
  set('defaultHolidaysUnit', dto.defaultHolidaysUnit);
  set('recruitmentFunctionalityRequired', dto.recruitmentFunctionalityRequired);
  set('complianceRequiredBy', dto.complianceRequiredBy);
  set('complianceApprovalForNewEmployee', dto.complianceApprovalForNewEmployee);
  set('calculateSicknessBradfordScale', dto.calculateSicknessBradfordScale);
  set('recordServiceUserWellbeing', dto.recordServiceUserWellbeing);
  set('recordEmployeeWellbeing', dto.recordEmployeeWellbeing);
  set('wellbeingRegularity', dto.wellbeingRegularity);
  set('wellbeingLabel1', dto.wellbeingLabel1?.trim());
  set('wellbeingLabel2', dto.wellbeingLabel2?.trim());
  set('wellbeingLabel3', dto.wellbeingLabel3?.trim());
  set('wellbeingLabel4', dto.wellbeingLabel4?.trim());
  set('wellbeingLabel5', dto.wellbeingLabel5?.trim());
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
  set('domGeofenceToleranceMeters', dto.domGeofenceToleranceMeters);
  set('domDownloadAllServiceUsers', dto.domDownloadAllServiceUsers);
  set('domFutureVisitsDays', dto.domFutureVisitsDays);
  set('domShowWeeklyHours', dto.domShowWeeklyHours);
  set('domShowServiceUserName', dto.domShowServiceUserName);
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
  set('incidentDetailsEditableMinutes', dto.incidentDetailsEditableMinutes);
  set('incidentDisplayHours', dto.incidentDisplayHours);
  set('incidentDefaultStatus', dto.incidentDefaultStatus);
  if (dto.incidentTypeSettings !== undefined) {
    data.incidentTypeSettings = serializeIncidentTypeSettings(
      dto.incidentTypeSettings as IncidentTypeSetting[],
    );
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

  async get() {
    const row = await this.getOrCreate();
    return { data: mapRow(row as SettingsRow) };
  }

  async update(userId: string, dto: UpdateOrganisationGeneralSettingsDto) {
    const existing = await this.getOrCreate();
    try {
      const row = await this.prisma.organisationGeneralSettings.update({
        where: { id: existing.id },
        data: buildUpdateData(userId, dto),
      });
      return {
        message: 'General settings updated',
        data: mapRow(row as SettingsRow),
      };
    } catch (error) {
      this.logger.error('Failed to update organisation general settings', error);
      throw error;
    }
  }
}
