import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateOrganisationGeneralSettingsDto } from './dto/update-organisation-general-settings.dto';

const DEFAULT_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';

const CREATE_DEFAULTS = {
  id: DEFAULT_SETTINGS_ID,
  reviewCarePlanAfterDays: 180,
  handoverReportLastHours: 12,
  archiveServiceUserAfterMonths: 3,
  timeDisplayFormat: 'HH_MM' as const,
};

function mapRow(row: {
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
  updatedAt: Date;
}) {
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
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class OrganisationGeneralSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreate() {
    let row = await this.prisma.organisationGeneralSettings.findUnique({
      where: { id: DEFAULT_SETTINGS_ID },
    });
    if (row) return row;
    row = await this.prisma.organisationGeneralSettings.create({
      data: CREATE_DEFAULTS as never,
    });
    return row;
  }

  async get() {
    const row = await this.getOrCreate();
    return { data: mapRow(row as unknown as Parameters<typeof mapRow>[0]) };
  }

  async update(userId: string, dto: UpdateOrganisationGeneralSettingsDto) {
    const existing = await this.getOrCreate();
    const row = await this.prisma.organisationGeneralSettings.update({
      where: { id: existing.id },
      data: {
        reviewCarePlanAfterDays: dto.reviewCarePlanAfterDays,
        handoverReportLastHours: dto.handoverReportLastHours,
        archiveServiceUserAfterMonths: dto.archiveServiceUserAfterMonths,
        timeDisplayFormat: dto.timeDisplayFormat,
        defaultCarerStatus: dto.defaultCarerStatus,
        sendEmailWhenEmployeeActive: dto.sendEmailWhenEmployeeActive,
        allowMultipleRoles: dto.allowMultipleRoles,
        allowWeekendDaysInHoliday: dto.allowWeekendDaysInHoliday,
        mandateComplianceForNewEmployees: dto.mandateComplianceForNewEmployees,
        defaultHolidaysUnit: dto.defaultHolidaysUnit,
        recruitmentFunctionalityRequired: dto.recruitmentFunctionalityRequired,
        complianceRequiredBy: dto.complianceRequiredBy,
        complianceApprovalForNewEmployee: dto.complianceApprovalForNewEmployee,
        calculateSicknessBradfordScale: dto.calculateSicknessBradfordScale,
        recordServiceUserWellbeing: dto.recordServiceUserWellbeing,
        recordEmployeeWellbeing: dto.recordEmployeeWellbeing,
        wellbeingRegularity: dto.wellbeingRegularity,
        wellbeingLabel1: dto.wellbeingLabel1?.trim(),
        wellbeingLabel2: dto.wellbeingLabel2?.trim(),
        wellbeingLabel3: dto.wellbeingLabel3?.trim(),
        wellbeingLabel4: dto.wellbeingLabel4?.trim(),
        wellbeingLabel5: dto.wellbeingLabel5?.trim(),
        enhancedRegularActionChecks: dto.enhancedRegularActionChecks,
        showRegularActionsInDailyList: dto.showRegularActionsInDailyList,
        allowFastAction: dto.allowFastAction,
        actionsDefaultView: dto.actionsDefaultView,
        appDefaultToObservationsTab: dto.appDefaultToObservationsTab,
        allocateEmployeeBy: dto.allocateEmployeeBy,
        restrictCarerToAllocatedServiceUsers: dto.restrictCarerToAllocatedServiceUsers,
        restrictLoginToShiftTimes: dto.restrictLoginToShiftTimes,
        preventCarerWebLogin: dto.preventCarerWebLogin,
        shiftAccessMinutesBefore: dto.shiftAccessMinutesBefore,
        shiftAccessMinutesAfter: dto.shiftAccessMinutesAfter,
        updatedById: userId,
      } as Record<string, unknown>,
    });
    return {
      message: 'General settings updated',
      data: mapRow(row as unknown as Parameters<typeof mapRow>[0]),
    };
  }
}
